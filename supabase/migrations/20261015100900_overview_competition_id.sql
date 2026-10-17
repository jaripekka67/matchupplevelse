-- Migration 9: lägg competitionId i matchlistan från evenness_overview() så förbundsvyn kan
-- gruppera matcher och per-lag-sammanställningar exakt per serie (inte via serienamnet).
-- Allt annat är oförändrat jämfört med migration 6/7.

create or replace function public.evenness_overview()
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if not public.is_federation_rep() then
    raise exception 'Ingen behörighet' using errcode = '42501';
  end if;

  with reports as (
    select
      me.fixture_id,
      me.team_id,
      me.verdict,
      f.kickoff,
      f.competition,
      f.competition_id,
      f.fogis_game_id,
      f.home,
      f.away,
      f.is_home,
      t.name  as team_name,
      c.name  as club_name,
      case
        when me.verdict = 2 then 'even'
        when f.is_home is null then 'unknown'
        when (me.verdict = 1 and f.is_home) or (me.verdict = 3 and not f.is_home) then 'us'
        else 'opp'
      end as dominant
    from public.match_evenness me
    join public.fixtures f on f.id = me.fixture_id and f.team_id = me.team_id
    join public.teams t on t.id = me.team_id
    join public.clubs c on c.id = t.club_id
  )
  select jsonb_build_object(
    'series', coalesce((
      select jsonb_agg(s order by s->>'name')
      from (
        select jsonb_build_object(
          'competitionId', competition_id,
          'name', coalesce(max(competition), '(okänd serie)'),
          'reports', count(*),
          'even', count(*) filter (where verdict = 2),
          'dominated', count(*) filter (where verdict in (1, 3)),
          'evenShare', round(count(*) filter (where verdict = 2)::numeric / nullif(count(*), 0), 2)
        ) as s
        from reports
        where competition_id is not null
        group by competition_id
      ) q
    ), '[]'::jsonb),

    'teams', coalesce((
      select jsonb_agg(tt order by tt->>'clubName', tt->>'teamName')
      from (
        select jsonb_build_object(
          'teamId', team_id,
          'teamName', max(team_name),
          'clubName', max(club_name),
          'reports', count(*),
          'ownBig', count(*) filter (where dominant = 'us'),
          'oppBig', count(*) filter (where dominant = 'opp'),
          'even', count(*) filter (where dominant = 'even'),
          'dominatedByUs', round(count(*) filter (where dominant = 'us')::numeric / nullif(count(*), 0), 2)
        ) as tt
        from reports
        group by team_id
      ) q
    ), '[]'::jsonb),

    'matches', coalesce((
      select jsonb_agg(mm order by mm->>'kickoff' desc)
      from (
        select jsonb_build_object(
          'fixtureId', fixture_id,
          'teamId', team_id,
          'fogisGameId', fogis_game_id,
          'kickoff', kickoff,
          'competition', competition,
          'competitionId', competition_id,
          'home', home,
          'away', away,
          'teamName', team_name,
          'clubName', club_name,
          'isHome', is_home,
          'verdict', verdict,
          'dominant', dominant
        ) as mm
        from reports
      ) q
    ), '[]'::jsonb)
  )
  into result;

  return result;
end $$;

revoke execute on function public.evenness_overview() from public, anon;
grant  execute on function public.evenness_overview() to authenticated;
