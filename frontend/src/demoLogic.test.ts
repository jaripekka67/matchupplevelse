import { describe, it, expect } from 'vitest';
import {
  parseDateTimeCell,
  parseFogisTable,
  parseSwedishDate,
  parseOffWeb,
  parseDemoInput,
  isDisagreement,
  summarize,
  absolute,
  ownOutcome,
  teamStandings,
  ageGroupOf,
  levelKey,
  groupSeries,
  serializeDemoState,
  deserializeDemoState,
  type DemoMatch,
  type DemoState,
  type DemoVerdicts,
  type MatchWithVerdicts,
} from './demoLogic.ts';

function dm(home: string, away: string, over: Partial<DemoMatch> = {}): DemoMatch {
  return { matchNo: '1', competition: 'S', round: null, home, away, kickoff: null, ...over };
}

const HEADER =
  'Tävling\tMatchNr\tOmg\tHemmalag\tBortalag\tDatum / tid\tResultat\tAnläggning\tAnl.nr.\tPlannr.\tKarta\tDomare\tVarningar';

describe('parseDateTimeCell', () => {
  it('datum + tid', () => {
    expect(parseDateTimeCell('2026-05-03 10:00')).toBe('2026-05-03T10:00');
  });
  it('bara datum när tid ej fastställd', () => {
    expect(parseDateTimeCell('2026-05-03 (Tid ej fastställd)')).toBe('2026-05-03');
  });
  it('tom cell -> null', () => {
    expect(parseDateTimeCell('')).toBeNull();
    expect(parseDateTimeCell('   ')).toBeNull();
  });
});

describe('parseFogisTable', () => {
  it('parsar rader med rubrik, tål tomma inledande rader', () => {
    const text = [
      '',
      HEADER,
      'F10 C Mellersta/Västra\t232802005\t1\tVadstena GIF 1\tHemgårdarnas BK\t2026-05-03 10:00\t\tKungsvalla IP\t23117\t1\t\t\t',
      'F10 C Mellersta/Västra\t232802003\t1\tKisa BK F2016\tSmedby AIS F2016 Vit\t2026-05-03 (Tid ej fastställd)\t\tKisa IP C-plan\t23024\t3\t\t\t',
    ].join('\n');
    const games = parseFogisTable(text);
    expect(games.length).toBe(2);
    expect(games[0]).toEqual({
      matchNo: '232802005',
      competition: 'F10 C Mellersta/Västra',
      round: '1',
      home: 'Vadstena GIF 1',
      away: 'Hemgårdarnas BK',
      kickoff: '2026-05-03T10:00',
    });
    expect(games[1].kickoff).toBe('2026-05-03'); // tid ej fastställd -> bara datum
  });

  it('hoppar rader utan hemma/borta', () => {
    const text = [HEADER, '\t\t\t\t\t\t\t\t\t\t\t\t'].join('\n');
    expect(parseFogisTable(text)).toEqual([]);
  });

  it('tom text -> tomt', () => {
    expect(parseFogisTable('')).toEqual([]);
    expect(parseFogisTable('bara lite skräp utan rubrik')).toEqual([]);
  });

  it('WO-rad parsas ändå (resultatkolumnen ignoreras)', () => {
    const text = [
      HEADER,
      'F10 C Mellersta/Västra\t232802055\t11\tSmedby AIS F2016 Vit\tKisa BK F2016\t2026-08-30 13:00\t\tPreZero Arena D\t23151\t4\t\t\tWO',
    ].join('\n');
    const games = parseFogisTable(text);
    expect(games.length).toBe(1);
    expect(games[0].home).toBe('Smedby AIS F2016 Vit');
  });
});

