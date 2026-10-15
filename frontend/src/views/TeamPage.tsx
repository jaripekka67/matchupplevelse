import { useEffect, useMemo, useState } from 'react';
import type { Backend } from '../backend.ts';
import type { Fixture, Verdict } from '../types.ts';
import {
  isPlayed,
  latestPlayed,
  sortByKickoffDesc,
  verdictOptions,
  formatKickoff,
  matchTitle,
} from '../verdictLogic.ts';

export function TeamPage({ teamId, backend }: { teamId: string; backend: Backend }) {
  const [fixtures, setFixtures] = useState<Fixture[] | null>(null);
  const [verdicts, setVerdicts] = useState<Record<string, Verdict>>({});
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setError(null);
    Promise.all([backend.matches.forTeam(teamId), backend.matches.verdicts(teamId)]).then(
      ([fRes, vRes]) => {
        if (!active) return;
        if (!fRes.ok) {
          setError(fRes.error);
          return;
        }
        setFixtures(fRes.data);
        if (vRes.ok) {
          const map: Record<string, Verdict> = {};
          for (const v of vRes.data) map[v.fixtureId] = v.verdict;
          setVerdicts(map);
        }
      },
    );
    return () => {
      active = false;
    };
  }, [teamId, backend]);

  const { latest, otherPlayed, upcoming } = useMemo(() => {
    const all = fixtures ?? [];
    const now = new Date();
    const latest = latestPlayed(all, now);
    const played = sortByKickoffDesc(all.filter((f) => isPlayed(f, now)));
    const otherPlayed = played.filter((f) => f.id !== latest?.id);
    const upcoming = sortByKickoffDesc(all.filter((f) => !isPlayed(f, now))).reverse();
    return { latest, otherPlayed, upcoming };
  }, [fixtures]);

  async function save(fixtureId: string, verdict: Verdict) {
    setSavingId(fixtureId);
    setError(null);
    // Växla av om man klickar på det redan valda (toggle -> ta bort).
    const next = verdicts[fixtureId] === verdict ? null : verdict;
    const res = await backend.matches.saveVerdict(fixtureId, next);
    setSavingId(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setVerdicts((prev) => {
      const copy = { ...prev };
      if (next === null) delete copy[fixtureId];
      else copy[fixtureId] = next;
      return copy;
    });
  }

  return (
    <div>
      <button className="link-btn" onClick={() => (window.location.hash = '#/')}>
        ← Mina lag
      </button>
      <h1>Lagets matcher</h1>
      <p className="lede">
        Rapportera hur den senaste spelade matchen upplevdes. Klicka på det alternativ som stämmer –
        klicka igen för att ångra.
      </p>

      {error && (
        <p className="msg msg-err" role="alert">
          {error}
        </p>
      )}

      {fixtures === null && !error && <p>Laddar matcher…</p>}

      {fixtures && fixtures.length === 0 && (
        <div className="card">Inga matcher importerade för laget än.</div>
      )}

      {latest && (
        <section>
          <h2>Senaste matchen</h2>
          <MatchCard
            fixture={latest}
            verdict={verdicts[latest.id] ?? null}
            saving={savingId === latest.id}
            onSelect={(v) => save(latest.id, v)}
            highlighted
          />
        </section>
      )}

      {otherPlayed.length > 0 && (
        <section>
          <h2>Tidigare matcher</h2>
          <div className="match-grid">
            {otherPlayed.map((f) => (
              <MatchCard
                key={f.id}
                fixture={f}
                verdict={verdicts[f.id] ?? null}
                saving={savingId === f.id}
                onSelect={(v) => save(f.id, v)}
              />
            ))}
          </div>
        </section>
      )}

      {upcoming.length > 0 && (
        <section>
          <h2>Kommande matcher</h2>
          <div className="match-grid">
            {upcoming.map((f) => (
              <div key={f.id} className="card match-upcoming">
                <div className="match-title">{matchTitle(f)}</div>
                <div className="match-meta">
                  {formatKickoff(f.kickoff)}
                  {f.competition ? ` · ${f.competition}` : ''}
                </div>
                <div className="match-note">Kan rapporteras efter avspark.</div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function MatchCard({
  fixture,
  verdict,
  saving,
  onSelect,
  highlighted = false,
}: {
  fixture: Fixture;
  verdict: Verdict | null;
  saving: boolean;
  onSelect: (v: Verdict) => void;
  highlighted?: boolean;
}) {
  const options = verdictOptions(fixture);
  return (
    <div className={highlighted ? 'card match-card-full match-highlight' : 'card match-card-full'}>
      <div className="match-title">{matchTitle(fixture)}</div>
      <div className="match-meta">
        {formatKickoff(fixture.kickoff)}
        {fixture.competition ? ` · ${fixture.competition}` : ''}
        {fixture.place ? ` · ${fixture.place}` : ''}
      </div>
      <div className="verdict-row" role="group" aria-label="Hur upplevdes matchen?">
        {options.map((o) => {
          const selected = verdict === o.value;
          return (
            <button
              key={o.value}
              type="button"
              className={selected ? 'verdict-btn verdict-selected' : 'verdict-btn'}
              aria-pressed={selected}
              disabled={saving}
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
      {saving && <div className="match-note">Sparar…</div>}
      {verdict !== null && !saving && (
        <div className="match-note match-saved" role="status">
          Sparat: {options.find((o) => o.value === verdict)!.label}
        </div>
      )}
    </div>
  );
}
