import { localDate, localMinutes } from '../engine/bars';
import type { LatestFile, SessionHours, Tip } from '../engine/bars';
import type { Bars } from '../engine/types';

/* Prices, in the order they are trusted.

   1. The snapshot: bars.json and prices-latest.json, written by the data jobs and served from this site's
      own origin. The board paints on these alone.
   2. The live upgrade: Yahoo's own answer, fetched in the browser through the Cloudflare Worker (the only
      way past Yahoo's missing CORS header). It replaces a symbol's tip when it is newer, and when it fails,
      for any reason, nothing changes and the page says the snapshot is what it is showing.

   The Worker accepts https://joeedessa.github.io, so on this site's own address the browser reaches it
   directly. On localhost it does not, so local development forwards the same request through the dev
   server (`/__yahoo`, see vite.config.ts), which has no CORS problem. */

export const WORKER_URL = 'https://macro-compass-proxy.joe-edessa.workers.dev/';
const YAHOO = 'https://query1.finance.yahoo.com';

export interface Env {
  /** True on localhost, where the request goes through the dev server instead of the Worker. */
  local: boolean;
  base: string;
}

export function currentEnv(): Env {
  const host = typeof location === 'undefined' ? '' : location.hostname;
  return { local: host === 'localhost' || host === '127.0.0.1' || host === '[::1]', base: import.meta.env.BASE_URL };
}

/** The URL the browser should fetch for a Yahoo path (`/v7/finance/spark?...`). */
export function viaProxy(yahooPath: string, env: Env = currentEnv()): string {
  return env.local
    ? `${env.base}__yahoo${yahooPath}`
    : `${WORKER_URL}?url=${encodeURIComponent(YAHOO + yahooPath)}`;
}

