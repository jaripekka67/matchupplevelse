-- Migration 6: förbundsrepresentant (plattformsroll) och aggregat.
-- federation_reps speglar platform_admins: ingen API-åtkomst, rader sätts bara med SQL.
-- evenness_overview() är SECURITY DEFINER och kontrollerar SJÄLV is_federation_rep(), så den
-- läser matchupplevelsedata tvärs ALLA föreningar utan att öppna rå radåtkomst via RLS.
--
-- verdict: 1 = hemmalaget vann stort, 2 = jämn, 3 = bortalaget vann stort. Värdet är
-- hemma/borta-relativt. Lag-översättning (vem dominerade) sker via fixtures.is_home:
--   is_home = true:  verdict 1 -> vårt lag dominerade, 3 -> motståndaren dominerade
--   is_home = false: verdict 1 -> motståndaren dominerade, 3 -> vårt lag dominerade
--   verdict 2 -> ingen dominans (jämn)
--   is_home okänt (null): dominans kan inte knytas till lag (räknas bara i jämn/ojämn).

-- ---------------------------------------------------------------------------
-- federation_reps + is_federation_rep
-- ---------------------------------------------------------------------------

create table public.federation_reps (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.federation_reps enable row level security;

-- Ingen API-åtkomst och en explicit nekande policy (som platform_admins). Rader sätts med SQL.
revoke all on public.federation_reps from anon, authenticated;

create policy federation_reps_deny on public.federation_reps
  for all to anon, authenticated
  using (false) with check (false);

create or replace function public.is_federation_rep()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from public.federation_reps where user_id = auth.uid())
$$;

revoke execute on function public.is_federation_rep() from public, anon;
grant  execute on function public.is_federation_rep() to authenticated;

-- ---------------------------------------------------------------------------
-- evenness_overview: aggregat för förbundsrepresentanten
-- ---------------------------------------------------------------------------

-- Returnerar jsonb:
--   {
--     series: [{competitionId, name, reports, even, dominated, evenShare}],   -- per serie
--     teams:  [{teamId, teamName, clubName, reports, ownBig, oppBig, even, dominatedByUs}], -- per lag
--     matches:[{fixtureId, kickoff, competition, home, away, teamName, isHome, verdict, dominant}] -- varje rapport
--   }
-- "dominant" i matchlistan är 'us' | 'opp' | 'even' | 'unknown' (lag-översatt).
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
      f.home,
      f.away,
      f.is_home,
      t.name  as team_name,
      c.name  as club_name,
      -- Lag-översättning: vem dominerade enligt detta lags ledare.
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
          'kickoff', kickoff,
          'competition', competition,
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
