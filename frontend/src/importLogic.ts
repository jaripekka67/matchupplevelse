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
export function normalizeFogisGame(
  raw: unknown,
  ourClubName?: string,
  ourClubId?: string | number,
): NormalizedGame | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;

  const fogisGameId = pickStr(o, ['gameId', 'matchId', 'id', 'matchNo', 'matchNr']);
  const kickoff = normalizeKickoff(
    o.timeAsDateTime ?? o.kickoff ?? o.matchDateTime ?? o.dateTime ?? o.startTime ?? o.time ?? o.date,
  );
  const home = pickStr(o, ['homeTeamName', 'homeTeam', 'home', 'hemmalag']);
  const away = pickStr(o, ['awayTeamName', 'awayTeam', 'away', 'bortalag']);
  if (!fogisGameId || !kickoff || !home || !away) return null;

  // is_home: explicit flagga om den finns; annars via klubb-id (säkrast); annars gissa via namn.
  let isHome: boolean | null = null;
  if (typeof o.isHome === 'boolean') isHome = o.isHome;
  else if (typeof o.homeMatch === 'boolean') isHome = o.homeMatch;
  else if (ourClubId !== undefined && ourClubId !== '' && (o.homeClubId !== undefined || o.awayClubId !== undefined)) {
    const mine = String(ourClubId);
    if (String(o.homeClubId) === mine) isHome = true;
    else if (String(o.awayClubId) === mine) isHome = false;
  } else if (ourClubName) {
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
    competition: pickStr(o, ['competitionName', 'competition', 'league', 'serie']),
    competitionId: pickStr(o, ['competitionId', 'competitionID', 'leagueId', 'serieId']),
    place: pickStr(o, ['venueName', 'arena', 'venue', 'place', 'facility', 'plan']),
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

/** Spelformer appen stöder (upp till 7 mot 7). */
export const ALLOWED_FORMATS = ['3v3', '5v5', '7v7'] as const;
export type AllowedFormat = (typeof ALLOWED_FORMATS)[number];

/**
 * Tolkar FOGIS spelform (t.ex. venuePitchTypeName "7 mot 7") till 3v3/5v5/7v7, eller null
 * om formen inte stöds (9 mot 9, 11 mot 11, okänt). Tål "7 mot 7", "7v7", "7-manna".
 */
export function pitchFormat(value: unknown): AllowedFormat | null {
  if (typeof value !== 'string') return null;
  const m = /(\d+)\s*(?:mot|v|vs|-?manna|-?man)\s*\1?/i.exec(value) ?? /\b(\d+)\b/.exec(value);
  const n = m ? Number(m[1]) : NaN;
  if (n === 3) return '3v3';
  if (n === 5) return '5v5';
  if (n === 7) return '7v7';
  return null;
}

/** En serie i FOGIS-svaret, för att låta admin välja vilken import ska gälla. */
export type SeriesOption = {
  competitionId: string;
  name: string;
  /** Antal matcher i serien med en spelform appen stöder (3v3/5v5/7v7). */
  playableCount: number;
};

/**
 * Extraherar serierna ur ett FOGIS-svar. Returnerar bara serier som har minst en match med
 * en spelform appen stöder (så damserier i 9v9/11v11 inte visas). Sorteras på namn.
 */
export function extractSeries(response: unknown): SeriesOption[] {
  const games = extractGames(response);
  const byId = new Map<string, SeriesOption>();
  for (const raw of games) {
    if (typeof raw !== 'object' || raw === null) continue;
    const o = raw as Record<string, unknown>;
    const competitionId = pickStr(o, ['competitionId', 'competitionID', 'leagueId', 'serieId']);
    const name = pickStr(o, ['competitionName', 'competition', 'league', 'serie']) ?? '(okänd serie)';
    if (!competitionId) continue;
    const playable = pitchFormat(o.venuePitchTypeName ?? o.pitchType ?? o.gameFormat) !== null;
    const existing = byId.get(competitionId);
    if (existing) {
      if (playable) existing.playableCount += 1;
    } else {
      byId.set(competitionId, { competitionId, name, playableCount: playable ? 1 : 0 });
    }
  }
  return [...byId.values()]
    .filter((s) => s.playableCount > 0)
    .sort((a, b) => a.name.localeCompare(b.name, 'sv'));
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
  ourClubId?: string | number,
  competitionId?: string,
): ImportPreview {
  const preview: ImportPreview = { inserts: [], updates: [], skipped: [] };
  const games = extractGames(response);
  // FOGIS-svaret har klubb-id på toppnivå; använd det för säker hemma/borta om inget skickats in.
  const clubId =
    ourClubId ??
    (typeof response === 'object' && response !== null
      ? (response as Record<string, unknown>).clubId as string | number | undefined
      : undefined);

  for (const raw of games) {
    // Filtrera på vald serie (om angiven): hoppa matcher från andra serier helt (visas inte).
    if (competitionId && typeof raw === 'object' && raw !== null) {
      const rid = pickStr(raw as Record<string, unknown>, [
        'competitionId',
        'competitionID',
        'leagueId',
        'serieId',
      ]);
      if (rid !== competitionId) continue;
    }

    const g = normalizeFogisGame(raw, ourClubName, clubId);
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
