-- Test av migration 10: inbjudningar (club_invites/team_invites, invite/list/revoke-RPC:er och
-- materialisering via trigger på auth.users vid registrering).
-- Kör: supabase db query --linked --file supabase/tests/inbjudningar.test.sql
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
  u_bmem  constant uuid := 'c94b13fe-3b8f-5a76-9e53-842538818bb1';
  -- Nya konton som "registrerar sig" under testet (triggern materialiserar deras inbjudningar).
  u_reg1  constant uuid := 'a1111111-0000-5000-8000-000000000010';  -- enbart föreningsinbjudan
  u_reg2  constant uuid := 'a1111111-0000-5000-8000-000000000011';  -- förening + lag
  club_a constant uuid := 'aaaaaaaa-0000-0000-0000-0000000000c0';
  club_b constant uuid := 'bbbbbbbb-0000-0000-0000-0000000000c0';
  team_a constant uuid := 'aaaaaaaa-1111-0000-0000-0000000000c0';
begin
  -- Testdata (befintliga konton + roller)
  insert into auth.users (id, email, aud, role) values
    (u_super, 'super10@test.invalid', 'authenticated', 'authenticated'),
    (u_admin, 'admin10@test.invalid', 'authenticated', 'authenticated'),
    (u_lead,  'lead10@test.invalid',  'authenticated', 'authenticated'),
    (u_bmem,  'bmem10@test.invalid',  'authenticated', 'authenticated');
  insert into public.clubs (id, name, slug) values
    (club_a, 'Förening A10', 'forening-a10'),
    (club_b, 'Förening B10', 'forening-b10');
  insert into public.club_members (user_id, club_id, role) values
    (u_admin, club_a, 'club_admin'),
    (u_lead,  club_a, 'member'),
    (u_bmem,  club_b, 'member');
  insert into public.platform_admins (user_id) values (u_super);
  insert into public.teams (id, club_id, name) values
    (team_a, club_a, 'P13-10');

  -- ---------------------------------------------------------------------------
  -- invite_club_member
  -- ---------------------------------------------------------------------------

  -- admin bjuder in en e-post utan konto -> väntande inbjudan, has_account = false
  begin
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', u_admin), true); set local role authenticated;
    execute format('select has_account::text from public.invite_club_member(%L, %L, %L)', club_a, 'reg1@test.invalid', 'member') into v;
    reset role; total := total + 1;
    if v is distinct from 'false' then fails := fails || ('invite_club_member utan konto: has_account='||coalesce(v,'null')||', väntade false'); end if;
  exception when others then reset role; total := total + 1; fails := fails || ('invite_club_member utan konto: fel '||sqlerrm); end;

  -- raden finns i club_invites (normaliserad e-post)
  begin
    reset role;
    select count(*) into n from public.club_invites where club_id = club_a and email = 'reg1@test.invalid';
    total := total + 1;
    if n <> 1 then fails := fails || ('club_invite skapad: '||n||', väntade 1'); end if;
  exception when others then reset role; total := total + 1; fails := fails || ('club_invite skapad: fel '||sqlerrm); end;

  -- e-post normaliseras (versaler/mellanslag) och är idempotent (ingen dubblett, roll uppdateras)
  begin
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', u_admin), true); set local role authenticated;
    perform public.invite_club_member(club_a, '  REG1@Test.invalid ', 'club_admin');
    reset role;
    select count(*) into n from public.club_invites where club_id = club_a and email = 'reg1@test.invalid';
    total := total + 1;
    if n <> 1 then fails := fails || ('invite idempotent/normaliserad: '||n||' rader, väntade 1'); end if;
    select role into v from public.club_invites where club_id = club_a and email = 'reg1@test.invalid';
    total := total + 1;
    if v is distinct from 'club_admin' then fails := fails || ('invite uppdaterar roll: '||coalesce(v,'null')||', väntade club_admin'); end if;
  exception when others then reset role; total := total + 2; fails := fails || ('invite idempotent: fel '||sqlerrm); end;

  -- invite på e-post som HAR konto -> läggs till direkt (has_account = true), ingen väntande rad
  begin
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', u_admin), true); set local role authenticated;
    execute format('select has_account::text from public.invite_club_member(%L, %L, %L)', club_a, 'lead10@test.invalid', 'member') into v;
    reset role; total := total + 1;
    if v is distinct from 'true' then fails := fails || ('invite_club_member med konto: has_account='||coalesce(v,'null')||', väntade true'); end if;
    reset role;
    select count(*) into n from public.club_invites where club_id = club_a and email = 'lead10@test.invalid';
    total := total + 1;
    if n <> 0 then fails := fails || ('invite med konto skapar ingen väntande rad: '||n||', väntade 0'); end if;
  exception when others then reset role; total := total + 2; fails := fails || ('invite med konto: fel '||sqlerrm); end;

  -- icke-admin (ledare) kan inte bjuda in
  begin
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', u_lead), true); set local role authenticated;
    perform public.invite_club_member(club_a, 'reg1@test.invalid', 'member');
    reset role; total := total + 1;
    fails := fails || 'ledare kan inte bjuda in: borde ha nekats';
  exception when others then reset role; total := total + 1; end;

  -- ---------------------------------------------------------------------------
  -- list_club_invites + revoke_club_invite
  -- ---------------------------------------------------------------------------

  -- admin ser den väntande inbjudan
  begin
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', u_admin), true); set local role authenticated;
    execute format('select (count(*))::text from public.list_club_invites(%L)', club_a) into v;
    reset role; total := total + 1;
    if v is distinct from '1' then fails := fails || ('list_club_invites: '||coalesce(v,'null')||', väntade 1'); end if;
  exception when others then reset role; total := total + 1; fails := fails || ('list_club_invites: fel '||sqlerrm); end;

  -- ledare kan inte lista inbjudningar
  begin
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', u_lead), true); set local role authenticated;
    perform public.list_club_invites(club_a);
    reset role; total := total + 1;
    fails := fails || 'ledare kan inte lista inbjudningar: borde ha nekats';
  exception when others then reset role; total := total + 1; end;

  -- ---------------------------------------------------------------------------
  -- invite_team_member utan konto -> både team_invite OCH club_invite skapas
  -- ---------------------------------------------------------------------------

  begin
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', u_admin), true); set local role authenticated;
    perform public.invite_team_member(team_a, 'reg2@test.invalid', true);
    reset role;
    select count(*) into n from public.team_invites where team_id = team_a and email = 'reg2@test.invalid';
    total := total + 1;
    if n <> 1 then fails := fails || ('team_invite skapad: '||n||', väntade 1'); end if;
    select count(*) into n from public.club_invites where club_id = club_a and email = 'reg2@test.invalid';
    total := total + 1;
    if n <> 1 then fails := fails || ('team-invite skapar även club_invite: '||n||', väntade 1'); end if;
  exception when others then reset role; total := total + 2; fails := fails || ('invite_team_member utan konto: fel '||sqlerrm); end;

  -- ---------------------------------------------------------------------------
  -- Materialisering vid registrering (trigger på auth.users)
  -- ---------------------------------------------------------------------------

  -- reg1 registrerar sig -> föreningsmedlemskap skapas, club_invite konsumeras
  begin
    insert into auth.users (id, email, aud, role) values (u_reg1, 'reg1@test.invalid', 'authenticated', 'authenticated');
    select count(*) into n from public.club_members where club_id = club_a and user_id = u_reg1;
    total := total + 1;
    if n <> 1 then fails := fails || ('reg1 blir föreningsmedlem vid registrering: '||n||', väntade 1'); end if;
    -- rollen från inbjudan (club_admin) ska ha följt med
    select role into v from public.club_members where club_id = club_a and user_id = u_reg1;
    total := total + 1;
    if v is distinct from 'club_admin' then fails := fails || ('reg1 får inbjuden roll: '||coalesce(v,'null')||', väntade club_admin'); end if;
    -- inbjudan konsumerad
    select count(*) into n from public.club_invites where email = 'reg1@test.invalid';
    total := total + 1;
    if n <> 0 then fails := fails || ('reg1 club_invite konsumerad: '||n||' kvar, väntade 0'); end if;
  exception when others then total := total + 3; fails := fails || ('reg1 materialisering: fel '||sqlerrm); end;

  -- reg2 registrerar sig -> både föreningsmedlem och lagledare (huvudtränare) skapas
  begin
    insert into auth.users (id, email, aud, role) values (u_reg2, 'reg2@test.invalid', 'authenticated', 'authenticated');
    select count(*) into n from public.club_members where club_id = club_a and user_id = u_reg2;
    total := total + 1;
    if n <> 1 then fails := fails || ('reg2 blir föreningsmedlem: '||n||', väntade 1'); end if;
    select count(*) into n from public.team_members where team_id = team_a and user_id = u_reg2;
    total := total + 1;
    if n <> 1 then fails := fails || ('reg2 blir lagledare: '||n||', väntade 1'); end if;
    select head_coach::text into v from public.team_members where team_id = team_a and user_id = u_reg2;
    total := total + 1;
    if v is distinct from 'true' then fails := fails || ('reg2 head_coach från inbjudan: '||coalesce(v,'null')||', väntade true'); end if;
    -- båda inbjudningarna konsumerade
    select count(*) into n from public.team_invites where email = 'reg2@test.invalid';
    total := total + 1;
    if n <> 0 then fails := fails || ('reg2 team_invite konsumerad: '||n||' kvar, väntade 0'); end if;
    select count(*) into n from public.club_invites where email = 'reg2@test.invalid';
    total := total + 1;
    if n <> 0 then fails := fails || ('reg2 club_invite konsumerad: '||n||' kvar, väntade 0'); end if;
  exception when others then total := total + 5; fails := fails || ('reg2 materialisering: fel '||sqlerrm); end;

  -- ---------------------------------------------------------------------------
  -- revoke_team_invite + revoke_club_invite
  -- ---------------------------------------------------------------------------

  -- Lägg en ny väntande inbjudan och återkalla den
  begin
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', u_admin), true); set local role authenticated;
    perform public.invite_team_member(team_a, 'reg3@test.invalid', false);
    perform public.revoke_team_invite(team_a, 'reg3@test.invalid');
    perform public.revoke_club_invite(club_a, 'reg3@test.invalid');
    reset role;
    select count(*) into n from public.team_invites where email = 'reg3@test.invalid';
    total := total + 1;
    if n <> 0 then fails := fails || ('revoke_team_invite: '||n||' kvar, väntade 0'); end if;
    select count(*) into n from public.club_invites where email = 'reg3@test.invalid';
    total := total + 1;
    if n <> 0 then fails := fails || ('revoke_club_invite: '||n||' kvar, väntade 0'); end if;
  exception when others then reset role; total := total + 2; fails := fails || ('revoke: fel '||sqlerrm); end;

  -- admin i annan förening kan inte lista/återkalla förening A:s inbjudningar
  begin
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', u_bmem), true); set local role authenticated;
    perform public.list_club_invites(club_a);
    reset role; total := total + 1;
    fails := fails || 'B-medlem kan inte lista A:s inbjudningar: borde ha nekats';
  exception when others then reset role; total := total + 1; end;

  -- tabellerna är inte nåbara direkt via API-roller: execute är revoked (permission denied),
  -- och även med rättigheter blockerar deny-policyn. En direkt select ska alltså nekas.
  begin
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', u_admin), true); set local role authenticated;
    select count(*) into n from public.club_invites;
    reset role; total := total + 1;
    fails := fails || ('club_invites direkt select nekas: borde ha gett fel, fick '||n||' rader');
  exception when others then reset role; total := total + 1; end;

  -- ---------------------------------------------------------------------------
  -- Resultat
  -- ---------------------------------------------------------------------------
  raise exception 'TESTRESULT total=% fail=% :: %',
    total, cardinality(fails), coalesce(array_to_string(fails, ' | '), '(inga)');
end;
$test$;
