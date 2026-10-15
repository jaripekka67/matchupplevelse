import type { SupabaseClient } from '@supabase/supabase-js';
import {
  type Club,
  type Team,
  type Subteam,
  type Series,
  type Fixture,
  type MatchEvenness,
  type Overview,
  type Roles,
  type Result,
  type Verdict,
  ok,
  fail,
} from './types.ts';

// Hjälpare: slå ihop Supabase {data, error} till vårt Result<T>, med en läsbar felsträng.
function wrap<T>(data: T | null, error: { message: string } | null): Result<T> {
  if (error) return fail(error.message);
  return ok(data as T);
}

// --- Mappning från databasrader (snake_case) till våra typer (camelCase) ---

export function mapTeam(r: Record<string, unknown>): Team {
  return { id: r.id as string, clubId: r.club_id as string, name: r.name as string };
}

export function mapSubteam(r: Record<string, unknown>): Subteam {
  return {
    id: r.id as string,
    teamId: r.team_id as string,
    name: r.name as string,
    gameFormat: r.game_format as Subteam['gameFormat'],
    fogisTeamId: (r.fogis_team_id as string | null) ?? null,
  };
}

export function mapSeries(r: Record<string, unknown>): Series {
  return {
    id: r.id as string,
    teamId: r.team_id as string,
    competitionId: r.competition_id as string,
    name: r.name as string,
    season: (r.season as string | null) ?? null,
  };
}

export function mapFixture(r: Record<string, unknown>): Fixture {
  return {
    id: r.id as string,
    teamId: r.team_id as string,
    subteamId: (r.subteam_id as string | null) ?? null,
    gameFormat: r.game_format as Fixture['gameFormat'],
    fogisGameId: (r.fogis_game_id as string | null) ?? null,
    competition: (r.competition as string | null) ?? null,
    competitionId: (r.competition_id as string | null) ?? null,
    kickoff: r.kickoff as string,
    home: (r.home as string | null) ?? null,
    away: (r.away as string | null) ?? null,
    isHome: (r.is_home as boolean | null) ?? null,
    place: (r.place as string | null) ?? null,
    source: r.source as string,
  };
}

export function mapClub(r: Record<string, unknown>): Club {
  return { id: r.id as string, name: r.name as string, slug: r.slug as string };
}

// --- API-lagret ---

export function createBackend(client: SupabaseClient) {
  return {
    auth: createAuthApi(client),
    roles: createRolesApi(client),
    clubs: createClubsApi(client),
    teams: createTeamsApi(client),
    matches: createMatchApi(client),
    fogis: createFogisApi(client),
    federation: createFederationApi(client),
  };
}

export type Backend = ReturnType<typeof createBackend>;

function createAuthApi(client: SupabaseClient) {
  return {
    async signIn(email: string, password: string): Promise<Result<null>> {
      const { error } = await client.auth.signInWithPassword({ email, password });
      return error ? fail(error.message) : ok(null);
    },
    async signUp(email: string, password: string): Promise<Result<null>> {
      const { error } = await client.auth.signUp({ email, password });
      return error ? fail(error.message) : ok(null);
    },
    async signOut(): Promise<Result<null>> {
      const { error } = await client.auth.signOut();
      return error ? fail(error.message) : ok(null);
    },
  };
}

function createRolesApi(client: SupabaseClient) {
  return {
    // Hämtar användarens roller via RPC + club_members. Säkerheten ligger i RLS; detta styr bara UI.
    async load(): Promise<Result<Roles>> {
      const sa = await client.rpc('is_superadmin');
      if (sa.error) return fail(sa.error.message);
      const fr = await client.rpc('is_federation_rep');
      if (fr.error) return fail(fr.error.message);
      const mem = await client.from('club_members').select('club_id, role');
      if (mem.error) return fail(mem.error.message);

      const superadmin = sa.data === true;
      const federationRep = fr.data === true;
      const adminClubs = (mem.data ?? [])
        .filter((m: Record<string, unknown>) => m.role === 'club_admin')
        .map((m: Record<string, unknown>) => m.club_id as string);
      return ok({
        superadmin,
        federationRep,
        adminClubs,
        anyAdmin: superadmin || adminClubs.length > 0,
      });
    },
  };
}

