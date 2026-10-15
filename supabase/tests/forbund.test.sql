-- Test av migration 6: federation_reps, is_federation_rep och evenness_overview.
-- Kör: supabase db query --linked --file supabase/tests/forbund.test.sql
-- DO-block som avslutas med RAISE (rullar tillbaka testdata).

do $test$
declare
  v text;
  ov jsonb;
  total int := 0;
  fails text[] := '{}';
  u_rep   constant uuid := '138b8030-c45a-5e42-b829-e45b795a2562';  -- förbundsrepresentant
  u_admin constant uuid := 'c8c5ba92-0fa7-5775-8fa5-f501a378f786';  -- vanlig föreningsadmin
  u_lead  constant uuid := 'e4970889-ac8e-56e1-a4c7-33210f0eed9f';
  club_a constant uuid := 'aaaaaaaa-0000-0000-0000-00000000000a';
  club_b constant uuid := 'bbbbbbbb-0000-0000-0000-00000000000b';
  team_a constant uuid := 'aaaaaaaa-1111-0000-0000-00000000000a';   -- hemma i matchen
  team_b constant uuid := 'bbbbbbbb-1111-0000-0000-00000000000b';   -- borta i matchen (annan förening)
  sub_a  constant uuid := 'aaaaaaaa-3333-0000-0000-00000000000a';
  sub_b  constant uuid := 'bbbbbbbb-3333-0000-0000-00000000000b';
  fx_a   constant uuid := 'aaaaaaaa-5555-0000-0000-00000000000a';   -- lag A:s rad (is_home=true)
  fx_b   constant uuid := 'bbbbbbbb-5555-0000-0000-00000000000b';   -- lag B:s rad samma match (is_home=false)
  fx_a2  constant uuid := 'aaaaaaaa-5555-0000-0000-0000000000a2';   -- lag A, is_home null (okänd)
