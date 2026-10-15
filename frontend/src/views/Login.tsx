import { useState } from 'react';
import type { Backend } from '../backend.ts';

export function Login({ backend }: { backend: Backend }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);
    const res =
      mode === 'in' ? await backend.auth.signIn(email, password) : await backend.auth.signUp(email, password);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
    } else if (mode === 'up') {
      setInfo('Konto skapat. Du kan nu logga in.');
      setMode('in');
    }
  }

  return (
    <main className="app-shell">
      <h1>Matchupplevelse</h1>
      <p className="lede">Logga in för att rapportera eller följa matchupplevelser.</p>

      <form className="card form" onSubmit={submit}>
        <label>
          E-post
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </label>
        <label>
          Lösenord
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
            required
            minLength={6}
          />
        </label>

        {error && (
          <p className="msg msg-err" role="alert">
            {error}
          </p>
        )}
        {info && (
          <p className="msg msg-ok" role="status">
            {info}
          </p>
        )}

        <button type="submit" disabled={busy}>
          {busy ? 'Vänta…' : mode === 'in' ? 'Logga in' : 'Skapa konto'}
        </button>

        <button
          type="button"
          className="link-btn"
          onClick={() => {
            setMode(mode === 'in' ? 'up' : 'in');
            setError(null);
            setInfo(null);
          }}
        >
          {mode === 'in' ? 'Skapa ett nytt konto' : 'Har du redan ett konto? Logga in'}
        </button>
      </form>
    </main>
  );
}
