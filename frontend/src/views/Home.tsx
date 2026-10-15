import { useEffect, useState } from 'react';
import type { Backend } from '../backend.ts';
import type { Team } from '../types.ts';

export function Home({ backend }: { backend: Backend }) {
  const [teams, setTeams] = useState<Team[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    backend.teams.myTeams().then((res) => {
      if (!active) return;
      if (res.ok) setTeams(res.data);
      else setError(res.error);
    });
    return () => {
      active = false;
    };
  }, [backend]);

  return (
    <div>
      <h1>Mina lag</h1>
      <p className="lede">Välj ett lag för att rapportera matchupplevelse.</p>

      {error && (
        <p className="msg msg-err" role="alert">
          {error}
        </p>
      )}

      {teams === null && !error && <p>Laddar…</p>}

      {teams && teams.length === 0 && (
        <div className="card">
          Du är inte med i något lag än. Be din förenings administratör lägga till dig.
        </div>
      )}

      {teams && teams.length > 0 && (
        <ul className="team-list">
          {teams.map((t) => (
            <li key={t.id}>
              <button className="team-card" onClick={() => (window.location.hash = `#/team/${t.id}`)}>
                {t.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
