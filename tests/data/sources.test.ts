import { describe, expect, it } from 'vitest';
import { fetchBarsFor, fetchLive, mergeLive, parseChart, parseSpark, viaProxy, WORKER_URL } from '../../src/data/sources';
import type { Fetch } from '../../src/data/sources';
import { historyOf } from '../../src/engine/bars';
import type { BarsFile, LatestFile } from '../../src/engine/bars';

const S = (iso: string) => Date.parse(iso) / 1000;
const T = (iso: string) => Date.parse(iso);

/** The shape the Worker returned for three symbols on Sunday 2026-11-01 (meta fields only, as the code reads them). */
const SPARK = {
  spark: {
    result: [
      { symbol: 'ICLR', response: [{ meta: { currency: 'USD', exchangeTimezoneName: 'America/New_York', regularMarketPrice: 211.36, previousClose: 215.48,
        regularMarketTime: 1793390401, currentTradingPeriod: { regular: { start: 1793367000, end: 1793390400, gmtoffset: -14400 } } } }] },
      { symbol: 'S32.AX', response: [{ meta: { currency: 'AUD', exchangeTimezoneName: 'Australia/Sydney', regularMarketPrice: 4.34, previousClose: 4.36,
        regularMarketTime: 1793337104, currentTradingPeriod: { regular: { start: 1793574000, end: 1793596320, gmtoffset: 39600 } } } }] },
      { symbol: 'NOPRICE', response: [{ meta: { currency: 'USD' } }] },
      { symbol: 'EMPTY', response: [] },
    ],
  },
};

const ok = (body: unknown): ReturnType<Fetch> => Promise.resolve({ ok: true, status: 200, json: async () => body });

describe('where a request goes', () => {
  it('through the Worker on the live site, whole Yahoo URL encoded', () => {
    const u = viaProxy('/v7/finance/spark?symbols=A,B', { local: false, base: '/SwingTrader/' });
    expect(u).toBe(WORKER_URL + '?url=' + encodeURIComponent('https://query1.finance.yahoo.com/v7/finance/spark?symbols=A,B'));
  });

  it('through the dev server on localhost, under the site\'s base path', () => {
    expect(viaProxy('/v8/finance/chart/7936.T?range=2y&interval=1d', { local: true, base: '/SwingTrader/' }))
      .toBe('/SwingTrader/__yahoo/v8/finance/chart/7936.T?range=2y&interval=1d');
  });
});

describe('parseSpark', () => {
  it('reads price, previous close, time, currency, zone and the session window; skips what has no price', () => {
    const q = parseSpark(SPARK);
    expect(Object.keys(q)).toEqual(['ICLR', 'S32.AX']);
    expect(q['S32.AX']).toEqual({ c: 4.34, p: 4.36, t: 1793337104, ccy: 'AUD', tz: 'Australia/Sydney', start: 1793574000, end: 1793596320 });
  });

  it('survives anything else', () => {
    expect(parseSpark(null)).toEqual({});
    expect(parseSpark({ spark: {} })).toEqual({});
    expect(parseSpark({ spark: { result: [{ symbol: 'X', response: [{ meta: { regularMarketPrice: 'x', regularMarketTime: 1 } }] }] } })).toEqual({});
  });
});

