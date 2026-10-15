// Delade typer för appen.

export type ClubRole = 'club_admin' | 'member';

/** Användarens roller, hämtade via RPC efter inloggning. */
export type Roles = {
  superadmin: boolean;
  federationRep: boolean;
  /** Föreningar där användaren är admin (club_admin eller superadmin). */
  adminClubs: string[];
  /** True om användaren är admin i någon förening (eller superadmin). */
  anyAdmin: boolean;
};

export type Club = {
  id: string;
  name: string;
  slug: string;
};

export type Team = {
  id: string;
  clubId: string;
  name: string;
};

export type Subteam = {
  id: string;
  teamId: string;
  name: string;
  gameFormat: GameFormat;
  fogisTeamId: string | null;
};

export type GameFormat = '3v3' | '5v5' | '7v7';

export type Series = {
  id: string;
  teamId: string;
  competitionId: string;
  name: string;
  season: string | null;
};

export type Fixture = {
  id: string;
  teamId: string;
  subteamId: string | null;
  gameFormat: GameFormat;
  fogisGameId: string | null;
  competition: string | null;
  competitionId: string | null;
  kickoff: string; // ISO
  home: string | null;
  away: string | null;
  isHome: boolean | null;
  place: string | null;
  source: string;
};

/** Lagledarens rapport om en match. 1 = hemma vann stort, 2 = jämn, 3 = borta vann stort. */
export type Verdict = 1 | 2 | 3;

export type MatchEvenness = {
  fixtureId: string;
  teamId: string;
  verdict: Verdict;
};

/** Resultat från evenness_overview() (förbundsrepresentant). */
export type Overview = {
  series: SeriesSummary[];
  teams: TeamSummary[];
  matches: MatchReport[];
};

export type SeriesSummary = {
  competitionId: string;
  name: string;
  reports: number;
  even: number;
  dominated: number;
  evenShare: number | null;
};

export type TeamSummary = {
  teamId: string;
  teamName: string;
  clubName: string;
  reports: number;
  ownBig: number;
  oppBig: number;
  even: number;
  dominatedByUs: number | null;
};

export type MatchReport = {
  fixtureId: string;
  kickoff: string;
  competition: string | null;
  home: string | null;
  away: string | null;
  teamName: string;
  clubName: string;
  isHome: boolean | null;
  verdict: Verdict;
  dominant: 'us' | 'opp' | 'even' | 'unknown';
};

/** Enhetligt resultat från API-lagret: antingen ok med data, eller fail med ett meddelande. */
export type Result<T> = { ok: true; data: T } | { ok: false; error: string };

export function ok<T>(data: T): Result<T> {
  return { ok: true, data };
}

export function fail<T = never>(error: string): Result<T> {
  return { ok: false, error };
}
