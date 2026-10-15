// Ren logik för matchupplevelse-rapportering. Ingen DOM, ingen Supabase – testbar.

import type { Fixture, Verdict } from './types.ts';

/** En match är spelad när avsparkstiden passerat (serierna har inga resultat att vänta på). */
export function isPlayed(fixture: Fixture, now: Date = new Date()): boolean {
  return new Date(fixture.kickoff).getTime() <= now.getTime();
}

/** Sortera matcher med senaste först. Spelade matcher är de som är rapporterbara. */
export function sortByKickoffDesc(fixtures: Fixture[]): Fixture[] {
  return [...fixtures].sort(
    (a, b) => new Date(b.kickoff).getTime() - new Date(a.kickoff).getTime(),
  );
}

/** Den senast spelade matchen (lyfts fram överst). null om ingen spelats. */
export function latestPlayed(fixtures: Fixture[], now: Date = new Date()): Fixture | null {
  const played = sortByKickoffDesc(fixtures.filter((f) => isPlayed(f, now)));
  return played[0] ?? null;
}

/** De tre stegen på skalan, med symbol och text. Aldrig bara siffror för användaren. */
export type VerdictOption = {
  value: Verdict;
  symbol: string;
  /** Kort etikett, med lagnamnen inkopplade när de finns. */
  label: string;
};

/**
 * Bygger de tre valen för en match, med konkreta lagnamn utsatta så ledaren ser vilket
 * lag "hemma"/"borta" är. Symboler kompletterar alltid texten (tillgänglighet).
 */
export function verdictOptions(fixture: Fixture): VerdictOption[] {
  const home = fixture.home?.trim() || 'Hemmalaget';
  const away = fixture.away?.trim() || 'Bortalaget';
  return [
    { value: 1, symbol: '⬅️🏆', label: `${home} vann stort` },
    { value: 2, symbol: '⚖️', label: 'Jämn match' },
    { value: 3, symbol: '🏆➡️', label: `${away} vann stort` },
  ];
}

/** Text för ett sparat värde (används i listor och sammanfattningar). */
export function verdictText(fixture: Fixture, verdict: Verdict): string {
  return verdictOptions(fixture).find((o) => o.value === verdict)!.label;
}

/** Symbol för ett sparat värde. */
export function verdictSymbol(verdict: Verdict): string {
  return { 1: '⬅️🏆', 2: '⚖️', 3: '🏆➡️' }[verdict];
}

/** Formatterar avspark för visning (sv-SE, datum + tid). */
export function formatKickoff(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('sv-SE', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Kort beskrivning av matchen: motståndare + hemma/borta. */
export function matchTitle(fixture: Fixture): string {
  const home = fixture.home?.trim() || 'Hemmalaget';
  const away = fixture.away?.trim() || 'Bortalaget';
  return `${home} – ${away}`;
}
