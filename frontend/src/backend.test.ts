import { describe, it, expect } from 'vitest';
import { mapTeam, mapSubteam, mapSeries, mapFixture, mapClub } from './backend.ts';

describe('backend-mappning (snake_case -> camelCase)', () => {
  it('mapTeam', () => {
    expect(mapTeam({ id: 't1', club_id: 'c1', name: 'P13' })).toEqual({
      id: 't1',
      clubId: 'c1',
      name: 'P13',
    });
  });

  it('mapSubteam med och utan fogis_team_id', () => {
    expect(mapSubteam({ id: 's1', team_id: 't1', name: 'A', game_format: '5v5', fogis_team_id: '123' })).toEqual({
      id: 's1',
      teamId: 't1',
      name: 'A',
      gameFormat: '5v5',
      fogisTeamId: '123',
    });
    expect(mapSubteam({ id: 's2', team_id: 't1', name: 'B', game_format: '7v7', fogis_team_id: null }).fogisTeamId).toBeNull();
  });

  it('mapSeries', () => {
    expect(mapSeries({ id: 'se1', team_id: 't1', competition_id: 'C1', name: 'Vår', season: '2026' })).toEqual({
      id: 'se1',
      teamId: 't1',
      competitionId: 'C1',
      name: 'Vår',
      season: '2026',
    });
  });

  it('mapFixture bevarar is_home och saknar resultatfält', () => {
    const f = mapFixture({
      id: 'f1',
      team_id: 't1',
      subteam_id: 's1',
      game_format: '5v5',
      fogis_game_id: 'FG-1',
      competition: 'Vår',
      competition_id: 'C1',
      kickoff: '2026-05-01T10:00:00Z',
      home: 'Alfa',
      away: 'Beta',
      is_home: false,
      place: 'Plan 2',
      source: 'fogis',
    });
    expect(f.isHome).toBe(false);
    expect(f.fogisGameId).toBe('FG-1');
    expect(f.home).toBe('Alfa');
    expect('homeGoals' in f).toBe(false);
  });

  it('mapClub', () => {
    expect(mapClub({ id: 'c1', name: 'Alfa IF', slug: 'alfa-if' })).toEqual({
      id: 'c1',
      name: 'Alfa IF',
      slug: 'alfa-if',
    });
  });
});
