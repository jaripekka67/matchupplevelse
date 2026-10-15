import { useEffect, useState } from 'react';
import { getClient, hasConfig, readConfig } from './supabaseClient.ts';

type Status =
  | { kind: 'checking' }
  | { kind: 'missing-config' }
  | { kind: 'connected' }
  | { kind: 'error'; message: string };

/**
 * Minimal startpunkt för appen. Verifierar att frontend kan nå Supabase genom att be om
 * den aktuella auth-sessionen (ett lätt anrop som inte kräver något schema). Resultatet
 * visas som anslutningsstatus – demon för Task 1.
 */
export function App() {
  const [status, setStatus] = useState<Status>({ kind: 'checking' });

  useEffect(() => {
    const cfg = readConfig();
    if (!hasConfig(cfg)) {
      setStatus({ kind: 'missing-config' });
      return;
    }
    let active = true;
    getClient()
      .auth.getSession()
      .then(({ error }) => {
        if (!active) return;
        if (error) setStatus({ kind: 'error', message: error.message });
        else setStatus({ kind: 'connected' });
      })
      .catch((e: unknown) => {
        if (!active) return;
        setStatus({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="app-shell">
      <h1>Matchupplevelse</h1>
      <p className="lede">
        Rapportera hur jämn den senaste matchen var. Appen byggs steg för steg – det här är
        grundskelettet.
      </p>
      <ConnectionCard status={status} />
    </main>
  );
}

function ConnectionCard({ status }: { status: Status }) {
  switch (status.kind) {
    case 'checking':
      return (
        <div className="card" role="status">
          <span className="dot dot-neutral" aria-hidden="true" /> Kontrollerar anslutning till Supabase…
        </div>
      );
    case 'missing-config':
      return (
        <div className="card card-warn" role="alert">
          <span className="dot dot-warn" aria-hidden="true" /> Konfiguration saknas. Skapa{' '}
          <code>frontend/.env.local</code> från <code>.env.example</code> och fyll i Supabase-URL
          och anon-nyckel från <code>supabase start</code>.
        </div>
      );
    case 'connected':
      return (
        <div className="card card-ok" role="status">
          <span className="dot dot-ok" aria-hidden="true" /> Ansluten till Supabase.
        </div>
      );
    case 'error':
      return (
        <div className="card card-err" role="alert">
          <span className="dot dot-err" aria-hidden="true" /> Kunde inte nå Supabase: {status.message}
        </div>
      );
  }
}
