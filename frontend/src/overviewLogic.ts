// Ren presentationslogik för förbundsrepresentantens vy. Ingen DOM/Supabase – testbar.
//
// Grupperar rapporter per FOGIS-match så att båda lagens (hemma- och bortalagets) upplevelse
// av samma match visas tillsammans, och flaggar oenighet. Oenighet = lagen är inte överens om
// vem som dominerade (sett i absolut mening): t.ex. ett lag säger "hemma vann stort" och det
// andra säger "jämn" eller "borta vann stort".

import type { MatchReport, SeriesSummary, TeamSummary } from './types.ts';

/** En FOGIS-match med alla rapporter om den (ett eller två lag). */
export type MatchGroup = {
  key: string; // fogisGameId om det finns, annars en syntetisk nyckel
  kickoff: string;
  competition: string | null;
  home: string | null;
  away: string | null;
  reports: MatchReport[];
  /** True när rapporterna inte är överens om matchens utfall (hemma/jämn/borta). */
  disagreement: boolean;
};

/** Gruppnyckel: FOGIS-id om det finns, annars dag + hemma + borta (normaliserat). */
function groupKey(r: MatchReport): string {
  if (r.fogisGameId) return `fg:${r.fogisGameId}`;
  const day = r.kickoff.slice(0, 10);
  const norm = (s: string | null) => (s ?? '').toLowerCase().replace(/\s/g, '');
  return `d:${day}:${norm(r.home)}:${norm(r.away)}`;
}

/**
 * Översätter ett lags verdict till matchens absoluta utfall (vem vann enligt det laget),
 * oberoende av vilket lag som rapporterade:
 *   'home' = hemmalaget vann stort, 'away' = bortalaget vann stort, 'even' = jämn.
 * verdict är redan hemma/borta-relativt (1=hemma, 2=jämn, 3=borta), så det är direkt.
 */
export function absoluteOutcome(r: MatchReport): 'home' | 'even' | 'away' {
  if (r.verdict === 1) return 'home';
  if (r.verdict === 3) return 'away';
  return 'even';
}

/** Grupperar rapporter till matcher och markerar oenighet. Senaste matchen först. */
export function groupMatches(matches: MatchReport[]): MatchGroup[] {
  const byKey = new Map<string, MatchReport[]>();
  for (const r of matches) {
    const k = groupKey(r);
    const list = byKey.get(k) ?? [];
    list.push(r);
    byKey.set(k, list);
  }

  const groups: MatchGroup[] = [];
  for (const [key, reports] of byKey) {
    const outcomes = new Set(reports.map(absoluteOutcome));
    const first = reports[0]!;
    groups.push({
      key,
      kickoff: first.kickoff,
      competition: first.competition,
      home: first.home,
      away: first.away,
      reports,
      disagreement: outcomes.size > 1,
    });
  }

  groups.sort((a, b) => new Date(b.kickoff).getTime() - new Date(a.kickoff).getTime());
  return groups;
}

/** Antal matcher där lagen är oense (av de som har mer än en rapport). */
export function countDisagreements(groups: MatchGroup[]): number {
  return groups.filter((g) => g.disagreement).length;
}

/** Sorterar serier efter flest rapporter (mest aktivitet först). */
export function sortSeries(series: SeriesSummary[]): SeriesSummary[] {
  return [...series].sort((a, b) => b.reports - a.reports);
}

/** Sorterar lag efter förening och lagnamn. */
export function sortTeams(teams: TeamSummary[]): TeamSummary[] {
  return [...teams].sort((a, b) =>
    a.clubName === b.clubName
      ? a.teamName.localeCompare(b.teamName, 'sv')
      : a.clubName.localeCompare(b.clubName, 'sv'),
  );
}

/** Andel jämna matcher i en serie som procenttext, eller '–' om okänt. */
export function evenPercent(s: SeriesSummary): string {
  if (s.evenShare === null) return '–';
  return `${Math.round(s.evenShare * 100)} %`;
}
