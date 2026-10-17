// Hjälpare för komponenttester: en fejkad Backend med stubbar som ger Result-svar. Testerna
// skickar in den som prop i stället för en riktig Supabase-klient, så vyerna kan testas utan nät.
// Varje grupp kan skrivas över per test via overrides (djup sammanslagning på gruppnivå).

import type { Backend } from '../backend.ts';
import { ok } from '../types.ts';

type DeepPartial<T> = { [K in keyof T]?: Partial<T[K]> };

/** Bygger en fejk-backend. Ange bara de metoder testet behöver; resten ger tomma ok-svar. */
export function makeFakeBackend(overrides: DeepPartial<Backend> = {}): Backend {
  const base: Backend = {
    auth: {
      signIn: async () => ok(null),
      signUp: async () => ok(null),
      signOut: async () => ok(null),
    },
    roles: {
      load: async () => ok({ superadmin: false, federationRep: false, adminClubs: [], anyAdmin: false }),
    },
    clubs: {
      list: async () => ok([]),
      create: async () => ok({ id: 'c1', name: '', slug: '' }),
    },
    teams: {
      myTeams: async () => ok([]),
      subteams: async () => ok([]),
      series: async () => ok([]),
      addSeries: async () => ok({ id: 's1', teamId: 't1', competitionId: 'C1', name: '', season: null }),
      removeSeries: async () => ok(null),
      teamsInClub: async () => ok([]),
      createTeam: async () => ok({ id: 't1', clubId: 'c1', name: '' }),
      renameTeam: async () => ok({ id: 't1', clubId: 'c1', name: '' }),
      deleteTeam: async () => ok(null),
      createSubteam: async () =>
        ok({ id: 'sub1', teamId: 't1', name: '', gameFormat: '7v7', fogisTeamId: null }),
    },
    matches: {
      forTeam: async () => ok([]),
      verdicts: async () => ok([]),
      saveVerdict: async () => ok(null),
    },
    fogis: {
      games: async () => ok({}),
      importGames: async () => ok({ created: 0, updated: 0, skipped: 0 }),
    },
    federation: {
      overview: async () => ok({ series: [], teams: [], matches: [] }),
    },
    members: {
      listClubMembers: async () => ok([]),
      addClubMember: async () => ok({ userId: 'u1', email: '', role: 'member' }),
      removeClubMember: async () => ok(null),
      listTeamMembers: async () => ok([]),
      addTeamMember: async () => ok({ userId: 'u1', email: '', headCoach: false }),
      removeTeamMember: async () => ok(null),
      inviteClubMember: async () => ok({ hasAccount: true }),
      listClubInvites: async () => ok([]),
      revokeClubInvite: async () => ok(null),
      inviteTeamMember: async () => ok({ hasAccount: true }),
      listTeamInvites: async () => ok([]),
      revokeTeamInvite: async () => ok(null),
    },
  };

  // Slå ihop per grupp så ett test kan skriva över enstaka metoder utan att tappa resten.
  // Hjälparen merge() bevarar gruppens exakta typ (K) genom hela sammanslagningen, vilket
  // TypeScript inte klarar via en generell indexskrivning över unionen keyof Backend.
  const merged = { ...base };
  function merge<K extends keyof Backend>(key: K): void {
    const override = overrides[key];
    if (override) merged[key] = { ...base[key], ...override };
  }
  for (const key of Object.keys(overrides) as (keyof Backend)[]) {
    merge(key);
  }
  return merged;
}
