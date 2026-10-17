import { useEffect, useRef, useState } from 'react';
import type { Verdict } from '../types.ts';
import {
  parseDemoInput,
  isDisagreement,
  summarize,
  teamStandings,
  groupSeries,
  serializeDemoState,
  deserializeDemoState,
  type DemoState,
  type DemoStateSeries,
  type DemoVerdicts,
  type MatchWithVerdicts,
} from '../demoLogic.ts';
import { verdictSymbol } from '../verdictLogic.ts';

// Demo-/testläge: läs in hela serier (klistra in FOGIS-TSV eller ÖFF-webbtext), sätt påhittade
// utfall för BÅDA lagen i varje match, och se en förbundslik vy med per-lag-sammanställning och
// oense-markering. Allt lever i webbläsaren (localStorage) – inget rör databasen eller rollerna.
// Går att exportera/importera som JSON så en färdig demo-uppsättning kan sparas och flyttas.

const STORAGE_KEY = 'matchupplevelse.demo.v1';

function emptyVerdicts(n: number): DemoVerdicts[] {
  return Array.from({ length: n }, () => ({ home: null, away: null }));
}

function loadInitial(): DemoStateSeries[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const state = deserializeDemoState(raw);
    return state ? state.series : [];
  } catch {
    return [];
  }
}