describe('parseSwedishDate', () => {
  it('fullt månadsnamn', () => {
    expect(parseSwedishDate('2 maj 2026')).toBe('2026-05-02');
    expect(parseSwedishDate('6 juni 2026')).toBe('2026-06-06');
  });
  it('förkortat månadsnamn med punkt', () => {
    expect(parseSwedishDate('8 aug. 2026')).toBe('2026-08-08');
    expect(parseSwedishDate('5 sep. 2026')).toBe('2026-09-05');
  });
  it('skräp -> null', () => {
    expect(parseSwedishDate('ingen månad')).toBeNull();
  });
});

describe('parseOffWeb', () => {
  const text = [
    'Omgång 1',
    'BK Zeros F16 Vit emblem BK Zeros F16 Vit',
    'Rimforsa IF F15/16 emblem Rimforsa IF F15/16',
    '11:30, 2 maj 2026',
    'Z-parken',
    'Kisa BK F2016 emblem Kisa BK F2016',
    'Smedby AIS F2016 Vit emblem Smedby AIS F2016 Vit',
    'Tid ej fastställd',
    '3 maj 2026',
    'Kisa IP C-plan',
    'Omgång 2',
    'Smedby AIS F2016 Vit emblem Smedby AIS F2016 Vit',
    'BK Zeros F16 Vit emblem BK Zeros F16 Vit',
    'Tid ej fastställd',
    '10 maj 2026',
  ].join('\n');

  it('läser lag före "emblem", tid och omgång', () => {
    const games = parseOffWeb(text, 'F10 C Mellersta/Västra');
    expect(games.length).toBe(3);
    expect(games[0]).toEqual({
      matchNo: '1',
      competition: 'F10 C Mellersta/Västra',
      round: '1',
      home: 'BK Zeros F16 Vit',
      away: 'Rimforsa IF F15/16',
      kickoff: '2026-05-02T11:30',
    });
  });

  it('hanterar "Tid ej fastställd" (bara datum) med anläggning', () => {
    const games = parseOffWeb(text, 'F10');
    expect(games[1].home).toBe('Kisa BK F2016');
    expect(games[1].away).toBe('Smedby AIS F2016 Vit');
    expect(games[1].kickoff).toBe('2026-05-03');
    expect(games[1].round).toBe('1');
  });

  it('hanterar "Tid ej fastställd" utan anläggning (sista matchen)', () => {
    const games = parseOffWeb(text, 'F10');
    expect(games[2].round).toBe('2');
    expect(games[2].kickoff).toBe('2026-05-10');
    expect(games[2].home).toBe('Smedby AIS F2016 Vit');
  });
});

describe('parseDemoInput (autodetektering)', () => {
  it('väljer TSV när rubrikrad med Hemmalag/Bortalag finns', () => {
    const text = [
      HEADER,
      'F10 C Mellersta/Västra\t232802005\t1\tVadstena GIF 1\tHemgårdarnas BK\t2026-05-03 10:00\t\tKungsvalla IP\t23117\t1\t\t\t',
    ].join('\n');
    const games = parseDemoInput(text, '');
    expect(games.length).toBe(1);
    expect(games[0].home).toBe('Vadstena GIF 1');
  });
  it('väljer ÖFF-formatet annars', () => {
    const text = [
      'Omgång 1',
      'BK Zeros F16 Vit emblem BK Zeros F16 Vit',
      'Rimforsa IF F15/16 emblem Rimforsa IF F15/16',
      '11:30, 2 maj 2026',
      'Z-parken',
    ].join('\n');
    const games = parseDemoInput(text, 'F10 C Mellersta/Västra');
    expect(games.length).toBe(1);
    expect(games[0].competition).toBe('F10 C Mellersta/Västra');
    expect(games[0].home).toBe('BK Zeros F16 Vit');
  });
  it('serienamn skrivs över på TSV när angivet', () => {
    const text = [
      HEADER,
      'Gammalt namn\t1\t1\tA\tB\t2026-05-03 10:00\t\tPlan\t1\t1\t\t\t',
    ].join('\n');
    const games = parseDemoInput(text, 'Nytt serienamn');
    expect(games[0].competition).toBe('Nytt serienamn');
  });
});

