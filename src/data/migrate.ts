import { KEYS } from './keys';
import type { KV } from './overlay';

/* Once, on the first load of a browser that has this site's own keys but not yet their contents: copy what the old watchlist
   page saved under its keys into this site's. After that the two sites no longer share anything, so a save here can never
   overwrite a save there, nor the other way round. The old keys are read here and nowhere else, and never written: the old
   page goes on using them on its own, and what it saves from now on does not reach this site.

   The copy is of the stored text, byte for byte. A key of ours that already has a value is left as it is (nothing is overwritten),
   and a marker records that the copy was done, so a later change to an old key, or a key of ours that was cleared on purpose,
   does not bring old values back. If the browser refuses a write the marker is not set, and the next load tries again. */

/** What the old page used, and where each value now lives. The last two are this site's own section memory, whose names
    were built from the old overlay keys. */
export const LEGACY: readonly { from: string; to: string; what: string }[] = [
  { from: 'macro-compass-watch-overlay-v2', to: KEYS.overlay.watchlist, what: 'saved edits to the watchlist' },
  { from: 'macro-compass-benchmarks-overlay-v1', to: KEYS.overlay.benchmarks, what: 'saved edits to the benchmarks' },
  { from: 'macro-compass-tradelog-v1', to: KEYS.journal, what: 'the trade journal' },
  { from: 'mc-seg-macro-compass-watch-overlay-v2', to: 'mc-seg-' + KEYS.overlay.watchlist, what: 'the section last open on Setups' },
  { from: 'mc-seg-macro-compass-benchmarks-overlay-v1', to: 'mc-seg-' + KEYS.overlay.benchmarks, what: 'the section last open on Benchmarks' },
];

export interface Migration {
  /** False when there was nothing to do: already done, or no storage. */
  ran: boolean;
  /** The old keys whose values were copied. */
  copied: string[];
  /** The old keys that had no value, or whose new key already had one. */
  left: string[];
  /** The browser refused a write: the marker is not set, and the next load tries again. */
  failed: boolean;
}

const read = (kv: KV, key: string): string | null => {
  try { return kv.getItem(key); } catch { return null; }
};

export function migrateLegacyKeys(kv: KV | null, now: Date = new Date()): Migration {
  const none: Migration = { ran: false, copied: [], left: [], failed: false };
  if (!kv || read(kv, KEYS.migrated) != null) return none;
  const out: Migration = { ran: true, copied: [], left: [], failed: false };
  for (const { from, to } of LEGACY) {
    const value = read(kv, from);
    if (value == null || read(kv, to) != null) { out.left.push(from); continue; }
    try {
      kv.setItem(to, value);
      out.copied.push(from);
    } catch {
      out.failed = true;
    }
  }
  if (!out.failed) {
    try { kv.setItem(KEYS.migrated, JSON.stringify({ at: now.toISOString(), copied: out.copied })); } catch { out.failed = true; }
  }
  return out;
}
