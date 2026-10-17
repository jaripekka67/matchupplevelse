# Handoff – nuläge och var man börjar

Sammanfattning vid sessionsslut. Allt nedan är gjort, verifierat och ligger på `main`.
Dokumentet är till för att snabbt komma in i nästa session.

## Vad appen är

Matchupplevelse: ledare rapporterar hur jämna ungdomsmatcher (upp till 7v7) var, och
förbundsrepresentanter ser en sammanställning per serie/lag. Två delar:
- `frontend/` – React + Vite (statisk build, hostad på Netlify)
- `supabase/` – hostad Postgres med migrationer, RLS och Edge Function `fogis-api`

Rollmodell: superadmin (plattform) → föreningsadmin → medlem/lagledare → förbundsrepresentant.
All säkerhet ligger i RLS + SECURITY DEFINER-RPC:er. Frontend använder bara anon-nyckeln.

Djupare beskrivning av körning, roller, demoläge och deploy finns i `docs/korning.md` och
`docs/deploy.md`. Läs dem först.

## Så kör du (kort)

```
cd frontend
npm install        # eller npm ci
npm run dev        # http://localhost:5500  (porten är 5500, inte 5173)
npm run test       # 115 tester, ska vara gröna
npm run typecheck
```

Databas/migrationer mot hostat Supabase (kräver inloggad + länkad supabase CLI):
```
supabase db push                 # applicerar migrationer
supabase functions deploy fogis-api
```
SQL-tester (DO-block som avslutas med `TESTRESULT total=N fail=M`; `fail=0` = grönt):
```
supabase db query --linked --file supabase/tests/<fil>.test.sql
```

## Vad som gjordes senast (allt KLART)

Punktlistan i `docs/info.txt` (a–d) är helt avklarad:

- **(a) FOGIS-import verifierad live.** Edge Function `fogis-api` svarar; appens importflöde
  (Admin → lag → "Importera matcher från FOGIS") hämtar serier och visar korrekt förhandsgranskning
  (tid, hemma/borta, serienamn, plats). Fältmappningen i `frontend/src/importLogic.ts`
  (`normalizeFogisGame`/`extractSeries`) stämmer och behålls tolerant.
- **(b) Inbjudningsflöde för personer utan konto.** En föreningsadmin kan bjuda in en e-post till
  både förening och lag. Har personen konto läggs hen till direkt; annars skapas en **väntande
  inbjudan** (ingen e-post skickas) som materialiseras automatiskt vid registrering.
  - DB: `supabase/migrations/20261015101000_inbjudningar.sql` – tabellerna `club_invites`/
    `team_invites` (RLS deny, nås bara via RPC), RPC:erna `invite/list/revoke_club_invite` +
    team-motsvarigheter, och triggern `claim_invites_for_new_user` på `auth.users`.
  - Frontend: `backend.ts` (`createMembersApi`), UI i `AdminPage.tsx` (`ClubMembers`/`TeamMembers`
    med inbjudningsläge + lista över väntande med Återkalla).
  - Viktig fix: `#variable_conflict use_column` lades till i invite-RPC:erna OCH i
    `add_club_member`/`add_team_member` (migration 8) – annars blev `email`/`role`/`user_id`
    tvetydiga mot OUT-kolumnerna och RPC:erna kraschade.
- **(c) Oanvänt API borttaget.** `fogis.saveSeries` (anropade RPC `save_series`) användes inte och
  togs bort ur `backend.ts` + `fakeBackend.ts`. DB-funktionen `save_series` (migration 5) BEHÖLLS
  medvetet (deployad, testad, oskadlig). Seriehantering i UI sker via `teams.addSeries/removeSeries`
  (`SeriesAdmin` i AdminPage) och är orörd.
- **(d) Komponenttester.** `AdminPage.test.tsx` täcker nu både inbjudningsflödet och FOGIS-import
  (hämta → förhandsgranska → importera, plus felfall). Importtestet använder ett FOGIS-svar i den
  live-verifierade formen och fungerar som regressionsskydd för fältmappningen.

Övrigt gjort i sessionen:
- Dev-port flyttad `5173 → 5500` (`vite.config.ts`, `strictPort: true`) pga krock med annat projekt.
  Följdändringar: `supabase/config.toml` (lokal auth-URL), `README.md`, `docs/korning.md`.
- Netlify-deploy: `netlify.toml` (base `frontend`, `npm ci && npm run build`, publish `dist`,
  `NODE_VERSION=24`, SPA-redirect) + `frontend/.nvmrc` + `frontend/public/_redirects`.
  Appen är live. `docs/deploy.md` har full guide inkl. felsökningskedja.
- Repo städat: ~19 lösa logg-/probe-filer borttagna; `.gitignore` fångar nu `probe*.txt`,
  `ct*.txt`, `npm-*.txt` m.fl.

## Testläge (förväntat grönt)

- Frontend: `npm run test` → **115** gröna (`frontend/`).
- SQL (mot hostad DB): `inbjudningar.test.sql` (23), `membership.test.sql` (17), samt övriga i
  `supabase/tests/`. Alla `fail=0`.

## Viktigt att veta / fallgropar

- **Porten är 5500.** Netlify-/Supabase-auth-URL:er i produktion sätts i Supabase-dashboarden
  (Authentication → URL Configuration), INTE i `config.toml` (den gäller bara lokal Supabase).
- **PL/pgSQL + `RETURNS TABLE`:** om en RPC returnerar kolumner som heter som tabellkolumner
  (`email`, `role`, `user_id` …), lägg `#variable_conflict use_column` först i funktionskroppen,
  annars blir referenser i `on conflict`/`where` tvetydiga. Mönstret finns i migration 8 och 10.
- **`npm ci` på Netlify** kräver att `frontend/package-lock.json` är i synk med `package.json`.
  Ändrar du beroenden: kör `npm install` lokalt och committa lockfilen.
- **FOGIS-token** (`FOGIS_API_KEY`) är en Supabase-hemlighet, finns aldrig i repo eller webbläsare.

## Git

Allt arbete ligger på `main` (origin: `github.com/jaripekka67/matchupplevelse`). Netlify
auto-deployar vid push till `main`. Pusha till ny branch för större ändringar om du vill ha
preview-deploys.

## Rimliga nästa steg (inget pågående)

- Fler komponenttester (t.ex. rapporteringsvyn `TeamPage` har redan test; förbundsvyn kan utökas).
- Rensa `frontend/info.txt`/root-`info.txt` om de inte behövs (lämnades kvar på begäran).
- Verifiera inbjudningsflödet end-to-end i produktion (bjud in en okänd e-post, registrera, se att
  medlemskap/ledarskap materialiseras).