describe('absolute', () => {
  it('mappar verdict till absolut utfall', () => {
    expect(absolute(1)).toBe('home');
    expect(absolute(2)).toBe('even');
    expect(absolute(3)).toBe('away');
  });
});

describe('isDisagreement', () => {
  it('oense när lagen inte är överens om utfallet', () => {
    expect(isDisagreement({ home: 1, away: 2 })).toBe(true);
    expect(isDisagreement({ home: 1, away: 3 })).toBe(true);
  });
  it('överens -> inte oense', () => {
    expect(isDisagreement({ home: 1, away: 1 })).toBe(false);
    expect(isDisagreement({ home: 2, away: 2 })).toBe(false);
  });
  it('ofullständig (saknar en rapport) räknas inte som oense', () => {
    expect(isDisagreement({ home: 1, away: null })).toBe(false);
    expect(isDisagreement({ home: null, away: null })).toBe(false);
  });
});

describe('ownOutcome', () => {
  it('hemmalagets perspektiv', () => {
    expect(ownOutcome('home', { home: 1, away: null })).toBe('won'); // hemma vann stort = vi vann
    expect(ownOutcome('home', { home: 3, away: null })).toBe('lost'); // borta vann stort = vi förlorade
    expect(ownOutcome('home', { home: 2, away: null })).toBe('even');
  });
  it('bortalagets perspektiv (spegelvänt)', () => {
    expect(ownOutcome('away', { home: null, away: 3 })).toBe('won'); // borta vann stort = vi vann
    expect(ownOutcome('away', { home: null, away: 1 })).toBe('lost');
    expect(ownOutcome('away', { home: null, away: 2 })).toBe('even');
  });
  it('null när laget inte rapporterat', () => {
    expect(ownOutcome('home', { home: null, away: 1 })).toBeNull();
  });
});

describe('teamStandings', () => {
  it('räknar varje lags egna upplevda utfall och sorterar på flest storsegrar', () => {
    const items: MatchWithVerdicts[] = [
      // Alfa (hemma) tycker de vann stort; Beta (borta) tycker de förlorade stort -> överens
      { match: dm('Alfa', 'Beta'), verdicts: { home: 1, away: 1 } },
      // Alfa (borta) tycker de vann stort (away=3); Gamma (hemma) tycker de förlorade (home=3)
      { match: dm('Gamma', 'Alfa'), verdicts: { home: 3, away: 3 } },
      // Beta (hemma) jämnt; Gamma (borta) jämnt
      { match: dm('Beta', 'Gamma'), verdicts: { home: 2, away: 2 } },
    ];
    const rows = teamStandings(items);
    const alfa = rows.find((r) => r.team === 'Alfa')!;
    const beta = rows.find((r) => r.team === 'Beta')!;
    const gamma = rows.find((r) => r.team === 'Gamma')!;
    expect(alfa).toEqual({ team: 'Alfa', reports: 2, wonBig: 2, even: 0, lostBig: 0 });
    expect(beta).toEqual({ team: 'Beta', reports: 2, wonBig: 0, even: 1, lostBig: 1 });
    expect(gamma).toEqual({ team: 'Gamma', reports: 2, wonBig: 0, even: 1, lostBig: 1 });
    expect(rows[0].team).toBe('Alfa'); // flest storsegrar först
  });

  it('räknar bara matcher där laget självt rapporterat', () => {
    const items: MatchWithVerdicts[] = [
      { match: dm('Alfa', 'Beta'), verdicts: { home: 1, away: null } },
    ];
    const rows = teamStandings(items);
    expect(rows.find((r) => r.team === 'Alfa')!.reports).toBe(1);
    expect(rows.find((r) => r.team === 'Beta')!.reports).toBe(0);
  });
});

