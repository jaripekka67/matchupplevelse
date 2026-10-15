import type { Backend } from '../backend.ts';

// Lagledarens rapporteringsvy byggs ut i Task 9. Här en platshållare så routingen fungerar.
export function TeamPage({ teamId }: { teamId: string; backend: Backend }) {
  return (
    <div>
      <button className="link-btn" onClick={() => (window.location.hash = '#/')}>
        ← Mina lag
      </button>
      <h1>Lagets matcher</h1>
      <div className="card">Rapporteringsvyn byggs i nästa steg (lag {teamId}).</div>
    </div>
  );
}