describe('fetchLive', () => {
  const syms = Array.from({ length: 23 }, (_, i) => 'S' + i);

  it('asks ten symbols at a time, once each, however often they are listed', async () => {
    const urls: string[] = [];
    const fetch: Fetch = async url => { urls.push(decodeURIComponent(url)); return { ok: true, status: 200, json: async () => ({ spark: { result: [] } }) }; };
    await fetchLive([...syms, ...syms], { fetch, env: { local: true, base: '/SwingTrader/' } });
    expect(urls).toHaveLength(3);
    expect(urls[0]).toContain('symbols=S0,S1,S2,S3,S4,S5,S6,S7,S8,S9&range=1d&interval=5m');
    expect(urls[2]).toContain('symbols=S20,S21,S22&');
  });

  it('keeps what arrived when one batch fails, and lists every symbol it has no answer for', async () => {
    const fetch: Fetch = async url => {
      if (url.includes('S10')) return { ok: false, status: 503, json: async () => ({}) };
      const wanted = /symbols=([^&]+)/.exec(decodeURIComponent(url))![1].split(',');
      return ok({ spark: { result: wanted.slice(0, 1).map(s => ({ symbol: s, response: [{ meta: { regularMarketPrice: 1, regularMarketTime: 5 } }] })) } });
    };
    const r = await fetchLive(syms, { fetch, env: { local: true, base: '/' }, now: () => 42 });
    expect(Object.keys(r.quotes).sort()).toEqual(['S0', 'S20']);
    expect(r.failed).toHaveLength(21);
    expect(r.failed).toContain('S10');
    expect(r.failed).toContain('S5');       // asked, but the answer did not include it
    expect(r.at).toBe(42);
  });

  it('never throws: a network failure is a failed batch', async () => {
    const fetch: Fetch = async () => { throw new Error('offline'); };
    const r = await fetchLive(['A', 'B'], { fetch, env: { local: true, base: '/' } });
    expect(r.quotes).toEqual({});
    expect(r.failed).toEqual(['A', 'B']);
  });

  it('gives up at the deadline and keeps what it has', async () => {
    const fetch: Fetch = (_u, init) => new Promise((_res, rej) => { init?.signal?.addEventListener('abort', () => rej(new Error('aborted'))); });
    const r = await fetchLive(['A'], { fetch, env: { local: true, base: '/' }, deadlineMs: 20 });
    expect(r.failed).toEqual(['A']);
  });
});

describe('mergeLive', () => {
  const base: LatestFile = {
    generated_at: '2026-11-01T17:38:00Z',
    sessions: [['America/New_York', 570, 960]],
    latest: {
      ICLR: { c: 200, p: 210, t: 1793000000, ccy: 'USD', z: 0 },
      '7936.T': { c: 4838, p: 4613, t: 1793341800, ccy: 'JPY' },
    },
  };

  it('newest wins; an older live answer leaves the snapshot tip alone', () => {
    const live = { quotes: { ICLR: { c: 211.36, p: 215.48, t: 1793390401, ccy: 'USD', tz: 'America/New_York', start: 1793367000, end: 1793390400 },
                             '7936.T': { c: 1, t: 1793000000 } }, failed: [], at: 0 };
    const m = mergeLive(base, live)!;
    expect(m.latest.ICLR).toEqual({ c: 211.36, p: 215.48, t: 1793390401, ccy: 'USD', z: 0 });
    expect(m.latest['7936.T']).toEqual(base.latest['7936.T']);
  });

  it('stores the session as the exchange\'s local hours and shares one row among symbols', () => {
    const live = { quotes: {
      A: { c: 1, t: 1, tz: 'Australia/Sydney', start: 1793574000, end: 1793596320 },
      B: { c: 2, t: 1, tz: 'Australia/Sydney', start: 1793574000, end: 1793596320 },
    }, failed: [], at: 0 };
    const m = mergeLive(base, live)!;
    expect(m.sessions).toEqual([['America/New_York', 570, 960], ['Australia/Sydney', 600, 972]]);
    expect([m.latest.A.z, m.latest.B.z]).toEqual([1, 1]);
    expect(base.sessions).toHaveLength(1);       // the snapshot object is not mutated
  });

  it('returns the snapshot as it is when there is nothing live', () => {
    expect(mergeLive(base, null)).toBe(base);
    expect(mergeLive(base, { quotes: {}, failed: ['A'], at: 0 })).toBe(base);
    expect(mergeLive(null, null)).toBeNull();
  });

  it('works with no snapshot at all', () => {
    const m = mergeLive(null, { quotes: { A: { c: 1, t: 1 } }, failed: [], at: 0 })!;
    expect(m.latest.A).toEqual({ c: 1, t: 1 });
  });

  it('feeds the engine: Sydney open on Monday makes the live price live, not settled', () => {
    const bars: BarsFile = { generated_at: '', ccy: { 'S32.AX': 'AUD' }, bars: { 'S32.AX': { '2026-10-30': [4.3, 4.4, 4.36] } } };
    const live = { quotes: { 'S32.AX': { c: 4.5, p: 4.36, t: S('2026-11-02T00:30:00Z'), tz: 'Australia/Sydney', start: S('2026-11-01T23:00:00Z'), end: S('2026-11-02T05:12:00Z') } }, failed: [], at: 0 };
    const h = historyOf('S32.AX', bars, mergeLive(null, live), T('2026-11-02T00:31:00Z'))!;
    expect(h.settled).toEqual([['2026-10-30', 4.36]]);
    expect(h).toMatchObject({ live: 4.5, liveDate: '2026-11-02' });
    // Once the session is over the same print is the day's settled close.
    const after = historyOf('S32.AX', bars, mergeLive(null, { ...live, quotes: { 'S32.AX': { ...live.quotes['S32.AX'], t: S('2026-11-02T05:12:00Z') } } }), T('2026-11-02T06:00:00Z'))!;
    expect(after.settled).toEqual([['2026-10-30', 4.36], ['2026-11-02', 4.5]]);
  });
});

