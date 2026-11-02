import type { Acks } from '../engine/flags';
import { Store } from '../store';
import { localKV } from './kv';
import type { KV, SetId } from './overlay';

/* Acknowledgements: which flags this browser has been told about. A flag's id (sym|dir|kind|when) maps to the moment
   it was acknowledged. They live in this browser's localStorage and nowhere else (the site has no server), one set per
   list, so the phone and the desktop each acknowledge on their own; Export and Import carry them across.

   They are not part of the setups overlay: that file's shape belongs to the old page too, and an acknowledgement is a
   fact about this browser's attention, not about a setup. */

export const ACK_KEYS: Record<SetId, string> = { watchlist: 'st-acks-v1', benchmarks: 'st-acks-benchmarks-v1' };

/** An acknowledgement this old is forgotten on the next read: the flag it was for left Today weeks before. */
export const ACK_KEEP_MS = 90 * 864e5;

/** Whatever was stored, as a clean map: ids to a positive time. Anything else is dropped. */
export function parseAcks(raw: unknown): Acks {
  const out: Acks = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [id, t] of Object.entries(raw as Record<string, unknown>)) {
    if (id && typeof t === 'number' && Number.isFinite(t) && t > 0) out[id] = t;
  }
  return out;
}

export function pruneAcks(acks: Acks, now: number): Acks {
  const out: Acks = {};
  for (const [id, t] of Object.entries(acks)) if (now - t <= ACK_KEEP_MS) out[id] = t;
  return out;
}

export function readAcks(storage: KV | null, key: string, now: number = Date.now()): Acks {
  try {
    const raw = storage && storage.getItem(key);
    return raw ? pruneAcks(parseAcks(JSON.parse(raw)), now) : {};
  } catch {
    return {};
  }
}

/** Returns false when storage refused the write, so the page can say the acknowledgement will not survive a reload. */
export function writeAcks(storage: KV | null, key: string, acks: Acks): boolean {
  try {
    if (!storage) return false;
    storage.setItem(key, JSON.stringify(acks));
    return true;
  } catch {
    return false;
  }
}

export const addAcks = (acks: Acks, ids: readonly string[], now: number): Acks => {
  const out = { ...acks };
  for (const id of ids) out[id] = now;
  return out;
};

export const removeAcks = (acks: Acks, ids: readonly string[]): Acks => {
  const out = { ...acks };
  for (const id of ids) delete out[id];
  return out;
};

/** Both sets; where both know an id, the later acknowledgement stands. */
export function mergeAcks(a: Acks, b: Acks): Acks {
  const out = { ...a };
  for (const [id, t] of Object.entries(b)) if (!(id in out) || t > out[id]) out[id] = t;
  return out;
}

/* ------------------------------------------------------------------ the store */

export interface AckState {
  acks: Record<SetId, Acks>;
  /** The browser refused to save the last acknowledgement. */
  saveFailed: boolean;
}

export const ackStore = new Store<AckState>({
  acks: {
    watchlist: readAcks(localKV(), ACK_KEYS.watchlist),
    benchmarks: readAcks(localKV(), ACK_KEYS.benchmarks),
  },
  saveFailed: false,
});

/** A change is applied to what this browser has stored now, not to what was stored when the page loaded: another tab may have
    acknowledged something since, and writing the old set back would erase it. Where the last write failed, or there is no
    storage, what is in memory is all there is. */
function update(set: SetId, fn: (a: Acks) => Acks): void {
  const s = ackStore.get();
  const kv = localKV();
  const base = kv && !s.saveFailed ? readAcks(kv, ACK_KEYS[set]) : s.acks[set];
  const next = fn(base);
  const saved = writeAcks(kv, ACK_KEYS[set], next);
  ackStore.set({ acks: { ...s.acks, [set]: next }, saveFailed: !saved });
}

/** Take in what another tab acknowledged since this page last looked. Identical sets leave the store alone. */
export function reloadAcks(): void {
  const kv = localKV();
  const s = ackStore.get();
  if (!kv || s.saveFailed) return;
  const next = { watchlist: readAcks(kv, ACK_KEYS.watchlist), benchmarks: readAcks(kv, ACK_KEYS.benchmarks) };
  if (JSON.stringify(next) !== JSON.stringify(s.acks)) ackStore.set({ acks: next });
}

export const acknowledge = (set: SetId, ids: readonly string[], now: number = Date.now()): void =>
  update(set, a => addAcks(a, ids, now));

export const unacknowledge = (set: SetId, ids: readonly string[]): void =>
  update(set, a => removeAcks(a, ids));

/** Merge an exported set in. Returns how many acknowledgements were new here. */
export function importAcks(set: SetId, raw: unknown): number {
  const incoming = parseAcks(raw);
  const before = ackStore.get().acks[set];
  const fresh = Object.keys(incoming).filter(id => !(id in before)).length;
  update(set, a => mergeAcks(a, incoming));
  return fresh;
}
