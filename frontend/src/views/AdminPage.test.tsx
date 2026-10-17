import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AdminPage } from './AdminPage.tsx';
import { makeFakeBackend } from '../test/fakeBackend.ts';
import type { Club, Roles, Team, Subteam } from '../types.ts';
import { ok } from '../types.ts';

const club: Club = { id: 'c1', name: 'Alfa IF', slug: 'alfa-if' };
const team: Team = { id: 't1', clubId: 'c1', name: 'P13' };
const adminRoles: Roles = {
  superadmin: false,
  federationRep: false,
  adminClubs: ['c1'],
  anyAdmin: true,
};

// Hjälpare: öppna <details> med given summary-text och returnera både within-frågor och själva
// elementet (för queries på element utan tillgängligt namn, t.ex. date-inputs).
async function openSection(labelRe: RegExp) {
  const summary = await screen.findByText(labelRe);
  await userEvent.click(summary);
  // details-elementet är summaryns förälder
  const details = summary.closest('details') as HTMLElement;
  return Object.assign(within(details), { container: details });
}

// Sätt från/till-datum. date-inputs saknar tillgängligt namn, så vi når dem via DOM och
// sätter värdet med fireEvent (tillförlitligt i jsdom, till skillnad från userEvent.type).
function setDates(container: HTMLElement, from: string, to: string) {
  const dateInputs = container.querySelectorAll('input[type="date"]');
  fireEvent.change(dateInputs[0] as HTMLInputElement, { target: { value: from } });
  fireEvent.change(dateInputs[1] as HTMLInputElement, { target: { value: to } });
}

describe('AdminPage – inbjudningar', () => {
  it('medlem med konto läggs till direkt (inviteClubMember hasAccount=true)', async () => {
    const inviteClubMember = vi.fn(async () => ok({ hasAccount: true }));
    const backend = makeFakeBackend({
      clubs: { list: async () => ok([club]) },
      teams: { teamsInClub: async () => ok([]) },
      members: { inviteClubMember },
    });
    render(<AdminPage backend={backend} roles={adminRoles} />);

    const section = await openSection(/^Medlemmar/);
    await userEvent.type(section.getByPlaceholderText(/E-post/), 'finns@test.local');
    await userEvent.click(section.getByRole('button', { name: /Lägg till \/ bjud in/ }));

    await waitFor(() =>
      expect(inviteClubMember).toHaveBeenCalledWith('c1', 'finns@test.local', 'member'),
    );
    expect(await screen.findByText(/lades till som medlem/)).toBeInTheDocument();
  });

  it('medlem utan konto blir väntande inbjudan (hasAccount=false)', async () => {
    const inviteClubMember = vi.fn(async () => ok({ hasAccount: false }));
    const backend = makeFakeBackend({
      clubs: { list: async () => ok([club]) },
      teams: { teamsInClub: async () => ok([]) },
      members: { inviteClubMember },
    });
    render(<AdminPage backend={backend} roles={adminRoles} />);

    const section = await openSection(/^Medlemmar/);
    await userEvent.type(section.getByPlaceholderText(/E-post/), 'ny@test.local');
    await userEvent.click(section.getByRole('button', { name: /Lägg till \/ bjud in/ }));

    expect(await screen.findByText(/har inget konto än/)).toBeInTheDocument();
  });

  it('visar väntande föreningsinbjudan med återkalla-knapp', async () => {
    const revokeClubInvite = vi.fn(async () => ok(null));
    const backend = makeFakeBackend({
      clubs: { list: async () => ok([club]) },
      teams: { teamsInClub: async () => ok([]) },
      members: {
        listClubInvites: async () => ok([{ id: 'i1', email: 'vantar@test.local', role: 'member' }]),
        revokeClubInvite,
      },
    });
    render(<AdminPage backend={backend} roles={adminRoles} />);

    const section = await openSection(/^Medlemmar/);
    expect(section.getByText(/vantar@test.local.*väntande inbjudan/)).toBeInTheDocument();

    await userEvent.click(
      section.getByRole('button', { name: /Återkalla inbjudan till vantar@test.local/ }),
    );
    await waitFor(() =>
      expect(revokeClubInvite).toHaveBeenCalledWith('c1', 'vantar@test.local'),
    );
  });

  it('ledare utan konto bjuds in till både förening och lag', async () => {
    const inviteTeamMember = vi.fn(async () => ok({ hasAccount: false }));
    const backend = makeFakeBackend({
      clubs: { list: async () => ok([club]) },
      teams: { teamsInClub: async () => ok([team]), subteams: async () => ok([]), series: async () => ok([]) },
      members: { inviteTeamMember },
    });
    render(<AdminPage backend={backend} roles={adminRoles} />);

    const section = await openSection(/^Ledare/);
    await userEvent.type(section.getByPlaceholderText(/E-post/), 'tranare@test.local');
    await userEvent.click(section.getByRole('button', { name: /Lägg till \/ bjud in/ }));

    await waitFor(() =>
      expect(inviteTeamMember).toHaveBeenCalledWith('t1', 'tranare@test.local', false),
    );
    expect(await screen.findByText(/inbjudan \(förening \+ lag\) väntar/)).toBeInTheDocument();
  });
});