describe('parseChart', () => {
  // Three Sydney daily bars; stamps are the session open, 10:00 AEDT = 23:00Z the evening before.
  const chart = (last: number, reg?: { start: number; end: number }) => ({ chart: { result: [{
    meta: { currency: 'AUD', exchangeTimezoneName: 'Australia/Sydney', ...(reg ? { currentTradingPeriod: { regular: reg } } : {}) },
    timestamp: [S('2026-10-29T23:00:00Z'), S('2026-10-30T23:00:00Z'), last],
    indicators: { quote: [{ low: [4.2, 4.3, 4.4], high: [4.3, 4.4, 4.6], close: [4.25, 4.35, 4.5] }] },
  }] } });

  it('keys each bar by the exchange\'s own date, so a Sydney Monday is Monday', () => {
    const got = parseChart(chart(S('2026-11-01T23:00:00Z')), T('2026-11-02T08:00:00Z'))!;
    expect(Object.keys(got.bars)).toEqual(['2026-10-30', '2026-10-31', '2026-11-02']);
    expect(got.bars['2026-11-02']).toEqual([4.4, 4.6, 4.5]);
    expect(got.ccy).toBe('AUD');
  });

  it('drops the last bar while its session is still running, keeps it once the session has ended', () => {
    const reg = { start: S('2026-11-01T23:00:00Z'), end: S('2026-11-02T05:12:00Z') };
    expect(Object.keys(parseChart(chart(reg.start, reg), T('2026-11-02T01:00:00Z'))!.bars)).toEqual(['2026-10-30', '2026-10-31']);
    expect(Object.keys(parseChart(chart(reg.start, reg), T('2026-11-02T06:00:00Z'))!.bars)).toHaveLength(3);
    // A market that has not opened yet reports the next session's window: the last bar is not in it.
    const next = { start: S('2026-11-02T23:00:00Z'), end: S('2026-11-03T05:12:00Z') };
    expect(Object.keys(parseChart(chart(reg.start, next), T('2026-11-02T08:00:00Z'))!.bars)).toHaveLength(3);
  });

  it('skips a bar with no low or high, and returns null for an answer with no bars', () => {
    const j = chart(S('2026-11-01T23:00:00Z'));
    (j.chart.result[0].indicators.quote[0].low as (number | null)[])[1] = null;
    expect(Object.keys(parseChart(j, 0)!.bars)).toHaveLength(2);
    expect(parseChart({ chart: { result: [] } }, 0)).toBeNull();
    expect(parseChart(null, 0)).toBeNull();
  });
});

describe('fetchBarsFor', () => {
  it('fetches each symbol once from the chart endpoint and lists the ones that fail', async () => {
    const urls: string[] = [];
    const fetch: Fetch = async url => {
      urls.push(decodeURIComponent(url));
      if (url.includes('BAD')) return { ok: false, status: 404, json: async () => ({}) };
      return ok({ chart: { result: [{ meta: { currency: 'USD', exchangeTimezoneName: 'America/New_York' }, timestamp: [S('2026-10-30T13:30:00Z')],
        indicators: { quote: [{ low: [1], high: [3], close: [2] }] } }] } });
    };
    const r = await fetchBarsFor(['GDX', 'BAD', 'GDX'], { fetch, env: { local: true, base: '/' }, now: () => T('2026-11-01T12:00:00Z') });
    expect(urls.sort()).toEqual(['/__yahoo/v8/finance/chart/BAD?range=2y&interval=1d', '/__yahoo/v8/finance/chart/GDX?range=2y&interval=1d']);
    expect(r.bars).toEqual({ GDX: { '2026-10-30': [1, 3, 2] } });
    expect(r.ccy).toEqual({ GDX: 'USD' });
    expect(r.failed).toEqual(['BAD']);
  });
});