export function DemoPage() {
  const [series, setSeries] = useState<DemoStateSeries[]>(loadInitial);
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Flikar: topp (Data/Serier), vald grupp (F10…), vald serie (index i series).
  const [topTab, setTopTab] = useState<'data' | 'serier'>('serier');
  const [activeGroup, setActiveGroup] = useState<string | null>(null);
  const [activeSeries, setActiveSeries] = useState<number | null>(null);

  // Spara till localStorage vid varje ändring.
  useEffect(() => {
    try {
      const state: DemoState = { version: 1, series };
      localStorage.setItem(STORAGE_KEY, serializeDemoState(state));
    } catch {
      // localStorage kan vara otillgängligt (privat läge m.m.) – demon funkar ändå utan persistens.
    }
  }, [series]);

  function addSeries(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    const trimmedName = name.trim();
    if (!trimmedName) {
      setErr('Ange ett serienamn.');
      return;
    }
    const matches = parseDemoInput(text, trimmedName);
    if (matches.length === 0) {
      setErr('Kunde inte läsa några matcher ur texten. Kontrollera att du klistrat in hela tabellen.');
      return;
    }
    setSeries((prev) => [...prev, { name: trimmedName, matches, verdicts: emptyVerdicts(matches.length) }]);
    setName('');
    setText('');
    setMsg(`Lade till "${trimmedName}" med ${matches.length} matcher.`);
  }

  function setVerdict(seriesIdx: number, matchIdx: number, side: 'home' | 'away', value: Verdict) {
    setSeries((prev) =>
      prev.map((s, si) => {
        if (si !== seriesIdx) return s;
        const verdicts = s.verdicts.map((v, mi) => {
          if (mi !== matchIdx) return v;
          const next = v[side] === value ? null : value; // toggle av vid upprepat klick
          return { ...v, [side]: next };
        });
        return { ...s, verdicts };
      }),
    );
  }

  function removeSeries(idx: number) {
    setSeries((prev) => prev.filter((_, i) => i !== idx));
  }

  function fillRandom() {
    setSeries((prev) =>
      prev.map((s) => ({
        ...s,
        verdicts: s.matches.map(() => ({
          home: ((Math.floor(Math.random() * 3) + 1) as Verdict),
          away: ((Math.floor(Math.random() * 3) + 1) as Verdict),
        })),
      })),
    );
  }

  function clearAll() {
    if (!window.confirm('Rensa all demodata (alla serier och utfall)?')) return;
    setSeries([]);
    setMsg('Demodata rensad.');
  }

  function exportJson() {
    const state: DemoState = { version: 1, series };
    const blob = new Blob([serializeDemoState(state)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'matchupplevelse-demo.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  function importJson(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setErr(null);
    setMsg(null);
    const reader = new FileReader();
    reader.onload = () => {
      const state = deserializeDemoState(String(reader.result ?? ''));
      if (!state) {
        setErr('Kunde inte läsa filen som demodata.');
        return;
      }
      setSeries(state.series);
      setMsg(`Importerade ${state.series.length} serier.`);
    };
    reader.readAsText(file);
    e.target.value = ''; // tillåt att importera samma fil igen
  }

  const totals = summarize(
    series.flatMap((s) => s.matches.map((_, i) => s.verdicts[i] ?? { home: null, away: null })),
  );

  // Grupper (F10, F11…) och vald grupp/serie, med fallback om valet inte längre finns.
  const groups = groupSeries(series);
  const group = groups.find((g) => g.label === activeGroup) ?? groups[0] ?? null;
  const seriesIndices = group?.seriesIndices ?? [];
  const selectedIdx = seriesIndices.includes(activeSeries ?? -1)
    ? (activeSeries as number)
    : seriesIndices[0] ?? null;

  return (
    <div>
      <button className="link-btn" onClick={() => (window.location.hash = '#/')}>
        ← Till appen
      </button>
      <h1>Demo och test</h1>

      <div className="tabs" role="tablist">
        <button
          role="tab"
          aria-selected={topTab === 'serier'}
          className={topTab === 'serier' ? 'tab tab-active' : 'tab'}
          onClick={() => setTopTab('serier')}
        >
          Serier
        </button>
        <button
          role="tab"
          aria-selected={topTab === 'data'}
          className={topTab === 'data' ? 'tab tab-active' : 'tab'}
          onClick={() => setTopTab('data')}
        >
          Data
        </button>
      </div>

      {topTab === 'data' && (
        <DataTab
          name={name}
          text={text}
          err={err}
          msg={msg}
          totals={totals}
          seriesCount={series.length}
          fileInput={fileInput}
          onName={setName}
          onText={setText}
          onAdd={addSeries}
          onFillRandom={fillRandom}
          onExport={exportJson}
          onImportClick={() => fileInput.current?.click()}
          onImport={importJson}
          onClear={clearAll}
        />
      )}

      {topTab === 'serier' && (
        <>
          {series.length === 0 && (
            <section className="card">
              <p className="muted">
                Inga serier inlästa än. Gå till fliken <strong>Data</strong> och lägg till eller
                importera serier.
              </p>
            </section>
          )}

          {groups.length > 0 && (
            <div className="tabs subtabs" role="tablist">
              {groups.map((g) => {
                const active = g.label === group?.label;
                return (
                  <button
                    key={g.label}
                    role="tab"
                    aria-selected={active}
                    className={active ? 'tab tab-active' : 'tab'}
                    onClick={() => {
                      setActiveGroup(g.label);
                      setActiveSeries(g.seriesIndices[0] ?? null);
                    }}
                  >
                    {g.label} ({g.seriesIndices.length})
                  </button>
                );
              })}
            </div>
          )}

          {seriesIndices.length > 0 && (
            <div className="tabs subtabs series-tabs" role="tablist">
              {seriesIndices.map((si) => {
                const active = si === selectedIdx;
                return (
                  <button
                    key={si}
                    role="tab"
                    aria-selected={active}
                    className={active ? 'tab tab-active' : 'tab'}
                    onClick={() => setActiveSeries(si)}
                  >
                    {series[si].name}
                  </button>
                );
              })}
            </div>
          )}

          {selectedIdx !== null && series[selectedIdx] && (
            <SeriesBlock
              key={`${selectedIdx}:${series[selectedIdx].name}`}
              series={series[selectedIdx]}
              onVerdict={(mi, side, v) => setVerdict(selectedIdx, mi, side, v)}
              onRemove={() => {
                removeSeries(selectedIdx);
                setActiveSeries(null);
              }}
            />
          )}
        </>
      )}
    </div>
  );
}

function DataTab({
  name,
  text,
  err,
  msg,
  totals,
  seriesCount,
  fileInput,
  onName,
  onText,
  onAdd,
  onFillRandom,
  onExport,
  onImportClick,
  onImport,
  onClear,
}: {
  name: string;
  text: string;
  err: string | null;
  msg: string | null;
  totals: ReturnType<typeof summarize>;
  seriesCount: number;
  fileInput: React.RefObject<HTMLInputElement>;
  onName: (v: string) => void;
  onText: (v: string) => void;
  onAdd: (e: React.FormEvent) => void;
  onFillRandom: () => void;
  onExport: () => void;
  onImportClick: () => void;
  onImport: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onClear: () => void;
}) {
  return (
    <>
      <p className="lede">
        Läs in hela serier genom att klistra in spelprogrammet (från FOGIS-exporten eller
        seriesidan) och ange ett serienamn (t.ex. "F10 C Mellersta/Västra" – kullen härleds ur
        namnet). Datat sparas i den här webbläsaren och kan exporteras som fil.
      </p>

      <section className="card">
        <h2>Lägg till en serie</h2>
        <form className="form" onSubmit={onAdd}>
          <label>
            Serienamn
            <input
              value={name}
              onChange={(e) => onName(e.target.value)}
              placeholder="t.ex. F10 C Mellersta/Västra"
              required
            />
          </label>
          <label>
            Klistra in spelprogrammet
            <textarea
              value={text}
              onChange={(e) => onText(e.target.value)}
              rows={6}
              placeholder="Klistra in texten från FOGIS-exporten eller seriesidan…"
              required
            />
          </label>
          {err && (
            <p className="msg msg-err" role="alert">
              {err}
            </p>
          )}
          {msg && (
            <p className="msg msg-ok" role="status">
              {msg}
            </p>
          )}
          <button type="submit">Lägg till serie</button>
        </form>
      </section>

      <section className="card demo-summary">
        <h2>Sparad demodata</h2>
        <p>
          {seriesCount} serier · {totals.reports} rapporter · {totals.complete} fullständiga
          matcher ·{' '}
          {totals.disagreements > 0 ? (
            <span className="badge badge-warn">{totals.disagreements} oense</span>
          ) : (
            'inga oense'
          )}
        </p>
        <div className="demo-actions">
          <button type="button" className="link-btn" onClick={onFillRandom}>
            Fyll i slumpmässiga utfall
          </button>
          <button type="button" className="link-btn" onClick={onExport}>
            Exportera JSON
          </button>
          <button type="button" className="link-btn" onClick={onImportClick}>
            Importera JSON
          </button>
          <button type="button" className="link-btn link-danger" onClick={onClear}>
            Rensa demodata
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            onChange={onImport}
            style={{ display: 'none' }}
          />
        </div>
      </section>
    </>
  );
}

function SeriesBlock({
  series,
  onVerdict,
  onRemove,
}: {
  series: DemoStateSeries;
  onVerdict: (matchIdx: number, side: 'home' | 'away', value: Verdict) => void;
  onRemove: () => void;
}) {
  const items: MatchWithVerdicts[] = series.matches.map((match, i) => ({
    match,
    verdicts: series.verdicts[i] ?? { home: null, away: null },
  }));
  const summary = summarize(items.map((it) => it.verdicts));
  const standings = teamStandings(items);

  return (
    <section>
      <div className="series-head">
        <h2>{series.name}</h2>
        <button type="button" className="link-btn link-danger" onClick={onRemove}>
          Ta bort serie
        </button>
      </div>
      <p className="muted">
        {series.matches.length} matcher · {summary.reports} rapporter ·{' '}
        {summary.disagreements > 0 ? (
          <span className="badge badge-warn">{summary.disagreements} oense</span>
        ) : (
          'inga oense'
        )}{' '}
        · andel jämna{' '}
        {summary.evenShare === null ? '–' : `${Math.round(summary.evenShare * 100)} %`}
      </p>

      {standings.length > 0 && (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Lag</th>
                <th>Rapporter</th>
                <th>Vann stort</th>
                <th>Jämnt</th>
                <th>Förlorade stort</th>
              </tr>
            </thead>
            <tbody>
              {standings.map((r) => (
                <tr key={r.team}>
                  <td>{r.team}</td>
                  <td>{r.reports}</td>
                  <td>{r.wonBig}</td>
                  <td>{r.even}</td>
                  <td>{r.lostBig}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3 className="demo-matches-head">Matcher</h3>
      <div className="match-grid">
        {series.matches.map((m, mi) => {
          const v = series.verdicts[mi] ?? { home: null, away: null };
          const disagree = isDisagreement(v);
          return (
            <div key={mi} className={disagree ? 'card group-card group-disagree' : 'card group-card'}>
              <div className="match-title">
                {m.home} – {m.away}
                {disagree && (
                  <span className="badge badge-warn" title="Lagen är oense om utfallet">
                    Oense
                  </span>
                )}
              </div>
              <div className="match-meta">
                {m.kickoff ? m.kickoff.replace('T', ' ') : 'Tid ej fastställd'}
                {m.round ? ` · Omgång ${m.round}` : ''}
              </div>

              <TeamVerdictRow
                teamLabel={m.home}
                roleLabel="hemmalaget"
                home={m.home}
                away={m.away}
                selected={v.home}
                onSelect={(val) => onVerdict(mi, 'home', val)}
              />
              <TeamVerdictRow
                teamLabel={m.away}
                roleLabel="bortalaget"
                home={m.home}
                away={m.away}
                selected={v.away}
                onSelect={(val) => onVerdict(mi, 'away', val)}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}

function TeamVerdictRow({
  teamLabel,
  roleLabel,
  home,
  away,
  selected,
  onSelect,
}: {
  teamLabel: string;
  roleLabel: string;
  home: string;
  away: string;
  selected: Verdict | null;
  onSelect: (v: Verdict) => void;
}) {
  const options: { value: Verdict; symbol: string; label: string }[] = [
    { value: 1, symbol: verdictSymbol(1), label: `${home} vann stort` },
    { value: 2, symbol: verdictSymbol(2), label: 'Jämn match' },
    { value: 3, symbol: verdictSymbol(3), label: `${away} vann stort` },
  ];
  return (
    <div className="demo-team-row">
      <div className="demo-team-name">
        {teamLabel} <span className="muted">({roleLabel})</span>
      </div>
      <div className="verdict-row" role="group" aria-label={`Hur upplevde ${teamLabel} matchen?`}>
        {options.map((o) => {
          const isSel = selected === o.value;
          return (
            <button
              key={o.value}
              type="button"
              className={isSel ? 'verdict-btn verdict-selected' : 'verdict-btn'}
              aria-pressed={isSel}
              onClick={() => onSelect(o.value)}
            >
              <span className="verdict-symbol" aria-hidden="true">
                {o.symbol}
              </span>
              <span className="verdict-label">{o.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
