-- Migration 2: lag (teams/subteams), truppmedlemskap, serier och rollhjälpare som
-- beror på lag. Bygger på migration 1 (clubs, club_members, is_superadmin/is_admin/is_active).
--
-- Appen används bara för spelformer upp till 7 mot 7. Det bärs av subteams.game_format
-- som har en CHECK som bara tillåter 3v3, 5v5 och 7v7.

-- ---------------------------------------------------------------------------
-- Tabeller
-- ---------------------------------------------------------------------------

-- Ett lag (truppnivå) hör till en förening. "Lagledare" är medlemmar i team_members.
create table public.teams (
  id      uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  name    text not null,
  unique (club_id, name)
);

create index teams_club_id_idx on public.teams (club_id);

create table public.team_members (
  user_id    uuid not null references auth.users (id) on delete cascade,
  team_id    uuid not null references public.teams (id) on delete cascade,
  head_coach boolean not null default false,
  primary key (user_id, team_id)
);

create index team_members_team_id_idx on public.team_members (team_id);

-- Undergrupp/åldersgrupp i ett lag, med spelform och FOGIS-id. Matcher hör till ett subteam.
-- game_format begränsas till ungdomsspelformer (upp till 7 mot 7).
create table public.subteams (
  id            uuid not null default gen_random_uuid(),
  team_id       uuid not null references public.teams (id) on delete cascade,
  name          text not null,
  game_format   text not null check (game_format in ('3v3', '5v5', '7v7')),
  fogis_team_id text,                                   -- lagets id hos förbundet (FOGIS)
  created_at    timestamptz not null default now(),
  primary key (id),
  -- Sammansatt nyckel så att matcher kan ha FK mot (id, team_id) och hållas i rätt lag.
  unique (id, team_id)
);

create index subteams_team_id_idx on public.subteams (team_id);

-- En serie (tävling) som ett lags matcher spelas i. competition_id är förbundets id.
create table public.series (
  id             uuid primary key default gen_random_uuid(),
  team_id        uuid not null references public.teams (id) on delete cascade,
  competition_id text not null,
  name           text not null,
  season         text,
  created_at     timestamptz not null default now(),
  unique (team_id, competition_id)
);

create index series_team_id_idx on public.series (team_id);

-- ---------------------------------------------------------------------------
-- Rollhjälpare (SECURITY DEFINER, läcker inte: returnerar null/false om anroparen
-- saknar åtkomst till föreningen).
-- ---------------------------------------------------------------------------

-- Truppens förening. Null om anroparen inte är aktiv i den föreningen.
create or replace function public.team_club(t uuid)
returns uuid
language sql stable security definer
set search_path = public
as $$
  select club_id from public.teams
  where id = t and public.is_active(club_id)
$$;

-- Föreningsadmin/superadmin, eller medlem i laget och i lagets förening.
create or replace function public.in_team(t uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select public.is_admin(public.team_club(t))
      or (
        public.is_active(public.team_club(t))
        and exists (
          select 1 from public.team_members
          where user_id = auth.uid() and team_id = t
        )
      )
$$;

revoke execute on function public.team_club(uuid) from public, anon;
revoke execute on function public.in_team(uuid)   from public, anon;
grant  execute on function public.team_club(uuid) to authenticated;
grant  execute on function public.in_team(uuid)   to authenticated;

-- ---------------------------------------------------------------------------
-- Triggers som håller föreningarna isär
-- ---------------------------------------------------------------------------

-- En lagmedlem måste vara medlem i lagets förening. Oberoende av vem som anropar
-- (joinar club_members mot teams i stället för att gå via team_club, som kräver åtkomst).
create or replace function public.team_members_check_club()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.club_members cm
    join public.teams t on t.club_id = cm.club_id
    where cm.user_id = new.user_id and t.id = new.team_id
  ) then
    raise exception 'Användaren är inte medlem i lagets förening'
      using errcode = '23514';
  end if;
  return new;
end $$;

create trigger team_members_check_club
  before insert or update of user_id, team_id on public.team_members
  for each row execute function public.team_members_check_club();

-- Tas en användare bort ur föreningen försvinner även hens lagrader där.
create or replace function public.club_members_cleanup_teams()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  delete from public.team_members
  where user_id = old.user_id
    and team_id in (select id from public.teams where club_id = old.club_id);
  return old;
end $$;

create trigger club_members_cleanup_teams
  after delete on public.club_members
  for each row execute function public.club_members_cleanup_teams();

-- Ett lag får inte flyttas till en annan förening.
create or replace function public.teams_lock_club()
returns trigger
language plpgsql
as $$
begin
  if new.club_id is distinct from old.club_id then
    raise exception 'Ett lag kan inte flyttas till en annan förening'
      using errcode = '23514';
  end if;
  return new;
end $$;

create trigger teams_lock_club
  before update of club_id on public.teams
  for each row execute function public.teams_lock_club();

-- Triggerfunktioner ska aldrig kunna anropas via API:t.
revoke execute on function public.team_members_check_club()    from public, anon, authenticated;
revoke execute on function public.club_members_cleanup_teams() from public, anon, authenticated;
revoke execute on function public.teams_lock_club()            from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- RLS
--   Aktiva medlemmar i laget läser; bara föreningsadmin/superadmin skriver lag,
--   subteams och serier.
-- ---------------------------------------------------------------------------

alter table public.teams        enable row level security;
alter table public.team_members enable row level security;
alter table public.subteams     enable row level security;
alter table public.series       enable row level security;

-- teams
create policy teams_select on public.teams
  for select to authenticated
  using (public.in_team(id));

create policy teams_insert on public.teams
  for insert to authenticated
  with check (public.is_admin(club_id));

create policy teams_update on public.teams
  for update to authenticated
  using (public.is_admin(club_id))
  with check (public.is_admin(club_id));

create policy teams_delete on public.teams
  for delete to authenticated
  using (public.is_admin(club_id));

-- team_members
create policy team_members_select on public.team_members
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin(public.team_club(team_id)));

create policy team_members_insert on public.team_members
  for insert to authenticated
  with check (public.is_admin(public.team_club(team_id)));

create policy team_members_update on public.team_members
  for update to authenticated
  using (public.is_admin(public.team_club(team_id)))
  with check (public.is_admin(public.team_club(team_id)));

create policy team_members_delete on public.team_members
  for delete to authenticated
  using (public.is_admin(public.team_club(team_id)));

-- subteams: alla i laget läser, bara admin skriver.
create policy subteams_select on public.subteams
  for select to authenticated
  using (public.in_team(team_id));

create policy subteams_insert on public.subteams
  for insert to authenticated
  with check (public.is_admin(public.team_club(team_id)));

create policy subteams_update on public.subteams
  for update to authenticated
  using (public.is_admin(public.team_club(team_id)))
  with check (public.is_admin(public.team_club(team_id)));

create policy subteams_delete on public.subteams
  for delete to authenticated
  using (public.is_admin(public.team_club(team_id)));

-- series: alla i laget läser, bara admin skriver.
create policy series_select on public.series
  for select to authenticated
  using (public.in_team(team_id));

create policy series_insert on public.series
  for insert to authenticated
  with check (public.is_admin(public.team_club(team_id)));

create policy series_update on public.series
  for update to authenticated
  using (public.is_admin(public.team_club(team_id)))
  with check (public.is_admin(public.team_club(team_id)));

create policy series_delete on public.series
  for delete to authenticated
  using (public.is_admin(public.team_club(team_id)));
