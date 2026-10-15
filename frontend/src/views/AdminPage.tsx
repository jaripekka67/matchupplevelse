import { useEffect, useState } from 'react';
import type { Backend } from '../backend.ts';
import type { Club, Roles, Subteam, Team, GameFormat, Fixture } from '../types.ts';
import { buildImportPreview, type ImportPreview } from '../importLogic.ts';
import { matchTitle, formatKickoff } from '../verdictLogic.ts';

const FORMATS: GameFormat[] = ['3v3', '5v5', '7v7'];

export function AdminPage({ backend, roles }: { backend: Backend; roles: Roles | null }) {
  const [clubs, setClubs] = useState<Club[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    backend.clubs.list().then((res) => {
      if (!active) return;
      if (res.ok) setClubs(res.data);
      else setError(res.error);
    });
    return () => {
      active = false;
    };
  }, [backend]);

  function reloadClubs() {
    backend.clubs.list().then((res) => {
      if (res.ok) setClubs(res.data);
    });
  }

  return (
    <div>
      <h1>Admin</h1>
      {error && (
        <p className="msg msg-err" role="alert">
          {error}
        </p>
      )}

      {roles?.superadmin && <CreateClub backend={backend} onCreated={reloadClubs} />}

      <section>
        <h2>Föreningar</h2>
        {clubs.length === 0 && <div className="card">Inga föreningar synliga.</div>}
        {clubs.map((c) => (
          <ClubAdmin key={c.id} club={c} backend={backend} />
        ))}
      </section>
    </div>
  );
}

function CreateClub({ backend, onCreated }: { backend: Backend; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    setErr(null);
    const res = await backend.clubs.create(name.trim(), slug.trim());
    setBusy(false);
    if (!res.ok) {
      setErr(res.error);
      return;
    }
    setMsg(`Förening "${res.data.name}" skapad.`);
    setName('');
    setSlug('');
    onCreated();
  }

  return (
    <section>
      <h2>Ny förening (superadmin)</h2>
      <form className="card form" onSubmit={submit}>
        <label>
          Namn
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label>
          Slug (små bokstäver, bindestreck)
          <input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
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
        <button type="submit" disabled={busy}>
          {busy ? 'Skapar…' : 'Skapa förening'}
        </button>
      </form>
    </section>
  );
}

function ClubAdmin({ club, backend }: { club: Club; backend: Backend }) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [newTeam, setNewTeam] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function reload() {
    backend.teams.teamsInClub(club.id).then((res) => {
      if (res.ok) setTeams(res.data);
      else setErr(res.error);
    });
  }
  useEffect(reload, [club.id, backend]);

  async function addTeam(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const res = await backend.teams.createTeam(club.id, newTeam.trim());
    setBusy(false);
    if (!res.ok) {
      setErr(res.error);
      return;
    }
    setNewTeam('');
    reload();
  }

  return (
    <div className="card club-admin">
      <h3>{club.name}</h3>

      <form className="inline-form" onSubmit={addTeam}>
        <input
          placeholder="Nytt lag (t.ex. P13)"
          value={newTeam}
          onChange={(e) => setNewTeam(e.target.value)}
          required
        />
        <button type="submit" disabled={busy}>
          Lägg till lag
        </button>
      </form>
      {err && (
        <p className="msg msg-err" role="alert">
          {err}
        </p>
      )}

      {teams.map((t) => (
        <TeamAdmin key={t.id} team={t} club={club} backend={backend} />
      ))}
    </div>
  );
}

