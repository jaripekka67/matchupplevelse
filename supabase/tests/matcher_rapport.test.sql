-- Test av migration 3: fixtures, match_evenness och save_match_verdict.
-- Kör: supabase db query --linked --file supabase/tests/matcher_rapport.test.sql
-- DO-block som avslutas med RAISE (rullar tillbaka testdata).

do $test$
declare
  v text;
  n int;
  total int := 0;
  fails text[] := '{}';
  u_lead  constant uuid := 'e4970889-ac8e-56e1-a4c7-33210f0eed9f';   -- ledare i lag A (hemma)
  u_lead2 constant uuid := 'ed1d87c5-0a3a-52b8-896c-7967220303ef';   -- ledare i lag C (borta)
  u_bmem  constant uuid := 'c94b13fe-3b8f-5a76-9e53-842538818bfb';   -- medlem i förening B (utomstående)
  club_a constant uuid := 'aaaaaaaa-0000-0000-0000-00000000000a';
  club_b constant uuid := 'bbbbbbbb-0000-0000-0000-00000000000b';
  team_a constant uuid := 'aaaaaaaa-1111-0000-0000-00000000000a';    -- hemmalaget
  team_c constant uuid := 'cccccccc-1111-0000-0000-00000000000c';    -- bortalaget (annan förening, samma FOGIS-match)
  sub_a  constant uuid := 'aaaaaaaa-3333-0000-0000-00000000000a';
  sub_c  constant uuid := 'cccccccc-3333-0000-0000-00000000000c';
  fx_a   constant uuid := 'aaaaaaaa-5555-0000-0000-00000000000a';    -- lag A:s rad för matchen (spelad)
  fx_c   constant uuid := 'cccccccc-5555-0000-0000-00000000000c';    -- lag C:s rad för SAMMA match (spelad)
  fx_up  constant uuid := 'aaaaaaaa-5555-0000-0000-0000000000f0';    -- kommande match (ej spelad)
  res jsonb;
