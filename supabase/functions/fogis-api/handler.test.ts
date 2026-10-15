import { describe, it, expect, vi } from 'vitest';
import { handleFogis, dayNumber, MAX_DAYS, type FogisDeps } from './handler.ts';

/** Standardberoenden som "lyckas" överallt, så varje test bara ändrar det som testas. */
function okDeps(overrides: Partial<FogisDeps> = {}): FogisDeps {
  return {
    hasKey: true,
    caller: vi.fn(async () => ({ id: 'user-1' })),
    mayFetch: vi.fn(async () => true),
    allow: vi.fn(() => true),
    fetchUpstream: vi.fn(async () => ({ status: 200, json: { games: [{ id: 'FG-1' }] } })),
    ...overrides,
  };
}

const AUTH = 'Bearer token';
const TEAM = 'aaaaaaaa-1111-0000-0000-00000000000a';

function gamesReq(extra: Record<string, unknown> = {}) {
  return {
    method: 'POST',
    authHeader: AUTH,
    body: { teamId: TEAM, op: 'games', from: '2026-01-01', to: '2026-12-31', ...extra },
  };
}

describe('dayNumber', () => {
  it('tolkar giltiga datum och avvisar ogiltiga', () => {
    expect(dayNumber('2026-01-01')).not.toBeNull();
    expect(dayNumber('2026-13-01')).toBeNull(); // ogiltig månad
    expect(dayNumber('2026-02-30')).toBeNull(); // finns inte
    expect(dayNumber('inte-ett-datum')).toBeNull();
    expect(dayNumber(12345)).toBeNull();
  });
});

describe('handleFogis – metod och inloggning', () => {
  it('avvisar annat än POST', async () => {
    const res = await handleFogis({ method: 'GET', authHeader: AUTH, body: {} }, okDeps());
    expect(res.status).toBe(405);
  });

  it('avvisar utan Authorization-huvud', async () => {
    const res = await handleFogis({ method: 'POST', authHeader: null, body: {} }, okDeps());
    expect(res.status).toBe(401);
  });

  it('avvisar ogiltig token (caller = null)', async () => {
    const deps = okDeps({ caller: vi.fn(async () => null) });
    const res = await handleFogis(gamesReq(), deps);
    expect(res.status).toBe(401);
    // mayFetch ska inte ens anropas när inloggningen är ogiltig.
    expect(deps.mayFetch).not.toHaveBeenCalled();
  });
});

describe('handleFogis – parametrar', () => {
  it('avvisar saknad/ogiltig teamId', async () => {
    const res = await handleFogis({ method: 'POST', authHeader: AUTH, body: { op: 'games' } }, okDeps());
    expect(res.status).toBe(400);
  });

  it('avvisar okänd op', async () => {
    const res = await handleFogis(
      { method: 'POST', authHeader: AUTH, body: { teamId: TEAM, op: 'standings' } },
      okDeps(),
    );
    expect(res.status).toBe(400);
  });

  it('avvisar ogiltigt datumintervall (to < from)', async () => {
    const res = await handleFogis(gamesReq({ from: '2026-12-31', to: '2026-01-01' }), okDeps());
    expect(res.status).toBe(400);
  });

  it('avvisar för långt intervall (> MAX_DAYS)', async () => {
    const from = '2026-01-01';
    const to = '2027-06-01'; // > 400 dagar
    expect(dayNumber(to)! - dayNumber(from)!).toBeGreaterThan(MAX_DAYS);
    const res = await handleFogis(gamesReq({ from, to }), okDeps());
    expect(res.status).toBe(400);
  });

  it('avvisar icke-numeriskt clubId', async () => {
    const res = await handleFogis(gamesReq({ clubId: 'abc' }), okDeps());
    expect(res.status).toBe(400);
  });
});

describe('handleFogis – behörighet och ratelimit', () => {
  it('avvisar när mayFetch säger nej (403)', async () => {
    const deps = okDeps({ mayFetch: vi.fn(async () => false) });
    const res = await handleFogis(gamesReq(), deps);
    expect(res.status).toBe(403);
    // FOGIS ska inte frågas när behörigheten saknas.
    expect(deps.fetchUpstream).not.toHaveBeenCalled();
  });

  it('ger 503 när nyckeln saknas', async () => {
    const deps = okDeps({ hasKey: false });
    const res = await handleFogis(gamesReq(), deps);
    expect(res.status).toBe(503);
    expect(deps.fetchUpstream).not.toHaveBeenCalled();
  });

  it('ger 429 när ratelimiten är nådd', async () => {
    const deps = okDeps({ allow: vi.fn(() => false) });
    const res = await handleFogis(gamesReq(), deps);
    expect(res.status).toBe(429);
    expect(deps.fetchUpstream).not.toHaveBeenCalled();
  });
});

describe('handleFogis – uppströms FOGIS', () => {
  it('skickar vidare FOGIS JSON vid 200', async () => {
    const deps = okDeps();
    const res = await handleFogis(gamesReq(), deps);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ games: [{ id: 'FG-1' }] });
  });

  it('bygger rätt path med from/to och clubId', async () => {
    const deps = okDeps();
    await handleFogis(gamesReq({ clubId: '123456' }), deps);
    const calledWith = (deps.fetchUpstream as unknown as { mock: { calls: string[][] } }).mock.calls[0]![0];
    expect(calledWith).toContain('/club/upcoming-games');
    expect(calledWith).toContain('from=2026-01-01');
    expect(calledWith).toContain('to=2026-12-31');
    expect(calledWith).toContain('clubId=123456');
  });

  it('översätter FOGIS 401/403 till 503 (inställningsfel, inte användarfel)', async () => {
    const deps = okDeps({ fetchUpstream: vi.fn(async () => ({ status: 403, json: null })) });
    const res = await handleFogis(gamesReq(), deps);
    expect(res.status).toBe(503);
  });

  it('skickar vidare FOGIS 429', async () => {
    const deps = okDeps({ fetchUpstream: vi.fn(async () => ({ status: 429, json: null })) });
    const res = await handleFogis(gamesReq(), deps);
    expect(res.status).toBe(429);
  });

  it('ger 502 vid annat uppströmsfel', async () => {
    const deps = okDeps({ fetchUpstream: vi.fn(async () => ({ status: 500, json: null })) });
    const res = await handleFogis(gamesReq(), deps);
    expect(res.status).toBe(502);
  });

  it('ger 502 när svaret inte är JSON', async () => {
    const deps = okDeps({ fetchUpstream: vi.fn(async () => ({ status: 200, json: null })) });
    const res = await handleFogis(gamesReq(), deps);
    expect(res.status).toBe(502);
  });

  it('läcker aldrig token – svaret innehåller aldrig nyckeln', async () => {
    // handler.ts känner inte ens till nyckelns värde (bara hasKey), men vi kollar att
    // svaret vid framgång bara är FOGIS JSON och inget annat.
    const deps = okDeps();
    const res = await handleFogis(gamesReq(), deps);
    expect(JSON.stringify(res.body)).not.toContain('FOGIS_API_KEY');
    expect(JSON.stringify(res.body)).not.toMatch(/api.?key/i);
  });
});
