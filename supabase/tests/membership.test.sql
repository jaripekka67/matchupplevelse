-- Test av migration 8: medlemskapshantering (add/remove/list för club_members och team_members).
-- Kör: supabase db query --linked --file supabase/tests/membership.test.sql
-- Allt i ett DO-block som avslutas med RAISE (rullar tillbaka testdata).

do $test$
declare
  v text;
  n int;
  total int := 0;
  fails text[] := '{}';
  u_super constant uuid := '138b8030-c45a-5e42-b829-e45b795a2563';
  u_admin constant uuid := 'c8c5ba92-0fa7-5775-8fa5-f501a378f787';
  u_lead  constant uuid := 'e4970889-ac8e-56e1-a4c7-33210f0eed91';
  u_new   constant uuid := 'f1234567-0000-5000-8000-000000000001';
  u_bmem  constant uuid := 'c94b13fe-3b8f-5a76-9e53-842538818bb1';
  club_a constant uuid := 'aaaaaaaa-0000-0000-0000-0000000000a8';
  club_b constant uuid := 'bbbbbbbb-0000-0000-0000-0000000000b8';
  team_a constant uuid := 'aaaaaaaa-1111-0000-0000-0000000000a8';
begin
  -- Testdata
  insert into auth.users (id, email, aud, role) values
    (u_super, 'super8@test.invalid', 'authenticated', 'authenticated'),
    (u_admin, 'admin8@test.invalid', 'authenticated', 'authenticated'),
    (u_lead,  'lead8@test.invalid',  'authenticated', 'authenticated'),
    (u_new,   'new8@test.invalid',   'authenticated', 'authenticated'),
    (u_bmem,  'bmem8@test.invalid',  'authenticated', 'authenticated');
  insert into public.clubs (id, name, slug) values
    (club_a, 'Förening A8', 'forening-a8'),
    (club_b, 'Förening B8', 'forening-b8');
  insert into public.club_members (user_id, club_id, role) values
    (u_admin, club_a, 'club_admin'),
    (u_lead,  club_a, 'member'),
    (u_bmem,  club_b, 'member');
  insert into public.platform_admins (user_id) values (u_super);
  insert into public.teams (id, club_id, name) values
    (team_a, club_a, 'P13-8');

  -- ---------------------------------------------------------------------------
  -- add_club_member
  -- ---------------------------------------------------------------------------

  -- admin kan lägga till en ny medlem via e-post
  begin
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', u_admin), true); set local role authenticated;
    execute format('select (count(*))::text from public.add_club_member(%L, %L, %L)', club_a, 'new8@test.invalid', 'member') into v;
    reset role; total := total + 1;
    if v is distinct from '1' then fails := fails || ('admin add_club_member: '||coalesce(v,'null')||', väntade 1 rad'); end if;
  exception when others then reset role; total := total + 1; fails := fails || ('admin add_club_member: fel '||sqlerrm); end;

  -- raden finns nu i club_members
  begin
    reset role;
    select count(*) into n from public.club_members where club_id = club_a and user_id = u_new;
    total := total + 1;
    if n <> 1 then fails := fails || ('ny medlem finns i club_members: '||n||', väntade 1'); end if;
  exception when others then reset role; total := total + 1; fails := fails || ('ny medlem finns: fel '||sqlerrm); end;

  -- add_club_member är idempotent + uppdaterar roll (member -> club_admin)
  begin
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', u_admin), true); set local role authenticated;
    perform public.add_club_member(club_a, 'new8@test.invalid', 'club_admin');
    reset role;
    select role into v from public.club_members where club_id = club_a and user_id = u_new;
    total := total + 1;
    if v is distinct from 'club_admin' then fails := fails || ('add_club_member uppdaterar roll: '||coalesce(v,'null')||', väntade club_admin'); end if;
  exception when others then reset role; total := total + 1; fails := fails || ('add_club_member uppdaterar roll: fel '||sqlerrm); end;

  -- okänd e-post ger fel
  begin
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', u_admin), true); set local role authenticated;
    perform public.add_club_member(club_a, 'finns-inte@test.invalid', 'member');
    reset role; total := total + 1;
    fails := fails || 'okänd e-post ger fel: borde ha gett fel';
  exception when others then reset role; total := total + 1; end;

  -- ogiltig roll ger fel
  begin
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', u_admin), true); set local role authenticated;
    perform public.add_club_member(club_a, 'new8@test.invalid', 'superhacker');
    reset role; total := total + 1;
    fails := fails || 'ogiltig roll ger fel: borde ha gett fel';
  exception when others then reset role; total := total + 1; end;

  -- icke-admin (ledare) kan INTE lägga till medlemmar
  begin
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', u_lead), true); set local role authenticated;
    perform public.add_club_member(club_a, 'new8@test.invalid', 'member');
    reset role; total := total + 1;
    fails := fails || 'ledare kan inte lägga till medlem: borde ha nekats';
  exception when others then reset role; total := total + 1; end;

  -- admin i annan förening kan INTE lägga till i förening A
  begin
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', u_bmem), true); set local role authenticated;
    perform public.add_club_member(club_a, 'new8@test.invalid', 'member');
    reset role; total := total + 1;
    fails := fails || 'B-medlem kan inte lägga till i A: borde ha nekats';
  exception when others then reset role; total := total + 1; end;

  -- ---------------------------------------------------------------------------
  -- list_club_members
  -- ---------------------------------------------------------------------------

  -- admin ser medlemmar med e-post
  begin
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', u_admin), true); set local role authenticated;
    execute format('select (count(*))::text from public.list_club_members(%L)', club_a) into v;
    reset role; total := total + 1;
    -- admin, lead, new = 3
    if v is distinct from '3' then fails := fails || ('admin list_club_members: '||coalesce(v,'null')||', väntade 3'); end if;
  exception when others then reset role; total := total + 1; fails := fails || ('admin list_club_members: fel '||sqlerrm); end;

  -- ledare kan INTE lista medlemmar
  begin
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', u_lead), true); set local role authenticated;
    perform public.list_club_members(club_a);
    reset role; total := total + 1;
    fails := fails || 'ledare kan inte lista medlemmar: borde ha nekats';
  exception when others then reset role; total := total + 1; end;

  -- ---------------------------------------------------------------------------
  -- team_members: add/list/remove
  -- ---------------------------------------------------------------------------

  -- admin kan lägga till en ledare som är medlem i föreningen
  begin
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', u_admin), true); set local role authenticated;
    execute format('select (count(*))::text from public.add_team_member(%L, %L, %L)', team_a, 'lead8@test.invalid', true) into v;
    reset role; total := total + 1;
    if v is distinct from '1' then fails := fails || ('admin add_team_member: '||coalesce(v,'null')||', väntade 1 rad'); end if;
  exception when others then reset role; total := total + 1; fails := fails || ('admin add_team_member: fel '||sqlerrm); end;

  -- head_coach sattes
  begin
    reset role;
    select head_coach::text into v from public.team_members where team_id = team_a and user_id = u_lead;
    total := total + 1;
    if v is distinct from 'true' then fails := fails || ('head_coach sattes: '||coalesce(v,'null')||', väntade true'); end if;
  exception when others then reset role; total := total + 1; fails := fails || ('head_coach sattes: fel '||sqlerrm); end;

  -- kan inte lägga till ledare som inte är med i föreningen (u_bmem hör till förening B)
  begin
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', u_admin), true); set local role authenticated;
    perform public.add_team_member(team_a, 'bmem8@test.invalid', false);
    reset role; total := total + 1;
    fails := fails || 'ledare utanför föreningen nekas: borde ha gett fel';
  exception when others then reset role; total := total + 1; end;

  -- admin kan lista ledare
  begin
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', u_admin), true); set local role authenticated;
    execute format('select (count(*))::text from public.list_team_members(%L)', team_a) into v;
    reset role; total := total + 1;
    if v is distinct from '1' then fails := fails || ('admin list_team_members: '||coalesce(v,'null')||', väntade 1'); end if;
  exception when others then reset role; total := total + 1; fails := fails || ('admin list_team_members: fel '||sqlerrm); end;

  -- admin kan ta bort en ledare
  begin
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', u_admin), true); set local role authenticated;
    perform public.remove_team_member(team_a, u_lead);
    reset role;
    select count(*) into n from public.team_members where team_id = team_a and user_id = u_lead;
    total := total + 1;
    if n <> 0 then fails := fails || ('admin remove_team_member: '||n||' kvar, väntade 0'); end if;
  exception when others then reset role; total := total + 1; fails := fails || ('admin remove_team_member: fel '||sqlerrm); end;

  -- ---------------------------------------------------------------------------
  -- remove_club_member + städning av lagmedlemskap
  -- ---------------------------------------------------------------------------

  -- Lägg tillbaka en ledare och ta sedan bort hen ur föreningen -> lagraden städas (trigger)
  begin
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', u_admin), true); set local role authenticated;
    perform public.add_team_member(team_a, 'lead8@test.invalid', false);
    perform public.remove_club_member(club_a, u_lead);
    reset role;
    select count(*) into n from public.team_members where team_id = team_a and user_id = u_lead;
    total := total + 1;
    if n <> 0 then fails := fails || ('remove_club_member städar lagmedlemskap: '||n||' kvar, väntade 0'); end if;
  exception when others then reset role; total := total + 1; fails := fails || ('remove_club_member städar: fel '||sqlerrm); end;

  -- icke-admin kan inte ta bort medlem
  begin
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', u_bmem), true); set local role authenticated;
    perform public.remove_club_member(club_a, u_new);
    reset role; total := total + 1;
    -- remove nekar genom exception (ingen behörighet)
    if exists (select 1 from public.club_members where club_id = club_a and user_id = u_new) then
      null; -- ok om raden finns kvar; men vi förväntar oss exception, inte tyst radering
    end if;
    fails := fails || 'icke-admin remove_club_member: borde ha nekats';
  exception when others then reset role; total := total + 1; end;

  -- user_id_by_email ska inte vara anropbar av authenticated (revoke)
  begin
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', u_admin), true); set local role authenticated;
    perform public.user_id_by_email('admin8@test.invalid');
    reset role; total := total + 1;
    fails := fails || 'user_id_by_email ej anropbar: borde ha nekats';
  exception when others then reset role; total := total + 1; end;

  -- ---------------------------------------------------------------------------
  -- Resultat
  -- ---------------------------------------------------------------------------
  raise exception 'TESTRESULT total=% fail=% :: %',
    total, cardinality(fails), coalesce(array_to_string(fails, ' | '), '(inga)');
end;
$test$;
