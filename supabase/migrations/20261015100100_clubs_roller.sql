-- Migration 1: föreningar, medlemskap och plattformsadmin (superadmin).
-- Rollmönstret är lånat från ledarportalen: hjälpare som SECURITY DEFINER med egen
-- behörighetskontroll, och RLS-policyer som anropar dem. Trupp-beroende hjälpare
-- (in_team, team_club) kommer i migration 2.

-- ---------------------------------------------------------------------------
-- Tabeller
-- ---------------------------------------------------------------------------

create table public.clubs (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  slug       text not null unique
             check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  created_at timestamptz not null default now()
);

create table public.club_members (
  user_id    uuid not null references auth.users (id) on delete cascade,
  club_id    uuid not null references public.clubs (id) on delete cascade,
  role       text not null default 'member'
             check (role in ('club_admin', 'member')),
  created_at timestamptz not null default now(),
  primary key (user_id, club_id)
);

create index club_members_club_id_idx on public.club_members (club_id);

-- Superadmin (plattformsnivå). Rader läggs bara till med SQL, aldrig via API:t.
create table public.platform_admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Rollhjälpare
--   SECURITY DEFINER + stable, med search_path låst till public. Var och en
--   kontrollerar själv anroparens behörighet (auth.uid()), så inget läcker.
-- ---------------------------------------------------------------------------

create or replace function public.is_superadmin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid())
$$;

-- Föreningsadmin i förening c, eller superadmin.
create or replace function public.is_admin(c uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select public.is_superadmin()
      or exists (
        select 1 from public.club_members
        where user_id = auth.uid() and club_id = c and role = 'club_admin'
      )
$$;

-- Medlem i förening c (vilken roll som helst), eller superadmin.
create or replace function public.is_active(c uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select public.is_superadmin()
      or exists (
        select 1 from public.club_members
        where user_id = auth.uid() and club_id = c
      )
$$;

revoke execute on function public.is_superadmin() from public, anon;
revoke execute on function public.is_admin(uuid)  from public, anon;
revoke execute on function public.is_active(uuid) from public, anon;
grant  execute on function public.is_superadmin() to authenticated;
grant  execute on function public.is_admin(uuid)  to authenticated;
grant  execute on function public.is_active(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.clubs           enable row level security;
alter table public.club_members    enable row level security;
alter table public.platform_admins enable row level security;

-- platform_admins: inga policyer och inga rättigheter för API-roller. En explicit
-- nekande policy så att inget kan läsas eller skrivas via PostgREST ens av misstag.
revoke all on public.platform_admins from anon, authenticated;

create policy platform_admins_deny on public.platform_admins
  for all to anon, authenticated
  using (false) with check (false);

-- clubs: medlemmar läser sin förening, bara superadmin skapar/ändrar/raderar.
create policy clubs_select on public.clubs
  for select to authenticated
  using (public.is_active(id));

create policy clubs_insert on public.clubs
  for insert to authenticated
  with check (public.is_superadmin());

create policy clubs_update on public.clubs
  for update to authenticated
  using (public.is_superadmin())
  with check (public.is_superadmin());

create policy clubs_delete on public.clubs
  for delete to authenticated
  using (public.is_superadmin());

-- club_members: var och en ser sina egna rader, föreningsadmin (eller superadmin)
-- ser och hanterar hela föreningen.
create policy club_members_select on public.club_members
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin(club_id));

create policy club_members_insert on public.club_members
  for insert to authenticated
  with check (public.is_admin(club_id));

create policy club_members_update on public.club_members
  for update to authenticated
  using (public.is_admin(club_id))
  with check (public.is_admin(club_id));

create policy club_members_delete on public.club_members
  for delete to authenticated
  using (public.is_admin(club_id));

-- Första superadmin läggs in manuellt (eller via seed.sql lokalt), till exempel:
--   insert into public.platform_admins (user_id)
--   select id from auth.users where email = '<e-post>';
