import { describe, it, expect } from 'vitest';
import {
  normalizeKickoff,
  normalizeFogisGame,
  extractGames,
  buildImportPreview,
} from './importLogic.ts';
import type { Fixture } from './types.ts';

describe('normalizeKickoff', () => {
  it('tolkar ISO med zon', () => {
    expect(normalizeKickoff('2026-05-01T10:00:00Z')).toBe('2026-05-01T10:00');
  });
  it('tolkar yyyy-mm-dd hh:mm', () => {
    expect(normalizeKickoff('2026-05-01 10:00')).toBe('2026-05-01T10:00');
  });
  it('avvisar skräp', () => {
    expect(normalizeKickoff('inte-datum')).toBeNull();
    expect(normalizeKickoff(123)).toBeNull();
  });
});

describe('normalizeFogisGame', () => {
  it('mappar vanliga fältnamn', () => {
    const g = normalizeFogisGame({
      matchId: '1001',
      kickoff: '2026-05-01T10:00:00',
      homeTeam: 'Alfa IF P13',
      awayTeam: 'Beta FK P13',
      isHome: true,
      competition: 'P13 Vår',
      competitionId: 'C1',
      arena: 'Alfaplan',
    });
    expect(g).toEqual({
      fogisGameId: '1001',
      kickoff: '2026-05-01T10:00',
      home: 'Alfa IF P13',
      away: 'Beta FK P13',
      isHome: true,
      competition: 'P13 Vår',
      competitionId: 'C1',
      place: 'Alfaplan',
    });
  });

  it('gissar is_home via klubbnamn när flagga saknas', () => {
    const home = normalizeFogisGame(
      { gameId: '2', date: '2026-05-02T09:00', hemmalag: 'Alfa IF P13', bortalag: 'Gamma P13' },
      'Alfa IF',
    );
    expect(home?.isHome).toBe(true);
    const away = normalizeFogisGame(
      { gameId: '3', date: '2026-05-03T09:00', hemmalag: 'Delta P13', bortalag: 'Alfa IF P13' },
      'Alfa IF',
    );
    expect(away?.isHome).toBe(false);
  });

  it('null när obligatoriskt saknas', () => {
    expect(normalizeFogisGame({ homeTeam: 'A', awayTeam: 'B' })).toBeNull(); // saknar id+tid
    expect(normalizeFogisGame(null)).toBeNull();
  });
});

describe('extractGames', () => {
  it('array direkt', () => {
    expect(extractGames([{ a: 1 }]).length).toBe(1);
  });
  it('inkapslat i games/matches/data', () => {
    expect(extractGames({ games: [1, 2] }).length).toBe(2);
    expect(extractGames({ matches: [1] }).length).toBe(1);
    expect(extractGames({ data: [1, 2, 3] }).length).toBe(3);
  });
  it('tomt annars', () => {
    expect(extractGames({ foo: 'bar' })).toEqual([]);
    expect(extractGames(null)).toEqual([]);
  });
});

function fx(id: string, over: Partial<Fixture> = {}): Fixture {
  return {
    id,
    teamId: 't1',
    subteamId: 's1',
    gameFormat: '5v5',
    fogisGameId: null,
    competition: null,
    competitionId: null,
    kickoff: '2026-05-01T10:00',
    home: 'Alfa',
    away: 'Beta',
    isHome: true,
    place: null,
    source: 'fogis',
    ...over,
  };
}

describe('buildImportPreview', () => {
  const sub = 'sub-1';

  it('nya matcher blir inserts med subteamId', () => {
    const resp = {
      games: [
        { matchId: '10', kickoff: '2026-06-01T10:00', homeTeam: 'Alfa P13', awayTeam: 'Beta P13', isHome: true },
      ],
    };
    const p = buildImportPreview(resp, [], sub);
    expect(p.inserts.length).toBe(1);
    expect(p.inserts[0].subteamId).toBe(sub);
    expect(p.updates.length).toBe(0);
  });

  it('matchning på fogis_game_id blir update', () => {
    const existing = [fx('f1', { fogisGameId: '10', kickoff: '2026-06-01T10:00' })];
    const resp = { games: [{ matchId: '10', kickoff: '2026-06-01T12:00', homeTeam: 'Alfa P13', awayTeam: 'Beta P13' }] };
    const p = buildImportPreview(resp, existing, sub);
    expect(p.updates.length).toBe(1);
    expect(p.updates[0].id).toBe('f1');
    expect(p.inserts.length).toBe(0);
  });

  it('matchning på dag + motståndare (utan fogis-id) blir update', () => {
    const existing = [fx('f2', { fogisGameId: null, kickoff: '2026-06-02T10:00', away: 'Gamma P13' })];
    const resp = { games: [{ matchId: '77', kickoff: '2026-06-02T18:00', homeTeam: 'Alfa P13', awayTeam: 'Gamma P13' }] };
    const p = buildImportPreview(resp, existing, sub);
    expect(p.updates.length).toBe(1);
    expect(p.updates[0].id).toBe('f2');
  });

  it('otolkbara spel hamnar i skipped', () => {
    const resp = { games: [{ homeTeam: 'A' }] }; // saknar id/tid/away
    const p = buildImportPreview(resp, [], sub);
    expect(p.skipped.length).toBe(1);
    expect(p.inserts.length).toBe(0);
  });

  it('blandat svar: en ny, en update, en skippad', () => {
    const existing = [fx('f1', { fogisGameId: '10' })];
    const resp = {
      games: [
        { matchId: '10', kickoff: '2026-06-01T10:00', homeTeam: 'Alfa', awayTeam: 'Beta' }, // update
        { matchId: '11', kickoff: '2026-06-08T10:00', homeTeam: 'Alfa', awayTeam: 'Delta' }, // ny
        { foo: 'bar' }, // skippad
      ],
    };
    const p = buildImportPreview(resp, existing, sub);
    expect(p.updates.length).toBe(1);
    expect(p.inserts.length).toBe(1);
    expect(p.skipped.length).toBe(1);
  });
});