begin
  -- Testdata: två föreningar, lag A (hemma) och lag C (borta i annan förening).
  insert into auth.users (id, email, aud, role) values
    (u_lead,  'lead@test.invalid',  'authenticated', 'authenticated'),
    (u_lead2, 'lead2@test.invalid', 'authenticated', 'authenticated'),
    (u_bmem,  'bmem@test.invalid',  'authenticated', 'authenticated');
  insert into public.clubs (id, name, slug) values
    (club_a, 'Förening A', 'forening-a'),
    (club_b, 'Förening B', 'forening-b');
  insert into public.club_members (user_id, club_id, role) values
    (u_lead,  club_a, 'member'),
    (u_lead2, club_b, 'member'),
    (u_bmem,  club_b, 'member');
  insert into public.teams (id, club_id, name) values
    (team_a, club_a, 'P13 A'),
    (team_c, club_b, 'P13 C');
  insert into public.team_members (user_id, team_id, head_coach) values
    (u_lead,  team_a, true),
    (u_lead2, team_c, true);
  insert into public.subteams (id, team_id, name, game_format) values
    (sub_a, team_a, 'A', '5v5'),
    (sub_c, team_c, 'C', '5v5');
  -- Samma FOGIS-match (FG-9000) finns som en rad per lag. Lag A hemma, lag C borta.
  insert into public.fixtures (id, team_id, subteam_id, game_format, fogis_game_id, kickoff, home, away, is_home, source) values
    (fx_a, team_a, sub_a, '5v5', 'FG-9000', now() - interval '1 day', 'P13 A', 'P13 C', true,  'fogis'),
    (fx_c, team_c, sub_c, '5v5', 'FG-9000', now() - interval '1 day', 'P13 A', 'P13 C', false, 'fogis'),
    (fx_up, team_a, sub_a, '5v5', 'FG-9001', now() + interval '3 days', 'P13 A', 'P13 D', true, 'fogis');

  -- ---------------------------------------------------------------------------
  -- save_match_verdict
  -- ---------------------------------------------------------------------------

  -- ledare A rapporterar verdict 1 (hemma vann stort) på spelad match
  begin
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', u_lead), true); set local role authenticated;
    execute format('select public.save_match_verdict(%L, 1)', fx_a) into v;
    reset role; total := total + 1;
    if v not like '%"saved": true%' then fails := fails || ('ledare A sparar verdict 1: oväntat svar '||coalesce(v,'null')); end if;
  exception when others then reset role; total := total + 1; fails := fails || ('ledare A sparar verdict 1: fel '||sqlerrm); end;

  -- raden finns med verdict 1
  begin
    reset role;
    execute format('select verdict::text from public.match_evenness where fixture_id=%L and team_id=%L', fx_a, team_a) into v;
    reset role; total := total + 1;
    if v is distinct from '1' then fails := fails || ('verdict sparat som 1: '||coalesce(v,'null')); end if;
  exception when others then reset role; total := total + 1; fails := fails || ('verdict sparat som 1: fel '||sqlerrm); end;

  -- ledare C rapporterar verdict 3 på SAMMA FOGIS-match (egen rad) -> båda lagen kan rapportera
  begin
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', u_lead2), true); set local role authenticated;
    execute format('select public.save_match_verdict(%L, 3)', fx_c) into v;
    reset role; total := total + 1;
    if v not like '%"saved": true%' then fails := fails || ('ledare C sparar verdict 3: oväntat svar '||coalesce(v,'null')); end if;
  exception when others then reset role; total := total + 1; fails := fails || ('ledare C sparar verdict 3: fel '||sqlerrm); end;

  -- båda lagens rapporter finns för samma FOGIS-match (2 rader med fogis_game_id FG-9000)
  begin
    reset role;
    execute 'select (count(*))::text from public.match_evenness me join public.fixtures f on f.id=me.fixture_id and f.team_id=me.team_id where f.fogis_game_id=''FG-9000''' into v;
    reset role; total := total + 1;
    if v is distinct from '2' then fails := fails || ('båda lagens rapporter för samma match: '||coalesce(v,'null')||', väntade 2'); end if;
  exception when others then reset role; total := total + 1; fails := fails || ('båda lagens rapporter: fel '||sqlerrm); end;

  -- uppdatera (ändra verdict till 2) via save_match_verdict
  begin
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', u_lead), true); set local role authenticated;
    execute format('select public.save_match_verdict(%L, 2)', fx_a) into v;
    reset role;
    execute format('select verdict::text from public.match_evenness where fixture_id=%L and team_id=%L', fx_a, team_a) into v;
    total := total + 1;
    if v is distinct from '2' then fails := fails || ('uppdatera verdict till 2: '||coalesce(v,'null')); end if;
  exception when others then reset role; total := total + 1; fails := fails || ('uppdatera verdict: fel '||sqlerrm); end;

  -- ta bort rapport (verdict null)
  begin
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', u_lead), true); set local role authenticated;
    execute format('select public.save_match_verdict(%L, null)', fx_a) into v;
    reset role;
    execute format('select (count(*))::text from public.match_evenness where fixture_id=%L and team_id=%L', fx_a, team_a) into v;
    total := total + 1;
    if v is distinct from '0' then fails := fails || ('ta bort rapport: '||coalesce(v,'null')||', väntade 0'); end if;
  exception when others then reset role; total := total + 1; fails := fails || ('ta bort rapport: fel '||sqlerrm); end;

  -- verdict utanför 1-3 nekas
  begin
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', u_lead), true); set local role authenticated;
    execute format('select public.save_match_verdict(%L, 5)', fx_a);
    reset role; total := total + 1;
    fails := fails || 'verdict 5 nekas: borde ha gett fel';
  exception when others then reset role; total := total + 1; end;

  -- ospelad (kommande) match kan inte rapporteras
  begin
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', u_lead), true); set local role authenticated;
    execute format('select public.save_match_verdict(%L, 2)', fx_up);
    reset role; total := total + 1;
    fails := fails || 'ospelad match nekas: borde ha gett fel';
  exception when others then reset role; total := total + 1; end;

  -- utomstående (annan förenings medlem utan lagmedlemskap) kan inte rapportera lag A:s match
  begin
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', u_bmem), true); set local role authenticated;
    execute format('select public.save_match_verdict(%L, 1)', fx_a);
    reset role; total := total + 1;
    fails := fails || 'utomstående nekas: borde ha gett fel';
  exception when others then reset role; total := total + 1; end;

  -- ---------------------------------------------------------------------------
  -- Direkt CHECK + RLS
  -- ---------------------------------------------------------------------------

  -- direkt insert av verdict 0 nekas (CHECK)
  begin
    reset role;
    execute format('insert into public.match_evenness (fixture_id, team_id, verdict) values (%L, %L, 0)', fx_c, team_c);
    reset role; total := total + 1;
    fails := fails || 'CHECK verdict 0 nekas: borde ha gett fel';
  exception when others then reset role; total := total + 1; end;

  -- utomstående ser inte lag A:s rapport (RLS). Sätt en rapport först (som superuser), läs som u_bmem.
  begin
    reset role;
    insert into public.match_evenness (fixture_id, team_id, verdict) values (fx_a, team_a, 1)
      on conflict (fixture_id, team_id) do update set verdict = 1;
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', u_bmem), true); set local role authenticated;
    execute format('select (count(*))::text from public.match_evenness where fixture_id=%L', fx_a) into v;
    reset role; total := total + 1;
    if v is distinct from '0' then fails := fails || ('utomstående ser inte rapport: '||coalesce(v,'null')||', väntade 0'); end if;
  exception when others then reset role; total := total + 1; fails := fails || ('utomstående ser inte rapport: fel '||sqlerrm); end;

  -- ledare A ser sin egen rapport
  begin
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', u_lead), true); set local role authenticated;
    execute format('select (count(*))::text from public.match_evenness where fixture_id=%L and team_id=%L', fx_a, team_a) into v;
    reset role; total := total + 1;
    if v is distinct from '1' then fails := fails || ('ledare A ser egen rapport: '||coalesce(v,'null')||', väntade 1'); end if;
  exception when others then reset role; total := total + 1; fails := fails || ('ledare A ser egen rapport: fel '||sqlerrm); end;

  -- fixtures: ingen resultat-/målkolumn finns (schemakontroll)
  begin
    reset role;
    execute 'select (count(*))::text from information_schema.columns where table_schema=''public'' and table_name=''fixtures'' and column_name in (''home_goals'',''away_goals'',''result_text'')' into v;
    reset role; total := total + 1;
    if v is distinct from '0' then fails := fails || ('fixtures saknar resultatkolumner: '||coalesce(v,'null')||', väntade 0'); end if;
  exception when others then reset role; total := total + 1; fails := fails || ('fixtures saknar resultatkolumner: fel '||sqlerrm); end;

  raise exception 'TESTRESULT total=% fail=% :: %',
    total, cardinality(fails), coalesce(array_to_string(fails, ' | '), '(inga)');
end;
$test$;
