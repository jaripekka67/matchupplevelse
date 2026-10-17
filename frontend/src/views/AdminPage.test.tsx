import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AdminPage } from './AdminPage.tsx';
import { makeFakeBackend } from '../test/fakeBackend.ts';
import type { Club, Roles, Team } from '../types.ts';
import { ok } from '../types.ts';

const club: Club = { id: 'c1', name: 'Alfa IF', slug: 'alfa-if' };
const team: Team = { id: 't1', clubId: 'c1', name: 'P13' };
const adminRoles: Roles = {
  superadmin: false,
  federationRep: false,
  adminClubs: ['c1'],
  anyAdmin: true,
};

// Hjälpare: öppna <details> med given summary-text och returnera dess innehållsregion.
async function openSection(labelRe: RegExp) {
  const summary = await screen.findByText(labelRe);
  await userEvent.click(summary);
  // details-elementet är summaryns förälder
  const details = summary.closest('details') as HTMLElement;
  return within(details);
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
