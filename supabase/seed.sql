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
