# Deploy och demo

## Säkerhet och hemligheter

- **FOGIS-token** (`FOGIS_API_KEY`) ligger bara som Supabase-hemlighet och används enbart i
  Edge Function `fogis-api`, i anrop mot FOGIS. Den når aldrig webbläsaren och ligger aldrig i repot.
  Sätt den med `supabase secrets set FOGIS_API_KEY=...` (committa den aldrig).
- **Service-nyckeln** används aldrig i frontend. Frontend använder bara den publika anon-nyckeln.
- `.env.local` och allt annat med hemligheter är gitignorerat (`.env*` utom `.env.example`).

## Gratisnivåns projektgräns

Supabase gratisnivå tillåter ett begränsat antal aktiva projekt. Appen använder ett hostat
projekt (`<PROJECT_REF>`) för både utveckling och demo tills vidare, för att hålla sig inom gränsen.
Vill man köra helt gratis och lokalt är lokal Supabase (Docker) alternativet, se `korning.md`.

## Hosting av frontend på Netlify

Frontend är en statisk Vite-build. Databas och Edge Function ligger kvar på Supabase; Netlify
hostar bara det statiska gränssnittet, som pratar med Supabase via den publika anon-nyckeln.

### Byggkonfiguration (redan i repot)

Byggandet styrs av `netlify.toml` i repo-roten – du behöver alltså **inte** fylla i build-fälten
manuellt i Netlifys UI (toml-filen åsidosätter dem). Den sätter:

- **base** = `frontend` (mappen bygget körs i)
- **command** = `npm ci && npm run build` (deterministisk install från lockfilen)
- **publish** = `dist` (relativt base → `frontend/dist`)
- **NODE_VERSION** = `24` (samma major som projektet kräver; `frontend/.nvmrc` speglar detta lokalt)
- en SPA-fallback (`/*` → `/index.html` 200). Appen använder hash-routing, så detta är mest en
  försiktighetsåtgärd. Samma regel finns även i `frontend/public/_redirects`.

> **Obs:** `npm ci` kräver att `frontend/package-lock.json` är i synk med `package.json`. Är den
> inte det failar bygget med flit – kör då `npm install` lokalt och committa den uppdaterade
> lockfilen.

### Koppla repot

Netlify bygger direkt från GitHub-repot (`jaripekka67/matchupplevelse`) – projektet behöver inte
flyttas. I Netlify: **Add new site → Import from Git → välj repot**. Varje push till `main`
triggar sedan en ny deploy automatiskt.

### Miljövariabler (måste sättas)

Netlify → **Site settings → Environment variables**:

- `VITE_SUPABASE_URL` = `https://<PROJECT_REF>.supabase.co`
- `VITE_SUPABASE_ANON_KEY` = anon-public-nyckeln

Saknas dessa byggs appen men visar rutan *"Konfiguration saknas"* i stället för inloggningssidan.

### Auth-URL:er i Supabase (måste sättas för inloggning i produktion)

`supabase/config.toml` styr bara **lokal** Supabase. Det hostade projektet konfigureras i
dashboarden: **Authentication → URL Configuration**. Lägg in Netlife-domänen, annars blockeras
redirecten vid registrering/inloggning och användaren kan inte logga in från den publika sajten:

- **Site URL:** `https://<ditt-netlify-namn>.netlify.app` (eller egen domän)
- **Redirect URLs:** samma domän (ev. med `/**`), samt `http://localhost:5500` för lokal utveckling.

### Felsökning efter deploy

- **404 (Netlifys "Page not found"):** bygget/publish hittades inte. Kontrollera i Deploy log att
  rätt commit byggdes och att "Published" pekar på `frontend/dist`. Byggde Netlify en gammal commit
  (utan `netlify.toml`/`vite@7`) blir installen dessutom långsam/hängande.
- **Appen laddar men "Konfiguration saknas":** miljövariablerna ovan är inte satta.
- **Välkomst/inloggning visas men login fallerar:** auth-URL:erna i Supabase-dashboarden saknar
  produktionsdomänen.

## FOGIS-fältmappning

Importfunktionen (`frontend/src/importLogic.ts`, `normalizeFogisGame`) läser FOGIS-svaret tolerant
och letar efter flera möjliga fältnamn (matchId/gameId/id, kickoff/matchDateTime/date,
homeTeam/home/hemmalag osv). Mappningen är **verifierad mot ett riktigt FOGIS-svar** via appens
importflöde – serier, tid, hemma/borta, serienamn och plats läses korrekt. Den toleranta
uppslagningen behålls så att små variationer i svaret tål utan kodändring.

Skulle FOGIS ändra sitt svarsformat framåt: kontrollera förhandsgranskningen vid import och
justera vid behov fältnamnen i `normalizeFogisGame`/`extractSeries`, samt `BASE`-URL och
endpoint-path i `supabase/functions/fogis-api/index.ts` och `handler.ts`.
