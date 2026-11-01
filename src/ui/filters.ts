import type { Row } from '../engine/row';

export interface Filters {
  /** Matches the symbol or the name, case-insensitively. */
  q: string;
  dir: 'all' | 'long' | 'short';
  /** Listing countries; empty means all. */
  markets: string[];
}

export const NO_FILTERS: Filters = { q: '', dir: 'all', markets: [] };

export const isFiltered = (f: Filters): boolean => !!f.q.trim() || f.dir !== 'all' || f.markets.length > 0;

export function matches(r: Row, f: Filters): boolean {
  const q = f.q.trim().toLowerCase();
  if (q && !(r.p.sym + ' ' + (r.p.note || '')).toLowerCase().includes(q)) return false;
  if (f.dir !== 'all' && r.p.dir !== f.dir) return false;
  if (f.markets.length && !f.markets.includes(r.p.country || '')) return false;
  return true;
}

/** The countries on the list, with how many setups each has, alphabetically. */
export function marketsOf(rows: Row[]): { name: string; n: number }[] {
  const n = new Map<string, number>();
  for (const r of rows) {
    const c = r.p.country;
    if (c) n.set(c, (n.get(c) || 0) + 1);
  }
  return [...n.entries()].map(([name, k]) => ({ name, n: k })).sort((a, b) => a.name.localeCompare(b.name));
}
