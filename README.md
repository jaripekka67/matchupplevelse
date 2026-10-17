# Matchupplevelse

Fristående webbapp där ledare i ungdomsfotboll (upp till 7 mot 7) rapporterar hur den
senaste spelade matchen upplevdes på en 3-gradig skala:

| Värde | Betydelse |
|---|---|
| 1 | Hemmalaget vann stort |
| 2 | Jämn match |
| 3 | Bortalaget vann stort |

Skalan visas med symboler i appen (aldrig bara siffror), alltid kompletterad med text.
Serierna i dessa spelformer räknar inte resultat, så det finns inga mål i FOGIS och ingen
serietabell. Ledarens upplevelse är enda datakällan.

## Roller

- **Ledare** – rapporterar matchupplevelse för sitt lags matcher. Alla ledare i truppen får rapportera.
- **Administratör** – skapar föreningar och lag (med FOGIS-id) och importerar matcher från FOGIS.
- **Förbundsrepresentant** – plattformsroll (satt av superadmin) som läser aggregerad data över alla föreningar och serier, ordnad per ålderskull och serie med en per-lag-sammanställning.

För demo och test finns ett **demoläge** (`#/demo`, visas för admin) som körs helt i webbläsaren:
klistra in hela seriers spelprogram, sätt påhittade utfall för alla lag och visa upp förbundsvyn –
utan att röra databasen. Se `docs/korning.md`.

## Struktur

| Mapp | Innehåll |
|---|---|
| `frontend/` | Webbapp i React + TypeScript (Vite). |
| `supabase/migrations/` | Databasmigrationer. Källa till hela schemat. |
| `supabase/functions/` | Edge Functions (t.ex. `fogis-api`). |
| `docs/` | Körning, deploy och driftsanvisningar. |

## Krav

- Git, Node.js 24 (LTS) med npm
- [Supabase CLI](https://supabase.com/docs/guides/cli)
- Docker Desktop (för lokal Supabase via `supabase start`)

## Starta lokalt

1. Starta lokal Supabase (kräver Docker):
   ```bash
   supabase start
   ```
   CLI:t skriver ut API-URL och `anon`-nyckel. Spara dem till frontendens miljöfil.

2. Skapa `frontend/.env.local` från mallen och fyll i värdena från steget ovan:
   ```bash
   cp frontend/.env.example frontend/.env.local
   ```

3. Starta frontend:
   ```bash
   cd frontend
   npm install
   npm run dev      # http://localhost:5500
   ```

4. (Vid FOGIS-import) kör Edge Functions lokalt och sätt FOGIS-token som hemlighet.
   Se `docs/` – token läggs **aldrig** i repot.

## Säkerhet

- FOGIS-token hanteras bara i en Edge Function (`fogis-api`) som en Supabase-hemlighet och
  lämnar aldrig servern. Klienten ser den aldrig.
- Service-nyckeln används aldrig i webbläsaren.
- Nya tabeller kräver RLS-policy.
