import { describe, it, expect } from 'vitest';
import {
  isPlayed,
  latestPlayed,
  sortByKickoffDesc,
  verdictOptions,
  verdictText,
  verdictSymbol,
  matchTitle,
} from './verdictLogic.ts';
import type { Fixture } from './types.ts';

function fx(id: string, kickoff: string, over: Partial<Fixture> = {}): Fixture {
  return {
    id,
    teamId: 't1',
    subteamId: 's1',
    gameFormat: '5v5',
    fogisGameId: null,
    competition: 'P13 Vår',
    competitionId: 'C1',
    kickoff,
    home: 'Alfa P13',
    away: 'Beta P13',
    isHome: true,
    place: null,
    source: 'fogis',
    ...over,
  };
}

const NOW = new Date('2026-05-10T12:00:00Z');

describe('isPlayed', () => {
  it('spelad när avspark passerat', () => {
    expect(isPlayed(fx('a', '2026-05-09T10:00:00Z'), NOW)).toBe(true);
  });
  it('inte spelad när avspark är i framtiden', () => {
    expect(isPlayed(fx('b', '2026-05-12T10:00:00Z'), NOW)).toBe(false);
  });
});

describe('sortByKickoffDesc', () => {
  it('senaste först', () => {
    const sorted = sortByKickoffDesc([
      fx('a', '2026-05-01T10:00:00Z'),
      fx('c', '2026-05-09T10:00:00Z'),
      fx('b', '2026-05-05T10:00:00Z'),
    ]);
    expect(sorted.map((f) => f.id)).toEqual(['c', 'b', 'a']);
  });
});

describe('latestPlayed', () => {
  it('väljer senaste spelade, hoppar framtida', () => {
    const list = [
      fx('old', '2026-05-01T10:00:00Z'),
      fx('recent', '2026-05-09T10:00:00Z'),
      fx('future', '2026-05-20T10:00:00Z'),
    ];
    expect(latestPlayed(list, NOW)?.id).toBe('recent');
  });
  it('null om inget spelats', () => {
    expect(latestPlayed([fx('future', '2026-05-20T10:00:00Z')], NOW)).toBeNull();
  });
});

describe('verdictOptions', () => {
  it('tre steg med lagnamn och symboler', () => {
    const opts = verdictOptions(fx('a', NOW.toISOString(), { home: 'Alfa', away: 'Beta' }));
    expect(opts.map((o) => o.value)).toEqual([1, 2, 3]);
    expect(opts[0].label).toBe('Alfa vann stort');
    expect(opts[1].label).toBe('Jämn match');
    expect(opts[2].label).toBe('Beta vann stort');
    // Varje val har en symbol (aldrig bara en siffra).
    for (const o of opts) expect(o.symbol.length).toBeGreaterThan(0);
  });

  it('faller tillbaka på Hemmalaget/Bortalaget när namn saknas', () => {
    const opts = verdictOptions(fx('a', NOW.toISOString(), { home: null, away: null }));
    expect(opts[0].label).toBe('Hemmalaget vann stort');
    expect(opts[2].label).toBe('Bortalaget vann stort');
  });
});

describe('verdictText / verdictSymbol / matchTitle', () => {
  it('text för sparat värde', () => {
    const f = fx('a', NOW.toISOString(), { home: 'Alfa', away: 'Beta' });
    expect(verdictText(f, 1)).toBe('Alfa vann stort');
    expect(verdictText(f, 2)).toBe('Jämn match');
    expect(verdictText(f, 3)).toBe('Beta vann stort');
  });
  it('symbol per värde', () => {
    expect(verdictSymbol(1)).toBeTruthy();
    expect(verdictSymbol(2)).toBeTruthy();
    expect(verdictSymbol(3)).toBeTruthy();
  });
  it('matchtitel hemma – borta', () => {
    expect(matchTitle(fx('a', NOW.toISOString(), { home: 'Alfa', away: 'Beta' }))).toBe('Alfa – Beta');
  });
});
