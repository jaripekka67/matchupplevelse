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
   npm run dev          # http://localhost:5500
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
   Logga in igen – nu visas **Förbund**-menyn (`#/forbund`). Vyn är ordnad per ålderskull
   (F10, F11, P10 …, härledd ur serienamnet) med en flik per serie, och visar en
   per-lag-sammanställning (vann stort / jämnt / förlorade stort) plus matcher med
   "Oense"-markering när båda lagen rapporterat olika. Den läser bara **riktiga** rapporter
   från appen; eftersom en ledare bara kan rapportera sitt eget lag ser man ofta en rapport per
   match. För att demonstrera hela bilden (båda lagens upplevelse), använd demoläget nedan.

> **Obs:** Förbundsvyns per-lag-sammanställning kräver att migrationerna är applicerade
> (`supabase db push`), eftersom aggregatfunktionen `evenness_overview` behöver fälten
> `competitionId`/`teamId` i svaret.

## Medlemmar, lagledare och inbjudningar

Första superadmin sätts med SQL (ovan), men därefter sköts **alla** föreningsmedlemmar och
lagledare från **Admin**-vyn i appen – ingen SQL behövs. Under varje förening finns "Medlemmar"
och under varje lag "Ledare". Fälten tar en e-post och lägger till / bjuder in.

- **Har personen redan ett konto** läggs hen till direkt som medlem respektive ledare.
- **Saknar personen konto** skapas en **väntande inbjudan** i stället (ingen e-post skickas –
  inbjudan ligger bara som en post i databasen). Väntande inbjudningar visas i listan med en
  **Återkalla**-knapp.
- När personen sedan **registrerar sig med samma e-post** materialiseras inbjudningarna
  automatiskt: hen blir föreningsmedlem och, om hen bjudits in som ledare, även lagledare.
  Detta sköts av triggern `claim_invites_for_new_user` på `auth.users` (migration 10).

En laginbjudan skapar även en väntande föreningsinbjudan om personen saknar konto, eftersom
ett lagmedlemskap kräver att man är medlem i lagets förening. Vid registrering läggs därför
föreningsmedlemskapet först, sedan lagledarrollen.

> **Obs:** Inbjudningsflödet kräver att migration 10 (`20261015101000_inbjudningar.sql`) är
> applicerad (`supabase db push`).

## Demoläge (för demo och test, ingen databas)

Appen kan bara hämta den egna föreningens matcher från FOGIS, så förbundsvyn visar normalt bara
enstaka rapporter. För att visa upp hela serier – med påhittade utfall för **alla** lag – finns ett
demoläge som körs helt i webbläsaren. Inget sparas i databasen och inga roller krävs; datat ligger i
`localStorage` och kan exporteras/importeras som JSON.

- Nås via **Demo** i menyn (visas för admin/superadmin) eller direkt på `#/demo`.
- **Data-fliken:** klistra in ett spelprogram och ange ett serienamn (t.ex. `F10 C Mellersta/Västra`
  – ålderskullen härleds ur namnet). Två inklistringsformat stöds och autodetekteras:
  - FOGIS-exportens tab-separerade tabell (kolumnrubriker Tävling/Hemmalag/Bortalag/…).
  - Seriesidans text (block per match, `Omgång N`, `Lag emblem Lag`, svenskt datum).
- **Serier-fliken:** gruppflikar per ålderskull och en flik per serie. För varje match sätter man
  utfall för båda lagen (1/2/3), och vyn visar per-lag-sammanställning och "Oense"-markering.
- **Spara mellan demos:** datat ligger kvar i webbläsaren. Knapparna **Exportera/Importera JSON**
  sparar en hel uppsättning till en fil (en fil i stället för flera inklistringar) och läser in den
  igen – smidigt för att återanvända en förberedd demo. **Rensa demodata** nollställer allt.

Exempeldata att klistra in finns i `data/` (t.ex. `data/ÖFF-F10C-Mellersta-Västra.txt`).

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
`super@test.local` (superadmin), `admin@test.local` (föreningsadmin), `ledare@test.local` (ledare).

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
