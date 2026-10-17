import { useEffect, useMemo, useState } from 'react';
import type { Backend } from '../backend.ts';
import type { MatchReport, Overview, SeriesSummary } from '../types.ts';
import {
  groupMatches,
  countDisagreements,
  evenPercent,
  federationStandings,
  groupSeries,
  type MatchGroup,
} from '../overviewLogic.ts';
import { verdictSymbol, formatKickoff } from '../verdictLogic.ts';

export function FederationPage({ backend }: { backend: Backend }) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeGroup, setActiveGroup] = useState<string | null>(null);
  const [activeSeries, setActiveSeries] = useState<string | null>(null); // competitionId

  useEffect(() => {
    let active = true;
    backend.federation.overview().then((res) => {
      if (!active) return;
      if (res.ok) setOverview(res.data);
      else setError(res.error);
    });
    return () => {
      active = false;
    };
  }, [backend]);

  if (error) {
    return (
      <div>
        <h1>Förbund</h1>
        <p className="msg msg-err" role="alert">
          {error}
        </p>
      </div>
    );
  }

  if (!overview) {
    return (
      <div>
        <h1>Förbund</h1>
        <p>Laddar…</p>
      </div>
    );
  }

  return <FederationView overview={overview} activeGroup={activeGroup} activeSeries={activeSeries} onGroup={setActiveGroup} onSeries={setActiveSeries} />;
}

function FederationView({
  overview,
  activeGroup,
  activeSeries,
  onGroup,
  onSeries,
}: {
  overview: Overview;
  activeGroup: string | null;
  activeSeries: string | null;
  onGroup: (label: string) => void;
  onSeries: (competitionId: string) => void;
}) {
  // Serierna sorterade/grupperade per ålderskull.
  const series = overview.series;
  const groups = useMemo(() => groupSeries(series), [series]);
  const group = groups.find((g) => g.label === activeGroup) ?? groups[0] ?? null;
  const groupSeriesList: SeriesSummary[] = (group?.seriesIndices ?? []).map((i) => series[i]);

  const selected =
    groupSeriesList.find((s) => s.competitionId === activeSeries) ?? groupSeriesList[0] ?? null;

  // Rapporter för vald serie (matchas på competitionId).
  const seriesReports: MatchReport[] = useMemo(
    () =>
      selected
        ? overview.matches.filter((m) => m.competitionId === selected.competitionId)
        : [],
    [overview.matches, selected],
  );
  const standings = useMemo(() => federationStandings(seriesReports), [seriesReports]);
  const matchGroups = useMemo(() => groupMatches(seriesReports), [seriesReports]);
  const disagreements = countDisagreements(matchGroups);

  return (
    <div>
      <h1>Förbund</h1>
      <p className="lede">
        Hur ledarna upplevt matcherna, per serie. 1 = hemmalaget vann stort, 2 = jämn, 3 =
        bortalaget vann stort.
      </p>

      {series.length === 0 && <div className="card">Inga rapporter inlagda än.</div>}

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
                  onGroup(g.label);
                  onSeries(series[g.seriesIndices[0]].competitionId);
                }}
              >
                {g.label} ({g.seriesIndices.length})
              </button>
            );
          })}
        </div>
      )}

      {groupSeriesList.length > 0 && (
        <div className="tabs subtabs series-tabs" role="tablist">
          {groupSeriesList.map((s) => {
            const active = s.competitionId === selected?.competitionId;
            return (
              <button
                key={s.competitionId}
                role="tab"
                aria-selected={active}
                className={active ? 'tab tab-active' : 'tab'}
                onClick={() => onSeries(s.competitionId)}
              >
                {s.name}
              </button>
            );
          })}
        </div>
      )}

      {selected && (
        <section>
          <div className="series-head">
            <h2>{selected.name}</h2>
          </div>
          <p className="muted">
            {selected.reports} rapporter · {selected.even} jämna · {selected.dominated} avgjorda ·
            andel jämna {evenPercent(selected)}
            {disagreements > 0 && (
              <>
                {' · '}
                <span className="badge badge-warn">{disagreements} oense</span>
              </>
            )}
          </p>

          {standings.length > 0 && (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Lag</th>
                    <th>Förening</th>
                    <th>Rapporter</th>
                    <th>Vann stort</th>
                    <th>Jämnt</th>
                    <th>Förlorade stort</th>
                  </tr>
                </thead>
                <tbody>
                  {standings.map((r) => (
                    <tr key={r.teamId}>
                      <td>{r.teamName}</td>
                      <td>{r.clubName}</td>
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

          <h3 className="demo-matches-head">
            Matcher{' '}
            {disagreements > 0 && (
              <span className="badge badge-warn">{disagreements} oense</span>
            )}
          </h3>
          {matchGroups.length === 0 ? (
            <p className="muted">Inga rapporter i den här serien än.</p>
          ) : (
            <div className="match-grid">
              {matchGroups.map((g) => (
                <MatchGroupCard key={g.key} group={g} />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function MatchGroupCard({ group }: { group: MatchGroup }) {
  const home = group.home ?? 'Hemmalag';
  const away = group.away ?? 'Bortalag';
  return (
    <div className={group.disagreement ? 'card group-card group-disagree' : 'card group-card'}>
      <div className="match-title">
        {home} – {away}
        {group.disagreement && (
          <span className="badge badge-warn" title="Lagen är oense om utfallet">
            Oense
          </span>
        )}
      </div>
      <div className="match-meta">
        {formatKickoff(group.kickoff)}
        {group.competition ? ` · ${group.competition}` : ''}
      </div>
      <ul className="report-list">
        {group.reports.map((r) => (
          <li key={r.fixtureId}>
            <span className="verdict-symbol-sm" aria-hidden="true">
              {verdictSymbol(r.verdict)}
            </span>
            <span>
              <strong>{r.teamName}</strong> ({r.clubName}):{' '}
              {r.verdict === 1
                ? 'hemmalaget vann stort'
                : r.verdict === 2
                  ? 'jämn match'
                  : 'bortalaget vann stort'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
