-- Migration 10: inbjudningar till personer som ännu inte har ett konto.
--
-- Problem: add_club_member/add_team_member (migration 8) kräver att e-posten tillhör ett
-- BEFINTLIGT konto. Det finns ingen väg att lägga till någon som inte registrerat sig än.
--
-- Lösning: väntande inbjudningar. En föreningsadmin kan bjuda in en e-post till föreningen
-- och/eller ett lag. Inbjudan ligger som en väntande post (ingen e-post skickas). När personen
-- sedan skapar ett konto med samma e-post materialiseras inbjudningarna automatiskt till
-- riktiga club_members/team_members via en trigger på auth.users.
--
-- Säkerhetsmönstret är samma som migration 8: SECURITY DEFINER-RPC:er som själva kräver
-- föreningsadmin (is_admin), search_path låst, execute revoked från anon. Tabellerna har RLS
-- men inga policyer för API-roller – all åtkomst går via RPC:erna (precis som platform_admins
-- aldrig nås direkt). E-post lagras normaliserad (lower+trim) så matchning vid registrering
-- blir skiftlägesokänslig.

-- ---------------------------------------------------------------------------
-- Tabeller
-- ---------------------------------------------------------------------------

create table public.club_invites (
  id         uuid primary key default gen_random_uuid(),
  club_id    uuid not null references public.clubs (id) on delete cascade,
  email      text not null,
  role       text not null default 'member' check (role in ('club_admin', 'member')),
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (club_id, email)
);

create index club_invites_email_idx on public.club_invites (email);

create table public.team_invites (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references public.teams (id) on delete cascade,
  email      text not null,
  head_coach boolean not null default false,
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (team_id, email)
);

create index team_invites_email_idx on public.team_invites (email);

-- RLS på, men inga policyer för anon/authenticated: inget nås via PostgREST, bara via RPC:erna.
alter table public.club_invites enable row level security;
alter table public.team_invites enable row level security;

revoke all on public.club_invites from anon, authenticated;
revoke all on public.team_invites from anon, authenticated;

create policy club_invites_deny on public.club_invites
  for all to anon, authenticated
  using (false) with check (false);

create policy team_invites_deny on public.team_invites
  for all to anon, authenticated
  using (false) with check (false);

-- ---------------------------------------------------------------------------
-- Föreningsinbjudningar
-- ---------------------------------------------------------------------------

-- Bjud in en e-post till en förening. Om personen redan har ett konto läggs hen till direkt
-- som medlem (via add_club_member) i stället för att skapa en väntande inbjudan. Idempotent:
-- finns inbjudan redan uppdateras rollen.
-- #variable_conflict use_column: OUT-kolumnerna (id/email/role/...) har samma namn som
-- tabellkolumner. Direktivet säger åt plpgsql att tolka tvetydiga namn som KOLUMNEN, vilket
-- gör referenser i on conflict/where/returning entydiga utan att behöva prefixa OUT-namnen.
create or replace function public.invite_club_member(p_club uuid, p_email text, p_role text default 'member')
returns table (id uuid, email text, role text, created_at timestamptz, has_account boolean)
language plpgsql security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  uid   uuid;
  mail  text := lower(trim(p_email));
begin
  if not public.is_admin(p_club) then
    raise exception 'Ingen behörighet (kräver föreningsadmin)' using errcode = '42501';
  end if;
  if p_role is null or p_role not in ('member', 'club_admin') then
    raise exception 'Ogiltig roll' using errcode = '22023';
  end if;
  if mail is null or mail = '' then
    raise exception 'E-post krävs' using errcode = '22023';
  end if;

  uid := public.user_id_by_email(mail);
  if uid is not null then
    -- Personen har redan ett konto: lägg till direkt och returnera med has_account = true.
    perform public.add_club_member(p_club, mail, p_role);
    return query
      select gen_random_uuid(), mail, p_role, now(), true;
    return;
  end if;

  insert into public.club_invites (club_id, email, role, invited_by)
  values (p_club, mail, p_role, auth.uid())
  on conflict (club_id, email) do update set role = excluded.role;

  return query
    select ci.id, ci.email, ci.role, ci.created_at, false
    from public.club_invites ci
    where ci.club_id = p_club and ci.email = mail;
end $$;

revoke execute on function public.invite_club_member(uuid, text, text) from public, anon;
grant  execute on function public.invite_club_member(uuid, text, text) to authenticated;

-- Lista väntande föreningsinbjudningar (de som ännu inte materialiserats).
create or replace function public.list_club_invites(p_club uuid)
returns table (id uuid, email text, role text, created_at timestamptz)
language plpgsql stable security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not public.is_admin(p_club) then
    raise exception 'Ingen behörighet (kräver föreningsadmin)' using errcode = '42501';
  end if;
  return query
    select ci.id, ci.email, ci.role, ci.created_at
    from public.club_invites ci
    where ci.club_id = p_club
    order by ci.email;
end $$;

revoke execute on function public.list_club_invites(uuid) from public, anon;
grant  execute on function public.list_club_invites(uuid) to authenticated;

-- Återkalla en väntande föreningsinbjudan.
create or replace function public.revoke_club_invite(p_club uuid, p_email text)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.is_admin(p_club) then
    raise exception 'Ingen behörighet (kräver föreningsadmin)' using errcode = '42501';
  end if;
  delete from public.club_invites where club_id = p_club and email = lower(trim(p_email));
