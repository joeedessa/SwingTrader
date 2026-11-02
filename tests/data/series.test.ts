import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app, load, loadSeries, wantedSymbols } from '../../src/data/app';
import { emptyOverlay } from '../../src/data/overlay';
import { parseSeries } from '../../src/data/schema';

/* series.json, the weekly and monthly closes only the Signals page reads: what is accepted from it, when it is fetched, and
   the index symbols the live upgrade asks for so a name's day can be set against its index's. */

const live = () => JSON.parse(readFileSync(new URL('../../public/data/series.json', import.meta.url), 'utf8'));
const entry = (n: number, ccy: unknown = 'USD') => ({ ccy, t: Array.from({ length: n }, (_, i) => 1.7e9 + i * 604800), c: Array.from({ length: n }, (_, i) => 100 + i) });

describe('parseSeries', () => {
  it('accepts every symbol of the live file, whole', () => {
    const { file, problems } = parseSeries(live());
    expect(problems).toEqual([]);
    expect(file).not.toBeNull();
    const j = live();
    expect(Object.keys(file!.weekly)).toEqual(Object.keys(j.weekly));
    expect(Object.keys(file!.monthly)).toEqual(Object.keys(j.monthly));
    expect(file!.generated_at).toBe(j.generated_at);
    for (const tf of ['weekly', 'monthly'] as const) {
      for (const [sym, e] of Object.entries(file![tf])) {
        expect(e.t.length, `${tf} ${sym}`).toBe(e.c.length);
        expect(e.c.every(Number.isFinite), `${tf} ${sym}`).toBe(true);
      }
    }
  });

  it('keeps the currency, or none', () => {
    const { file } = parseSeries({ generated_at: 'g', weekly: { A: entry(3, 'USD'), B: entry(3, 7) }, monthly: {} });
    expect(file!.weekly.A.ccy).toBe('USD');
    expect(file!.weekly.B.ccy).toBeNull();
  });

  it('leaves out a symbol whose stamps and closes do not match, or are not numbers, and says which', () => {
    const bad = { ccy: 'USD', t: [1, 2, 3], c: [1, 2] };
    const nan = { ccy: 'USD', t: [1, 2], c: [1, null] };
    const text = { ccy: 'USD', t: [1, 2], c: [1, '2'] };
    const { file, problems } = parseSeries({ generated_at: 'g', weekly: { OK: entry(2), BAD: bad, NAN: nan, TXT: text }, monthly: { OK: entry(2) } });
    expect(Object.keys(file!.weekly)).toEqual(['OK']);
    expect(problems).toHaveLength(3);
    expect(problems.join('\n')).toContain('weekly BAD');
    expect(problems.join('\n')).toContain('weekly NAN');
    expect(problems.join('\n')).toContain('weekly TXT');
  });

  it('is no file at all, with the reason, for anything that is not one', () => {
    for (const x of [null, undefined, 5, 'text', [], {}, { generated_at: 'g' }]) {
      const r = parseSeries(x);
      expect(r.file, JSON.stringify(x)).toBeNull();
      expect(r.problems.length).toBeGreaterThan(0);
    }
  });

  it('takes one timeframe without the other, and says the other is missing', () => {
    const r = parseSeries({ generated_at: 'g', weekly: { A: entry(2) } });
    expect(Object.keys(r.file!.weekly)).toEqual(['A']);
    expect(r.file!.monthly).toEqual({});
    expect(r.problems).toEqual(['series.json: monthly is missing']);
    expect(parseSeries({ generated_at: 'g', monthly: { A: entry(2) } }).problems).toEqual(['series.json: weekly is missing']);
    const bad = parseSeries({ generated_at: 'g', weekly: [1, 2], monthly: { A: entry(2) } });
    expect(bad.file!.weekly).toEqual({});
    expect(bad.problems.join('\n')).toContain('weekly is not a map');
  });

  it('has no stamp, rather than an invented one, when the file gives none', () => {
    expect(parseSeries({ weekly: {}, monthly: {} }).file!.generated_at).toBe('');
  });
});

