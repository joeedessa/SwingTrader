/* The keys this site writes in the browser's storage. They are its own: until revision 6 it shared three of them with the old
   watchlist page (same origin, same keys), so a save on one site could overwrite a save on the other. migrate.ts copies what
   the old keys hold into these, once, and never writes an old key again. */

export const KEYS = {
  /** The saved edits to the watchlist and to the benchmarks: added setups, level overrides, manual moves. */
  overlay: { watchlist: 'st-overlay-v1', benchmarks: 'st-overlay-benchmarks-v1' },
  /** The trade journal's fills added, edited and deleted in this browser. */
  journal: 'st-journal-v1',
  /** Set once the old values have been copied (or there were none). */
  migrated: 'st-migrated-v1',
} as const;
