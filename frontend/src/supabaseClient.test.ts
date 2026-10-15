import { describe, it, expect } from 'vitest';
import { readConfig, hasConfig } from './supabaseClient.ts';

describe('readConfig', () => {
  it('läser URL och anon-nyckel ur den angivna miljön', () => {
    const cfg = readConfig({
      VITE_SUPABASE_URL: 'http://127.0.0.1:54421',
      VITE_SUPABASE_ANON_KEY: 'abc',
    } as ImportMetaEnv);
    expect(cfg.url).toBe('http://127.0.0.1:54421');
    expect(cfg.anonKey).toBe('abc');
  });

  it('ger tomma strängar när inget är satt', () => {
    const cfg = readConfig({} as ImportMetaEnv);
    expect(cfg.url).toBe('');
    expect(cfg.anonKey).toBe('');
  });
});

describe('hasConfig', () => {
  it('är true bara när både URL och nyckel finns', () => {
    expect(hasConfig({ url: 'http://x', anonKey: 'k' })).toBe(true);
    expect(hasConfig({ url: '', anonKey: 'k' })).toBe(false);
    expect(hasConfig({ url: 'http://x', anonKey: '' })).toBe(false);
    expect(hasConfig({ url: '   ', anonKey: 'k' })).toBe(false);
  });
});
