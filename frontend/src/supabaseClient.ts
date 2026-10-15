import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Läser Supabase-konfigurationen ur miljön. Inget hårdkodas: både URL och den publika
 * anon-nyckeln kommer från Vites miljövariabler (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).
 * Service-nyckeln finns aldrig i frontend.
 */
export type SupabaseConfig = {
  url: string;
  anonKey: string;
};

export function readConfig(env: ImportMetaEnv = import.meta.env): SupabaseConfig {
  const url = env.VITE_SUPABASE_URL ?? '';
  const anonKey = env.VITE_SUPABASE_ANON_KEY ?? '';
  return { url, anonKey };
}

/** True om både URL och nyckel är satta (annars kan ingen klient skapas). */
export function hasConfig(cfg: SupabaseConfig): boolean {
  return cfg.url.trim() !== '' && cfg.anonKey.trim() !== '';
}

let client: SupabaseClient | null = null;

/** Skapar (och återanvänder) Supabase-klienten. Kastar om konfigurationen saknas. */
export function getClient(): SupabaseClient {
  if (client) return client;
  const cfg = readConfig();
  if (!hasConfig(cfg)) {
    throw new Error(
      'Supabase-konfiguration saknas. Skapa frontend/.env.local från .env.example och fyll i VITE_SUPABASE_URL och VITE_SUPABASE_ANON_KEY.',
    );
  }
  client = createClient(cfg.url, cfg.anonKey, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
  return client;
}
