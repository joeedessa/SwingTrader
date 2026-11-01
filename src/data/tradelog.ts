import type { KV } from './overlay';

/* The trade journal's storage, read here only so Export can include it. The journal itself (the form, the pairing
   of fills, the stats) is ported with History in a later phase; until then this keeps the format the old page
   wrote, untouched, so nothing a fill was recorded with is lost. */

export const LOG_KEY = 'macro-compass-tradelog-v1';

export interface Fill {
  id: string;
  sym: string;
  side: string;
  date: string;
  price: number;
  logged_at?: string;
  [key: string]: unknown;
}

export interface LogOverlay {
  added: Fill[];
  over: Record<string, Fill>;
  deleted: string[];
}

export function readLogOverlay(storage: KV | null): LogOverlay {
  const empty: LogOverlay = { added: [], over: {}, deleted: [] };
  try {
    const raw = storage && storage.getItem(LOG_KEY);
    if (!raw) return empty;
    const j = JSON.parse(raw) as Partial<LogOverlay> | null;
    if (!j || typeof j !== 'object') return empty;
    return {
      added: Array.isArray(j.added) ? j.added : [],
      over: j.over && typeof j.over === 'object' && !Array.isArray(j.over) ? j.over : {},
      deleted: Array.isArray(j.deleted) ? j.deleted : [],
    };
  } catch {
    return empty;
  }
}

/** Shared fills (minus deleted, with local edits applied) plus the ones added in this browser, oldest first. */
export function logRows(shared: Fill[], ov: LogOverlay): Fill[] {
  const rows: Fill[] = [];
  for (const f of shared) if (!ov.deleted.includes(f.id)) rows.push({ ...f, ...(ov.over[f.id] || {}) });
  for (const f of ov.added) if (!ov.deleted.includes(f.id)) rows.push({ ...f });
  return rows.sort((a, b) => (a.date + (a.logged_at || '')).localeCompare(b.date + (b.logged_at || '')));
}
