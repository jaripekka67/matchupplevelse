# Handoff: admin-UI för medlemmar/ledare (A → B → C)

Status vid sessionsbyte. Arbetet följer tasklistan: **A klar**, **B och C återstår**.
Orsak till sessionsbyte: terminalen slutade köra kommandon (varje kommando returnerade direkt
utan att köra, ingen output/filer skrevs). Starta ny session så fungerar terminalen igen.

## Vad som skulle göras

Ursprunglig punkt (b) i `docs/info.txt`: "Bygga en admin-UI för att lägga till föreningsmedlemmar
och lagledare". Vid granskning visade det sig att den **redan är byggd**. Planen blev därför:
- **A:** Verifiera att befintlig medlems-funktion håller ihop frontend→RPC→DB. (KLAR)
- **B:** Bygg ut med inbjudan av användare som ännu inte har konto. (ÅTERSTÅR)
- **C:** Uppdatera `docs/info.txt` och dokumentation. (ÅTERSTÅR)

## A — KLAR och verifierad

Medlems-funktionen är korrekt och komplett. Verifierat:
- Alla sex RPC:er finns i `supabase/migrations/20261015100800_medlemskap.sql` och matchar
  frontend-anropen i `frontend/src/backend.ts` (`createMembersApi`) exakt – signatur,
  parameternamn (`p_club`/`p_email`/`p_role`/`p_team`/`p_user`/`p_head_coach`) och returform.
  Säkerhet via SECURITY DEFINER + `is_admin`-check, `search_path` satt, execute revoked från anon.
- UI finns i `frontend/src/views/AdminPage.tsx`: komponenterna `ClubMembers` och `TeamMembers`.
- **Typecheck grön (exit 0)** och **alla 108 tester gröna** efter fixarna nedan.

### Fixar gjorda i A (preexisterande problem, ej relaterade till medlemskoden)
Dessa blockerade all testkörning/verifiering och är nu åtgärdade:
1. `frontend/package.json`: `vite` nedgraderad `^8.3.4` → `^7.0.0`, `vitest` `^5.0.5` → `^2.1.9`.
   Grundorsak: `vite@8` är inkompatibel med `@vitejs/plugin-react@4` (ERESOLVE + vitest-hängning).
2. `frontend/package.json`: lade till saknat peer-beroende `@testing-library/dom@^10.4.0`.
   Det var därför `screen`/`waitFor` saknades och två komponenttester + typecheck föll.
3. `frontend/src/test/fakeBackend.ts`: fixade generiskt typfel i merge-loopen med en typad
   hjälparfunktion `merge<K extends keyof Backend>(key)`.
4. `frontend/src/views/FederationPage.test.tsx`: tvetydig `getByText('Alfa')` matchade både
   `<td>` och `<strong>`. Scopade till tabellen med `within(table)` (importerar nu `within`).

Installerade versioner i node_modules (bekräftade): vite 7.3.7, vitest 2.1.9,
@vitejs/plugin-react 4.7.0, @testing-library/dom 10.4.2.

### ÖPPET i A: package-lock.json saknas
`frontend/package-lock.json` raderades under en ren ominstallation och hann aldrig
återskapas (terminalen slutade fungera). node_modules är komplett och korrekt, appen
bygger och testar grönt lokalt, men lockfilen fattas. Återskapa den (ändrar inget annat):
```
cd frontend
npm install --package-lock-only
```
Kör även en full verifiering igen i ny session för säkerhets skull:
```
cd frontend
npm run typecheck   # väntat: inga fel
npm run test        # väntat: 108 passed
```

## B — ÅTERSTÅR: inbjudan av användare utan konto

Dagens begränsning: `add_club_member` och `add_team_member` kräver att e-posten tillhör ett
**befintligt** konto (RPC:erna kastar `no_data_found` annars; UI säger "E-post till befintligt
konto" / "Ledaren måste först vara medlem i föreningen"). Det finns ingen väg att bjuda in någon
som inte registrerat sig än.

Förslag på design (bekräfta med användaren innan bygge):
- Ny tabell för väntande inbjudningar, t.ex. `club_invites (email, club_id, role, invited_by,
  created_at)` med RLS så bara föreningsadmin ser/skapar för sin förening. Ev. motsvarande för lag.
- Ny migration (nästa nummer efter `20261015100900_...`), t.ex. `..._invites.sql`, med
  SECURITY DEFINER-RPC:er `invite_club_member(p_club, p_email, p_role)` /
  `list_club_invites(p_club)` / `revoke_club_invite(...)` i samma mönster som migration 8.
- Trigger på nya auth-användare (eller en claim-funktion vid första inloggning) som materialiserar
  väntande inbjudningar till riktiga `club_members`/`team_members` när kontot skapas.
- Frontend: utöka `createMembersApi` i `backend.ts` + `ClubMembers`/`TeamMembers` i `AdminPage.tsx`
  med "Bjud in"-läge och lista över väntande inbjudningar.
- Tester: lägg till enhetstester för RPC:erna (SQL-tester i `supabase/tests/`) och ev. UI-test.

Beslut som behövs av användaren: ska inbjudan gälla både förening och lag, och ska den gå via
e-post eller bara ligga som väntande post som aktiveras vid registrering?

## C — ÅTERSTÅR: dokumentation
- `docs/info.txt`: punkt (b) är i praktiken redan gjord (UI finns); uppdatera listan så den
  speglar att det som återstår är inbjudningsflödet (B), inte hela UI:t.
- `docs/korning.md`: idag står att roller sätts via SQL. Komplettera med inbjudningsflödet när B är
  klart. Notera också att `host: true` i Vite kräver IPv4 – se separat not nedan.

## Sidospår (ej del av A/B/C) – mobilåtkomst
Tidigare i sessionen felsöktes att testa appen på mobil. Slutsats: appen fungerar men telefonen
kunde inte nå datorns dev-server (timeout). `vite.config.ts` är återställd till `host: true`.
Brandväggsregel "Vite dev 5173" skapades och togs sedan bort av användaren. Troliga kvarvarande
orsaker: WiFi client isolation / nätet klassat som Public i Windows. Enklaste väg för mobiltest
framåt: Cloudflare Tunnel/ngrok, eller testa mot Netlify-deploy (se `docs/deploy.md`).