describe('loadSeries', () => {
  const reply = (body: unknown, ok = true) => vi.fn(async (_url: string, _init?: unknown) => ({ ok, status: ok ? 200 : 503, json: async () => body }));
  beforeEach(() => { app.set({ series: null, seriesStatus: 'idle' }); });
  afterEach(() => { vi.unstubAllGlobals(); app.set({ series: null, seriesStatus: 'idle' }); });

  const good = { generated_at: '2026-11-01T17:03:51Z', weekly: { A: entry(3) }, monthly: { A: entry(3) } };

  it('fetches series.json, once, and keeps what it holds', async () => {
    const fetch = reply(good);
    vi.stubGlobal('fetch', fetch);
    const p = loadSeries();
    expect(app.get().seriesStatus).toBe('loading');
    await p;
    expect(app.get().seriesStatus).toBe('ok');
    expect(app.get().series!.generated_at).toBe('2026-11-01T17:03:51Z');
    expect(Object.keys(app.get().series!.weekly)).toEqual(['A']);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0][0])).toContain('data/series.json');
  });

  it('notes when it was fetched, and what in the file could not be read', async () => {
    vi.stubGlobal('fetch', reply({ ...good, weekly: { ...good.weekly, BAD: { ccy: 'USD', t: [1, 2], c: [1] } } }));
    const before = Date.now();
    await loadSeries();
    expect(app.get().seriesAt).toBeGreaterThanOrEqual(before);
    expect(Object.keys(app.get().series!.weekly)).toEqual(['A']);
    expect(app.get().seriesProblems).toHaveLength(1);
    expect(app.get().seriesProblems[0]).toContain('weekly BAD');
    vi.stubGlobal('fetch', reply(good));
    await loadSeries(true);
    expect(app.get().seriesProblems).toEqual([]);
  });

  it('does not fetch it again once it has it, and asks for it again when told to', async () => {
    const fetch = reply(good);
    vi.stubGlobal('fetch', fetch);
    await loadSeries();
    await loadSeries();
    expect(fetch).toHaveBeenCalledTimes(1);
    await loadSeries(true);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('shares one request between two askers at the same time', async () => {
    const fetch = reply(good);
    vi.stubGlobal('fetch', fetch);
    await Promise.all([loadSeries(), loadSeries(), loadSeries(true)]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('says it failed, and has no series, when the request is refused or the file is not one', async () => {
    vi.stubGlobal('fetch', reply({}, false));
    await loadSeries();
    expect(app.get()).toMatchObject({ seriesStatus: 'failed', series: null });
    vi.stubGlobal('fetch', reply('nonsense'));
    await loadSeries();
    expect(app.get()).toMatchObject({ seriesStatus: 'failed', series: null });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    await loadSeries();
    expect(app.get()).toMatchObject({ seriesStatus: 'failed', series: null });
  });

  it('keeps what it had when a later refresh fails, and still says it is ok', async () => {
    vi.stubGlobal('fetch', reply(good));
    await loadSeries();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    await loadSeries(true);
    expect(app.get().seriesStatus).toBe('ok');
    expect(app.get().series!.generated_at).toBe('2026-11-01T17:03:51Z');
    vi.stubGlobal('fetch', reply({}, false));
    await loadSeries(true);
    expect(app.get().series).not.toBeNull();
    expect(app.get().seriesStatus).toBe('ok');
  });

  it('can be tried again after it failed', async () => {
    vi.stubGlobal('fetch', reply({}, false));
    await loadSeries();
    expect(app.get().seriesStatus).toBe('failed');
    vi.stubGlobal('fetch', reply(good));
    await loadSeries();
    expect(app.get().seriesStatus).toBe('ok');
  });
});

describe('the symbols the live upgrade asks for', () => {
  const row = (sym: string, country?: string) => ({ sym, dir: 'long' as const, ...(country ? { country } : {}) });
  const before = app.get();
  afterEach(() => { app.set({ shared: before.shared, overlays: before.overlays }); });

  it('are the list\'s symbols, then the local index of each country on it, each once', () => {
    app.set({
      shared: { watchlist: [row('A', 'US'), row('B', 'US'), row('C', 'Japan'), row('D', 'Atlantis'), row('E')], benchmarks: [row('F', 'Japan')] },
      overlays: { watchlist: emptyOverlay(), benchmarks: emptyOverlay() },
    });
    expect(wantedSymbols()).toEqual(['A', 'B', 'C', 'D', 'E', 'F', '^GSPC', '^N225']);
  });

  it('do not name an index twice when it is itself on a list', () => {
    app.set({
      shared: { watchlist: [row('A', 'US')], benchmarks: [row('^GSPC')] },
      overlays: { watchlist: emptyOverlay(), benchmarks: emptyOverlay() },
    });
    const w = wantedSymbols();
    expect(w.filter(x => x === '^GSPC')).toHaveLength(1);
  });

  it('have no index for a country the map does not know, such as the UAE', () => {
    app.set({ shared: { watchlist: [row('A', 'UAE')], benchmarks: [] }, overlays: { watchlist: emptyOverlay(), benchmarks: emptyOverlay() } });
    expect(wantedSymbols()).toEqual(['A']);
  });
});

describe('a refresh, and the weekly and monthly bars', () => {
  const good = { generated_at: '2026-11-01T17:03:51Z', weekly: { A: entry(3) }, monthly: { A: entry(3) } };
  const files: Record<string, unknown> = {
    'watchlist.json': [], 'benchmarks.json': [], 'watch-events.json': { symbols: {} }, 'tradelog.json': [],
    'bars.json': { generated_at: 'g', ccy: {}, bars: {} }, 'prices-latest.json': { generated_at: 'g', sessions: [], latest: {} },
    'series.json': good,
  };
  const asked = (fetch: ReturnType<typeof vi.fn>) => fetch.mock.calls.map(c => String(c[0])).filter(u => u.includes('series.json')).length;
  const network = () => vi.fn(async (url: string) => {
    const name = Object.keys(files).find(n => url.includes('data/' + n));
    return { ok: !!name, status: name ? 200 : 404, json: async () => files[name as string] };
  });
  beforeEach(() => { app.set({ series: null, seriesStatus: 'idle', seriesAt: null, seriesProblems: [] }); });
  afterEach(() => { vi.unstubAllGlobals(); app.set({ series: null, seriesStatus: 'idle', seriesAt: null, seriesProblems: [] }); });

  const withSeries = (ageMs: number) => app.set({ series: parseSeries(good).file, seriesStatus: 'ok', seriesAt: Date.now() - ageMs });

  it('does not fetch the 1.7 MB file for a page that never asked for it', async () => {
    const fetch = network();
    vi.stubGlobal('fetch', fetch);
    await load();
    expect(asked(fetch)).toBe(0);
    expect(app.get().seriesStatus).toBe('idle');
  });

  it('leaves a copy alone that is only minutes old: the job rewrites the file about once a day', async () => {
    withSeries(5 * 60 * 1000);
    const fetch = network();
    vi.stubGlobal('fetch', fetch);
    await load();
    expect(asked(fetch)).toBe(0);
  });

  it('fetches it again, once, when the copy is more than half an hour old', async () => {
    withSeries(31 * 60 * 1000);
    const fetch = network();
    vi.stubGlobal('fetch', fetch);
    await load();
    expect(asked(fetch)).toBe(1);
    await vi.waitFor(() => expect(Date.now() - (app.get().seriesAt as number)).toBeLessThan(5000));
  });

  it('tries again after a failure, because a refresh is what a person presses when something did not load', async () => {
    app.set({ series: null, seriesStatus: 'failed' });
    const fetch = network();
    vi.stubGlobal('fetch', fetch);
    await load();
    expect(asked(fetch)).toBe(1);
    await vi.waitFor(() => expect(app.get().seriesStatus).toBe('ok'));
  });

  it('does not start a second request while the first is on its way, as on a cold landing on Signals', async () => {
    const fetch = network();
    vi.stubGlobal('fetch', fetch);
    const first = loadSeries();
    app.set({ seriesStatus: 'loading' });
    await load();
    await first;
    expect(asked(fetch)).toBe(1);
  });
});