// Ett subteam med FOGIS-id, så importknappen aktiveras.
const subteam: Subteam = {
  id: 'sub1',
  teamId: 't1',
  name: 'P13 7v7',
  gameFormat: '7v7',
  fogisTeamId: '12345',
};

// Rått FOGIS-svar i den form som verifierats live (fältnamnen som normalizeFogisGame/extractSeries
// faktiskt läser). Fungerar även som regressionsskydd för fältmappningen.
const fogisResponse = {
  clubId: '12345',
  games: [
    {
      gameId: 'G-100',
      timeAsDateTime: '2026-05-10T10:00:00',
      homeTeamName: 'Alfa IF',
      awayTeamName: 'Beta BK',
      homeClubId: '12345',
      awayClubId: '67890',
      competitionId: 'COMP-1',
      competitionName: 'F10 C Mellersta',
      venuePitchTypeName: '7 mot 7',
      venueName: 'Alfavallen',
    },
  ],
};

// Backend där admin ser en förening med ett lag och ett subteam, och FOGIS svarar med fogisResponse.
function importBackend(overrides: Parameters<typeof makeFakeBackend>[0] = {}) {
  return makeFakeBackend({
    clubs: { list: async () => ok([club]) },
    teams: {
      teamsInClub: async () => ok([team]),
      subteams: async () => ok([subteam]),
      series: async () => ok([]),
    },
    matches: { forTeam: async () => ok([]) },
    ...overrides,
  });
}

describe('AdminPage – FOGIS-import', () => {
  it('hämtar, bygger förhandsgranskning och importerar', async () => {
    const importGames = vi.fn(async () => ok({ created: 1, updated: 0, skipped: 0 }));
    const games = vi.fn(async () => ok(fogisResponse));
    const backend = importBackend({ fogis: { games, importGames } });
    render(<AdminPage backend={backend} roles={adminRoles} />);

    const section = await openSection(/Importera matcher från FOGIS/);

    // Fyll datum och hämta.
    setDates(section.container, '2026-05-01', '2026-05-31');
    await userEvent.click(section.getByRole('button', { name: /Hämta från FOGIS/ }));

    // Enda serien väljs automatiskt och förhandsgranskningen visar den nya matchen.
    expect(await section.findByText(/Alfa IF – Beta BK/)).toBeInTheDocument();
    await waitFor(() =>
      expect(games).toHaveBeenCalledWith('t1', '2026-05-01', '2026-05-31', '12345'),
    );

    // Bekräfta import.
    await userEvent.click(section.getByRole('button', { name: /Bekräfta import/ }));
    await waitFor(() => expect(importGames).toHaveBeenCalledTimes(1));
    const [, inserts, updates] = importGames.mock.calls[0];
    expect(inserts).toHaveLength(1);
    expect(updates).toHaveLength(0);
    expect(await section.findByText(/Import klar: 1 nya/)).toBeInTheDocument();
  });

  it('visar fel när FOGIS-svaret saknar spelbara serier', async () => {
    const games = vi.fn(async () => ok({ games: [] }));
    const backend = importBackend({ fogis: { games } });
    render(<AdminPage backend={backend} roles={adminRoles} />);

    const section = await openSection(/Importera matcher från FOGIS/);
    setDates(section.container, '2026-05-01', '2026-05-31');
    await userEvent.click(section.getByRole('button', { name: /Hämta från FOGIS/ }));

    expect(await section.findByText(/Inga serier med spelform/)).toBeInTheDocument();
  });

  it('visar fel när FOGIS-anropet misslyckas', async () => {
    const games = vi.fn(async () => ({ ok: false as const, error: 'rate_limited' }));
    const backend = importBackend({ fogis: { games } });
    render(<AdminPage backend={backend} roles={adminRoles} />);

    const section = await openSection(/Importera matcher från FOGIS/);
    setDates(section.container, '2026-05-01', '2026-05-31');
    await userEvent.click(section.getByRole('button', { name: /Hämta från FOGIS/ }));

    expect(await section.findByText(/Kunde inte hämta från FOGIS/)).toBeInTheDocument();
  });
});
