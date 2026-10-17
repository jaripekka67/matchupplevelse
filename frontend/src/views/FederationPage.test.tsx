import { describe, it, expect } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FederationPage } from './FederationPage.tsx';
import { makeFakeBackend } from '../test/fakeBackend.ts';
import type { MatchReport, Overview, Verdict } from '../types.ts';
import { ok } from '../types.ts';

function rep(over: Partial<MatchReport>): MatchReport {
  return {
    fixtureId: 'f1',
    teamId: 't1',
    fogisGameId: 'FG-1',
    kickoff: '2026-05-01T10:00',
    competition: 'F10 C Mellersta/Västra',
    competitionId: 'C1',
    home: 'Alfa',
    away: 'Beta',
    teamName: 'Alfa',
    clubName: 'Alfa IF',
    isHome: true,
    verdict: 1 as Verdict,
    dominant: 'us',
    ...over,
  };
}

const overview: Overview = {
  series: [
    { competitionId: 'C1', name: 'F10 C Mellersta/Västra', reports: 2, even: 0, dominated: 2, evenShare: 0 },
    { competitionId: 'C2', name: 'F10 B Östra', reports: 1, even: 1, dominated: 0, evenShare: 1 },
  ],
  teams: [],
  matches: [
    rep({ fixtureId: 'f1', teamId: 'alfa', teamName: 'Alfa', clubName: 'Alfa IF', competitionId: 'C1', dominant: 'us' }),
    rep({ fixtureId: 'f2', teamId: 'beta', teamName: 'Beta', clubName: 'Beta IF', competitionId: 'C1', dominant: 'opp' }),
    rep({ fixtureId: 'f3', teamId: 'gamma', teamName: 'Gamma', clubName: 'Gamma IF', competitionId: 'C2', dominant: 'even', competition: 'F10 B Östra' }),
  ],
};

describe('FederationPage', () => {
  it('visar ålderskullflik och serieflikar, med vald series per-lag-tabell', async () => {
    const backend = makeFakeBackend({ federation: { overview: async () => ok(overview) } });
    render(<FederationPage backend={backend} />);

    // Gruppflik F10 (2 serier)
    expect(await screen.findByRole('tab', { name: /F10 \(2\)/ })).toBeInTheDocument();

    // Serieflikar – B före C i sorteringen, så "F10 B Östra" ska vara den som visas först/vald.
    expect(screen.getByRole('tab', { name: 'F10 B Östra' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'F10 C Mellersta/Västra' })).toBeInTheDocument();
  });

  it('byter serie och visar rätt lag i per-lag-tabellen', async () => {
    const backend = makeFakeBackend({ federation: { overview: async () => ok(overview) } });
    render(<FederationPage backend={backend} />);

    // Välj C-serien
    const cTab = await screen.findByRole('tab', { name: 'F10 C Mellersta/Västra' });
    await userEvent.click(cTab);

    // Per-lag-tabellen för C1 ska innehålla Alfa och Beta men inte Gamma (som ligger i C2).
    // Scopa till tabellen: lagnamnen förekommer även i matchlistan nedanför (<strong>), så en
    // dokumentbred getByText('Alfa') skulle matcha flera element.
    const table = await screen.findByRole('table');
    await waitFor(() => expect(within(table).getByText('Alfa')).toBeInTheDocument());
    expect(within(table).getByText('Beta')).toBeInTheDocument();
    expect(within(table).queryByText('Gamma')).not.toBeInTheDocument();
  });

  it('visar fel när overview misslyckas', async () => {
    const backend = makeFakeBackend({
      federation: { overview: async () => ({ ok: false, error: 'Ingen behörighet' }) },
    });
    render(<FederationPage backend={backend} />);
    expect(await screen.findByText('Ingen behörighet')).toBeInTheDocument();
  });
});
