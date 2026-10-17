import { useEffect, useState } from 'react';
import type { Backend } from '../backend.ts';
import type {
  Club,
  ClubMember,
  ClubRole,
  ClubInvite,
  Roles,
  Series,
  Subteam,
  Team,
  TeamMember,
  TeamInvite,
  GameFormat,
  Fixture,
} from '../types.ts';
import {
  buildImportPreview,
  extractSeries,
  type ImportPreview,
  type SeriesOption,
} from '../importLogic.ts';
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

      <ClubMembers club={club} backend={backend} />

      {teams.map((t) => (
        <TeamAdmin key={t.id} team={t} club={club} backend={backend} onChanged={reload} />
      ))}
    </div>
  );
}

function ClubMembers({ club, backend }: { club: Club; backend: Backend }) {
  const [members, setMembers] = useState<ClubMember[]>([]);
  const [invites, setInvites] = useState<ClubInvite[]>([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<ClubRole>('member');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  function reload() {
    backend.members.listClubMembers(club.id).then((res) => {
      if (res.ok) setMembers(res.data);
      else setErr(res.error);
    });
    backend.members.listClubInvites(club.id).then((res) => {
      if (res.ok) setInvites(res.data);
    });
  }
  useEffect(reload, [club.id, backend]);

  async function addMember(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setMsg(null);
    const target = email.trim();
    const res = await backend.members.inviteClubMember(club.id, target, role);
    setBusy(false);
    if (!res.ok) {
      setErr(res.error);
      return;
    }
    setMsg(
      res.data.hasAccount
        ? `${target} lades till som medlem.`
        : `${target} har inget konto än – inbjudan väntar och aktiveras när personen registrerar sig.`,
    );
    setEmail('');
    setRole('member');
    reload();
  }

  async function remove(member: ClubMember) {
    setErr(null);
    setMsg(null);
    const res = await backend.members.removeClubMember(club.id, member.userId);
    if (!res.ok) {
      setErr(res.error);
      return;
    }
    reload();
  }

  async function revokeInvite(invite: ClubInvite) {
    setErr(null);
    setMsg(null);
    const res = await backend.members.revokeClubInvite(club.id, invite.email);
    if (!res.ok) {
      setErr(res.error);
      return;
    }
    reload();
  }

  return (
    <details className="members-box">
      <summary>
        Medlemmar ({members.length}
        {invites.length > 0 ? ` + ${invites.length} väntande` : ''})
      </summary>
      <div className="members-body">
        {members.length > 0 ? (
          <ul className="member-list">
            {members.map((m) => (
              <li key={m.userId}>
                <span>
                  {m.email}
                  {m.role === 'club_admin' ? ' · föreningsadmin' : ''}
                </span>
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => remove(m)}
                  aria-label={`Ta bort ${m.email}`}
                >
                  Ta bort
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">Inga medlemmar än.</p>
        )}

        {invites.length > 0 && (
          <ul className="member-list invite-list">
            {invites.map((i) => (
              <li key={i.id}>
                <span>
                  {i.email}
                  {i.role === 'club_admin' ? ' · föreningsadmin' : ''} · väntande inbjudan
                </span>
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => revokeInvite(i)}
                  aria-label={`Återkalla inbjudan till ${i.email}`}
                >
                  Återkalla
                </button>
              </li>
            ))}
          </ul>
        )}

        <form className="inline-form" onSubmit={addMember}>
          <input
            type="email"
            placeholder="E-post (konto eller inbjudan)"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <select value={role} onChange={(e) => setRole(e.target.value as ClubRole)}>
            <option value="member">Medlem</option>
            <option value="club_admin">Föreningsadmin</option>
          </select>
          <button type="submit" disabled={busy || !email.trim()}>
            {busy ? 'Lägger till…' : 'Lägg till / bjud in'}
          </button>
        </form>
        {msg && (
          <p className="msg msg-ok" role="status">
            {msg}
          </p>
        )}
        {err && (
          <p className="msg msg-err" role="alert">
            {err}
          </p>
        )}
      </div>
    </details>
  );
}

function TeamAdmin({
  team,
  club,
  backend,
  onChanged,
}: {
  team: Team;
  club: Club;
  backend: Backend;
  onChanged: () => void;
}) {
  const [subteams, setSubteams] = useState<Subteam[]>([]);
  const [name, setName] = useState('');
  const [format, setFormat] = useState<GameFormat>('5v5');
  const [fogisId, setFogisId] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(team.name);
  const [teamErr, setTeamErr] = useState<string | null>(null);

  function reload() {
    backend.teams.subteams(team.id).then((res) => {
      if (res.ok) setSubteams(res.data);
    });
  }
  useEffect(reload, [team.id, backend]);

  async function saveName(e: React.FormEvent) {
    e.preventDefault();
    setTeamErr(null);
    const res = await backend.teams.renameTeam(team.id, editName.trim());
    if (!res.ok) {
      setTeamErr(res.error);
      return;
    }
    setEditing(false);
    onChanged();
  }

  async function removeTeam() {
    const ok = window.confirm(
      `Ta bort laget "${team.name}"? Alla undergrupper, importerade matcher och rapporter för laget raderas. Detta går inte att ångra.`,
    );
    if (!ok) return;
    setTeamErr(null);
    const res = await backend.teams.deleteTeam(team.id);
    if (!res.ok) {
      setTeamErr(res.error);
      return;
    }
    onChanged();
  }

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
      <div className="team-admin-head">
        {editing ? (
          <form className="inline-form" onSubmit={saveName}>
            <input value={editName} onChange={(e) => setEditName(e.target.value)} required />
            <button type="submit">Spara</button>
            <button
              type="button"
              className="link-btn"
              onClick={() => {
                setEditing(false);
                setEditName(team.name);
                setTeamErr(null);
              }}
            >
              Avbryt
            </button>
          </form>
        ) : (
          <>
            <h4>{team.name}</h4>
            <span className="team-admin-actions">
              <button type="button" className="link-btn" onClick={() => setEditing(true)}>
                Byt namn
              </button>
              <button type="button" className="link-btn link-danger" onClick={removeTeam}>
                Ta bort lag
              </button>
            </span>
          </>
        )}
      </div>
      {teamErr && (
        <p className="msg msg-err" role="alert">
          {teamErr}
        </p>
      )}

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

      <TeamMembers team={team} backend={backend} />

      <SeriesAdmin team={team} backend={backend} />

      <ImportMatches team={team} club={club} subteams={subteams} backend={backend} />
    </div>
  );
}

function TeamMembers({ team, backend }: { team: Team; backend: Backend }) {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invites, setInvites] = useState<TeamInvite[]>([]);
  const [email, setEmail] = useState('');
  const [headCoach, setHeadCoach] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  function reload() {
    backend.members.listTeamMembers(team.id).then((res) => {
      if (res.ok) setMembers(res.data);
      else setErr(res.error);
    });
    backend.members.listTeamInvites(team.id).then((res) => {
      if (res.ok) setInvites(res.data);
    });
  }
  useEffect(reload, [team.id, backend]);

  async function addLeader(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setMsg(null);
    const target = email.trim();
    const res = await backend.members.inviteTeamMember(team.id, target, headCoach);
    setBusy(false);
    if (!res.ok) {
      setErr(res.error);
      return;
    }
    setMsg(
      res.data.hasAccount
        ? `${target} lades till som ledare.`
        : `${target} har inget konto än – inbjudan (förening + lag) väntar och aktiveras vid registrering.`,
    );
    setEmail('');
    setHeadCoach(false);
    reload();
  }

  async function remove(member: TeamMember) {
    setErr(null);
    setMsg(null);
    const res = await backend.members.removeTeamMember(team.id, member.userId);
    if (!res.ok) {
      setErr(res.error);
      return;
    }
    reload();
  }

  async function revokeInvite(invite: TeamInvite) {
    setErr(null);
    setMsg(null);
    const res = await backend.members.revokeTeamInvite(team.id, invite.email);
    if (!res.ok) {
      setErr(res.error);
      return;
    }
    reload();
  }

  return (
    <details className="members-box">
      <summary>
        Ledare ({members.length}
        {invites.length > 0 ? ` + ${invites.length} väntande` : ''})
      </summary>
      <div className="members-body">
        {members.length > 0 ? (
          <ul className="member-list">
            {members.map((m) => (
              <li key={m.userId}>
                <span>
                  {m.email}
                  {m.headCoach ? ' · huvudtränare' : ''}
                </span>
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => remove(m)}
                  aria-label={`Ta bort ${m.email}`}
                >
                  Ta bort
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">Inga ledare än.</p>
        )}

        {invites.length > 0 && (
          <ul className="member-list invite-list">
            {invites.map((i) => (
              <li key={i.id}>
                <span>
                  {i.email}
                  {i.headCoach ? ' · huvudtränare' : ''} · väntande inbjudan
                </span>
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => revokeInvite(i)}
                  aria-label={`Återkalla inbjudan till ${i.email}`}
                >
                  Återkalla
                </button>
              </li>
            ))}
          </ul>
        )}

        <form className="inline-form" onSubmit={addLeader}>
          <input
            type="email"
            placeholder="E-post (konto eller inbjudan)"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={headCoach}
              onChange={(e) => setHeadCoach(e.target.checked)}
            />
            Huvudtränare
          </label>
          <button type="submit" disabled={busy || !email.trim()}>
            {busy ? 'Lägger till…' : 'Lägg till / bjud in'}
          </button>
        </form>
        {msg && (
          <p className="msg msg-ok" role="status">
            {msg}
          </p>
        )}
        {err && (
          <p className="msg msg-err" role="alert">
            {err}
          </p>
        )}
      </div>
    </details>
  );
}

function SeriesAdmin({ team, backend }: { team: Team; backend: Backend }) {
  const [series, setSeries] = useState<Series[]>([]);
  const [competitionId, setCompetitionId] = useState('');
  const [name, setName] = useState('');
  const [season, setSeason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function reload() {
    backend.teams.series(team.id).then((res) => {
      if (res.ok) setSeries(res.data);
      else setErr(res.error);
    });
  }
  useEffect(reload, [team.id, backend]);

  async function addSeries(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const res = await backend.teams.addSeries(
      team.id,
      competitionId.trim(),
      name.trim(),
      season.trim() || null,
    );
    setBusy(false);
    if (!res.ok) {
      setErr(res.error);
      return;
    }
    setCompetitionId('');
    setName('');
    setSeason('');
    reload();
  }

  async function remove(s: Series) {
    setErr(null);
    const res = await backend.teams.removeSeries(s.id);
    if (!res.ok) {
      setErr(res.error);
      return;
    }
    reload();
  }

  return (
    <details className="members-box">
      <summary>Serier ({series.length})</summary>
      <div className="members-body">
        {series.length > 0 ? (
          <ul className="member-list">
            {series.map((s) => (
              <li key={s.id}>
                <span>
                  {s.name}
                  {s.season ? ` · ${s.season}` : ''} · id {s.competitionId}
                </span>
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => remove(s)}
                  aria-label={`Ta bort serie ${s.name}`}
                >
                  Ta bort
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">Inga serier än. De fylls annars i automatiskt vid FOGIS-import.</p>
        )}

        <form className="inline-form" onSubmit={addSeries}>
          <input
            placeholder="Serie-id (FOGIS competitionId)"
            value={competitionId}
            onChange={(e) => setCompetitionId(e.target.value)}
            required
          />
          <input
            placeholder="Namn"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <input
            placeholder="Säsong (valfritt)"
            value={season}
            onChange={(e) => setSeason(e.target.value)}
          />
          <button type="submit" disabled={busy || !competitionId.trim() || !name.trim()}>
            {busy ? 'Sparar…' : 'Lägg till serie'}
          </button>
        </form>
        {err && (
          <p className="msg msg-err" role="alert">
            {err}
          </p>
        )}
      </div>
    </details>
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
  const [raw, setRaw] = useState<unknown>(null);
  const [existing, setExisting] = useState<Fixture[]>([]);
  const [series, setSeries] = useState<SeriesOption[]>([]);
  const [competitionId, setCompetitionId] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (subteams.length > 0 && !subteamId) setSubteamId(subteams[0].id);
  }, [subteams, subteamId]);

  // När man valt serie (eller lag) byggs förhandsgranskningen om från det hämtade svaret.
  useEffect(() => {
    if (raw === null || !competitionId) {
      setPreview(null);
      return;
    }
    setPreview(buildImportPreview(raw, existing, subteamId, club.name, undefined, competitionId));
  }, [raw, existing, subteamId, competitionId, club.name]);

  async function fetchGames() {
    setBusy(true);
    setErr(null);
    setMsg(null);
    setPreview(null);
    setSeries([]);
    setCompetitionId('');
    setRaw(null);
    const clubFogisId = subteams.find((s) => s.id === subteamId)?.fogisTeamId ?? undefined;
    const gamesRes = await backend.fogis.games(team.id, from, to, clubFogisId);
    if (!gamesRes.ok) {
      setBusy(false);
      setErr(`Kunde inte hämta från FOGIS: ${gamesRes.error}`);
      return;
    }
    const existingRes = await backend.matches.forTeam(team.id);
    setExisting(existingRes.ok ? existingRes.data : []);
    const found = extractSeries(gamesRes.data);
    setRaw(gamesRes.data);
    setSeries(found);
    if (found.length === 1) setCompetitionId(found[0].competitionId);
    if (found.length === 0) {
      setErr('Inga serier med spelform 3v3/5v5/7v7 hittades i svaret.');
    }
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
    setRaw(null);
    setSeries([]);
    setCompetitionId('');
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
          <button type="button" disabled={busy || !subteamId || !from || !to} onClick={fetchGames}>
            {busy ? 'Hämtar…' : 'Hämta från FOGIS'}
          </button>
        </div>

        {series.length > 0 && (
          <div className="inline-form">
            <label>
              Serie
              <select value={competitionId} onChange={(e) => setCompetitionId(e.target.value)}>
                <option value="">Välj serie…</option>
                {series.map((s) => (
                  <option key={s.competitionId} value={s.competitionId}>
                    {s.name} ({s.playableCount} spelbara)
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

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