function TeamAdmin({ team, club, backend }: { team: Team; club: Club; backend: Backend }) {
  const [subteams, setSubteams] = useState<Subteam[]>([]);
  const [name, setName] = useState('');
  const [format, setFormat] = useState<GameFormat>('5v5');
  const [fogisId, setFogisId] = useState('');
  const [err, setErr] = useState<string | null>(null);

  function reload() {
    backend.teams.subteams(team.id).then((res) => {
      if (res.ok) setSubteams(res.data);
    });
  }
  useEffect(reload, [team.id, backend]);

  async function addSubteam(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const res = await backend.teams.createSubteam(team.id, name.trim(), format, fogisId.trim() || null);
    if (!res.ok) {
      setErr(res.error);
      return;
    }
    setName('');
    setFogisId('');
    reload();
  }

  return (
    <div className="team-admin">
      <h4>{team.name}</h4>

      {subteams.length > 0 && (
        <ul className="subteam-list">
          {subteams.map((s) => (
            <li key={s.id}>
              {s.name} · {s.gameFormat}
              {s.fogisTeamId ? ` · FOGIS-id ${s.fogisTeamId}` : ' · (inget FOGIS-id)'}
            </li>
          ))}
        </ul>
      )}

      <form className="inline-form" onSubmit={addSubteam}>
        <input placeholder="Lag/åldersgrupp" value={name} onChange={(e) => setName(e.target.value)} required />
        <select value={format} onChange={(e) => setFormat(e.target.value as GameFormat)}>
          {FORMATS.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        <input placeholder="FOGIS-id (valfritt)" value={fogisId} onChange={(e) => setFogisId(e.target.value)} />
        <button type="submit">Lägg till</button>
      </form>
      {err && (
        <p className="msg msg-err" role="alert">
          {err}
        </p>
      )}

      <ImportMatches team={team} club={club} subteams={subteams} backend={backend} />
    </div>
  );
}

function ImportMatches({
  team,
  club,
  subteams,
  backend,
}: {
  team: Team;
  club: Club;
  subteams: Subteam[];
  backend: Backend;
}) {
  const [subteamId, setSubteamId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (subteams.length > 0 && !subteamId) setSubteamId(subteams[0].id);
  }, [subteams, subteamId]);

  async function fetchPreview() {
    setBusy(true);
    setErr(null);
    setMsg(null);
    setPreview(null);
    const clubFogisId = subteams.find((s) => s.id === subteamId)?.fogisTeamId ?? undefined;
    const gamesRes = await backend.fogis.games(team.id, from, to, clubFogisId);
    if (!gamesRes.ok) {
      setBusy(false);
      setErr(`Kunde inte hämta från FOGIS: ${gamesRes.error}`);
      return;
    }
    const existingRes = await backend.matches.forTeam(team.id);
    const existing: Fixture[] = existingRes.ok ? existingRes.data : [];
    const p = buildImportPreview(gamesRes.data, existing, subteamId, club.name);
    setPreview(p);
    setBusy(false);
  }

  async function doImport() {
    if (!preview) return;
    setBusy(true);
    setErr(null);
    const res = await backend.fogis.importGames(team.id, preview.inserts, preview.updates);
    setBusy(false);
    if (!res.ok) {
      setErr(res.error);
      return;
    }
    const r = res.data as { created?: number; updated?: number; skipped?: number };
    setMsg(`Import klar: ${r.created ?? 0} nya, ${r.updated ?? 0} uppdaterade, ${r.skipped ?? 0} hoppade.`);
    setPreview(null);
  }

  return (
    <details className="import-box">
      <summary>Importera matcher från FOGIS</summary>
      <div className="import-body">
        <div className="inline-form">
          <label>
            Lag
            <select value={subteamId} onChange={(e) => setSubteamId(e.target.value)}>
              {subteams.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.gameFormat})
                </option>
              ))}
            </select>
          </label>
          <label>
            Från
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label>
            Till
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <button type="button" disabled={busy || !subteamId || !from || !to} onClick={fetchPreview}>
            {busy ? 'Hämtar…' : 'Hämta förhandsgranskning'}
          </button>
        </div>

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

        {preview && (
          <div className="preview">
            <p>
              {preview.inserts.length} nya, {preview.updates.length} uppdateras,{' '}
              {preview.skipped.length} hoppas.
            </p>
            {preview.inserts.length > 0 && (
              <>
                <strong>Nya matcher:</strong>
                <ul>
                  {preview.inserts.map((g) => (
                    <li key={g.fogisGameId}>
                      {matchTitle({ home: g.home, away: g.away } as Fixture)} ·{' '}
                      {formatKickoff(g.kickoff)}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {(preview.inserts.length > 0 || preview.updates.length > 0) && (
              <button type="button" disabled={busy} onClick={doImport}>
                {busy ? 'Importerar…' : 'Bekräfta import'}
              </button>
            )}
          </div>
        )}
      </div>
    </details>
  );
}
