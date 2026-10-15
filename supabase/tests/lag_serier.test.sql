-- Test av migration 2: in_team/team_club, spelformsbegränsning och RLS för
-- teams, team_members, subteams och series.
-- Kör: supabase db query --linked --file supabase/tests/lag_serier.test.sql
-- Allt i ett DO-block som avslutas med RAISE (rullar tillbaka testdata).

do $test$
declare
  v text;
  n int;
  total int := 0;
  fails text[] := '{}';
  u_super constant uuid := '138b8030-c45a-5e42-b829-e45b795a2562';
  u_admin constant uuid := 'c8c5ba92-0fa7-5775-8fa5-f501a378f786';
  u_lead  constant uuid := 'e4970889-ac8e-56e1-a4c7-33210f0eed9f';
  u_bmem  constant uuid := 'c94b13fe-3b8f-5a76-9e53-842538818bfb';
  club_a constant uuid := 'aaaaaaaa-0000-0000-0000-00000000000a';
  club_b constant uuid := 'bbbbbbbb-0000-0000-0000-00000000000b';
  team_a constant uuid := 'aaaaaaaa-1111-0000-0000-00000000000a';
  team_b constant uuid := 'bbbbbbbb-1111-0000-0000-00000000000b';
  sub_a  constant uuid := 'aaaaaaaa-3333-0000-0000-00000000000a';
