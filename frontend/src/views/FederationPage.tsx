import { useEffect, useState } from 'react';
import type { Backend } from '../backend.ts';
import type { Overview } from '../types.ts';
import {
  groupMatches,
  countDisagreements,
  sortSeries,
  sortTeams,
  evenPercent,
  type MatchGroup,
} from '../overviewLogic.ts';
import { verdictSymbol, formatKickoff } from '../verdictLogic.ts';

export function FederationPage({ backend }: { backend: Backend }) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const series = sortSeries(overview.series);
  const teams = sortTeams(overview.teams);
  const groups = groupMatches(overview.matches);
  const disagreements = countDisagreements(groups);

  return (
    <div>
      <h1>Förbund</h1>
      <p className="lede">
        Aggregerad matchupplevelse från lagledarna. 1 = hemmalaget vann stort, 2 = jämn, 3 =
        bortalaget vann stort.
      </p>

      {overview.matches.length === 0 && (
        <div className="card">Inga rapporter inlagda än.</div>
      )}

      {series.length > 0 && (
        <section>
          <h2>Per serie</h2>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Serie</th>
                  <th>Rapporter</th>
                  <th>Jämna</th>
                  <th>Avgjorda</th>
                  <th>Andel jämna</th>
                </tr>
              </thead>
              <tbody>
                {series.map((s) => (
                  <tr key={s.competitionId}>
                    <td>{s.name}</td>
                    <td>{s.reports}</td>
                    <td>{s.even}</td>
                    <td>{s.dominated}</td>
                    <td>{evenPercent(s)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {teams.length > 0 && (
        <section>
          <h2>Per lag</h2>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Lag</th>
                  <th>Förening</th>
                  <th>Rapporter</th>
                  <th>Vi dominerade</th>
                  <th>Motst. dominerade</th>
                  <th>Jämna</th>
                </tr>
              </thead>
              <tbody>
                {teams.map((t) => (
                  <tr key={t.teamId}>
                    <td>{t.teamName}</td>
                    <td>{t.clubName}</td>
                    <td>{t.reports}</td>
                    <td>{t.ownBig}</td>
                    <td>{t.oppBig}</td>
                    <td>{t.even}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {groups.length > 0 && (
        <section>
          <h2>
            Matcher{' '}
            {disagreements > 0 && (
              <span className="badge badge-warn">{disagreements} oense</span>
            )}
          </h2>
          <div className="match-grid">
            {groups.map((g) => (
              <MatchGroupCard key={g.key} group={g} />
            ))}
          </div>
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
              {r.verdict === 1 ? 'hemmalaget vann stort' : r.verdict === 2 ? 'jämn match' : 'bortalaget vann stort'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
