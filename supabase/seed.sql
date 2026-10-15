-- Seed för LOKAL utveckling. Körs av `supabase db reset` (och vid `supabase start`
-- första gången). Skapa aldrig riktiga lösenord så här i något annat än lokal miljö.
--
-- Skapar tre testanvändare med lösenordet "password123":
--   super@test.local   – superadmin (plattformsnivå)
--   admin@test.local    – föreningsadmin i Alfa IF
--   ledare@test.local   – vanlig medlem (lagledare) i Alfa IF
-- samt två testföreningar (Alfa IF, Beta FK).
--
-- Allt är idempotent (går att köra flera gånger).

-- ---------------------------------------------------------------------------
-- Testanvändare i auth-schemat (bara lokalt!).
-- Lösenordet hashas med pgcrypto:s crypt(). Supabase lokala GoTrue accepterar
-- bcrypt-hashar i encrypted_password.
-- ---------------------------------------------------------------------------

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password,
   email_confirmed_at, created_at, updated_at,
   raw_app_meta_data, raw_user_meta_data,
   confirmation_token, recovery_token, email_change_token_new, email_change)
values
  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'super@test.local', crypt('password123', gen_salt('bf')),
   now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}',
   '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'admin@test.local', crypt('password123', gen_salt('bf')),
   now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}',
   '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated',
   'ledare@test.local', crypt('password123', gen_salt('bf')),
   now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}',
   '', '', '', '')
on conflict (id) do nothing;

-- Identitetsrader (krävs för inloggning med e-post i GoTrue).
insert into auth.identities
  (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
values
  ('00000000-0000-4000-8000-000000000001',
   '00000000-0000-4000-8000-000000000001',
   '{"sub":"00000000-0000-4000-8000-000000000001","email":"super@test.local","email_verified":true}',
   'email', now(), now(), now()),
  ('00000000-0000-4000-8000-000000000002',
   '00000000-0000-4000-8000-000000000002',
   '{"sub":"00000000-0000-4000-8000-000000000002","email":"admin@test.local","email_verified":true}',
   'email', now(), now(), now()),
  ('00000000-0000-4000-8000-000000000003',
   '00000000-0000-4000-8000-000000000003',
   '{"sub":"00000000-0000-4000-8000-000000000003","email":"ledare@test.local","email_verified":true}',
   'email', now(), now(), now())
on conflict (provider, provider_id) do nothing;

-- ---------------------------------------------------------------------------
-- Föreningar
-- ---------------------------------------------------------------------------

insert into public.clubs (id, name, slug) values
  ('00000000-0000-4000-8000-0000000000a1', 'Alfa IF', 'alfa-if'),
  ('00000000-0000-4000-8000-0000000000b2', 'Beta FK', 'beta-fk')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Roller
-- ---------------------------------------------------------------------------

-- Superadmin (plattformsnivå).
insert into public.platform_admins (user_id)
values ('00000000-0000-4000-8000-000000000001')
on conflict (user_id) do nothing;

-- Föreningsadmin och lagledare i Alfa IF.
insert into public.club_members (user_id, club_id, role) values
  ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000a1', 'club_admin'),
  ('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-0000000000a1', 'member')
on conflict (user_id, club_id) do nothing;

-- ---------------------------------------------------------------------------
-- Lag, subteam (med FOGIS-id och spelform) och serie i Alfa IF (migration 2).
-- ---------------------------------------------------------------------------

insert into public.teams (id, club_id, name) values
  ('00000000-0000-4000-8000-00000000a101', '00000000-0000-4000-8000-0000000000a1', 'P13')
on conflict (id) do nothing;

-- Lagledaren (ledare@test.local) är medlem i laget.
insert into public.team_members (user_id, team_id, head_coach) values
  ('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-00000000a101', true)
on conflict (user_id, team_id) do nothing;

insert into public.subteams (id, team_id, name, game_format, fogis_team_id) values
  ('00000000-0000-4000-8000-00000000a1a1', '00000000-0000-4000-8000-00000000a101', 'P13 Lag 1', '5v5', '123456')
on conflict (id) do nothing;

insert into public.series (id, team_id, competition_id, name, season) values
  ('00000000-0000-4000-8000-00000000a1b1', '00000000-0000-4000-8000-00000000a101', 'COMP-2026-P13', 'P13 Vårserie 2026', '2026')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Matcher (migration 3): en spelad och en kommande, för att prova rapportering.
-- ---------------------------------------------------------------------------

insert into public.fixtures
  (id, team_id, subteam_id, game_format, fogis_game_id, external_id, competition, competition_id,
   kickoff, home, away, is_home, place, source)
values
  -- Spelad match (igår): rapporterbar.
  ('00000000-0000-4000-8000-00000000f101', '00000000-0000-4000-8000-00000000a101',
   '00000000-0000-4000-8000-00000000a1a1', '5v5', 'FG-1001', 'fogis:FG-1001',
   'P13 Vårserie 2026', 'COMP-2026-P13',
   now() - interval '1 day', 'Alfa IF P13', 'Gamma BK P13', true, 'Alfaplan 2', 'fogis'),
  -- Kommande match (om en vecka): INTE rapporterbar än.
  ('00000000-0000-4000-8000-00000000f102', '00000000-0000-4000-8000-00000000a101',
   '00000000-0000-4000-8000-00000000a1a1', '5v5', 'FG-1002', 'fogis:FG-1002',
   'P13 Vårserie 2026', 'COMP-2026-P13',
   now() + interval '7 days', 'Delta IF P13', 'Alfa IF P13', false, 'Deltavallen', 'fogis')
on conflict (id) do nothing;
