import type { Fill } from '../engine/journal';
import type { KV } from './overlay';

/* The journal's storage, in the old page's own format, unchanged, so a fill logged there is here (same origin, same
   key) and the old page can still read what is written back.

   The shared journal ships in the repo (tradelog.json, committed from an Export); fills added in this browser live in
   localStorage as `added`; an edit to a shared fill is an `over` entry and a delete is a `deleted` id. Export merges them
   all, and committing that file publishes them. The pairing and the statistics are in the engine (journal.ts). */

export const LOG_KEY = 'macro-compass-tradelog-v1';

export type { Fill };

export interface LogOverlay {
  added: Fill[];
  over: Record<string, Fill>;
  deleted: string[];
}

export const emptyLog = (): LogOverlay => ({ added: [], over: {}, deleted: [] });

const isFill = (f: unknown): f is Fill =>
  !!f && typeof f === 'object' && typeof (f as Fill).id === 'string' && typeof (f as Fill).sym === 'string' &&
  typeof (f as Fill).date === 'string' && typeof (f as Fill).price === 'number' && isFinite((f as Fill).price);

export function readLogOverlay(storage: KV | null): LogOverlay {
  try {
    const raw = storage && storage.getItem(LOG_KEY);
    if (!raw) return emptyLog();
    const j = JSON.parse(raw) as Partial<LogOverlay> | null;
    if (!j || typeof j !== 'object') return emptyLog();
    return {
      added: Array.isArray(j.added) ? j.added.filter(isFill) : [],
      over: j.over && typeof j.over === 'object' && !Array.isArray(j.over) ? j.over : {},
      deleted: Array.isArray(j.deleted) ? j.deleted.filter(d => typeof d === 'string') : [],
    };
  } catch {
    return emptyLog();
  }
}

/** Returns false when the browser refused the write, so the page can say the change will not survive a reload. */
export function writeLogOverlay(storage: KV | null, ov: LogOverlay): boolean {
  try {
    if (!storage) return false;
    storage.setItem(LOG_KEY, JSON.stringify(ov));
    return true;
  } catch {
    return false;
  }
}

/** Shared fills (minus deleted, with local edits applied) plus the ones added in this browser, oldest first by the day
    traded and then the moment logged. */
export function logRows(shared: readonly Fill[], ov: LogOverlay): Fill[] {
  const rows: Fill[] = [];
  for (const f of shared) if (!ov.deleted.includes(f.id)) rows.push({ ...f, ...(ov.over[f.id] || {}) });
  // A fill added here and then published (an export committed as tradelog.json) is in both lists: the shared copy is the fill.
  const published = new Set(shared.map(f => f.id));
  for (const f of ov.added) if (!ov.deleted.includes(f.id) && !published.has(f.id)) rows.push({ ...f });
  return rows.sort((a, b) => (a.date + (a.logged_at || '')).localeCompare(b.date + (b.logged_at || '')));
}

export const isSharedFill = (shared: readonly Fill[], id: string): boolean => shared.some(f => f.id === id);

/** A new id: the time in base 36 and four random characters, the old page's form. */
export const newFillId = (now: number = Date.now(), rand: number = Math.random()): string =>
  'f' + now.toString(36) + rand.toString(36).slice(2, 6);

export const addFill = (ov: LogOverlay, fill: Fill): LogOverlay => ({ ...ov, added: [...ov.added, fill] });

/** Editing a shared fill writes an override over it; a local one is replaced where it stands. */
export function saveFill(ov: LogOverlay, shared: readonly Fill[], fill: Fill): LogOverlay {
  return isSharedFill(shared, fill.id)
    ? { ...ov, over: { ...ov.over, [fill.id]: fill } }
    : { ...ov, added: ov.added.map(x => (x.id === fill.id ? fill : x)) };
}

/** A shared fill is hidden by id (the file is not ours to change); a local one is simply dropped. */
export function removeFill(ov: LogOverlay, shared: readonly Fill[], id: string): LogOverlay {
  return isSharedFill(shared, id)
    ? { ...ov, deleted: ov.deleted.includes(id) ? ov.deleted : [...ov.deleted, id] }
    : { ...ov, added: ov.added.filter(x => x.id !== id) };
}

/** Fills from another browser's export, added here unless this journal already has them (the same id, shared or local).
    Anything that is not a fill is skipped; the counts say what happened. */
export function importFills(ov: LogOverlay, shared: readonly Fill[], items: readonly unknown[]): { overlay: LogOverlay; added: number; skipped: number } {
  const have = new Set([...shared.map(f => f.id), ...ov.added.map(f => f.id)]);
  const added: Fill[] = [];
  for (const it of items) {
    if (!isFill(it) || have.has(it.id)) continue;
    have.add(it.id);
    // The export carries a `shared` flag the old page added to each row; it is not part of a fill.
    const { shared: _shared, ...fill } = it as Fill & { shared?: unknown };
    added.push(fill as Fill);
  }
  return { overlay: added.length ? { ...ov, added: [...ov.added, ...added] } : ov, added: added.length, skipped: items.length - added.length };
}
