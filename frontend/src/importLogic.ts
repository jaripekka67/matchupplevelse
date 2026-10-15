// Ren logik för matchimport från FOGIS. Ingen DOM/Supabase – testbar.
//
// OBS: Exakt form på FOGIS-svaret är INTE live-verifierad än. Fältmappningen nedan
// (normalizeFogisGame) är tolerant och letar efter flera möjliga fältnamn. Den MÅSTE
// verifieras mot ett riktigt FOGIS-svar (Task 10/12 live-test) och justeras vid behov.
// Allt annat (dedup, diff mot befintliga, byggande av insert/update-listor) är oberoende
// av exakt fältnamn och fullt testat.

import type { Fixture } from './types.ts';

/** Normaliserat spel från FOGIS, klart att skicka till import_fogis_games. */
export type NormalizedGame = {
  fogisGameId: string;
  kickoff: string; // 'yyyy-mm-ddThh:mm'
  home: string;
  away: string;
  isHome: boolean | null;
  competition: string | null;
  competitionId: string | null;
  place: string | null;
};

/** Plocka första icke-tomma strängen bland flera möjliga nycklar. */
function pickStr(o: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'string' && v.trim() !== '') return v.trim();
    if (typeof v === 'number') return String(v);
  }
  return null;
}

/** Normalisera ett datum/tid-värde till 'yyyy-mm-ddThh:mm'. Tål ISO med Z/offset och 'yyyy-mm-dd hh:mm'. */
export function normalizeKickoff(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const s = value.trim().replace(' ', 'T');
  // Matcha yyyy-mm-ddThh:mm (ev. med sekunder/zon som vi klipper bort).
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(s);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}`;
}

/**
 * Normaliserar ett rått FOGIS-spel till vår form. Returnerar null om obligatoriska fält
 * (id, kickoff, home, away) saknas. ourClubName används för att gissa is_home när FOGIS
 * inte anger det explicit (matchar mot hemmalagets namn).
 */
export function normalizeFogisGame(raw: unknown, ourClubName?: string): NormalizedGame | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;

  const fogisGameId = pickStr(o, ['matchId', 'gameId', 'id', 'matchNo', 'matchNr']);
  const kickoff = normalizeKickoff(
    o.kickoff ?? o.matchDateTime ?? o.dateTime ?? o.startTime ?? o.date,
  );
  const home = pickStr(o, ['homeTeam', 'home', 'homeTeamName', 'hemmalag']);
  const away = pickStr(o, ['awayTeam', 'away', 'awayTeamName', 'bortalag']);
  if (!fogisGameId || !kickoff || !home || !away) return null;

  // is_home: explicit flagga om den finns, annars gissa via klubbnamn.
  let isHome: boolean | null = null;
  if (typeof o.isHome === 'boolean') isHome = o.isHome;
  else if (typeof o.homeMatch === 'boolean') isHome = o.homeMatch;
  else if (ourClubName) {
    const norm = (x: string) => x.toLowerCase().replace(/\s/g, '');
    if (norm(home).includes(norm(ourClubName))) isHome = true;
    else if (norm(away).includes(norm(ourClubName))) isHome = false;
  }

  return {
    fogisGameId,
    kickoff,
    home,
    away,
    isHome,
    competition: pickStr(o, ['competition', 'competitionName', 'league', 'serie']),
    competitionId: pickStr(o, ['competitionId', 'competitionID', 'leagueId', 'serieId']),
    place: pickStr(o, ['arena', 'venue', 'place', 'facility', 'plan']),
  };
}

/** Extraherar listan av spel ur ett FOGIS-svar (kan vara array eller inkapslat i ett fält). */
export function extractGames(response: unknown): unknown[] {
  if (Array.isArray(response)) return response;
  if (typeof response === 'object' && response !== null) {
    const o = response as Record<string, unknown>;
    for (const key of ['games', 'matches', 'items', 'data', 'result']) {
      if (Array.isArray(o[key])) return o[key] as unknown[];
    }
  }
  return [];
}

export type ImportPreview = {
  /** Nya matcher som skapas. */
  inserts: Array<NormalizedGame & { subteamId: string }>;
  /** Befintliga matcher som uppdateras (med fixture-id). */
  updates: Array<NormalizedGame & { id: string }>;
  /** Spel som hoppas (med orsak). */
  skipped: Array<{ game: NormalizedGame | null; reason: string }>;
};

/** Normalisera ett datum till yyyy-mm-dd för dag-jämförelse. */
function dayOf(kickoff: string): string {
  return kickoff.slice(0, 10);
}
function normName(s: string | null): string {
  return (s ?? '').toLowerCase().replace(/\s/g, '');
}

/**
 * Bygger en förhandsgranskning: för varje FOGIS-spel, avgör om det är nytt, en uppdatering
 * av en befintlig match, eller ska hoppas. Dedup matchar på fogis_game_id, annars dag + motståndare.
 * Nya spel kopplas till det angivna subteamId (admin väljer vilket lag importen gäller).
 */
export function buildImportPreview(
  response: unknown,
  existing: Fixture[],
  subteamId: string,
  ourClubName?: string,
): ImportPreview {
  const preview: ImportPreview = { inserts: [], updates: [], skipped: [] };
  const games = extractGames(response);

  for (const raw of games) {
    const g = normalizeFogisGame(raw, ourClubName);
    if (!g) {
      preview.skipped.push({ game: null, reason: 'Kunde inte tolka matchen (saknar id/tid/lag)' });
      continue;
    }

    // Finns matchen redan? Matcha på fogis_game_id först, annars dag + motståndare.
    const byId = existing.find((f) => f.fogisGameId && f.fogisGameId === g.fogisGameId);
    const byDay = existing.find(
      (f) =>
        !f.fogisGameId &&
        dayOf(f.kickoff) === dayOf(g.kickoff) &&
        normName(f.away) === normName(g.away),
    );
    const match = byId ?? byDay;

    if (match) {
      preview.updates.push({ ...g, id: match.id });
    } else {
      preview.inserts.push({ ...g, subteamId });
    }
  }

  return preview;
}
