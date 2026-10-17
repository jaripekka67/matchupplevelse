// Edge Function: fogis-api
// Hämtar matcher från FOGIS (Svensk fotbolls förenings-API) åt appen. FOGIS-token ligger som
// hemlighet i Supabase och lämnar ALDRIG servern (används bara i headers mot FOGIS, aldrig i svaret).
// Logiken ligger i handler.ts (testas av Vitest).
//
// Hemlighet (sätts av superadmin, aldrig i repot eller i chatten):
//   supabase secrets set FOGIS_API_KEY=<primary key från FOGIS>
// Deploy (kräver inte Docker):
//   supabase functions deploy fogis-api
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { handleFogis, type FogisDeps } from './handler.ts';

// Bas-URL för FOGIS förenings-API.
const BASE = 'https://forening-api.svenskfotboll.se';

const url = Deno.env.get('SUPABASE_URL') ?? '';
const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const key = Deno.env.get('FOGIS_API_KEY') ?? '';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/** En klient som agerar som anroparen, så att databasens behörighetsregler (RLS) gäller. */
function asCaller(authHeader: string): SupabaseClient {
  return createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Ratelimit per instans (bästa ansträngning, inte garanti). FOGIS egen 429 skickas vidare.
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 50;
let stamps: number[] = [];

const MAX_BYTES = 5_000_000;

const deps: FogisDeps = {
  hasKey: key !== '',

  async caller(authHeader) {
    const token = authHeader.replace(/^Bearer\s+/i, '');
    const { data, error } = await asCaller(authHeader).auth.getUser(token);
    return error || !data.user ? null : { id: data.user.id };
  },

  async mayFetch(authHeader, teamId) {
    // fogis_check kräver inloggad och med i laget, och ger ett fel annars.
    const { error } = await asCaller(authHeader).rpc('fogis_check', { p_team: teamId });
    return !error;
  },

  allow() {
    const now = Date.now();
    stamps = stamps.filter((t) => now - t < WINDOW_MS);
    if (stamps.length >= MAX_PER_WINDOW) return false;
    stamps.push(now);
    return true;
  },

  async fetchUpstream(path) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 15_000);
    try {
      const r = await fetch(`${BASE}${path}`, {
        headers: {
          'Ocp-Apim-Subscription-Key': key,
          ApiKey: key,
          Accept: 'application/json',
        },
        redirect: 'error',
        signal: ctl.signal,
      });
      const text = await r.text();
      if (text.length > MAX_BYTES) return { status: 502, json: null };
      try {
        return { status: r.status, json: JSON.parse(text) as unknown };
      } catch {
        return { status: r.status, json: null };
      }
    } catch {
      return { status: 502, json: null };
    } finally {
      clearTimeout(timer);
    }
  },
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    // Ogiltig JSON ger 400 i handleFogis.
  }
  const result = await handleFogis(
    { method: req.method, authHeader: req.headers.get('Authorization'), body },
    deps,
  );
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
});
