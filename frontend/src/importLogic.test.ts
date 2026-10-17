import { describe, it, expect } from 'vitest';
import {
  normalizeKickoff,
  normalizeFogisGame,
  extractGames,
  extractSeries,
  pitchFormat,
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

  it('mappar riktiga FOGIS-fältnamn (gameId/timeAsDateTime/homeTeamName/venueName)', () => {
    const g = normalizeFogisGame(
      {
        gameId: 6707056,
        homeClubId: 10126,
        awayClubId: 8520,
        homeTeamName: 'Söderköpings IK dam',
        awayTeamName: 'Linköping BK Tinnis',
        timeAsDateTime: '2026-04-12T15:00:00',
        time: '2026-04-12 15:00',
        competitionId: 131975,
        competitionName: 'Träningsmatcher Dam',
        venueName: 'Vikingavallen A',
      },
      undefined,
      8520,
    );
    expect(g).toEqual({
      fogisGameId: '6707056',
      kickoff: '2026-04-12T15:00',
      home: 'Söderköpings IK dam',
      away: 'Linköping BK Tinnis',
      isHome: false, // vårt klubb-id 8520 är bortalag
      competition: 'Träningsmatcher Dam',
      competitionId: '131975',
      place: 'Vikingavallen A',
    });
  });

  it('is_home via klubb-id när vi är hemmalag', () => {
    const g = normalizeFogisGame(
      {
        gameId: 6707200,
        homeClubId: 8520,
        awayClubId: 9772,
        homeTeamName: 'Linköping BK Tinnis',
        awayTeamName: 'Ödeshögs IK Dam',
        timeAsDateTime: '2026-04-17T19:00:00',
      },
      undefined,
      '8520',
    );
    expect(g?.isHome).toBe(true);
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

describe('pitchFormat', () => {
  it('tolkar FOGIS "N mot N"', () => {
    expect(pitchFormat('7 mot 7')).toBe('7v7');
    expect(pitchFormat('5 mot 5')).toBe('5v5');
    expect(pitchFormat('3 mot 3')).toBe('3v3');
  });
  it('ger null för spelformer appen inte stöder', () => {
    expect(pitchFormat('9 mot 9')).toBeNull();
    expect(pitchFormat('11 mot 11')).toBeNull();
    expect(pitchFormat('')).toBeNull();
    expect(pitchFormat(undefined)).toBeNull();
  });
  it('tål alternativa skrivsätt', () => {
    expect(pitchFormat('7v7')).toBe('7v7');
    expect(pitchFormat('7-manna')).toBe('7v7');
  });
});

describe('extractSeries', () => {
  it('returnerar bara serier med minst en spelbar match (3v3/5v5/7v7)', () => {
    const resp = {
      clubId: 8520,
      games: [
        // 11v11-serie – ska inte visas
        { gameId: 1, competitionId: 136335, competitionName: 'Division 4 Dam', venuePitchTypeName: '11 mot 11' },
        { gameId: 2, competitionId: 136335, competitionName: 'Division 4 Dam', venuePitchTypeName: '11 mot 11' },
        // 7v7-serie – ska visas
        { gameId: 3, competitionId: 137512, competitionName: 'F10 C Mellersta/Västra', venuePitchTypeName: '7 mot 7' },
        // 9v9 i samma F10-serie räknas inte som spelbar men serien finns ändå via 7v7-matchen
        { gameId: 4, competitionId: 137512, competitionName: 'F10 C Mellersta/Västra', venuePitchTypeName: '9 mot 9' },
      ],
    };
    const series = extractSeries(resp);
    expect(series.length).toBe(1);
    expect(series[0].competitionId).toBe('137512');
    expect(series[0].name).toBe('F10 C Mellersta/Västra');
    expect(series[0].playableCount).toBe(1);
  });
  it('tomt när inga spelbara serier finns', () => {
    const resp = { games: [{ gameId: 1, competitionId: 1, competitionName: 'Dam', venuePitchTypeName: '11 mot 11' }] };
    expect(extractSeries(resp)).toEqual([]);
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

  it('plockar klubb-id från svarets toppnivå för hemma/borta', () => {
    const resp = {
      clubId: 8520,
      games: [
        {
          gameId: 6707056,
          homeClubId: 10126,
          awayClubId: 8520,
          homeTeamName: 'Söderköpings IK dam',
          awayTeamName: 'Linköping BK Tinnis',
          timeAsDateTime: '2026-04-12T15:00:00',
        },
      ],
    };
    const p = buildImportPreview(resp, [], sub);
    expect(p.inserts.length).toBe(1);
    expect(p.inserts[0].isHome).toBe(false);
  });

  it('filtrerar på vald serie (competitionId)', () => {
    const resp = {
      clubId: 8520,
      games: [
        { gameId: 100, competitionId: 137512, homeTeamName: 'Alfa', awayTeamName: 'Beta', timeAsDateTime: '2026-06-01T10:00' },
        { gameId: 101, competitionId: 999999, homeTeamName: 'Gamma', awayTeamName: 'Delta', timeAsDateTime: '2026-06-02T10:00' },
      ],
    };
    const p = buildImportPreview(resp, [], sub, undefined, undefined, '137512');
    expect(p.inserts.length).toBe(1);
    expect(p.inserts[0].fogisGameId).toBe('100');
    expect(p.skipped.length).toBe(0); // andra serien hoppas helt, inte som "skipped"
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
