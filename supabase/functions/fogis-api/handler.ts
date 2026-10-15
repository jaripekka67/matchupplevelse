// Logiken för fogis-api. Ren TypeScript utan Deno- eller Supabase-anrop, så att den går att
// testa med Vitest (se handler.test.ts). index.ts kopplar ihop den med Supabase och FOGIS-API:t.
//
// FOGIS-token lämnar ALDRIG servern: den används bara i index.ts fetchUpstream (headers), och
// skickas aldrig tillbaka i svaret. handler.ts känner inte ens till nyckelns värde, bara om den finns.
//
// Flöde: kontrollera metod och inloggning, kontrollera parametrar, kontrollera att anroparen får
// hämta för laget (databasen avgör via fogis_check: inloggad + i laget), ta ett utrymme i
// ratelimiten, och fråga FOGIS. En läsande operation stöds:
//   games  { teamId, op: 'games', from: 'yyyy-mm-dd', to: 'yyyy-mm-dd' }  -> matcher för föreningen
// teamId är laget i appen (för behörighet). Svaret är FOGIS svar, orört.

export interface FogisRequest {
  method: string;
  /** Hela Authorization-huvudet, t.ex. "Bearer eyJ...". */
  authHeader: string | null;
  body: unknown;
}

export interface FogisResponse {
  status: number;
  body: unknown;
}

export interface FogisDeps {
  /** Finns FOGIS-nyckeln (hemligheten FOGIS_API_KEY)? */
  hasKey: boolean;
  /** Vem anroparen är utifrån token. null om token är ogiltig. */
  caller(authHeader: string): Promise<{ id: string } | null>;
  /** Får anroparen hämta för laget? Databasen avgör (fogis_check: inloggad, i laget). */
  mayFetch(authHeader: string, teamId: string): Promise<boolean>;
  /** Tar ett utrymme i ratelimiten mot FOGIS. false när gränsen är nådd. */
  allow(): boolean;
  /** Frågar FOGIS. json är null om svaret inte var JSON. */
  fetchUpstream(path: string): Promise<{ status: number; json: unknown }>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
/** Längsta tidsrum en fråga får gälla (en säsong ~ ett år). */
export const MAX_DAYS = 400;
/** FOGIS klubb-id (numeriskt). */
const CLUB_ID = /^\d{1,12}$/;

const reply = (status: number, error: string): FogisResponse => ({ status, body: { error } });

/** Ett riktigt datum som antal dygn sedan 1970, eller null om texten inte är ett giltigt datum. */
export function dayNumber(text: unknown): number | null {
  const m = typeof text === 'string' ? DAY.exec(text) : null;
  if (!m) return null;
  const y = +m[1]!;
  const mo = +m[2]!;
  const da = +m[3]!;
  const d = new Date(Date.UTC(y, mo - 1, da));
  if (d.getUTCFullYear() !== y || d.getUTCMonth() !== mo - 1 || d.getUTCDate() !== da) return null;
  return Math.floor(d.getTime() / 86_400_000);
}

export async function handleFogis(req: FogisRequest, deps: FogisDeps): Promise<FogisResponse> {
  if (req.method !== 'POST') return reply(405, 'method_not_allowed');
  if (!req.authHeader) return reply(401, 'not_signed_in');

  const caller = await deps.caller(req.authHeader);
  if (!caller) return reply(401, 'not_signed_in');

  const b =
    typeof req.body === 'object' && req.body !== null && !Array.isArray(req.body)
      ? (req.body as Record<string, unknown>)
      : null;
  if (!b || typeof b.teamId !== 'string' || !UUID.test(b.teamId)) return reply(400, 'bad_request');

  let path: string;
  if (b.op === 'games') {
    const from = dayNumber(b.from);
    const to = dayNumber(b.to);
    if (from === null || to === null || to < from || to - from > MAX_DAYS) return reply(400, 'bad_request');
    // clubId är frivilligt – anges det måste det vara numeriskt.
    if (b.clubId !== undefined && (typeof b.clubId !== 'string' || !CLUB_ID.test(b.clubId))) {
      return reply(400, 'bad_request');
    }
    // from och to har kontrollerats som riktiga datum, så de kan skrivas rakt in i adressen.
    const clubPart = typeof b.clubId === 'string' ? `&clubId=${b.clubId}` : '';
    path = `/club/upcoming-games?from=${b.from as string}&to=${b.to as string}${clubPart}&w=3&take=1000&includeCanceled=false`;
  } else {
    return reply(400, 'bad_request');
  }

  if (!(await deps.mayFetch(req.authHeader, b.teamId))) return reply(403, 'forbidden');
  if (!deps.hasKey) return reply(503, 'not_configured');
  if (!deps.allow()) return reply(429, 'rate_limited');

  const up = await deps.fetchUpstream(path);
  // Att FOGIS nekar nyckeln är ett inställningsfel, inte något användaren kan rätta.
  if (up.status === 401 || up.status === 403) return reply(503, 'not_configured');
  if (up.status === 429) return reply(429, 'rate_limited');
  if (up.status < 200 || up.status >= 300) return reply(502, 'upstream_error');
  if (up.json === null || up.json === undefined) return reply(502, 'bad_response');
  return { status: 200, body: up.json };
}
