-- Migration 8: medlemskapshantering via API (så en föreningsadmin kan lägga till och ta bort
-- medlemmar och lagledare utan SQL). Bygger på migration 1 (club_members, is_admin) och
-- migration 2 (team_members, team_club).
--
-- Problem: frontend kan inte läsa auth.users (den är skyddad), så en admin kan inte slå upp en
-- användare på e-post via vanlig PostgREST. Funktionerna här är SECURITY DEFINER och kontrollerar
-- själva att anroparen är föreningsadmin (is_admin) innan de rör något, i samma mönster som
-- övriga rollhjälpare. De är enda vägen att läsa en annan medlems e-post.
--
-- En användare måste redan ha ett konto (registrerat sig via appen). Finns ingen användare med
-- den e-posten ges ett tydligt fel – vi skapar aldrig konton här.

-- ---------------------------------------------------------------------------
-- Slå upp en användare på e-post (normaliserad). Null om ingen finns.
-- Intern hjälpare, bara för funktionerna nedan.
-- ---------------------------------------------------------------------------

create or replace function public.user_id_by_email(p_email text)
returns uuid
language sql stable security definer
set search_path = public
as $$
  select id from auth.users
  where lower(email) = lower(trim(p_email))
  limit 1
$$;

revoke execute on function public.user_id_by_email(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Föreningsmedlemmar
-- ---------------------------------------------------------------------------

-- Lista medlemmar i en förening med e-post. Bara föreningsadmin (eller superadmin).
create or replace function public.list_club_members(p_club uuid)
returns table (user_id uuid, email text, role text, created_at timestamptz)
language plpgsql stable security definer
set search_path = public
as $$
begin
  if not public.is_admin(p_club) then
    raise exception 'Ingen behörighet (kräver föreningsadmin)' using errcode = '42501';
  end if;
  return query
    select cm.user_id, u.email::text, cm.role, cm.created_at
    from public.club_members cm
    join auth.users u on u.id = cm.user_id
    where cm.club_id = p_club
    order by u.email;
end $$;

revoke execute on function public.list_club_members(uuid) from public, anon;
grant  execute on function public.list_club_members(uuid) to authenticated;

-- Lägg till en medlem i en förening via e-post. role är 'member' eller 'club_admin'.
-- Idempotent: finns medlemmen redan uppdateras rollen.
create or replace function public.add_club_member(p_club uuid, p_email text, p_role text default 'member')
returns table (user_id uuid, email text, role text, created_at timestamptz)
language plpgsql security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  uid uuid;
begin
  if not public.is_admin(p_club) then
    raise exception 'Ingen behörighet (kräver föreningsadmin)' using errcode = '42501';
  end if;
  if p_role is null or p_role not in ('member', 'club_admin') then
    raise exception 'Ogiltig roll' using errcode = '22023';
  end if;
  uid := public.user_id_by_email(p_email);
  if uid is null then
    raise exception 'Ingen användare med e-posten %. Be personen skapa ett konto först.', trim(p_email)
      using errcode = 'no_data_found';
  end if;
  insert into public.club_members (user_id, club_id, role)
  values (uid, p_club, p_role)
  on conflict (user_id, club_id) do update set role = excluded.role;

  return query
    select cm.user_id, u.email::text, cm.role, cm.created_at
    from public.club_members cm
    join auth.users u on u.id = cm.user_id
    where cm.club_id = p_club and cm.user_id = uid;
end $$;

revoke execute on function public.add_club_member(uuid, text, text) from public, anon;
grant  execute on function public.add_club_member(uuid, text, text) to authenticated;

-- Ta bort en medlem ur en förening. Lagmedlemskap i föreningen städas av trigger
-- (club_members_cleanup_teams från migration 2).
create or replace function public.remove_club_member(p_club uuid, p_user uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.is_admin(p_club) then
    raise exception 'Ingen behörighet (kräver föreningsadmin)' using errcode = '42501';
  end if;
  delete from public.club_members where club_id = p_club and user_id = p_user;
end $$;

revoke execute on function public.remove_club_member(uuid, uuid) from public, anon;
grant  execute on function public.remove_club_member(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Lagledare (team_members)
-- ---------------------------------------------------------------------------

-- Lista ledare i ett lag med e-post. Bara föreningsadmin för lagets förening.
create or replace function public.list_team_members(p_team uuid)
returns table (user_id uuid, email text, head_coach boolean)
language plpgsql stable security definer
set search_path = public
as $$
begin
  if not public.is_admin(public.team_club(p_team)) then
    raise exception 'Ingen behörighet (kräver föreningsadmin)' using errcode = '42501';
  end if;
  return query
    select tm.user_id, u.email::text, tm.head_coach
    from public.team_members tm
    join auth.users u on u.id = tm.user_id
    where tm.team_id = p_team
    order by u.email;
end $$;

revoke execute on function public.list_team_members(uuid) from public, anon;
grant  execute on function public.list_team_members(uuid) to authenticated;

-- Lägg till en ledare i ett lag via e-post. Personen måste redan vara medlem i lagets
-- förening (annars nekar triggern team_members_check_club). Idempotent på head_coach.
create or replace function public.add_team_member(p_team uuid, p_email text, p_head_coach boolean default false)
returns table (user_id uuid, email text, head_coach boolean)
language plpgsql security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  uid uuid;
  club uuid;
begin
  club := public.team_club(p_team);
  if not public.is_admin(club) then
    raise exception 'Ingen behörighet (kräver föreningsadmin)' using errcode = '42501';
  end if;
  uid := public.user_id_by_email(p_email);
  if uid is null then
    raise exception 'Ingen användare med e-posten %. Be personen skapa ett konto först.', trim(p_email)
      using errcode = 'no_data_found';
  end if;
  if not exists (select 1 from public.club_members where user_id = uid and club_id = club) then
    raise exception 'Personen måste vara medlem i föreningen innan hen kan läggas till i ett lag'
      using errcode = '23514';
  end if;
  insert into public.team_members (user_id, team_id, head_coach)
  values (uid, p_team, coalesce(p_head_coach, false))
  on conflict (user_id, team_id) do update set head_coach = excluded.head_coach;

  return query
    select tm.user_id, u.email::text, tm.head_coach
    from public.team_members tm
    join auth.users u on u.id = tm.user_id
    where tm.team_id = p_team and tm.user_id = uid;
end $$;

revoke execute on function public.add_team_member(uuid, text, boolean) from public, anon;
grant  execute on function public.add_team_member(uuid, text, boolean) to authenticated;

-- Ta bort en ledare ur ett lag.
create or replace function public.remove_team_member(p_team uuid, p_user uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.is_admin(public.team_club(p_team)) then
    raise exception 'Ingen behörighet (kräver föreningsadmin)' using errcode = '42501';
  end if;
  delete from public.team_members where team_id = p_team and user_id = p_user;
end $$;

revoke execute on function public.remove_team_member(uuid, uuid) from public, anon;
grant  execute on function public.remove_team_member(uuid, uuid) to authenticated;
