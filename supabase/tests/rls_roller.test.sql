-- Test av rollhjälpare och RLS i grundschemat (migration 1).
-- Kör: supabase db query -f supabase/tests/rls_roller.test.sql  (lokalt mot `supabase start`)
-- Allt sker i ett DO-block som alltid avslutas med ett RAISE, så inget sparas i databasen.
-- Resultatet står i felmeddelandet: 'TESTRESULT total=N fail=M :: ...'.

do $test$
declare
  v text;
  n int;
  total int := 0;
  fails text[] := '{}';
  -- Testanvändare
  u_super constant uuid := '138b8030-c45a-5e42-b829-e45b795a2562';
  u_admin constant uuid := 'c8c5ba92-0fa7-5775-8fa5-f501a378f786';
  u_lead  constant uuid := 'e4970889-ac8e-56e1-a4c7-33210f0eed9f';
  u_other constant uuid := 'c94b13fe-3b8f-5a76-9e53-842538818bfb';
  -- Testföreningar
  club_a constant uuid := 'aaaaaaaa-0000-0000-0000-00000000000a';
  club_b constant uuid := 'bbbbbbbb-0000-0000-0000-00000000000b';
begin
  -- ---------------------------------------------------------------------------
  -- Testdata
  -- ---------------------------------------------------------------------------
  insert into auth.users (id, email, aud, role) values
    (u_super, 'super@test.invalid', 'authenticated', 'authenticated'),
    (u_admin, 'admin@test.invalid', 'authenticated', 'authenticated'),
    (u_lead,  'lead@test.invalid',  'authenticated', 'authenticated'),
    (u_other, 'other@test.invalid', 'authenticated', 'authenticated');
  insert into public.clubs (id, name, slug) values
    (club_a, 'Förening A', 'forening-a'),
    (club_b, 'Förening B', 'forening-b');
  insert into public.club_members (user_id, club_id, role) values
    (u_admin, club_a, 'club_admin'),
    (u_lead,  club_a, 'member'),
    (u_other, club_b, 'member');
  insert into public.platform_admins (user_id) values (u_super);

  -- ---------------------------------------------------------------------------
  -- Rollhjälpare
  -- ---------------------------------------------------------------------------

  -- superadmin: is_superadmin = true
  begin
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', u_super), true); set local role authenticated;
    execute 'select (public.is_superadmin())::text' into v;
    reset role; total := total + 1;
    if v is distinct from 'true' then fails := fails || ('superadmin is_superadmin: fick '||coalesce(v,'null')||', väntade true'); end if;
  exception when others then reset role; total := total + 1; fails := fails || ('superadmin is_superadmin: fel '||sqlerrm); end;

  -- vanlig användare: is_superadmin = false
  begin
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', u_lead), true); set local role authenticated;
    execute 'select (public.is_superadmin())::text' into v;
    reset role; total := total + 1;
    if v is distinct from 'false' then fails := fails || ('ledare inte superadmin: fick '||coalesce(v,'null')||', väntade false'); end if;
  exception when others then reset role; total := total + 1; fails := fails || ('ledare inte superadmin: fel '||sqlerrm); end;

  -- föreningsadmin: is_admin egen = true
  begin
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', u_admin), true); set local role authenticated;
    execute format('select (public.is_admin(%L))::text', club_a) into v;
    reset role; total := total + 1;
    if v is distinct from 'true' then fails := fails || ('admin is_admin egen: fick '||coalesce(v,'null')||', väntade true'); end if;
  exception when others then reset role; total := total + 1; fails := fails || ('admin is_admin egen: fel '||sqlerrm); end;

  -- föreningsadmin: is_admin annan = false
  begin
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', u_admin), true); set local role authenticated;
    execute format('select (public.is_admin(%L))::text', club_b) into v;
    reset role; total := total + 1;
    if v is distinct from 'false' then fails := fails || ('admin is_admin annan: fick '||coalesce(v,'null')||', väntade false'); end if;
  exception when others then reset role; total := total + 1; fails := fails || ('admin is_admin annan: fel '||sqlerrm); end;

  -- ledare: is_admin egen = false (bara medlem)
  begin
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', u_lead), true); set local role authenticated;
    execute format('select (public.is_admin(%L))::text', club_a) into v;
    reset role; total := total + 1;
    if v is distinct from 'false' then fails := fails || ('ledare inte is_admin: fick '||coalesce(v,'null')||', väntade false'); end if;
  exception when others then reset role; total := total + 1; fails := fails || ('ledare inte is_admin: fel '||sqlerrm); end;

  -- ledare: is_active egen = true
  begin
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', u_lead), true); set local role authenticated;
    execute format('select (public.is_active(%L))::text', club_a) into v;
    reset role; total := total + 1;
    if v is distinct from 'true' then fails := fails || ('ledare is_active egen: fick '||coalesce(v,'null')||', väntade true'); end if;
  exception when others then reset role; total := total + 1; fails := fails || ('ledare is_active egen: fel '||sqlerrm); end;

  -- ledare: is_active annan = false
  begin
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', u_lead), true); set local role authenticated;
    execute format('select (public.is_active(%L))::text', club_b) into v;
    reset role; total := total + 1;
    if v is distinct from 'false' then fails := fails || ('ledare is_active annan: fick '||coalesce(v,'null')||', väntade false'); end if;
  exception when others then reset role; total := total + 1; fails := fails || ('ledare is_active annan: fel '||sqlerrm); end;

  -- superadmin: is_admin annan förening = true (ser allt)
  begin
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', u_super), true); set local role authenticated;
    execute format('select (public.is_admin(%L))::text', club_b) into v;
    reset role; total := total + 1;
    if v is distinct from 'true' then fails := fails || ('superadmin is_admin annan: fick '||coalesce(v,'null')||', väntade true'); end if;
  exception when others then reset role; total := total + 1; fails := fails || ('superadmin is_admin annan: fel '||sqlerrm); end;

  -- ---------------------------------------------------------------------------
  -- RLS: synlighet
  -- ---------------------------------------------------------------------------

  -- ledare ser bara egen förening
  begin
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', u_lead), true); set local role authenticated;
    execute 'select (count(*))::text from public.clubs' into v;
    reset role; total := total + 1;
    if v is distinct from '1' then fails := fails || ('ledare ser 1 förening: fick '||coalesce(v,'null')||', väntade 1'); end if;
  exception when others then reset role; total := total + 1; fails := fails || ('ledare ser 1 förening: fel '||sqlerrm); end;

  -- superadmin ser båda testföreningarna
  begin
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', u_super), true); set local role authenticated;
    execute format('select (count(*))::text from public.clubs where id in (%L,%L)', club_a, club_b) into v;
    reset role; total := total + 1;
    if v is distinct from '2' then fails := fails || ('superadmin ser 2 föreningar: fick '||coalesce(v,'null')||', väntade 2'); end if;
  exception when others then reset role; total := total + 1; fails := fails || ('superadmin ser 2 föreningar: fel '||sqlerrm); end;

  -- anon ser inga föreningar
  begin
    perform set_config('request.jwt.claims', '', true); set local role anon;
    execute 'select (count(*))::text from public.clubs' into v;
    reset role; total := total + 1;
    if v is distinct from '0' then fails := fails || ('anon ser 0 föreningar: fick '||coalesce(v,'null')||', väntade 0'); end if;
  exception when others then reset role; total := total + 1; fails := fails || ('anon ser 0 föreningar: fel '||sqlerrm); end;

  -- föreningsadmin ser föreningens club_members (admin + ledare = 2)
  begin
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', u_admin), true); set local role authenticated;
    execute 'select (count(*))::text from public.club_members' into v;
    reset role; total := total + 1;
    if v is distinct from '2' then fails := fails || ('admin ser 2 medlemmar: fick '||coalesce(v,'null')||', väntade 2'); end if;
  exception when others then reset role; total := total + 1; fails := fails || ('admin ser 2 medlemmar: fel '||sqlerrm); end;

  -- ledare ser bara sin egen club_members-rad
  begin
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', u_lead), true); set local role authenticated;
    execute 'select (count(*))::text from public.club_members' into v;
    reset role; total := total + 1;
    if v is distinct from '1' then fails := fails || ('ledare ser egen medlemsrad: fick '||coalesce(v,'null')||', väntade 1'); end if;
  exception when others then reset role; total := total + 1; fails := fails || ('ledare ser egen medlemsrad: fel '||sqlerrm); end;

  -- ---------------------------------------------------------------------------
  -- RLS: skrivskydd
  -- ---------------------------------------------------------------------------

  -- föreningsadmin kan INTE skapa förening
  begin
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', u_admin), true); set local role authenticated;
    execute 'insert into public.clubs(name,slug) values (''Hack'',''hack'')';
    reset role; total := total + 1;
    fails := fails || 'admin kan inte skapa förening: borde ha nekats';
  exception when others then reset role; total := total + 1; end;

  -- superadmin KAN skapa förening
  begin
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', u_super), true); set local role authenticated;
    execute 'insert into public.clubs(name,slug) values (''Ny'',''ny-forening-test'')';
    get diagnostics n = row_count;
    reset role; total := total + 1;
    if n <> 1 then fails := fails || ('superadmin skapar förening: '||n||' rader, väntade 1'); end if;
  exception when others then reset role; total := total + 1; fails := fails || ('superadmin skapar förening: fel '||sqlerrm); end;

  -- ledare kan INTE göra sig själv till föreningsadmin i annan förening
  begin
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', u_lead), true); set local role authenticated;
    execute format('insert into public.club_members(user_id,club_id,role) values (%L,%L,''club_admin'')', u_lead, club_b);
    reset role; total := total + 1;
    fails := fails || 'ledare kan inte bli admin i annan förening: borde ha nekats';
  exception when others then reset role; total := total + 1; end;

  -- föreningsadmin når INTE platform_admins (nekande policy + revoke)
  begin
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', u_admin), true); set local role authenticated;
    execute 'select count(*) from public.platform_admins';
    reset role; total := total + 1;
    fails := fails || 'admin når inte platform_admins: borde ha nekats';
  exception when others then reset role; total := total + 1; end;

  -- föreningsadmin kan INTE göra sig själv till superadmin
  begin
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', u_admin), true); set local role authenticated;
    execute format('insert into public.platform_admins(user_id) values (%L)', u_admin);
    reset role; total := total + 1;
    fails := fails || 'admin kan inte bli superadmin: borde ha nekats';
  exception when others then reset role; total := total + 1; end;

  -- ogiltig slug nekas (CHECK)
  begin
    reset role;
    execute 'insert into public.clubs(name,slug) values (''X'',''Ogiltig Slug'')';
    reset role; total := total + 1;
    fails := fails || 'ogiltig slug nekas: borde ha gett fel';
  exception when others then reset role; total := total + 1; end;

  -- ogiltig roll i club_members nekas (CHECK)
  begin
    reset role;
    execute format('insert into public.club_members(user_id,club_id,role) values (%L,%L,''chef'')', u_other, club_a);
    reset role; total := total + 1;
    fails := fails || 'ogiltig roll nekas: borde ha gett fel';
  exception when others then reset role; total := total + 1; end;

  -- ---------------------------------------------------------------------------
  -- Resultat (RAISE rullar tillbaka allt testdata)
  -- ---------------------------------------------------------------------------
  raise exception 'TESTRESULT total=% fail=% :: %',
    total, cardinality(fails), coalesce(array_to_string(fails, ' | '), '(inga)');
end;
$test$;
