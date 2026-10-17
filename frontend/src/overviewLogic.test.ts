import { describe, it, expect } from 'vitest';
import {
  groupMatches,
  countDisagreements,
  absoluteOutcome,
  sortSeries,
  sortTeams,
  evenPercent,
  federationStandings,
  ageGroupOf,
  groupSeries,
} from './overviewLogic.ts';
import type { MatchReport, SeriesSummary, TeamSummary, Verdict } from './types.ts';

function rep(over: Partial<MatchReport> = {}): MatchReport {
  return {
    fixtureId: 'f1',
    teamId: 't1',
    fogisGameId: 'FG-1',
    kickoff: '2026-05-01T10:00',
    competition: 'P13 Vår',
    competitionId: 'C1',
    home: 'Alfa P13',
    away: 'Beta P13',
    teamName: 'Alfa P13',
    clubName: 'Alfa IF',
    isHome: true,
    verdict: 1 as Verdict,
    dominant: 'us',
    ...over,
  };
}

describe('absoluteOutcome', () => {
  it('verdict -> hemma/jämn/borta', () => {
    expect(absoluteOutcome(rep({ verdict: 1 }))).toBe('home');
    expect(absoluteOutcome(rep({ verdict: 2 }))).toBe('even');
    expect(absoluteOutcome(rep({ verdict: 3 }))).toBe('away');
  });
});

describe('groupMatches', () => {
  it('grupperar två lags rapporter om samma FOGIS-match', () => {
    const g = groupMatches([
      rep({ fixtureId: 'fa', teamName: 'Alfa P13', fogisGameId: 'FG-100', verdict: 1, isHome: true }),
      rep({ fixtureId: 'fb', teamName: 'Beta P13', fogisGameId: 'FG-100', verdict: 1, isHome: false }),
    ]);
    expect(g.length).toBe(1);
    expect(g[0].reports.length).toBe(2);
  });

  it('eniga lag (båda säger hemma vann) = ingen oenighet', () => {
    // Båda rapporterna har verdict 1 (hemma vann stort) -> absolut utfall 'home' för båda.
    const g = groupMatches([
      rep({ fixtureId: 'fa', fogisGameId: 'FG-1', verdict: 1 }),
      rep({ fixtureId: 'fb', fogisGameId: 'FG-1', verdict: 1 }),
    ]);
    expect(g[0].disagreement).toBe(false);
  });

  it('oeniga lag (ett säger hemma, ett säger jämn) = oenighet', () => {
    const g = groupMatches([
      rep({ fixtureId: 'fa', fogisGameId: 'FG-2', verdict: 1 }),
      rep({ fixtureId: 'fb', fogisGameId: 'FG-2', verdict: 2 }),
    ]);
    expect(g[0].disagreement).toBe(true);
  });

  it('en ensam rapport är aldrig oenig', () => {
    const g = groupMatches([rep({ fogisGameId: 'FG-3' })]);
    expect(g[0].disagreement).toBe(false);
  });

  it('grupperar på dag+lag när fogisGameId saknas', () => {
    const g = groupMatches([
      rep({ fixtureId: 'fa', fogisGameId: null, kickoff: '2026-05-02T10:00', home: 'Alfa', away: 'Gamma' }),
      rep({ fixtureId: 'fb', fogisGameId: null, kickoff: '2026-05-02T18:00', home: 'Alfa', away: 'Gamma' }),
    ]);
    expect(g.length).toBe(1);
  });

  it('senaste matchen först', () => {
    const g = groupMatches([
      rep({ fogisGameId: 'old', kickoff: '2026-05-01T10:00' }),
      rep({ fogisGameId: 'new', kickoff: '2026-05-09T10:00' }),
    ]);
    expect(g[0].key).toBe('fg:new');
  });
});

describe('countDisagreements', () => {
  it('räknar oeniga grupper', () => {
    const groups = groupMatches([
      rep({ fixtureId: 'a', fogisGameId: 'FG-1', verdict: 1 }),
      rep({ fixtureId: 'b', fogisGameId: 'FG-1', verdict: 3 }), // oenig
      rep({ fixtureId: 'c', fogisGameId: 'FG-2', verdict: 2 }),
      rep({ fixtureId: 'd', fogisGameId: 'FG-2', verdict: 2 }), // enig
    ]);
    expect(countDisagreements(groups)).toBe(1);
  });
});

