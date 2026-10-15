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

## Demo-hosting av frontend (valfritt, Netlify)

Frontend är en statisk Vite-build och kan hostas på t.ex. Netlify. Build-inställningar:

- **Base directory:** `frontend`
- **Build command:** `npm run build`
- **Publish directory:** `frontend/dist`
- **Miljövariabler** (Netlify → Site settings → Environment):
  - `VITE_SUPABASE_URL` = `https://<PROJECT_REF>.supabase.co`
  - `VITE_SUPABASE_ANON_KEY` = anon-public-nyckeln

Lägg till en SPA-omdirigering så att djuplänkar fungerar (appen använder hash-routing, så detta
är mest en försiktighetsåtgärd). Skapa `frontend/public/_redirects` med:
```
/*  /index.html  200
```

Edge Function och databas ligger kvar på Supabase; Netlify hostar bara det statiska gränssnittet.

## FOGIS-fältmappning – att verifiera

Importfunktionen (`frontend/src/importLogic.ts`, `normalizeFogisGame`) läser FOGIS-svaret tolerant
och letar efter flera möjliga fältnamn (matchId/gameId/id, kickoff/matchDateTime/date,
homeTeam/home/hemmalag osv). Den exakta formen på FOGIS-svaret för ungdomsserier (och om
hemma/borta anges explicit) är inte verifierad mot ett riktigt svar än. Vid första skarpa
importen: kontrollera förhandsgranskningen och justera fältnamnen i `normalizeFogisGame` om något
saknas. Likaså `BASE`-URL och endpoint-path i `supabase/functions/fogis-api/index.ts` och
`handler.ts` kan behöva stämmas av mot FOGIS-dokumentationen.
