// Ren logik för demo-/testläget. Ingen DOM, ingen Supabase – testbar.
//
// Appen kan bara hämta den egna föreningens matcher från FOGIS. För demo och test vill man
// kunna visa en HEL serie (alla lags matcher) och klicka in påhittade utfall för båda lagen,
// så förbundsvyns oense-markering blir meningsfull. Datat klistras in som den tab-separerade
// tabellen man kopierar från FOGIS webb (inte Edge Function-JSON), och allt lever i minnet.

import type { Verdict } from './types.ts';

/** En match inläst ur den inklistrade FOGIS-tabellen. */
export type DemoMatch = {
  matchNo: string;
  competition: string;
  round: string | null;
  home: string;
  away: string;
  /** 'yyyy-mm-ddThh:mm' när tid finns, annars 'yyyy-mm-dd' när bara datum fanns, annars null. */
  kickoff: string | null;
};

/** Kolumnrubriker vi letar efter (normaliserade: gemener, utan blanksteg/punkter). */
const COLS = {
  competition: ['tavling', 'tävling', 'serie'],
  matchNo: ['matchnr', 'matchnummer', 'matchno'],
  round: ['omg', 'omgang', 'omgång'],
  home: ['hemmalag', 'hemma'],
  away: ['bortalag', 'borta'],
  datetime: ['datum/tid', 'datumtid', 'datum', 'tid'],
};

function norm(s: string): string {
  return s.toLowerCase().replace(/[\s.]/g, '');
}

/** Hittar kolumnindex utifrån rubrikcellerna. Returnerar -1 om kolumnen inte finns. */
function columnIndex(headers: string[], candidates: string[]): number {
  const normed = headers.map(norm);
  for (const c of candidates) {
    const i = normed.indexOf(norm(c));
    if (i !== -1) return i;
  }
  return -1;
}

/**
 * Tolkar en datum/tid-cell till 'yyyy-mm-ddThh:mm' (med tid) eller 'yyyy-mm-dd' (bara datum),
 * eller null. Tål "2026-05-03 10:00" och "2026-05-03 (Tid ej fastställd)" samt tom cell.
 */
export function parseDateTimeCell(cell: string): string | null {
  const s = cell.trim();
  const dm = /(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!dm) return null;
  const day = `${dm[1]}-${dm[2]}-${dm[3]}`;
  const tm = /(\d{2}):(\d{2})/.exec(s);
  return tm ? `${day}T${tm[1]}:${tm[2]}` : day;
}

/**
 * Parsar den inklistrade FOGIS-tabellen (tab-separerad, med rubrikrad) till matcher.
 * Robust mot extra kolumner och tomma celler. Rader utan hemma-/bortalag hoppas.
 */
