import { describe, expect, it } from 'vitest';
import { assetsOf, checkForUpdate, CHECK_EVERY_MS, GUARD_KEY, isStale, RELOAD_GUARD_MS } from '../src/update';
import type { UpdateDeps, UpdateState } from '../src/update';

const page = (js: string, css: string, extra = '') => `<!doctype html><html><head>
<meta charset="UTF-8" />
<script type="module" crossorigin src="/SwingTrader/assets/${js}.js"></script>
<link rel="modulepreload" crossorigin href="/SwingTrader/assets/vendor-1.js">
<link rel="stylesheet" crossorigin href="/SwingTrader/assets/${css}.css">
<link rel="icon" href="data:image/svg+xml,%3Csvg%3E">${extra}
</head><body><div id="app"></div></body></html>`;

describe('assetsOf', () => {
  it('lists the scripts and stylesheets a built page points at, ignoring preloads and icons', () => {
    expect(assetsOf(page('index-AAA', 'index-BBB'))).toEqual([
      'css:/SwingTrader/assets/index-BBB.css',
      'js:/SwingTrader/assets/index-AAA.js',
    ]);
  });

  it('reads single-quoted and unquoted attributes, and skips inline scripts', () => {
    expect(assetsOf(`<script src='/a.js'></script><script src=/b.js></script><script>var x=1</script><link rel=stylesheet href=/c.css>`))
      .toEqual(['css:/c.css', 'js:/a.js', 'js:/b.js']);
  });

  it('does not take an anchor or a stylesheet-named icon for a stylesheet', () => {
    expect(assetsOf('<link rel="icon" href="/stylesheet.png"><a href="/x.css">x</a>')).toEqual([]);
  });
});

describe('isStale', () => {
  it('is true when the fresh page names code this page is not running, false for the same or fewer files', () => {
    const mine = ['css:/c1.css', 'js:/j1.js'];
    expect(isStale(mine, ['css:/c1.css', 'js:/j1.js'])).toBe(false);
    expect(isStale(mine, ['js:/j1.js'])).toBe(false);
    expect(isStale(mine, ['css:/c1.css', 'js:/j2.js'])).toBe(true);
    expect(isStale([], [])).toBe(false);
  });
});

describe('checkForUpdate', () => {
  const T0 = 1_000_000_000_000;
  const setup = (html: string | null | (() => Promise<string | null>), running = assetsOf(page('index-AAA', 'index-BBB'))) => {
    const store = new Map<string, string>();
    let reloads = 0;
    const deps: UpdateDeps = {
      fetchHtml: typeof html === 'function' ? html : async () => html,
      running: () => running,
      now: () => clock.t,
      session: { getItem: k => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v) },
      reload: () => { reloads++; },
    };
    const clock = { t: T0 };
    const state: UpdateState = { last: 0 };
    return { deps, state, store, clock, reloads: () => reloads };
  };

  it('does nothing when the fresh page runs the same code', async () => {
    const s = setup(page('index-AAA', 'index-BBB'));
    expect(await checkForUpdate(s.deps, s.state)).toBe('current');
    expect(s.reloads()).toBe(0);
  });

  it('reloads when a new build is live, and records when', async () => {
    const s = setup(page('index-NEW', 'index-BBB'));
    expect(await checkForUpdate(s.deps, s.state)).toBe('reloading');
    expect(s.reloads()).toBe(1);
    expect(s.store.get(GUARD_KEY)).toBe(String(T0));
  });

  it('will not reload twice inside ten minutes, even when still stale (a CDN edge serving the old copy cannot loop it)', async () => {
    const s = setup(page('index-NEW', 'index-BBB'));
    await checkForUpdate(s.deps, s.state);
    s.clock.t = T0 + CHECK_EVERY_MS + 1;
    expect(await checkForUpdate(s.deps, s.state)).toBe('guarded');
    expect(s.reloads()).toBe(1);
    s.clock.t = T0 + RELOAD_GUARD_MS + 1;
    expect(await checkForUpdate(s.deps, s.state)).toBe('reloading');
    expect(s.reloads()).toBe(2);
  });

  it('checks at most once every two minutes unless forced (a restored page forces it)', async () => {
    const s = setup(page('index-AAA', 'index-BBB'));
    expect(await checkForUpdate(s.deps, s.state)).toBe('current');
    s.clock.t = T0 + 60_000;
    expect(await checkForUpdate(s.deps, s.state)).toBe('throttled');
    expect(await checkForUpdate(s.deps, s.state, true)).toBe('current');
  });

  it('keeps what it has when offline, or when the answer is an error page', async () => {
    expect(await checkForUpdate(setup(null).deps, { last: 0 })).toBe('offline');
    const s = setup(async () => { throw new Error('network'); });
    expect(await checkForUpdate(s.deps, s.state)).toBe('offline');
    expect(s.reloads()).toBe(0);
  });

  it('reloads even where session storage refuses writes', async () => {
    const s = setup(page('index-NEW', 'index-BBB'));
    s.deps.session = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    expect(await checkForUpdate(s.deps, s.state)).toBe('reloading');
  });
});