begin
  -- Testdata
  insert into auth.users (id, email, aud, role) values
    (u_super, 'super@test.invalid', 'authenticated', 'authenticated'),
    (u_admin, 'admin@test.invalid', 'authenticated', 'authenticated'),
    (u_lead,  'lead@test.invalid',  'authenticated', 'authenticated'),
    (u_bmem,  'bmem@test.invalid',  'authenticated', 'authenticated');
  insert into public.clubs (id, name, slug) values
    (club_a, 'Förening A', 'forening-a'),
    (club_b, 'Förening B', 'forening-b');
  insert into public.club_members (user_id, club_id, role) values
    (u_admin, club_a, 'club_admin'),
    (u_lead,  club_a, 'member'),
    (u_bmem,  club_b, 'member');
  insert into public.platform_admins (user_id) values (u_super);
  insert into public.teams (id, club_id, name) values
    (team_a, club_a, 'P13'),
    (team_b, club_b, 'P13');
  insert into public.team_members (user_id, team_id, head_coach) values
    (u_lead, team_a, true);
  insert into public.subteams (id, team_id, name, game_format, fogis_team_id) values
    (sub_a, team_a, 'P13 Lag 1', '5v5', '111');

  -- ---------------------------------------------------------------------------
  -- Hjälpare
  -- ---------------------------------------------------------------------------

  -- ledare: in_team egen = true
  begin
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', u_lead), true); set local role authenticated;
    execute format('select (public.in_team(%L))::text', team_a) into v;
    reset role; total := total + 1;
    if v is distinct from 'true' then fails := fails || ('ledare in_team egen: '||coalesce(v,'null')||', väntade true'); end if;
  exception when others then reset role; total := total + 1; fails := fails || ('ledare in_team egen: fel '||sqlerrm); end;

  -- ledare: in_team annan förenings lag = false
  begin
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', u_lead), true); set local role authenticated;
    execute format('select (public.in_team(%L))::text', team_b) into v;
    reset role; total := total + 1;
    if v is distinct from 'false' then fails := fails || ('ledare in_team annan: '||coalesce(v,'null')||', väntade false'); end if;
  exception when others then reset role; total := total + 1; fails := fails || ('ledare in_team annan: fel '||sqlerrm); end;

  -- föreningsadmin: in_team utan lagmedlemskap = true (admin ser allt i föreningen)
  begin
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', u_admin), true); set local role authenticated;
    execute format('select (public.in_team(%L))::text', team_a) into v;
    reset role; total := total + 1;
    if v is distinct from 'true' then fails := fails || ('admin in_team egen förening: '||coalesce(v,'null')||', väntade true'); end if;
  exception when others then reset role; total := total + 1; fails := fails || ('admin in_team egen förening: fel '||sqlerrm); end;

  -- team_club läcker inte: användare i förening B får null för lag i förening A
  begin
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', u_bmem), true); set local role authenticated;
    execute format('select coalesce((public.team_club(%L))::text, ''NULL'')', team_a) into v;
    reset role; total := total + 1;
    if v is distinct from 'NULL' then fails := fails || ('team_club läcker inte: '||coalesce(v,'null')||', väntade NULL'); end if;
  exception when others then reset role; total := total + 1; fails := fails || ('team_club läcker inte: fel '||sqlerrm); end;

  -- ---------------------------------------------------------------------------
  -- Spelformsbegränsning
  -- ---------------------------------------------------------------------------

  -- 7v7 tillåts
  begin
    reset role;
    execute format('insert into public.subteams (team_id, name, game_format) values (%L, ''7-manna'', ''7v7'')', team_a);
    get diagnostics n = row_count;
    reset role; total := total + 1;
    if n <> 1 then fails := fails || ('7v7 tillåts: '||n||' rader, väntade 1'); end if;
  exception when others then reset role; total := total + 1; fails := fails || ('7v7 tillåts: fel '||sqlerrm); end;

  -- 11v11 nekas (CHECK)
  begin
    reset role;
    execute format('insert into public.subteams (team_id, name, game_format) values (%L, ''11-manna'', ''11v11'')', team_a);
    reset role; total := total + 1;
    fails := fails || '11v11 nekas: borde ha gett fel';
  exception when others then reset role; total := total + 1; end;

  -- 9v9 nekas (CHECK)
  begin
    reset role;
    execute format('insert into public.subteams (team_id, name, game_format) values (%L, ''9-manna'', ''9v9'')', team_a);
    reset role; total := total + 1;
    fails := fails || '9v9 nekas: borde ha gett fel';
  exception when others then reset role; total := total + 1; end;

  -- ---------------------------------------------------------------------------
  -- RLS: synlighet
  -- ---------------------------------------------------------------------------

  -- ledare ser alla egna lagets subteams, men inga från andra lag/föreningar.
  -- (Jämför mot det faktiska antalet subteams i team_a, oberoende av insert-ordning ovan.)
  declare
    expected_a int;
  begin
    reset role;
    select count(*) into expected_a from public.subteams where team_id = team_a;
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', u_lead), true); set local role authenticated;
    execute 'select (count(*))::text from public.subteams' into v;
    reset role; total := total + 1;
    if v is distinct from expected_a::text then fails := fails || ('ledare ser egna lagets subteams: '||coalesce(v,'null')||', väntade '||expected_a); end if;
  exception when others then reset role; total := total + 1; fails := fails || ('ledare ser egna lagets subteams: fel '||sqlerrm); end;

  -- annan förenings medlem ser inga av förening A:s lag
  begin
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', u_bmem), true); set local role authenticated;
    execute format('select (count(*))::text from public.teams where club_id = %L', club_a) into v;
    reset role; total := total + 1;
    if v is distinct from '0' then fails := fails || ('B-medlem ser 0 av A:s lag: '||coalesce(v,'null')||', väntade 0'); end if;
  exception when others then reset role; total := total + 1; fails := fails || ('B-medlem ser 0 av A:s lag: fel '||sqlerrm); end;

  -- anon ser inga lag
  begin
    perform set_config('request.jwt.claims', '', true); set local role anon;
    execute 'select (count(*))::text from public.teams' into v;
    reset role; total := total + 1;
    if v is distinct from '0' then fails := fails || ('anon ser 0 lag: '||coalesce(v,'null')||', väntade 0'); end if;
  exception when others then reset role; total := total + 1; fails := fails || ('anon ser 0 lag: fel '||sqlerrm); end;

  -- ---------------------------------------------------------------------------
  -- RLS: skrivskydd
  -- ---------------------------------------------------------------------------

  -- ledare kan INTE skapa subteam (bara admin)
  begin
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', u_lead), true); set local role authenticated;
    execute format('insert into public.subteams (team_id, name, game_format) values (%L, ''Hack'', ''5v5'')', team_a);
    reset role; total := total + 1;
    fails := fails || 'ledare kan inte skapa subteam: borde ha nekats';
  exception when others then reset role; total := total + 1; end;

  -- föreningsadmin KAN skapa subteam i egen förening
  begin
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', u_admin), true); set local role authenticated;
    execute format('insert into public.subteams (team_id, name, game_format) values (%L, ''P13 Lag 2'', ''3v3'')', team_a);
    get diagnostics n = row_count;
    reset role; total := total + 1;
    if n <> 1 then fails := fails || ('admin skapar subteam: '||n||' rader, väntade 1'); end if;
  exception when others then reset role; total := total + 1; fails := fails || ('admin skapar subteam: fel '||sqlerrm); end;

  -- föreningsadmin kan INTE skapa subteam i annan förening
  begin
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', u_admin), true); set local role authenticated;
    execute format('insert into public.subteams (team_id, name, game_format) values (%L, ''Hack'', ''5v5'')', team_b);
    reset role; total := total + 1;
    fails := fails || 'admin kan inte skapa subteam i annan förening: borde ha nekats';
  exception when others then reset role; total := total + 1; end;

  -- föreningsadmin KAN skapa serie i egen förening
  begin
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', u_admin), true); set local role authenticated;
    execute format('insert into public.series (team_id, competition_id, name, season) values (%L, ''C1'', ''Serie 1'', ''2026'')', team_a);
    get diagnostics n = row_count;
    reset role; total := total + 1;
    if n <> 1 then fails := fails || ('admin skapar serie: '||n||' rader, väntade 1'); end if;
  exception when others then reset role; total := total + 1; fails := fails || ('admin skapar serie: fel '||sqlerrm); end;

  -- lag kan inte flyttas till annan förening (trigger)
  begin
    reset role;
    execute format('update public.teams set club_id = %L where id = %L', club_b, team_a);
    reset role; total := total + 1;
    fails := fails || 'lag kan inte flyttas: borde ha gett fel';
  exception when others then reset role; total := total + 1; end;

  -- lagmedlem utanför föreningen nekas (trigger)
  begin
    reset role;
    execute format('insert into public.team_members (user_id, team_id) values (%L, %L)', u_bmem, team_a);
    reset role; total := total + 1;
    fails := fails || 'lagmedlem utanför föreningen nekas: borde ha gett fel';
  exception when others then reset role; total := total + 1; end;

  -- ---------------------------------------------------------------------------
  -- Resultat
  -- ---------------------------------------------------------------------------
  raise exception 'TESTRESULT total=% fail=% :: %',
    total, cardinality(fails), coalesce(array_to_string(fails, ' | '), '(inga)');
end;
$test$;
