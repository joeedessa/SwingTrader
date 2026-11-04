import { Store } from './store';

/* Hash routes, because GitHub Pages has no single-page fallback: a reload on /SwingTrader/#/setups always
   finds index.html. Each page takes an optional setup, which opens its drawer over that page (a Back press closes it):
     #/today             the landing page: what needs a decision this morning
     #/today/AME/long    Today with that setup's drawer open
     #/setups[...]       the board
     #/positions[...]    the stop ladder: what is in trade, and where it gets out
     #/history[...]      outcomes, and the trade journal
     #/model[...]?...    the backtest: what to play and how much; its settings follow as a query, so a scenario is a link
     #/signals[...]      moving averages, crosses, and the day against the index and the sector
     #/benchmarks[...]   the same board on the benchmarks list
     #/method            the rules, where the data comes from, how fresh it is
     #/more              the pages that do not fit the tab bar (a phone's last tab) */

export type Page = 'today' | 'setups' | 'positions' | 'history' | 'model' | 'signals' | 'benchmarks' | 'method' | 'more';
export const PAGES: readonly Page[] = ['today', 'setups', 'positions', 'history', 'model', 'signals', 'benchmarks', 'method', 'more'];

/** The pages a setup's drawer can open over. */
export const ROW_PAGES: readonly Page[] = ['today', 'setups', 'positions', 'history', 'model', 'signals', 'benchmarks'];

export interface RowRef {
  sym: string;
  dir: 'long' | 'short';
}

export interface Route {
  page: Page;
  row: RowRef | null;
  /** What follows a "?" in the address: a page's own settings (the Model's dials), kept as it was written; absent when none. */
  query?: string;
}

export const DEFAULT_ROUTE: Route = { page: 'today', row: null };

export function parseHash(hash: string): Route {
  const at = hash.indexOf('?');
  const query = at >= 0 ? hash.slice(at + 1) : '';
  const parts = (at >= 0 ? hash.slice(0, at) : hash).replace(/^#\/?/, '').split('/').filter(Boolean);
  const page = PAGES.find(p => p === parts[0]);
  if (!page) return DEFAULT_ROUTE;
  const q = query ? { query } : {};
  if (ROW_PAGES.includes(page) && parts.length >= 3 && (parts[2] === 'long' || parts[2] === 'short')) {
    try {
      return { page, row: { sym: decodeURIComponent(parts[1]), dir: parts[2] }, ...q };
    } catch {
      return { page, row: null, ...q };
    }
  }
  return { page, row: null, ...q };
}

export function hashFor(r: Route): string {
  return '#/' + r.page + (r.row ? '/' + encodeURIComponent(r.row.sym) + '/' + r.row.dir : '') + (r.query ? '?' + r.query : '');
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
  else go({ page: cur.page, row: null, ...(cur.query ? { query: cur.query } : {}) }, { replace: true });
}

/** Rewrite the current page's settings in the address without a new history entry. */
export function setQuery(query: string): void {
  const cur = route.get();
  if ((cur.query ?? '') === query) return;
  go({ page: cur.page, row: cur.row, ...(query ? { query } : {}) }, { replace: true });
}

/** Normalise an unknown address once at start-up so the tab bar and the address agree. */
export function normaliseAddress(): void {
  if (typeof location === 'undefined') return;
  const want = hashFor(parseHash(location.hash));
  if (location.hash !== want) history.replaceState(null, '', want);
}
