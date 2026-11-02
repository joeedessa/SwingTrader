import type { KV } from './overlay';

/* localStorage that is allowed to be missing: private mode and blocked storage read as no storage at all, and every
   reader and writer built on it treats that as empty rather than throwing. */

let stand: KV | null | undefined;

/** A test gives the data layer a storage of its own (a Map behind getItem and setItem, or none); `undefined` goes back to the browser's. */
export function useStorageForTests(kv: KV | null | undefined): void {
  stand = kv;
}

export function localKV(): KV | null {
  if (stand !== undefined) return stand;
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}