export function parseFogisTable(text: string): DemoMatch[] {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+$/, ''));
  // Hitta rubrikraden: första raden som innehåller både ett hemmalags- och ett bortalagsord.
  let headerIdx = -1;
  let headers: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '') continue;
    const cells = lines[i].split('\t');
    if (columnIndex(cells, COLS.home) !== -1 && columnIndex(cells, COLS.away) !== -1) {
      headerIdx = i;
      headers = cells;
      break;
    }
  }
  if (headerIdx === -1) return [];

  const iComp = columnIndex(headers, COLS.competition);
  const iNo = columnIndex(headers, COLS.matchNo);
  const iRound = columnIndex(headers, COLS.round);
  const iHome = columnIndex(headers, COLS.home);
  const iAway = columnIndex(headers, COLS.away);
  const iDate = columnIndex(headers, COLS.datetime);

  const out: DemoMatch[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    if (lines[i].trim() === '') continue;
    const c = lines[i].split('\t');
    const home = (c[iHome] ?? '').trim();
    const away = (c[iAway] ?? '').trim();
    if (!home || !away) continue;
    out.push({
      matchNo: (c[iNo] ?? '').trim(),
      competition: (iComp !== -1 ? c[iComp] ?? '' : '').trim(),
      round: iRound !== -1 && (c[iRound] ?? '').trim() !== '' ? c[iRound].trim() : null,
      home,
      away,
      kickoff: iDate !== -1 ? parseDateTimeCell(c[iDate] ?? '') : null,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// ÖFF-webbformatet (text kopierad från seriesidan). Block per match:
//   <Hemmalag> emblem <Hemmalag>
//   <Bortalag> emblem <Bortalag>
//   "HH:MM, D mån ÅÅÅÅ"  ELLER  "Tid ej fastställd" + egen rad "D mån ÅÅÅÅ"
//   <Anläggning>   (kan saknas)
// "Omgång N"-rader markerar omgång. Serienamnet står INTE i texten (anges separat).
// ---------------------------------------------------------------------------

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', maj: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', okt: '10', nov: '11', dec: '12',
};

/** Tolkar svenskt datum "2 maj 2026" / "8 aug. 2026" till 'yyyy-mm-dd', annars null. */
export function parseSwedishDate(s: string): string | null {
  const m = /(\d{1,2})\s+([A-Za-zåäöÅÄÖ]+)\.?\s+(\d{4})/.exec(s.trim());
  if (!m) return null;
  const day = m[1].padStart(2, '0');
  const mon = MONTHS[m[2].slice(0, 3).toLowerCase()];
  if (!mon) return null;
  return `${m[3]}-${mon}-${day}`;
}

/** Lagnamnet före " emblem " (ÖFF dubblerar namnet med "emblem" emellan). */
function nameBeforeEmblem(line: string): string | null {
  const i = line.indexOf(' emblem ');
  const name = (i === -1 ? line : line.slice(0, i)).trim();
  return name === '' ? null : name;
}

/** Är raden en lagrad i ÖFF-formatet (innehåller " emblem ")? */
function isTeamLine(line: string): boolean {
  return line.includes(' emblem ');
}

/** Tolkar en tidsrad "HH:MM, D mån ÅÅÅÅ" till 'yyyy-mm-ddThh:mm', annars null. */
function parseOffDateTimeLine(line: string): string | null {
  const tm = /(\d{1,2}):(\d{2})/.exec(line);
  const date = parseSwedishDate(line);
  if (!date) return null;
  return tm ? `${date}T${tm[1].padStart(2, '0')}:${tm[2]}` : date;
}

/** Parsar ÖFF-webbformatet. competition sätts på varje match (anges av användaren). */
export function parseOffWeb(text: string, competition: string): DemoMatch[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '' && l.toLowerCase() !== 'emblem');

  const out: DemoMatch[] = [];
  let round: string | null = null;
  let i = 0;
  let counter = 0;
  while (i < lines.length) {
    const line = lines[i];

    const rm = /^Omg[åa]ng\s+(.+)$/i.exec(line);
    if (rm) {
      round = rm[1].trim();
      i += 1;
      continue;
    }

    // En match börjar med två lagrader i följd.
    if (isTeamLine(line) && i + 1 < lines.length && isTeamLine(lines[i + 1])) {
      const home = nameBeforeEmblem(line);
      const away = nameBeforeEmblem(lines[i + 1]);
      i += 2;

      let kickoff: string | null = null;
      // Tidsinfo: antingen "HH:MM, datum", eller "Tid ej fastställd" + egen datumrad.
      if (i < lines.length) {
        if (/tid ej fastställd/i.test(lines[i])) {
          i += 1;
          if (i < lines.length) {
            const d = parseSwedishDate(lines[i]);
            if (d) {
              kickoff = d;
              i += 1;
            }
          }
        } else {
          const dt = parseOffDateTimeLine(lines[i]);
          if (dt) {
            kickoff = dt;
            i += 1;
          }
        }
      }

      // Valfri anläggningsrad: en rad som varken är lagrad, omgång eller tid.
      if (
        i < lines.length &&
        !isTeamLine(lines[i]) &&
        !/^Omg[åa]ng\s+/i.test(lines[i]) &&
        !/tid ej fastställd/i.test(lines[i]) &&
        parseOffDateTimeLine(lines[i]) === null &&
        parseSwedishDate(lines[i]) === null
      ) {
        i += 1; // hoppa anläggningen (vi behöver den inte i demon)
      }

      if (home && away) {
        counter += 1;
        out.push({
          matchNo: String(counter),
          competition,
          round,
          home,
          away,
          kickoff,
        });
      }
      continue;
    }

    i += 1; // okänd rad, hoppa
  }
  return out;
}

/**
 * Läser inklistrad text i endera formatet och ger matcher. Autodetekterar:
 * en tab-separerad rubrikrad (Hemmalag/Bortalag-kolumner) -> FOGIS-TSV, annars ÖFF-webbformat.
 * competition används för ÖFF-formatet (TSV har tävling i egen kolumn).
 */
export function parseDemoInput(text: string, competition: string): DemoMatch[] {
  const looksTsv = text
    .split(/\r?\n/)
    .some((l) => l.includes('\t') && columnIndex(l.split('\t'), COLS.home) !== -1);
  if (looksTsv) {
    const games = parseFogisTable(text);
    // Om användaren angav serienamn, låt det gälla (TSV:ns tävling kan vara tom).
    return competition.trim()
      ? games.map((g) => ({ ...g, competition: competition.trim() }))
      : games;
  }
  return parseOffWeb(text, competition.trim());
}

/** En serie i demon: namn + matcher (med utfall satt separat i vyn). */
export type DemoSeries = {
  name: string;
  matches: DemoMatch[];
};

/** Utfall per lag för en match i demon (null = inte satt). */
export type DemoVerdicts = {
  home: Verdict | null;
  away: Verdict | null;
};

/** Matchens absoluta utfall enligt ett verdict (1=hemma, 2=jämn, 3=borta). */
export function absolute(v: Verdict): 'home' | 'even' | 'away' {
  return v === 1 ? 'home' : v === 3 ? 'away' : 'even';
}

/**
 * Är lagen oense om matchens utfall? Oense = båda har rapporterat men är inte överens om
 * det absoluta utfallet (hemma/jämn/borta). Saknas en rapport är de inte oense (men inte heller
 * överens – det räknas som ofullständigt, inte oense).
 */
export function isDisagreement(v: DemoVerdicts): boolean {
  if (v.home === null || v.away === null) return false;
  return absolute(v.home) !== absolute(v.away);
}

/** Sammanfattning över alla matchers rapporter i demon. */
export type DemoSummary = {
  /** Antal lag-rapporter inlagda (0–2 per match). */
  reports: number;
  /** Antal matcher där båda lagen rapporterat. */
  complete: number;
  /** Antal matcher med båda rapporter som är oense. */
  disagreements: number;
  /** Antal lag-rapporter som säger "jämn". */
  even: number;
  /** Andel jämna av alla rapporter (0–1), eller null när inga rapporter finns. */
  evenShare: number | null;
};

/** Räknar ihop en sammanfattning från en lista av matchers utfall. */
export function summarize(verdicts: DemoVerdicts[]): DemoSummary {
  let reports = 0;
  let complete = 0;
  let disagreements = 0;
  let even = 0;
  for (const v of verdicts) {
    for (const side of [v.home, v.away]) {
      if (side !== null) {
        reports += 1;
        if (side === 2) even += 1;
      }
    }
    if (v.home !== null && v.away !== null) {
      complete += 1;
      if (isDisagreement(v)) disagreements += 1;
    }
  }
  return {
    reports,
    complete,
    disagreements,
    even,
    evenShare: reports > 0 ? even / reports : null,
  };
}

// ---------------------------------------------------------------------------
// Per-lag-sammanställning för en serie (hur varje lag upplevt sina matcher).
// Utfall är hemma/borta-relativt (1=hemma vann stort, 2=jämnt, 3=borta vann stort).
// Ur ett lags EGET perspektiv: hemmalaget ser 1=vi vann stort, 3=vi förlorade stort;
// bortalaget tvärtom. 2 är jämnt för båda.
// ---------------------------------------------------------------------------

/** En match ihopparad med lagens utfall, för sammanställningen. */
export type MatchWithVerdicts = {
  match: DemoMatch;
  verdicts: DemoVerdicts;
};

/** En rad i per-lag-tabellen. */
export type TeamStanding = {
  team: string;
  /** Antal matcher där laget självt lämnat en rapport. */
  reports: number;
  /** Laget upplevde att de vann stort. */
  wonBig: number;
  /** Laget upplevde jämn match. */
  even: number;
  /** Laget upplevde att de förlorade stort. */
  lostBig: number;
};

/** Lagets eget utfall i en match: 'won' | 'even' | 'lost', eller null om laget inte rapporterat. */
export function ownOutcome(
  side: 'home' | 'away',
  v: DemoVerdicts,
): 'won' | 'even' | 'lost' | null {
  const verdict = side === 'home' ? v.home : v.away;
  if (verdict === null) return null;
  if (verdict === 2) return 'even';
  // Hemma: 1 = hemma vann stort = vi vann. Borta: 3 = borta vann stort = vi vann.
  const weWon = side === 'home' ? verdict === 1 : verdict === 3;
  return weWon ? 'won' : 'lost';
}

/**
 * Bygger per-lag-sammanställningen för en serie: en rad per lag som förekommer, med hur många
 * matcher laget självt upplevt som storseger / jämn / storförlust. Sorteras på flest storsegrar,
 * sedan lagnamn.
 */
export function teamStandings(items: MatchWithVerdicts[]): TeamStanding[] {
  const byTeam = new Map<string, TeamStanding>();
  const ensure = (team: string): TeamStanding => {
    let row = byTeam.get(team);
    if (!row) {
      row = { team, reports: 0, wonBig: 0, even: 0, lostBig: 0 };
      byTeam.set(team, row);
    }
    return row;
  };

  for (const { match, verdicts } of items) {
    for (const side of ['home', 'away'] as const) {
      const team = side === 'home' ? match.home : match.away;
      if (!team) continue;
      const row = ensure(team);
      const outcome = ownOutcome(side, verdicts);
      if (outcome === null) continue;
      row.reports += 1;
      if (outcome === 'won') row.wonBig += 1;
      else if (outcome === 'even') row.even += 1;
      else row.lostBig += 1;
    }
  }

  return [...byTeam.values()].sort((a, b) =>
    b.wonBig !== a.wonBig ? b.wonBig - a.wonBig : a.team.localeCompare(b.team, 'sv'),
  );
}

// ---------------------------------------------------------------------------
// Serialiserbart demo-state (för localStorage och JSON-export/import).
// Utfallen lagras som en parallell lista per serie, i samma ordning som matcherna,
// så datat är oberoende av hur vyn råkar nyckla matcherna.
// ---------------------------------------------------------------------------

/** En serie med matcher och motsvarande utfall (per match, i matchernas ordning). */
export type DemoStateSeries = {
  name: string;
  matches: DemoMatch[];
  verdicts: DemoVerdicts[];
};

/** Hela demons sparbara tillstånd. version för framtida migrering. */
export type DemoState = {
  version: 1;
  series: DemoStateSeries[];
};

/** Serialiserar demo-state till en JSON-sträng. */
export function serializeDemoState(state: DemoState): string {
  return JSON.stringify(state, null, 2);
}

function isVerdictValue(x: unknown): x is Verdict | null {
  return x === null || x === 1 || x === 2 || x === 3;
}

/**
 * Läser tillbaka demo-state ur en JSON-sträng, tolerant mot trasig/ofullständig data.
 * Returnerar null om det inte går att tolka som ett giltigt state. Fyller på saknade utfall
 * med null så verdicts alltid matchar matches i längd.
 */
export function deserializeDemoState(text: string): DemoState | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const o = parsed as Record<string, unknown>;
  if (!Array.isArray(o.series)) return null;

  const series: DemoStateSeries[] = [];
  for (const s of o.series) {
    if (typeof s !== 'object' || s === null) continue;
    const so = s as Record<string, unknown>;
    const name = typeof so.name === 'string' ? so.name : '';
    if (!Array.isArray(so.matches)) continue;

    const matches: DemoMatch[] = [];
    for (const m of so.matches) {
      if (typeof m !== 'object' || m === null) continue;
      const mo = m as Record<string, unknown>;
      if (typeof mo.home !== 'string' || typeof mo.away !== 'string') continue;
      matches.push({
        matchNo: typeof mo.matchNo === 'string' ? mo.matchNo : '',
        competition: typeof mo.competition === 'string' ? mo.competition : name,
        round: typeof mo.round === 'string' ? mo.round : null,
        home: mo.home,
        away: mo.away,
        kickoff: typeof mo.kickoff === 'string' ? mo.kickoff : null,
      });
    }

    const rawVerdicts = Array.isArray(so.verdicts) ? so.verdicts : [];
    const verdicts: DemoVerdicts[] = matches.map((_, i) => {
      const rv = rawVerdicts[i];
      if (typeof rv === 'object' && rv !== null) {
        const vo = rv as Record<string, unknown>;
        return {
          home: isVerdictValue(vo.home) ? vo.home : null,
          away: isVerdictValue(vo.away) ? vo.away : null,
        };
      }
      return { home: null, away: null };
    });

    series.push({ name, matches, verdicts });
  }

  return { version: 1, series };
}

