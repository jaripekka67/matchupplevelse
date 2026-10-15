-- Migration 5: importfunktioner för serier och matcher från FOGIS.
-- save_series: sparar vilka serier ett lag spelar i.
-- import_fogis_games: skapar/uppdaterar matcher. FOGIS äger tid, tävling, motståndare och
--   hemma/borta. Dedup på fogis_game_id (unikt per lag), annars dag + motståndare. game_format
--   ärvs från subteamet (trigger). INGA resultat skrivs (serierna räknar inte resultat).
--   Matcher vars spelform inte är tillåten (inte 3v3/5v5/7v7) hoppas över.
-- Båda är SECURITY INVOKER (RLS gäller) och kräver föreningsadmin (import är en admin-åtgärd).

-- ---------------------------------------------------------------------------
-- Behörighetskontroll för import (admin i lagets förening)
-- ---------------------------------------------------------------------------

create or replace function public.import_check(p_team uuid)
returns void
language plpgsql security invoker
set search_path = public
as $$
begin
  if p_team is null or auth.uid() is null or not public.is_admin(public.team_club(p_team)) then
    raise exception 'Ingen behörighet (kräver föreningsadmin)' using errcode = '42501';
  end if;
end $$;

revoke execute on function public.import_check(uuid) from public, anon;
grant  execute on function public.import_check(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- save_series: [{competitionId, name, season}]
-- ---------------------------------------------------------------------------

create or replace function public.save_series(p_team uuid, p_series jsonb)
returns jsonb
language plpgsql security invoker
set search_path = public
as $$
declare
  s jsonb;
  cid text;
  saved int := 0;
begin
  perform public.import_check(p_team);
  if jsonb_typeof(p_series) is distinct from 'array' or jsonb_array_length(p_series) > 200 then
    raise exception 'Ogiltigt val av serier' using errcode = '22023';
  end if;
  for s in select value from jsonb_array_elements(p_series) loop
    cid := s ->> 'competitionId';
    if jsonb_typeof(s) is distinct from 'object' or cid is null or cid !~ '^[0-9A-Za-z_-]{1,40}$'
       or char_length(coalesce(s ->> 'name', '')) not between 1 and 200
       or char_length(coalesce(s ->> 'season', '')) > 40 then
      raise exception 'Ogiltig serie' using errcode = '22023';
    end if;
    insert into public.series (team_id, competition_id, name, season)
    values (p_team, cid, s ->> 'name', nullif(s ->> 'season', ''))
    on conflict (team_id, competition_id) do update
      set name = excluded.name, season = excluded.season;
    saved := saved + 1;
  end loop;
  return jsonb_build_object('saved', saved);
end $$;

revoke execute on function public.save_series(uuid, jsonb) from public, anon;
grant  execute on function public.save_series(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- import_fogis_games
--   p_inserts: [{fogisGameId, kickoff, subteamId, competition, competitionId, home, away, isHome, place}]
--   p_updates: [{id, fogisGameId, kickoff, competition, competitionId, home, away, isHome, place?, subteamId?}]
--   Högst 600 av varje. En uppdatering rör bara fälten FOGIS äger. Inga resultat skrivs.
--   Ger {created, updated}.
-- ---------------------------------------------------------------------------

create or replace function public.import_fogis_games(p_team uuid, p_inserts jsonb, p_updates jsonb)
returns jsonb
language plpgsql security invoker
set search_path = public
as $$
declare
  g jsonb;
  rid uuid;
  fmt text;
  created int := 0;
  updated int := 0;
  skipped int := 0;
begin
  perform public.import_check(p_team);
  if jsonb_typeof(p_inserts) is distinct from 'array' or jsonb_typeof(p_updates) is distinct from 'array'
     or jsonb_array_length(p_inserts) > 600 or jsonb_array_length(p_updates) > 600 then
    raise exception 'Ogiltig import' using errcode = '22023';
  end if;

  -- Nya matcher
  for g in select value from jsonb_array_elements(p_inserts) loop
    if jsonb_typeof(g) is distinct from 'object' or (g ->> 'fogisGameId') !~ '^[0-9A-Za-z_-]{1,40}$'
       or (g ->> 'kickoff') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$'
       or (g ->> 'subteamId') is null
       or char_length(coalesce(g ->> 'home', '')) not between 1 and 120
       or char_length(coalesce(g ->> 'away', '')) not between 1 and 120
       or char_length(coalesce(g ->> 'competition', '')) > 200
       or char_length(coalesce(g ->> 'place', '')) > 200
       or coalesce(g ->> 'competitionId', '') !~ '^[0-9A-Za-z_-]{0,40}$' then
      raise exception 'Ogiltig match i importen' using errcode = '22023';
    end if;

    -- Spelformen kommer från subteamet. Är den inte tillåten (annat än 3v3/5v5/7v7) hoppas matchen.
    select game_format into fmt from public.subteams where id = (g ->> 'subteamId')::uuid and team_id = p_team;
    if fmt is null or fmt not in ('3v3', '5v5', '7v7') then
      skipped := skipped + 1;
      continue;
    end if;

    -- Dedup: finns matchen redan (fogis_game_id, eller samma dag + motståndare) hoppas insert.
    if exists (
      select 1 from public.fixtures f
      where f.team_id = p_team
        and (
          f.fogis_game_id = (g ->> 'fogisGameId')
          or (
            date(f.kickoff) = date(replace(g ->> 'kickoff', 'T', ' ')::timestamptz)
            and lower(regexp_replace(coalesce(f.away, ''), '\s', '', 'g')) = lower(regexp_replace(g ->> 'away', '\s', '', 'g'))
          )
        )
    ) then
      skipped := skipped + 1;
      continue;
    end if;

    insert into public.fixtures
      (team_id, subteam_id, external_id, fogis_game_id, source, kickoff, competition, competition_id, home, away, is_home, place)
    values
      (p_team, (g ->> 'subteamId')::uuid, 'fogis:' || (g ->> 'fogisGameId'), g ->> 'fogisGameId', 'fogis',
       replace(g ->> 'kickoff', 'T', ' ')::timestamptz, nullif(g ->> 'competition', ''), nullif(g ->> 'competitionId', ''),
       g ->> 'home', g ->> 'away',
       case jsonb_typeof(g -> 'isHome') when 'boolean' then (g ->> 'isHome')::boolean else null end,
       nullif(g ->> 'place', ''));
    created := created + 1;
  end loop;

  -- Uppdateringar (rör bara fält FOGIS äger)
  for g in select value from jsonb_array_elements(p_updates) loop
    if jsonb_typeof(g) is distinct from 'object' or (g ->> 'id') is null
       or (g ->> 'fogisGameId') !~ '^[0-9A-Za-z_-]{1,40}$'
       or (g ->> 'kickoff') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$'
       or char_length(coalesce(g ->> 'home', '')) not between 1 and 120
       or char_length(coalesce(g ->> 'away', '')) not between 1 and 120
       or char_length(coalesce(g ->> 'competition', '')) > 200
       or char_length(coalesce(g ->> 'place', '')) > 200
       or coalesce(g ->> 'competitionId', '') !~ '^[0-9A-Za-z_-]{0,40}$' then
      raise exception 'Ogiltig match i importen' using errcode = '22023';
    end if;

    update public.fixtures set
      fogis_game_id  = g ->> 'fogisGameId',
      kickoff        = replace(g ->> 'kickoff', 'T', ' ')::timestamptz,
      competition    = nullif(g ->> 'competition', ''),
      competition_id = nullif(g ->> 'competitionId', ''),
      home           = g ->> 'home',
      away           = g ->> 'away',
      is_home        = case jsonb_typeof(g -> 'isHome') when 'boolean' then (g ->> 'isHome')::boolean else is_home end,
      place          = case when g ? 'place' then nullif(g ->> 'place', '') else place end,
      subteam_id     = case when (g ->> 'subteamId') is not null then (g ->> 'subteamId')::uuid else subteam_id end,
      updated_at     = now()
    where id = (g ->> 'id')::uuid and team_id = p_team
    returning id into rid;
    if rid is null then
      raise exception 'Matchen finns inte i laget' using errcode = '23503';
    end if;
    updated := updated + 1;
  end loop;

  return jsonb_build_object('created', created, 'updated', updated, 'skipped', skipped);
end $$;

revoke execute on function public.import_fogis_games(uuid, jsonb, jsonb) from public, anon;
grant  execute on function public.import_fogis_games(uuid, jsonb, jsonb) to authenticated;
