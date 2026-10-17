import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TeamPage } from './TeamPage.tsx';
import { makeFakeBackend } from '../test/fakeBackend.ts';
import type { Fixture, Verdict } from '../types.ts';
import { ok } from '../types.ts';

function playedFixture(over: Partial<Fixture> = {}): Fixture {
  return {
    id: 'fx1',
    teamId: 't1',
    subteamId: 'sub1',
    gameFormat: '7v7',
    fogisGameId: 'FG-1',
    competition: 'F10 C',
    competitionId: 'C1',
    kickoff: '2020-05-01T10:00', // i det förflutna -> spelad, rapporterbar
    home: 'Alfa',
    away: 'Beta',
    isHome: true,
    place: 'Planen',
    source: 'fogis',
    ...over,
  };
}

describe('TeamPage', () => {
  it('visar lagets spelade match och dess alternativ', async () => {
    const backend = makeFakeBackend({
      matches: { forTeam: async () => ok([playedFixture()]) },
    });
    render(<TeamPage teamId="t1" backend={backend} />);

    expect(await screen.findByText('Alfa – Beta')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Alfa vann stort/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Jämn match/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Beta vann stort/ })).toBeInTheDocument();
  });

  it('rapporterar genom att klicka ett alternativ (saveVerdict med rätt värde)', async () => {
    const saveVerdict = vi.fn(async (_id: string, _v: Verdict | null) => ok(null));
    const backend = makeFakeBackend({
      matches: { forTeam: async () => ok([playedFixture()]), saveVerdict },
    });
    render(<TeamPage teamId="t1" backend={backend} />);

    const evenBtn = await screen.findByRole('button', { name: /Jämn match/ });
    await userEvent.click(evenBtn);

    await waitFor(() => expect(saveVerdict).toHaveBeenCalledWith('fx1', 2));
    expect(evenBtn).toHaveAttribute('aria-pressed', 'true');
  });

  it('klick på redan valt alternativ tar bort rapporten (saveVerdict null)', async () => {
    const saveVerdict = vi.fn(async (_id: string, _v: Verdict | null) => ok(null));
    const backend = makeFakeBackend({
      matches: {
        forTeam: async () => ok([playedFixture()]),
        verdicts: async () => ok([{ fixtureId: 'fx1', teamId: 't1', verdict: 2 as Verdict }]),
        saveVerdict,
      },
    });
    render(<TeamPage teamId="t1" backend={backend} />);

    const evenBtn = await screen.findByRole('button', { name: /Jämn match/ });
    await waitFor(() => expect(evenBtn).toHaveAttribute('aria-pressed', 'true'));

    await userEvent.click(evenBtn);
    await waitFor(() => expect(saveVerdict).toHaveBeenCalledWith('fx1', null));
  });

  it('visar tomt läge när inga matcher finns', async () => {
    const backend = makeFakeBackend({ matches: { forTeam: async () => ok([]) } });
    render(<TeamPage teamId="t1" backend={backend} />);
    expect(await screen.findByText(/Inga matcher importerade/)).toBeInTheDocument();
  });
});