// ---------------------------------------------------------------------------
// Gruppering av serier per ålderskull/kön (härledd ur serienamnet) för flikarna i demovyn.
// Namnet börjar typiskt med en kod som "F10" eller "P11". Serier utan kod hamnar i "Övrigt".
// Inom en grupp sorteras serierna på nivåbokstav (B före C ...), sedan på hela namnet.
// ---------------------------------------------------------------------------

/** Ålderskull/kön ur ett serienamn, t.ex. "F10 C Mellersta/Västra" -> "F10". "Övrigt" om okänt. */
export function ageGroupOf(name: string): string {
  const m = /^\s*([FPfp])\s*(\d{1,2})\b/.exec(name);
  if (!m) return 'Övrigt';
  return `${m[1].toUpperCase()}${m[2]}`;
}

/**
 * Nivå-sorteringsnyckel: bokstaven direkt efter ålderskoden (B, C, ...). Saknas den ges en nyckel
 * som sorteras sist, så namngivna nivåer kommer före onamngivna. Jämförs sedan på hela namnet.
 */
export function levelKey(name: string): string {
  const m = /^\s*[FPfp]\s*\d{1,2}\s+([A-Za-zÅÄÖåäö0-9]+)/.exec(name);
  return m ? m[1].toUpperCase() : '\uffff';
}

/** En grupp av serier (för gruppflikarna). seriesIndices pekar in i den ursprungliga listan. */
export type SeriesGroup = {
  label: string;
  /** Index i den inskickade series-listan, sorterade (B före C, sedan namn). */
  seriesIndices: number[];
};

/**
 * Grupperar serier efter ålderskull. Grupperna sorteras så att F-grupper och P-grupper kommer i
 * stigande ålder, och "Övrigt" sist. Inom varje grupp sorteras serierna på nivå (B före C), namn.
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
