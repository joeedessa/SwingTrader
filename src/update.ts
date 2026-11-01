import type { KV } from './data/overlay';

/* Stay current when the page is reopened rather than reloaded.

   Added to the Home Screen the site runs as a standalone app: no address bar, no pull-to-refresh, and iOS keeps
   its pages alive for days, so a new version can go unseen for a week. A Safari tab restored from the
   back-forward cache does the same, more briefly.

   So on returning to the page, fetch index.html again past every cache and compare the code it points at.
   Build output is content-hashed, so a new deployment means new script and stylesheet names; if the fresh page
   names one this page is not running, a newer version is live and the page reloads. At most one reload every
   ten minutes, so a CDN edge serving the old copy cannot loop it, and at most one check every two minutes. */

export const CHECK_EVERY_MS = 2 * 60 * 1000;
export const RELOAD_GUARD_MS = 10 * 60 * 1000;
export const GUARD_KEY = 'st-reloaded';

/** The scripts and stylesheets an HTML document points at, as `js:<url>` and `css:<url>`, sorted. */
export function assetsOf(html: string): string[] {
  const out = new Set<string>();
  const attr = (tag: string, name: string): string | null => {
    const m = new RegExp('\\s' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i').exec(tag);
    return m ? (m[1] ?? m[2] ?? m[3]) : null;
  };
  for (const m of html.matchAll(/<(script|link)\b[^>]*>/gi)) {
    const tag = m[0];
    if (m[1].toLowerCase() === 'script') {
      const src = attr(tag, 'src');
      if (src) out.add('js:' + src);
    } else if (/\brel\s*=\s*["']?[^"'>]*\bstylesheet\b/i.test(tag)) {
      const href = attr(tag, 'href');
      if (href) out.add('css:' + href);
    }
  }
  return [...out].sort();
}

/** The same list for the document that is running. */
export function runningAssets(doc: Document): string[] {
  const out = new Set<string>();
  doc.querySelectorAll('script[src]').forEach(n => out.add('js:' + n.getAttribute('src')));
  doc.querySelectorAll('link[rel~="stylesheet"][href]').forEach(n => out.add('css:' + n.getAttribute('href')));
  return [...out].sort();
}

/** A newer version is live when the fresh page names code this page is not running. */
export const isStale = (running: string[], fresh: string[]): boolean => {
  const mine = new Set(running);
  return fresh.some(a => !mine.has(a));
};

export type UpdateResult = 'current' | 'throttled' | 'reloading' | 'guarded' | 'offline';

export interface UpdateDeps {
  fetchHtml: () => Promise<string | null>;
  running: () => string[];
  now: () => number;
  session: KV;
  reload: () => void;
}

export interface UpdateState {
  /** When the last check started, ms. */
  last: number;
}

export async function checkForUpdate(deps: UpdateDeps, state: UpdateState, force = false): Promise<UpdateResult> {
  const now = deps.now();
  if (!force && now - state.last < CHECK_EVERY_MS) return 'throttled';
  state.last = now;
  try {
    const html = await deps.fetchHtml();
    if (html == null) return 'offline';
    if (!isStale(deps.running(), assetsOf(html))) return 'current';
    let prev = 0;
    try { prev = +(deps.session.getItem(GUARD_KEY) || 0); } catch { /* private mode */ }
    if (now - prev < RELOAD_GUARD_MS) return 'guarded';
    try { deps.session.setItem(GUARD_KEY, String(now)); } catch { /* private mode */ }
    deps.reload();
    return 'reloading';
  } catch {
    return 'offline';          // offline: keep what we have
  }
}

/** Wire the check to the moments a page comes back: a restored page, a tab brought forward, and shortly after load. */
export function startSelfUpdate(): void {
  if (import.meta.env.DEV) return;
  const state: UpdateState = { last: 0 };
  const deps: UpdateDeps = {
    fetchHtml: async () => {
      const r = await fetch(import.meta.env.BASE_URL, { cache: 'no-store' });
      return r.ok ? r.text() : null;
    },
    running: () => runningAssets(document),
    now: Date.now,
    session: (() => { try { return sessionStorage; } catch { return { getItem: () => null, setItem: () => {} }; } })(),
    reload: () => location.reload(),
  };
  addEventListener('pageshow', e => { if (e.persisted) void checkForUpdate(deps, state, true); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void checkForUpdate(deps, state); });
  setTimeout(() => void checkForUpdate(deps, state), 4000);
}
