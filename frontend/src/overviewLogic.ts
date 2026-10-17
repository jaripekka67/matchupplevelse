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

// ---------------------------------------------------------------------------
// Per-lag-sammanställning och serie-gruppering för förbundsvyn (riktig DB-data).
// En MatchReport är EN lag-rapport (ett lag som rapporterat sin match) med fältet `dominant`
// (us/opp/even/unknown) redan lag-översatt av evenness_overview. Per-lag-raderna räknas direkt
// därifrån, utan att para ihop hemma/borta.
// ---------------------------------------------------------------------------

/** En rad i per-lag-tabellen för en serie. */
export type FederationStanding = {
  teamId: string;
  teamName: string;
  clubName: string;
  reports: number;
  wonBig: number;
  even: number;
  lostBig: number;
};

/**
 * Per-lag-sammanställning från lag-rapporter: hur många matcher varje lag upplevt som egen
 * storseger (dominant 'us'), jämn ('even') eller storförlust ('opp'). 'unknown' (hemma/borta
 * okänt) räknas som rapport men varken vinst/jämn/förlust. Sorteras på flest storsegrar, namn.
 */
export function federationStandings(reports: MatchReport[]): FederationStanding[] {
  const byTeam = new Map<string, FederationStanding>();
  for (const r of reports) {
    let row = byTeam.get(r.teamId);
    if (!row) {
      row = {
        teamId: r.teamId,
        teamName: r.teamName,
        clubName: r.clubName,
        reports: 0,
        wonBig: 0,
        even: 0,
        lostBig: 0,
      };
      byTeam.set(r.teamId, row);
    }
    row.reports += 1;
    if (r.dominant === 'us') row.wonBig += 1;
    else if (r.dominant === 'even') row.even += 1;
    else if (r.dominant === 'opp') row.lostBig += 1;
  }
  return [...byTeam.values()].sort((a, b) =>
    b.wonBig !== a.wonBig ? b.wonBig - a.wonBig : a.teamName.localeCompare(b.teamName, 'sv'),
  );
}

/** Ålderskull/kön ur ett serienamn, t.ex. "F10 C Mellersta/Västra" -> "F10". "Övrigt" om okänt. */
export function ageGroupOf(name: string): string {
  const m = /^\s*([FPfp])\s*(\d{1,2})\b/.exec(name);
  return m ? `${m[1].toUpperCase()}${m[2]}` : 'Övrigt';
}

/** Nivå-sorteringsnyckel: bokstaven efter ålderskoden (B, C, ...). Saknas den sorteras den sist. */
export function levelKey(name: string): string {
  const m = /^\s*[FPfp]\s*\d{1,2}\s+([A-Za-zÅÄÖåäö0-9]+)/.exec(name);
  return m ? m[1].toUpperCase() : '\uffff';
}

/** En grupp av serier för gruppflikarna (seriesIndices pekar in i den inskickade listan). */
export type SeriesGroup = {
  label: string;
  seriesIndices: number[];
};

/**
 * Grupperar serier efter ålderskull (härledd ur namnet). Grupperna sorteras stigande med "Övrigt"
 * sist; serierna inom en grupp sorteras på nivå (B före C), sedan namn.
 */
export function groupSeries(series: { name: string }[]): SeriesGroup[] {
  const byLabel = new Map<string, number[]>();
  series.forEach((s, i) => {
    const label = ageGroupOf(s.name);
    const list = byLabel.get(label) ?? [];
    list.push(i);
    byLabel.set(label, list);
  });

  const groups: SeriesGroup[] = [...byLabel.entries()].map(([label, idxs]) => ({
    label,
    seriesIndices: idxs.sort((a, b) => {
      const la = levelKey(series[a].name);
      const lb = levelKey(series[b].name);
      return la !== lb
        ? la.localeCompare(lb, 'sv')
        : series[a].name.localeCompare(series[b].name, 'sv');
    }),
  }));

  groups.sort((a, b) => {
    if (a.label === 'Övrigt') return 1;
    if (b.label === 'Övrigt') return -1;
    return a.label.localeCompare(b.label, 'sv', { numeric: true });
  });
  return groups;
}