describe('ageGroupOf', () => {
  it('härleder F10/P11 ur namnet', () => {
    expect(ageGroupOf('F10 C Mellersta/Västra')).toBe('F10');
    expect(ageGroupOf('P11 A Norra')).toBe('P11');
    expect(ageGroupOf('f10 b söder')).toBe('F10');
  });
  it('Övrigt när ingen kod', () => {
    expect(ageGroupOf('Träningsmatcher Dam')).toBe('Övrigt');
    expect(ageGroupOf('')).toBe('Övrigt');
  });
});

describe('levelKey', () => {
  it('plockar nivåbokstaven efter koden', () => {
    expect(levelKey('F10 B Något')).toBe('B');
    expect(levelKey('F10 C Något')).toBe('C');
  });
  it('saknad nivå sorteras sist', () => {
    expect(levelKey('F10').localeCompare(levelKey('F10 B'), 'sv')).toBeGreaterThan(0);
  });
});

describe('groupSeries', () => {
  it('grupperar och sorterar B före C, grupper i åldersordning, Övrigt sist', () => {
    const series = [
      { name: 'F10 C Mellersta/Västra' },
      { name: 'F10 B Östra' },
      { name: 'P11 A Norra' },
      { name: 'Träningsmatcher Dam' },
      { name: 'F11 C Västra' },
    ];
    const groups = groupSeries(series);
    const labels = groups.map((g) => g.label);
    expect(labels).toEqual(['F10', 'F11', 'P11', 'Övrigt']);
    // F10-gruppen: B (index 1) före C (index 0)
    const f10 = groups.find((g) => g.label === 'F10')!;
    expect(f10.seriesIndices).toEqual([1, 0]);
  });
});

describe('serialize/deserialize demo-state', () => {
  const state: DemoState = {
    version: 1,
    series: [
      {
        name: 'F10 C',
        matches: [dm('Alfa', 'Beta', { matchNo: '7', kickoff: '2026-05-02T11:30' })],
        verdicts: [{ home: 1, away: 3 }],
      },
    ],
  };

  it('round-trip bevarar datat', () => {
    const back = deserializeDemoState(serializeDemoState(state));
    expect(back).toEqual(state);
  });

  it('trasig JSON -> null', () => {
    expect(deserializeDemoState('{inte json')).toBeNull();
    expect(deserializeDemoState('42')).toBeNull();
    expect(deserializeDemoState('{"series": "nope"}')).toBeNull();
  });

  it('fyller på saknade utfall med null så de matchar matcherna', () => {
    const json = JSON.stringify({
      series: [{ name: 'S', matches: [dm('A', 'B'), dm('C', 'D')], verdicts: [{ home: 2 }] }],
    });
    const back = deserializeDemoState(json)!;
    expect(back.series[0].verdicts).toEqual([
      { home: 2, away: null },
      { home: null, away: null },
    ]);
  });

  it('hoppar matcher utan hemma/borta', () => {
    const json = JSON.stringify({
      series: [{ name: 'S', matches: [{ matchNo: '1' }, dm('A', 'B')], verdicts: [] }],
    });
    const back = deserializeDemoState(json)!;
    expect(back.series[0].matches.length).toBe(1);
    expect(back.series[0].matches[0].home).toBe('A');
  });
});

describe('summarize', () => {
  it('räknar rapporter, fullständiga, oense och andel jämna', () => {
    const vs: DemoVerdicts[] = [
      { home: 1, away: 1 }, // fullständig, överens, inga jämna
      { home: 2, away: 3 }, // fullständig, oense, en jämn
      { home: 2, away: null }, // ofullständig, en jämn
    ];
    const s = summarize(vs);
    expect(s.reports).toBe(5);
    expect(s.complete).toBe(2);
    expect(s.disagreements).toBe(1);
    expect(s.even).toBe(2);
    expect(s.evenShare).toBeCloseTo(2 / 5);
  });
  it('inga rapporter -> evenShare null', () => {
    const s = summarize([{ home: null, away: null }]);
    expect(s.reports).toBe(0);
    expect(s.evenShare).toBeNull();
  });
});
