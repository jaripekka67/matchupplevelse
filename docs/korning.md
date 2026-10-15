# Köra och utveckla Matchupplevelse

Appen har två delar: `frontend/` (React + Vite) och `supabase/` (databas-migrationer och
Edge Function `fogis-api`). Databasen körs på ett **hostat Supabase-projekt** (gratisnivå).

## Krav

- Node.js 24 (LTS) med npm
- Git
- [Supabase CLI](https://supabase.com/docs/guides/cli) (för migrationer och functions-deploy)
- Docker Desktop – **bara** om du vill köra hela Supabase lokalt (`supabase start`). Behövs inte
  för det hostade arbetssättet nedan.

## Snabbstart (hostat Supabase)

Det här är arbetssättet projektet använder: databasen ligger hostad, frontend körs lokalt mot den.

1. **Logga in och länka CLI:t mot projektet** (en gång):
   ```bash
   supabase login
   supabase link --project-ref <PROJECT_REF>
   ```

2. **Applicera migrationer** till det hostade projektet:
   ```bash
   supabase db push
   ```

3. **Deploya Edge Function** (för FOGIS-import):
   ```bash
   supabase functions deploy fogis-api
   ```

4. **Sätt FOGIS-token** som hemlighet (lämnar aldrig repot, aldrig webbläsaren):
   ```bash
   supabase secrets set FOGIS_API_KEY=<din-fogis-nyckel>
   ```

5. **Konfigurera frontend.** Skapa `frontend/.env.local` från mallen och fyll i Project URL och
   anon-nyckel (Project Settings → API i Supabase-dashboarden):
   ```bash
   cp frontend/.env.example frontend/.env.local
   ```
   ```
   VITE_SUPABASE_URL=https://<PROJECT_REF>.supabase.co
   VITE_SUPABASE_ANON_KEY=<anon-public-key>
   ```

6. **Starta frontend:**
   ```bash
   cd frontend
   npm install
   npm run dev          # http://localhost:5173
   ```
   `host: true` i Vite-konfigurationen gör att du även kan öppna appen från telefonen på samma
   nätverk (adressen visas i terminalen).

## Första superadmin och testdata (hostat)

`supabase/seed.sql` körs bara lokalt (`supabase db reset`), aldrig mot det hostade projektet. För
att komma igång på hostad DB:

1. Registrera ett konto via appens inloggningssida (knappen "Skapa ett nytt konto").
2. Gör kontot till superadmin med en SQL-fråga (Supabase SQL Editor eller `supabase db query --linked`):
   ```sql
   insert into public.platform_admins (user_id)
   select id from auth.users where email = '<din-epost>';
   ```
3. Logga in igen – nu visas Admin-menyn. Skapa en förening, ett lag och ett subteam (med spelform
   och FOGIS-id), och importera matcher.
4. En **förbundsrepresentant** sätts på samma sätt:
   ```sql
   insert into public.federation_reps (user_id)
   select id from auth.users where email = '<rep-epost>';
   ```

## Lokal Supabase (valfritt, kräver Docker)

Om du vill köra allt lokalt:
```bash
supabase start          # reser lokal Postgres, Auth, Studio m.m. i containrar
supabase db reset       # applicerar migrationer OCH seed.sql (testanvändare + data)
supabase functions serve fogis-api   # kör Edge Function lokalt
```
Sätt då `frontend/.env.local` till de lokala värdena som `supabase start` skriver ut
(API-URL `http://127.0.0.1:54421` och den lokala anon-nyckeln).

Lokala testanvändare från `seed.sql` (lösenord `password123`):
`super@test.local` (superadmin), `admin@test.local` (föreningsadmin), `ledare@test.local` (lagledare).

## Tester

- **Frontend och ren logik** (Vitest, jsdom):
  ```bash
  cd frontend
  npm run test
  npm run typecheck
  npm run build
  ```
- **Edge Function-logik** (Vitest, Node):
  ```bash
  cd supabase/functions
  npm install
  npm run test
  ```
- **Databas (RLS, funktioner)** – kör testfilerna i `supabase/tests/` mot den hostade DB:n:
  ```bash
  supabase db query --linked --file supabase/tests/rls_roller.test.sql
  ```
  Varje testfil är ett självständigt `DO`-block som avslutas med ett fel av formen
  `TESTRESULT total=N fail=M :: ...` (felet rullar tillbaka all testdata). `fail=0` betyder godkänt.