end $$;

revoke execute on function public.revoke_club_invite(uuid, text) from public, anon;
grant  execute on function public.revoke_club_invite(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Laginbjudningar
-- ---------------------------------------------------------------------------

-- Bjud in en e-post som ledare i ett lag. Har personen redan konto OCH är medlem i föreningen
-- läggs hen till direkt (add_team_member). Annars skapas en väntande laginbjudan – och om
-- personen saknar konto läggs även en väntande föreningsinbjudan till, så att hen vid
-- registrering först blir föreningsmedlem och sedan lagledare (lagmedlemskap kräver förening).
create or replace function public.invite_team_member(p_team uuid, p_email text, p_head_coach boolean default false)
returns table (id uuid, email text, head_coach boolean, created_at timestamptz, has_account boolean)
language plpgsql security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  uid  uuid;
  club uuid;
  mail text := lower(trim(p_email));
begin
  club := public.team_club(p_team);
  if not public.is_admin(club) then
    raise exception 'Ingen behörighet (kräver föreningsadmin)' using errcode = '42501';
  end if;
  if mail is null or mail = '' then
    raise exception 'E-post krävs' using errcode = '22023';
  end if;

  uid := public.user_id_by_email(mail);
  if uid is not null and exists (
    select 1 from public.club_members where user_id = uid and club_id = club
  ) then
    -- Har konto och är redan föreningsmedlem: lägg till som ledare direkt.
    perform public.add_team_member(p_team, mail, coalesce(p_head_coach, false));
    return query
      select gen_random_uuid(), mail, coalesce(p_head_coach, false), now(), true;
    return;
  end if;

  -- Saknar konto: säkerställ en väntande föreningsinbjudan (member) så lagmedlemskapet
  -- kan materialiseras efter registrering. Rör inte befintlig roll (t.ex. club_admin).
  if uid is null then
    insert into public.club_invites (club_id, email, role, invited_by)
    values (club, mail, 'member', auth.uid())
    on conflict (club_id, email) do nothing;
  end if;

  insert into public.team_invites (team_id, email, head_coach, invited_by)
  values (p_team, mail, coalesce(p_head_coach, false), auth.uid())
  on conflict (team_id, email) do update set head_coach = excluded.head_coach;

  return query
    select ti.id, ti.email, ti.head_coach, ti.created_at, false
    from public.team_invites ti
    where ti.team_id = p_team and ti.email = mail;
end $$;

revoke execute on function public.invite_team_member(uuid, text, boolean) from public, anon;
grant  execute on function public.invite_team_member(uuid, text, boolean) to authenticated;

-- Lista väntande laginbjudningar.
create or replace function public.list_team_invites(p_team uuid)
returns table (id uuid, email text, head_coach boolean, created_at timestamptz)
language plpgsql stable security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not public.is_admin(public.team_club(p_team)) then
    raise exception 'Ingen behörighet (kräver föreningsadmin)' using errcode = '42501';
  end if;
  return query
    select ti.id, ti.email, ti.head_coach, ti.created_at
    from public.team_invites ti
    where ti.team_id = p_team
    order by ti.email;
end $$;

revoke execute on function public.list_team_invites(uuid) from public, anon;
grant  execute on function public.list_team_invites(uuid) to authenticated;

-- Återkalla en väntande laginbjudan.
create or replace function public.revoke_team_invite(p_team uuid, p_email text)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.is_admin(public.team_club(p_team)) then
    raise exception 'Ingen behörighet (kräver föreningsadmin)' using errcode = '42501';
  end if;
  delete from public.team_invites where team_id = p_team and email = lower(trim(p_email));
end $$;

revoke execute on function public.revoke_team_invite(uuid, text) from public, anon;
grant  execute on function public.revoke_team_invite(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Materialisering vid registrering
--   När ett nytt auth-konto skapas: gör om väntande inbjudningar (matchade på e-post)
--   till riktiga medlemskap. Föreningsinbjudningar först (så lagmedlemskapet klarar
--   team_members_check_club), sedan laginbjudningar. Inbjudningarna tas bort när de
--   konsumerats.
-- ---------------------------------------------------------------------------

create or replace function public.claim_invites_for_new_user()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  mail text := lower(trim(new.email));
begin
  if mail is null or mail = '' then
    return new;
  end if;

  -- Föreningsmedlemskap först.
  insert into public.club_members (user_id, club_id, role)
  select new.id, ci.club_id, ci.role
  from public.club_invites ci
  where ci.email = mail
  on conflict (user_id, club_id) do update set role = excluded.role;

  delete from public.club_invites where email = mail;

  -- Lagmedlemskap sedan (föreningen finns nu, så check-triggern godkänner).
  insert into public.team_members (user_id, team_id, head_coach)
  select new.id, ti.team_id, ti.head_coach
  from public.team_invites ti
  where ti.email = mail
  on conflict (user_id, team_id) do update set head_coach = excluded.head_coach;

  delete from public.team_invites where email = mail;

  return new;
end $$;

revoke execute on function public.claim_invites_for_new_user() from public, anon, authenticated;

create trigger claim_invites_for_new_user
  after insert on auth.users
  for each row execute function public.claim_invites_for_new_user();