describe('federationStandings', () => {
  it('räknar per lag från dominant (us/even/opp)', () => {
    const rows = federationStandings([
      rep({ teamId: 'alfa', teamName: 'Alfa P13', clubName: 'Alfa IF', dominant: 'us' }),
      rep({ teamId: 'alfa', teamName: 'Alfa P13', clubName: 'Alfa IF', dominant: 'even' }),
      rep({ teamId: 'beta', teamName: 'Beta P13', clubName: 'Beta IF', dominant: 'opp' }),
    ]);
    const alfa = rows.find((r) => r.teamId === 'alfa')!;
    expect(alfa).toEqual({
      teamId: 'alfa',
      teamName: 'Alfa P13',
      clubName: 'Alfa IF',
      reports: 2,
      wonBig: 1,
      even: 1,
      lostBig: 0,
    });
    const beta = rows.find((r) => r.teamId === 'beta')!;
    expect(beta.lostBig).toBe(1);
    expect(beta.reports).toBe(1);
  });

  it('grupperar per teamId', () => {
    const rows = federationStandings([
      rep({ teamId: 'alfa', dominant: 'us' }),
      rep({ teamId: 'alfa', dominant: 'us' }),
    ]);
    expect(rows.length).toBe(1);
    expect(rows[0].wonBig).toBe(2);
  });

  it("unknown räknas som rapport men varken vinst/jämn/förlust", () => {
    const rows = federationStandings([rep({ dominant: 'unknown' })]);
    expect(rows[0].reports).toBe(1);
    expect(rows[0].wonBig + rows[0].even + rows[0].lostBig).toBe(0);
  });

  it('sorterar på flest storsegrar', () => {
    const rows = federationStandings([
      rep({ teamId: 'lag', teamName: 'Låg', dominant: 'even' }),
      rep({ teamId: 'hog', teamName: 'Hög', dominant: 'us' }),
    ]);
    expect(rows[0].teamName).toBe('Hög');
  });
});

describe('ageGroupOf / groupSeries (förbund)', () => {
  it('härleder kull ur serienamn', () => {
    expect(ageGroupOf('F10 C Mellersta/Västra')).toBe('F10');
    expect(ageGroupOf('okänd')).toBe('Övrigt');
  });
  it('grupperar och sorterar B före C, Övrigt sist', () => {
    const groups = groupSeries([
      { name: 'F10 C' },
      { name: 'F10 B' },
      { name: 'Träningsmatcher' },
    ]);
    expect(groups.map((g) => g.label)).toEqual(['F10', 'Övrigt']);
    expect(groups[0].seriesIndices).toEqual([1, 0]); // B (1) före C (0)
  });
});

describe('sortSeries / sortTeams / evenPercent', () => {
  it('serier sorteras på flest rapporter', () => {
    const s: SeriesSummary[] = [
      { competitionId: 'A', name: 'A', reports: 2, even: 1, dominated: 1, evenShare: 0.5 },
      { competitionId: 'B', name: 'B', reports: 9, even: 3, dominated: 6, evenShare: 0.33 },
    ];
    expect(sortSeries(s).map((x) => x.competitionId)).toEqual(['B', 'A']);
  });

  it('lag sorteras på förening + lagnamn', () => {
    const t: TeamSummary[] = [
      { teamId: '2', teamName: 'P13', clubName: 'Beta', reports: 1, ownBig: 0, oppBig: 0, even: 1, dominatedByUs: 0 },
      { teamId: '1', teamName: 'P13', clubName: 'Alfa', reports: 1, ownBig: 0, oppBig: 0, even: 1, dominatedByUs: 0 },
    ];
    expect(sortTeams(t).map((x) => x.clubName)).toEqual(['Alfa', 'Beta']);
  });

  it('evenPercent formatterar andel', () => {
    expect(evenPercent({ competitionId: 'A', name: 'A', reports: 4, even: 1, dominated: 3, evenShare: 0.25 })).toBe('25 %');
    expect(evenPercent({ competitionId: 'A', name: 'A', reports: 0, even: 0, dominated: 0, evenShare: null })).toBe('–');
  });
});
