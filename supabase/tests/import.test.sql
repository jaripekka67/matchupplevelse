-- Test av migration 5: save_series och import_fogis_games.
-- Kör: supabase db query --linked --file supabase/tests/import.test.sql
-- DO-block som avslutas med RAISE (rullar tillbaka testdata).

do $test$
declare
  v text;
  n int;
  total int := 0;
  fails text[] := '{}';
  u_admin constant uuid := 'c8c5ba92-0fa7-5775-8fa5-f501a378f786';
  u_lead  constant uuid := 'e4970889-ac8e-56e1-a4c7-33210f0eed9f';
  club_a constant uuid := 'aaaaaaaa-0000-0000-0000-00000000000a';
  team_a constant uuid := 'aaaaaaaa-1111-0000-0000-00000000000a';
  sub_5  constant uuid := 'aaaaaaaa-3333-0000-0000-000000000055';  -- 5v5 (tillåten)
  sub_11 constant uuid := 'aaaaaaaa-3333-0000-0000-000000000011';  -- hjälp: vi kan inte skapa 11v11-subteam (CHECK), så "otillåten" testas via okänt subteam
  res jsonb;
begin
  insert into auth.users (id, email, aud, role) values
    (u_admin, 'admin@test.invalid', 'authenticated', 'authenticated'),
    (u_lead,  'lead@test.invalid',  'authenticated', 'authenticated');
  insert into public.clubs (id, name, slug) values (club_a, 'Förening A', 'forening-a');
  insert into public.club_members (user_id, club_id, role) values
    (u_admin, club_a, 'club_admin'),
    (u_lead,  club_a, 'member');
  insert into public.teams (id, club_id, name) values (team_a, club_a, 'P13');
  insert into public.team_members (user_id, team_id, head_coach) values (u_lead, team_a, true);
  insert into public.subteams (id, team_id, name, game_format) values (sub_5, team_a, 'P13 5-manna', '5v5');

  -- ---------------------------------------------------------------------------
  -- save_series
  -- ---------------------------------------------------------------------------

  -- admin kan spara serier
  begin
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', u_admin), true); set local role authenticated;
    execute format('select public.save_series(%L, %L::jsonb)', team_a,
      '[{"competitionId":"COMP-1","name":"P13 Vår","season":"2026"}]') into v;
    reset role; total := total + 1;
    if v not like '%"saved": 1%' then fails := fails || ('admin save_series: oväntat '||coalesce(v,'null')); end if;
  exception when others then reset role; total := total + 1; fails := fails || ('admin save_series: fel '||sqlerrm); end;

  -- ledare (inte admin) kan INTE spara serier
  begin
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', u_lead), true); set local role authenticated;
    execute format('select public.save_series(%L, %L::jsonb)', team_a, '[{"competitionId":"COMP-2","name":"X"}]');
    reset role; total := total + 1;
    fails := fails || 'ledare kan inte save_series: borde ha nekats';
  exception when others then reset role; total := total + 1; end;

  -- ---------------------------------------------------------------------------
  -- import_fogis_games – nya matcher
  -- ---------------------------------------------------------------------------

  -- admin importerar två matcher (en hemma, en borta)
  begin
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', u_admin), true); set local role authenticated;
    execute format('select public.import_fogis_games(%L, %L::jsonb, %L::jsonb)', team_a,
      format('[{"fogisGameId":"FG-1","kickoff":"2026-05-01T10:00","subteamId":"%s","competition":"P13 Vår","competitionId":"COMP-1","home":"Alfa P13","away":"Gamma P13","isHome":true,"place":"Alfaplan"},
               {"fogisGameId":"FG-2","kickoff":"2026-05-08T10:00","subteamId":"%s","competition":"P13 Vår","competitionId":"COMP-1","home":"Delta P13","away":"Alfa P13","isHome":false}]', sub_5, sub_5),
      '[]') into v;
    reset role; total := total + 1;
    if v not like '%"created": 2%' then fails := fails || ('import 2 nya: oväntat '||coalesce(v,'null')); end if;
  exception when others then reset role; total := total + 1; fails := fails || ('import 2 nya: fel '||sqlerrm); end;

  -- is_home sattes rätt (FG-1 hemma=true, FG-2 hemma=false)
  begin
    reset role;
    execute format('select is_home::text from public.fixtures where team_id=%L and fogis_game_id=''FG-1''', team_a) into v;
    total := total + 1;
    if v is distinct from 'true' then fails := fails || ('FG-1 is_home: '||coalesce(v,'null')||', väntade true'); end if;
    execute format('select is_home::text from public.fixtures where team_id=%L and fogis_game_id=''FG-2''', team_a) into v;
    total := total + 1;
    if v is distinct from 'false' then fails := fails || ('FG-2 is_home: '||coalesce(v,'null')||', väntade false'); end if;
  exception when others then reset role; total := total + 1; fails := fails || ('is_home-kontroll: fel '||sqlerrm); end;

  -- game_format ärvdes från subteamet (5v5), source=fogis
  begin
    reset role;
    execute format('select game_format||'',''||source from public.fixtures where team_id=%L and fogis_game_id=''FG-1''', team_a) into v;
    total := total + 1;
    if v is distinct from '5v5,fogis' then fails := fails || ('FG-1 format/source: '||coalesce(v,'null')||', väntade 5v5,fogis'); end if;
  exception when others then reset role; total := total + 1; fails := fails || ('format/source: fel '||sqlerrm); end;

  -- ---------------------------------------------------------------------------
  -- Dedup
  -- ---------------------------------------------------------------------------

  -- samma fogisGameId importeras igen -> hoppas (created 0, skipped 1)
  begin
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', u_admin), true); set local role authenticated;
    execute format('select public.import_fogis_games(%L, %L::jsonb, %L::jsonb)', team_a,
      format('[{"fogisGameId":"FG-1","kickoff":"2026-05-01T10:00","subteamId":"%s","home":"Alfa P13","away":"Gamma P13","isHome":true}]', sub_5),
      '[]') into v;
    reset role; total := total + 1;
    if v not like '%"created": 0%' or v not like '%"skipped": 1%' then fails := fails || ('dedup fogisGameId: oväntat '||coalesce(v,'null')); end if;
  exception when others then reset role; total := total + 1; fails := fails || ('dedup fogisGameId: fel '||sqlerrm); end;

  -- samma dag + motståndare men nytt fogisGameId -> hoppas också (dedup på dag+motståndare)
  begin
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', u_admin), true); set local role authenticated;
    execute format('select public.import_fogis_games(%L, %L::jsonb, %L::jsonb)', team_a,
      format('[{"fogisGameId":"FG-99","kickoff":"2026-05-01T18:00","subteamId":"%s","home":"Alfa P13","away":"Gamma P13","isHome":true}]', sub_5),
      '[]') into v;
    reset role; total := total + 1;
    if v not like '%"created": 0%' or v not like '%"skipped": 1%' then fails := fails || ('dedup dag+motståndare: oväntat '||coalesce(v,'null')); end if;
  exception when others then reset role; total := total + 1; fails := fails || ('dedup dag+motståndare: fel '||sqlerrm); end;

  -- totalt bara 2 matcher i laget (ingen dubblett skapades)
  begin
    reset role;
    execute format('select (count(*))::text from public.fixtures where team_id=%L', team_a) into v;
    total := total + 1;
    if v is distinct from '2' then fails := fails || ('antal matcher efter dedup: '||coalesce(v,'null')||', väntade 2'); end if;
  exception when others then reset role; total := total + 1; fails := fails || ('antal efter dedup: fel '||sqlerrm); end;

  -- ---------------------------------------------------------------------------
  -- Otillåten spelform hoppas
  -- ---------------------------------------------------------------------------

  -- okänt/ogiltigt subteam (finns inte) -> hoppas (skipped), ingen match skapas
  begin
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', u_admin), true); set local role authenticated;
    execute format('select public.import_fogis_games(%L, %L::jsonb, %L::jsonb)', team_a,
      format('[{"fogisGameId":"FG-3","kickoff":"2026-06-01T10:00","subteamId":"%s","home":"Alfa P13","away":"Epsilon P13","isHome":true}]', sub_11),
      '[]') into v;
    reset role; total := total + 1;
    if v not like '%"created": 0%' or v not like '%"skipped": 1%' then fails := fails || ('otillåten/okänd spelform hoppas: oväntat '||coalesce(v,'null')); end if;
  exception when others then reset role; total := total + 1; fails := fails || ('otillåten spelform: fel '||sqlerrm); end;

  -- ---------------------------------------------------------------------------
  -- Uppdatering
  -- ---------------------------------------------------------------------------

  -- admin uppdaterar FG-1 (ny tid och plats)
  declare fid uuid;
  begin
    reset role;
    select id into fid from public.fixtures where team_id = team_a and fogis_game_id = 'FG-1';
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', u_admin), true); set local role authenticated;
    execute format('select public.import_fogis_games(%L, %L::jsonb, %L::jsonb)', team_a, '[]',
      format('[{"id":"%s","fogisGameId":"FG-1","kickoff":"2026-05-01T12:30","competition":"P13 Vår","competitionId":"COMP-1","home":"Alfa P13","away":"Gamma P13","isHome":true,"place":"Nya planen"}]', fid)) into v;
    reset role; total := total + 1;
    if v not like '%"updated": 1%' then fails := fails || ('uppdatering: oväntat '||coalesce(v,'null')); end if;
    reset role;
    execute format('select place from public.fixtures where id=%L', fid) into v;
    total := total + 1;
    if v is distinct from 'Nya planen' then fails := fails || ('uppdatering plats: '||coalesce(v,'null')); end if;
  exception when others then reset role; total := total + 1; fails := fails || ('uppdatering: fel '||sqlerrm); end;

  -- ---------------------------------------------------------------------------
  -- Behörighet
  -- ---------------------------------------------------------------------------

  -- ledare (inte admin) kan INTE importera
  begin
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', u_lead), true); set local role authenticated;
    execute format('select public.import_fogis_games(%L, %L::jsonb, %L::jsonb)', team_a,
      format('[{"fogisGameId":"FG-X","kickoff":"2026-07-01T10:00","subteamId":"%s","home":"A","away":"B","isHome":true}]', sub_5), '[]');
    reset role; total := total + 1;
    fails := fails || 'ledare kan inte importera: borde ha nekats';
  exception when others then reset role; total := total + 1; end;

  -- INGA resultat skrevs (fixtures har inga resultatkolumner – redan testat i migration 3,
  -- men vi bekräftar att importen inte råkar skapa dem via någon kolumn)
  begin
    reset role;
    execute 'select (count(*))::text from information_schema.columns where table_schema=''public'' and table_name=''fixtures'' and column_name like ''%goal%''' into v;
    total := total + 1;
    if v is distinct from '0' then fails := fails || ('inga målkolumner: '||coalesce(v,'null')); end if;
  exception when others then reset role; total := total + 1; fails := fails || ('inga målkolumner: fel '||sqlerrm); end;

  raise exception 'TESTRESULT total=% fail=% :: %',
    total, cardinality(fails), coalesce(array_to_string(fails, ' | '), '(inga)');
end;
$test$;