function createClubsApi(client: SupabaseClient) {
  return {
    async list(): Promise<Result<Club[]>> {
      const { data, error } = await client.from('clubs').select('*').order('name');
      return wrap((data ?? []).map(mapClub), error);
    },
  };
}

function createTeamsApi(client: SupabaseClient) {
  return {
    async myTeams(): Promise<Result<Team[]>> {
      const { data, error } = await client.from('teams').select('*').order('name');
      return wrap((data ?? []).map(mapTeam), error);
    },
    async subteams(teamId: string): Promise<Result<Subteam[]>> {
      const { data, error } = await client
        .from('subteams')
        .select('*')
        .eq('team_id', teamId)
        .order('name');
      return wrap((data ?? []).map(mapSubteam), error);
    },
    async series(teamId: string): Promise<Result<Series[]>> {
      const { data, error } = await client
        .from('series')
        .select('*')
        .eq('team_id', teamId)
        .order('name');
      return wrap((data ?? []).map(mapSeries), error);
    },
  };
}

function createMatchApi(client: SupabaseClient) {
  return {
    async forTeam(teamId: string): Promise<Result<Fixture[]>> {
      const { data, error } = await client
        .from('fixtures')
        .select('*')
        .eq('team_id', teamId)
        .order('kickoff', { ascending: false });
      return wrap((data ?? []).map(mapFixture), error);
    },
    async verdicts(teamId: string): Promise<Result<MatchEvenness[]>> {
      const { data, error } = await client
        .from('match_evenness')
        .select('fixture_id, team_id, verdict')
        .eq('team_id', teamId);
      if (error) return fail(error.message);
      return ok(
        (data ?? []).map((r: Record<string, unknown>) => ({
          fixtureId: r.fixture_id as string,
          teamId: r.team_id as string,
          verdict: r.verdict as Verdict,
        })),
      );
    },
    async saveVerdict(fixtureId: string, verdict: Verdict | null): Promise<Result<null>> {
      const { error } = await client.rpc('save_match_verdict', {
        p_fixture: fixtureId,
        p_verdict: verdict,
      });
      return error ? fail(error.message) : ok(null);
    },
  };
}

function createFogisApi(client: SupabaseClient) {
  return {
    // Anropar Edge Function fogis-api. Returnerar FOGIS rå-JSON (okänd form tills live-verifierad).
    async games(teamId: string, from: string, to: string, clubId?: string): Promise<Result<unknown>> {
      const { data, error } = await client.functions.invoke('fogis-api', {
        body: { teamId, op: 'games', from, to, ...(clubId ? { clubId } : {}) },
      });
      return error ? fail(error.message) : ok(data);
    },
    async saveSeries(teamId: string, series: unknown[]): Promise<Result<unknown>> {
      const { data, error } = await client.rpc('save_series', { p_team: teamId, p_series: series });
      return error ? fail(error.message) : ok(data);
    },
    async importGames(teamId: string, inserts: unknown[], updates: unknown[]): Promise<Result<unknown>> {
      const { data, error } = await client.rpc('import_fogis_games', {
        p_team: teamId,
        p_inserts: inserts,
        p_updates: updates,
      });
      return error ? fail(error.message) : ok(data);
    },
  };
}

function createFederationApi(client: SupabaseClient) {
  return {
    async overview(): Promise<Result<Overview>> {
      const { data, error } = await client.rpc('evenness_overview');
      if (error) return fail(error.message);
      const d = (data ?? {}) as Partial<Overview>;
      return ok({
        series: d.series ?? [],
        teams: d.teams ?? [],
        matches: d.matches ?? [],
      });
    },
  };
}
