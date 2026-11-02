import { Store } from './store';

/* Hash routes, because GitHub Pages has no single-page fallback: a reload on /SwingTrader/#/setups always
   finds index.html. Each page takes an optional setup, which opens its drawer over that page (a Back press closes it):
     #/today             the landing page: what needs a decision this morning
     #/today/AME/long    Today with that setup's drawer open
     #/setups[...]       the board
     #/benchmarks[...]   the same board on the benchmarks list */

export type Page = 'today' | 'setups' | 'benchmarks';
export const PAGES: readonly Page[] = ['today', 'setups', 'benchmarks'];

export interface RowRef {
  sym: string;
  dir: 'long' | 'short';
}

export interface Route {
  page: Page;
  row: RowRef | null;
}

export const DEFAULT_ROUTE: Route = { page: 'today', row: null };

export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const page = PAGES.find(p => p === parts[0]);
  if (!page) return DEFAULT_ROUTE;
  if (parts.length >= 3 && (parts[2] === 'long' || parts[2] === 'short')) {
    try {
      return { page, row: { sym: decodeURIComponent(parts[1]), dir: parts[2] } };
    } catch {
      return { page, row: null };
    }
  }
  return { page, row: null };
}

export function hashFor(r: Route): string {
  return '#/' + r.page + (r.row ? '/' + encodeURIComponent(r.row.sym) + '/' + r.row.dir : '');
}

export const route = new Store<Route>(typeof location === 'undefined' ? DEFAULT_ROUTE : parseHash(location.hash));

const sync = () => route.set(parseHash(location.hash));

if (typeof window !== 'undefined') {
  addEventListener('hashchange', sync);
  addEventListener('popstate', sync);
}

/** Move to a page (a new history entry), or replace the current one. */
export function go(r: Route, opts: { replace?: boolean } = {}): void {
  const h = hashFor(r);
  if (opts.replace) history.replaceState(null, '', h); else history.pushState(r.row ? { drawer: true } : null, '', h);
  route.set(r);
}

/** Close the drawer: step back if it was opened from the board, else replace the address with the board's. */
export function closeRow(): void {
  const cur = route.get();
  if (!cur.row) return;
  if (history.state && (history.state as { drawer?: boolean }).drawer) history.back();
  else go({ page: cur.page, row: null }, { replace: true });
}

/** Normalise an unknown address once at start-up so the tab bar and the address agree. */
export function normaliseAddress(): void {
  if (typeof location === 'undefined') return;
  const want = hashFor(parseHash(location.hash));
  if (location.hash !== want) history.replaceState(null, '', want);
}