export type Fetch = (url: string, init?: { signal?: AbortSignal; cache?: RequestCache }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface Deps {
  fetch?: Fetch;
  env?: Env;
  now?: () => number;
  /** The whole upgrade gives up after this long; what has arrived by then is kept. */
  deadlineMs?: number;
  concurrency?: number;
}

const chunks = <T,>(xs: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};

/** Run `fn` over `items` with at most `n` in flight; one failure never stops the rest. */
async function pool<T>(items: T[], n: number, fn: (item: T) => Promise<void>): Promise<void> {
  const queue = items.slice();
  await Promise.all(Array.from({ length: Math.min(n, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift() as T;
      try { await fn(item); } catch { /* one bad request is not fatal */ }
    }
  }));
}

function guarded(deps: Deps): { fetchJson: (path: string) => Promise<unknown>; done: () => void } {
  const f: Fetch = deps.fetch ?? ((url, init) => fetch(url, init));
  const env = deps.env ?? currentEnv();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), deps.deadlineMs ?? 12000);
  return {
    fetchJson: async path => {
      const r = await f(viaProxy(path, env), { signal: ctl.signal, cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    },
    done: () => clearTimeout(timer),
  };
}

/* ------------------------------------------------------------------ live quotes */

export interface LiveQuote {
  c: number;
  p?: number;
  t: number;
  ccy?: string;
  tz?: string;
  /** The regular session's start and end, as Yahoo reports them for the current or next trading day. */
  start?: number;
  end?: number;
}

export interface LiveResult {
  quotes: Record<string, LiveQuote>;
  failed: string[];
  /** When the answer arrived, ms. */
  at: number;
}

interface SparkRow {
  symbol?: string;
  response?: { meta?: Record<string, unknown> }[];
}

export function parseSpark(json: unknown): Record<string, LiveQuote> {
  const out: Record<string, LiveQuote> = {};
  const rows = ((json as { spark?: { result?: SparkRow[] } })?.spark?.result) || [];
  for (const row of rows) {
    const m = row.response?.[0]?.meta;
    if (!row.symbol || !m) continue;
    const c = m.regularMarketPrice, t = m.regularMarketTime;
    if (typeof c !== 'number' || !isFinite(c) || typeof t !== 'number') continue;
    const reg = (m.currentTradingPeriod as { regular?: { start?: unknown; end?: unknown } } | undefined)?.regular;
    const q: LiveQuote = { c, t };
    if (typeof m.previousClose === 'number') q.p = m.previousClose;
    if (typeof m.currency === 'string') q.ccy = m.currency;
    if (typeof m.exchangeTimezoneName === 'string') q.tz = m.exchangeTimezoneName;
    if (reg && typeof reg.start === 'number' && typeof reg.end === 'number') { q.start = reg.start; q.end = reg.end; }
    out[row.symbol] = q;
  }
  return out;
}

/** Ten symbols a request, a few requests at once. Never throws: a failed batch is listed in `failed`. */
export async function fetchLive(symbols: string[], deps: Deps = {}): Promise<LiveResult> {
  const now = deps.now ?? Date.now;
  const g = guarded(deps);
  const quotes: Record<string, LiveQuote> = {};
  const failed: string[] = [];
  try {
    await pool(chunks([...new Set(symbols)], 10), deps.concurrency ?? 3, async batch => {
      try {
        const path = '/v7/finance/spark?symbols=' + batch.map(encodeURIComponent).join(',') + '&range=1d&interval=5m';
        Object.assign(quotes, parseSpark(await g.fetchJson(path)));
      } catch {
        failed.push(...batch);
      }
    });
  } finally {
    g.done();
  }
  for (const s of symbols) if (!quotes[s] && !failed.includes(s)) failed.push(s);
  return { quotes, failed, at: now() };
}

/** The live answers laid over the snapshot's tip file, newest wins. Sessions are stored as local hours
    (the exchange's own clock and zone), the same form the data job writes, so one rule reads both. */
export function mergeLive(base: LatestFile | null, live: LiveResult | null): LatestFile | null {
  if (!live || !Object.keys(live.quotes).length) return base;
  const sessions: SessionHours[] = base ? base.sessions.slice() : [];
  const index = new Map(sessions.map((h, i) => [h.join('|'), i]));
  const latest: Record<string, Tip> = base ? { ...base.latest } : {};
  for (const [sym, q] of Object.entries(live.quotes)) {
    const old = latest[sym];
    if (old && old.t != null && q.t < old.t) continue;
    const tip: Tip = { c: q.c, t: q.t };
    if (q.p != null) tip.p = q.p;
    if (q.ccy) tip.ccy = q.ccy;
    if (q.tz && q.start != null && q.end != null) {
      const open = localMinutes(q.tz, q.start), close = localMinutes(q.tz, q.end);
      if (close > open) {
        const hours: SessionHours = [q.tz, open, close];
        const key = hours.join('|');
        let z = index.get(key);
        if (z === undefined) { z = sessions.length; sessions.push(hours); index.set(key, z); }
        tip.z = z;
      }
    } else if (old && old.z != null) tip.z = old.z;
    latest[sym] = tip;
  }
  return { generated_at: base ? base.generated_at : '', sessions, latest };
}

/* ------------------------------------------------------------------ bars for symbols not in the snapshot */

export interface ExtraBars {
  bars: Record<string, Bars>;
  ccy: Record<string, string>;
  failed: string[];
}

interface ChartResult {
  meta?: Record<string, unknown>;
  timestamp?: number[];
  indicators?: { quote?: { low?: (number | null)[]; high?: (number | null)[]; close?: (number | null)[] }[] };
}

/** Daily [low, high, close] from one v8 chart answer, keyed by the exchange's own date. A bar that belongs to
    the session running right now is dropped: it is still forming, and the live quote carries it instead. */
export function parseChart(json: unknown, nowMs: number): { bars: Bars; ccy: string } | null {
  const res = ((json as { chart?: { result?: ChartResult[] } })?.chart?.result || [])[0];
  const q = res?.indicators?.quote?.[0];
  if (!res || !q || !res.timestamp) return null;
  const meta = res.meta || {};
  const tz = typeof meta.exchangeTimezoneName === 'string' ? meta.exchangeTimezoneName : null;
  const reg = (meta.currentTradingPeriod as { regular?: { start?: number; end?: number } } | undefined)?.regular;
  const bars: Bars = {};
  const ts = res.timestamp;
  for (let i = 0; i < ts.length; i++) {
    const lo = q.low?.[i], hi = q.high?.[i], c = q.close?.[i];
    if (lo == null || hi == null) continue;
    // The last bar is forming when its stamp falls inside the session that has not ended yet.
    if (i === ts.length - 1 && reg && reg.start != null && reg.end != null && ts[i] >= reg.start && nowMs / 1000 < reg.end) continue;
    bars[localDate(ts[i], tz)] = [lo, hi, c ?? null];
  }
  if (!Object.keys(bars).length) return null;
  return { bars, ccy: typeof meta.currency === 'string' ? meta.currency : '' };
}

/** Two years of daily bars, one request a symbol (the chart endpoint does not batch), for symbols the data
    job has not reached yet: a setup added in this browser, or a row the weekly sync pushed since the last run. */
export async function fetchBarsFor(symbols: string[], deps: Deps = {}): Promise<ExtraBars> {
  const now = deps.now ?? Date.now;
  const g = guarded({ deadlineMs: 20000, ...deps });
  const out: ExtraBars = { bars: {}, ccy: {}, failed: [] };
  try {
    await pool([...new Set(symbols)], deps.concurrency ?? 4, async sym => {
      try {
        const got = parseChart(await g.fetchJson(`/v8/finance/chart/${encodeURIComponent(sym)}?range=2y&interval=1d`), now());
        if (!got) throw new Error('no bars');
        out.bars[sym] = got.bars;
        if (got.ccy) out.ccy[sym] = got.ccy;
      } catch {
        out.failed.push(sym);
      }
    });
  } finally {
    g.done();
  }
  return out;
}