begin
  insert into auth.users (id, email, aud, role) values
    (u_rep,   'rep@test.invalid',   'authenticated', 'authenticated'),
    (u_admin, 'admin@test.invalid', 'authenticated', 'authenticated'),
    (u_lead,  'lead@test.invalid',  'authenticated', 'authenticated');
  insert into public.clubs (id, name, slug) values
    (club_a, 'Alfa IF', 'alfa-if'),
    (club_b, 'Beta FK', 'beta-fk');
  insert into public.club_members (user_id, club_id, role) values
    (u_admin, club_a, 'club_admin'),
    (u_lead,  club_a, 'member');
  insert into public.federation_reps (user_id) values (u_rep);
  insert into public.teams (id, club_id, name) values
    (team_a, club_a, 'Alfa P13'),
    (team_b, club_b, 'Beta P13');
  insert into public.subteams (id, team_id, name, game_format) values
    (sub_a, team_a, 'A', '5v5'),
    (sub_b, team_b, 'B', '5v5');
  -- Samma match: lag A hemma, lag B borta. Plus en extra match för lag A med is_home null.
  insert into public.fixtures (id, team_id, subteam_id, game_format, fogis_game_id, competition, competition_id, kickoff, home, away, is_home) values
    (fx_a,  team_a, sub_a, '5v5', 'FG-100', 'P13 Vår', 'COMP-1', now() - interval '2 day', 'Alfa P13', 'Beta P13', true),
    (fx_b,  team_b, sub_b, '5v5', 'FG-100', 'P13 Vår', 'COMP-1', now() - interval '2 day', 'Alfa P13', 'Beta P13', false),
    (fx_a2, team_a, sub_a, '5v5', 'FG-101', 'P13 Vår', 'COMP-1', now() - interval '1 day', 'Alfa P13', 'Gamma P13', null);
  -- Rapporter:
  --  Lag A (hemma) säger verdict 1 (hemma vann stort) -> dominant 'us' (Alfa dominerade)
  --  Lag B (borta) säger verdict 1 (hemma vann stort) -> dominant 'opp' (Beta tycker motståndaren=Alfa dominerade)
  --  Lag A match 2, is_home null, verdict 1 -> dominant 'unknown'
  insert into public.match_evenness (fixture_id, team_id, verdict) values
    (fx_a,  team_a, 1),
    (fx_b,  team_b, 1),
    (fx_a2, team_a, 1);

  -- ---------------------------------------------------------------------------
  -- Behörighet
  -- ---------------------------------------------------------------------------

  -- vanlig admin nekas
  begin
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', u_admin), true); set local role authenticated;
    execute 'select public.evenness_overview()';
    reset role; total := total + 1;
    fails := fails || 'admin nekas evenness_overview: borde ha gett fel';
  exception when others then reset role; total := total + 1; end;

  -- ledare nekas
  begin
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', u_lead), true); set local role authenticated;
    execute 'select public.evenness_overview()';
    reset role; total := total + 1;
    fails := fails || 'ledare nekas evenness_overview: borde ha gett fel';
  exception when others then reset role; total := total + 1; end;

  -- is_federation_rep: admin = false
  begin
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', u_admin), true); set local role authenticated;
    execute 'select (public.is_federation_rep())::text' into v;
    reset role; total := total + 1;
    if v is distinct from 'false' then fails := fails || ('admin is_federation_rep: '||coalesce(v,'null')||', väntade false'); end if;
  exception when others then reset role; total := total + 1; fails := fails || ('admin is_federation_rep: fel '||sqlerrm); end;

  -- is_federation_rep: rep = true
  begin
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', u_rep), true); set local role authenticated;
    execute 'select (public.is_federation_rep())::text' into v;
    reset role; total := total + 1;
    if v is distinct from 'true' then fails := fails || ('rep is_federation_rep: '||coalesce(v,'null')||', väntade true'); end if;
  exception when others then reset role; total := total + 1; fails := fails || ('rep is_federation_rep: fel '||sqlerrm); end;

  -- förbundsrepresentant når inte federation_reps-tabellen direkt (nekande policy)
  begin
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', u_rep), true); set local role authenticated;
    execute 'select count(*) from public.federation_reps';
    reset role; total := total + 1;
    fails := fails || 'rep når inte federation_reps direkt: borde ha nekats';
  exception when others then reset role; total := total + 1; end;

  -- ---------------------------------------------------------------------------
  -- Aggregatet (som förbundsrepresentant)
  -- ---------------------------------------------------------------------------

  perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', u_rep), true); set local role authenticated;
  execute 'select public.evenness_overview()' into ov;
  reset role;

  -- 3 rapporter totalt i matchlistan
  begin
    total := total + 1;
    if jsonb_array_length(ov -> 'matches') <> 3 then
      fails := fails || ('matches längd: '||jsonb_array_length(ov -> 'matches')||', väntade 3');
    end if;
  exception when others then total := total + 1; fails := fails || ('matches längd: fel '||sqlerrm); end;

  -- serien COMP-1 har 3 rapporter, alla "dominated" (ingen jämn)
  begin
    total := total + 1;
    if not exists (
      select 1 from jsonb_array_elements(ov -> 'series') s
      where s->>'competitionId' = 'COMP-1' and (s->>'reports')::int = 3 and (s->>'dominated')::int = 3 and (s->>'even')::int = 0
    ) then
      fails := fails || ('serie COMP-1 aggregat fel: '||coalesce((select s::text from jsonb_array_elements(ov->'series') s where s->>'competitionId'='COMP-1'),'saknas'));
    end if;
  exception when others then total := total + 1; fails := fails || ('serie-aggregat: fel '||sqlerrm); end;

  -- lag A: dominant 'us' för fx_a (verdict 1, is_home true), 'unknown' för fx_a2 (is_home null)
  --        -> ownBig=1, even=0, (unknown räknas inte som us/opp/even)
  begin
    total := total + 1;
    if not exists (
      select 1 from jsonb_array_elements(ov -> 'teams') t
      where t->>'teamId' = team_a::text and (t->>'ownBig')::int = 1 and (t->>'oppBig')::int = 0 and (t->>'even')::int = 0 and (t->>'reports')::int = 2
    ) then
      fails := fails || ('lag A aggregat fel: '||coalesce((select t::text from jsonb_array_elements(ov->'teams') t where t->>'teamId'=team_a::text),'saknas'));
    end if;
  exception when others then total := total + 1; fails := fails || ('lag A-aggregat: fel '||sqlerrm); end;

  -- lag B: dominant 'opp' för fx_b (verdict 1, is_home false) -> oppBig=1, ownBig=0
  begin
    total := total + 1;
    if not exists (
      select 1 from jsonb_array_elements(ov -> 'teams') t
      where t->>'teamId' = team_b::text and (t->>'ownBig')::int = 0 and (t->>'oppBig')::int = 1
    ) then
      fails := fails || ('lag B aggregat fel: '||coalesce((select t::text from jsonb_array_elements(ov->'teams') t where t->>'teamId'=team_b::text),'saknas'));
    end if;
  exception when others then total := total + 1; fails := fails || ('lag B-aggregat: fel '||sqlerrm); end;

  -- hemma/borta->lag: fx_a (lag A, is_home true, verdict 1) ska ge dominant='us'
  begin
    total := total + 1;
    if not exists (
      select 1 from jsonb_array_elements(ov -> 'matches') m
      where m->>'fixtureId' = fx_a::text and m->>'dominant' = 'us'
    ) then
      fails := fails || 'fx_a dominant borde vara us';
    end if;
  exception when others then total := total + 1; fails := fails || ('fx_a dominant: fel '||sqlerrm); end;

  -- fx_b (lag B, is_home false, verdict 1) ska ge dominant='opp'
  begin
    total := total + 1;
    if not exists (
      select 1 from jsonb_array_elements(ov -> 'matches') m
      where m->>'fixtureId' = fx_b::text and m->>'dominant' = 'opp'
    ) then
      fails := fails || 'fx_b dominant borde vara opp';
    end if;
  exception when others then total := total + 1; fails := fails || ('fx_b dominant: fel '||sqlerrm); end;

  -- fx_a2 (is_home null) ska ge dominant='unknown'
  begin
    total := total + 1;
    if not exists (
      select 1 from jsonb_array_elements(ov -> 'matches') m
      where m->>'fixtureId' = fx_a2::text and m->>'dominant' = 'unknown'
    ) then
      fails := fails || 'fx_a2 dominant borde vara unknown';
    end if;
  exception when others then total := total + 1; fails := fails || ('fx_a2 dominant: fel '||sqlerrm); end;

  -- data täcker flera föreningar (lag A i Alfa, lag B i Beta)
  begin
    total := total + 1;
    if (select count(distinct t->>'clubName') from jsonb_array_elements(ov -> 'teams') t) < 2 then
      fails := fails || 'aggregatet borde täcka minst 2 föreningar';
    end if;
  exception when others then total := total + 1; fails := fails || ('flera föreningar: fel '||sqlerrm); end;

  raise exception 'TESTRESULT total=% fail=% :: %',
    total, cardinality(fails), coalesce(array_to_string(fails, ' | '), '(inga)');
end;
$test$;
