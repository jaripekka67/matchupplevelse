-- Migration 3: matcher (fixtures) och lagledarens rapport (match_evenness).
-- Bygger på migration 1 och 2.
--
-- Serierna i dessa spelformer räknar INTE resultat, så fixtures har inga mål-/resultatkolumner.
-- Rapporten är en 3-gradig upplevelse per lag: 1 = hemmalaget vann stort, 2 = jämn, 3 = bortalaget vann stort.
-- En rapport PER LAG (PK fixture_id, team_id), så både hemma- och bortalagets ledare kan rapportera samma match.

-- ---------------------------------------------------------------------------
-- Matcher
-- ---------------------------------------------------------------------------

create table public.fixtures (
  id             uuid primary key default gen_random_uuid(),
  team_id        uuid not null references public.teams (id) on delete cascade,
  subteam_id     uuid,
  game_format    text not null check (game_format in ('3v3', '5v5', '7v7')),
  fogis_game_id  text,                               -- matchens id hos förbundet (FOGIS)
  external_id    text,                               -- t.ex. 'fogis:<id>'
  competition    text,                               -- seriens namn
  competition_id text,                               -- seriens id hos förbundet
  kickoff        timestamptz not null,
  home           text,                               -- hemmalagets namn (från FOGIS)
  away           text,                               -- bortalagets namn (från FOGIS)
  is_home        boolean,                            -- är vårt lag hemmalag? grund för lag-översättning i förbundsvyn
  place          text,
  source         text not null default 'manual',     -- 'manual' eller 'fogis'
  updated_at     timestamptz not null default now(),
  -- Dedup: en match per lag och FOGIS-id (när FOGIS-id finns).
  unique (team_id, fogis_game_id),
  -- Så att match_evenness kan ha sammansatt FK mot (id, team_id).
  unique (id, team_id),
  foreign key (subteam_id, team_id)
    references public.subteams (id, team_id) on delete set null (subteam_id)
);

create index fixtures_team_kickoff_idx on public.fixtures (team_id, kickoff);
create index fixtures_competition_idx on public.fixtures (competition_id);

-- Spelformen ärvs från subteamet om den saknas vid insert/update.
create or replace function public.fixtures_set_format()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if new.game_format is null and new.subteam_id is not null then
    select game_format into new.game_format from public.subteams where id = new.subteam_id;
  end if;
  if new.game_format is null then
    raise exception 'Matchen saknar spelform' using errcode = '23502';
  end if;
  return new;
end $$;

create trigger fixtures_set_format
  before insert or update on public.fixtures
  for each row execute function public.fixtures_set_format();

revoke execute on function public.fixtures_set_format() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Rapport: match_evenness (en per lag)
-- ---------------------------------------------------------------------------

-- verdict: 1 = hemmalaget vann stort, 2 = jämn match, 3 = bortalaget vann stort.
create table public.match_evenness (
  fixture_id uuid not null,
  team_id    uuid not null references public.teams (id) on delete cascade,
  verdict    smallint not null check (verdict in (1, 2, 3)),
  updated_at timestamptz not null default now(),
  primary key (fixture_id, team_id),
  foreign key (fixture_id, team_id)
    references public.fixtures (id, team_id) on delete cascade
);

create index match_evenness_team_idx on public.match_evenness (team_id);

-- ---------------------------------------------------------------------------
-- Validering (immutable, används i CHECK ovan via inline-villkoret, och av save-funktionen)
-- ---------------------------------------------------------------------------

create or replace function public.valid_verdict(v int)
returns boolean
language sql immutable
as $$
  select v in (1, 2, 3)
$$;

revoke execute on function public.valid_verdict(int) from public, anon;
grant  execute on function public.valid_verdict(int) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
--   Alla ledare i laget (in_team) läser och skriver sitt lags rapport.
-- ---------------------------------------------------------------------------

alter table public.fixtures       enable row level security;
alter table public.match_evenness enable row level security;

-- fixtures: alla i laget läser; admin skriver (import sker via security invoker-funktion i migration 4).
create policy fixtures_select on public.fixtures
  for select to authenticated
  using (public.in_team(team_id));

create policy fixtures_insert on public.fixtures
  for insert to authenticated
  with check (public.is_admin(public.team_club(team_id)));

create policy fixtures_update on public.fixtures
  for update to authenticated
  using (public.is_admin(public.team_club(team_id)))
  with check (public.is_admin(public.team_club(team_id)));

create policy fixtures_delete on public.fixtures
  for delete to authenticated
  using (public.is_admin(public.team_club(team_id)));

-- match_evenness: alla ledare i laget läser och skriver (in_team).
create policy match_evenness_select on public.match_evenness
  for select to authenticated
  using (public.in_team(team_id));

create policy match_evenness_insert on public.match_evenness
  for insert to authenticated
  with check (public.in_team(team_id));

create policy match_evenness_update on public.match_evenness
  for update to authenticated
  using (public.in_team(team_id))
  with check (public.in_team(team_id));

create policy match_evenness_delete on public.match_evenness
  for delete to authenticated
  using (public.in_team(team_id));

-- ---------------------------------------------------------------------------
-- Spara rapport (security invoker: RLS/in_team gäller)
-- ---------------------------------------------------------------------------

-- Sätter eller tar bort lagets rapport för en match. p_verdict null tar bort rapporten.
-- Kräver att anroparen är i laget (in_team) och att matchen är SPELAD (kickoff passerat),
-- eftersom rapportering bara gäller spelade matcher.
create or replace function public.save_match_verdict(p_fixture uuid, p_verdict int)
returns jsonb
language plpgsql security invoker
set search_path = public
as $$
declare
  fx public.fixtures%rowtype;
begin
  if p_fixture is null then
    raise exception 'Match saknas' using errcode = '22023';
  end if;
  if p_verdict is not null and not public.valid_verdict(p_verdict) then
    raise exception 'Ogiltigt värde (väntade 1, 2 eller 3)' using errcode = '22023';
  end if;

  select * into fx from public.fixtures where id = p_fixture;
  if not found or not public.in_team(fx.team_id) then
    raise exception 'Ingen behörighet' using errcode = '42501';
  end if;
  if fx.kickoff > now() then
    raise exception 'Matchen är inte spelad än' using errcode = '22023';
  end if;

  if p_verdict is null then
    delete from public.match_evenness where fixture_id = p_fixture and team_id = fx.team_id;
    return jsonb_build_object('saved', false, 'removed', true);
  end if;

  insert into public.match_evenness (fixture_id, team_id, verdict)
  values (p_fixture, fx.team_id, p_verdict)
  on conflict (fixture_id, team_id) do update
    set verdict = excluded.verdict, updated_at = now();
  return jsonb_build_object('saved', true, 'verdict', p_verdict);
end $$;

revoke execute on function public.save_match_verdict(uuid, int) from public, anon;
grant  execute on function public.save_match_verdict(uuid, int) to authenticated;
