import { dayPctOf, pct1 } from './derived';
import { crosses, maRead, maSlope, MIN_BARS, PERIODS_BY_TF, TAGGED, TF_WORDS } from './ma';
import type { Cross, MaRead, MaSlope, Timeframe } from './ma';
import { median } from './outcomes';
import type { Row } from './row';
import type { History, ReplayStatus } from './types';

/* What the Signals page reads off a set of setups: where each sits against its moving averages on daily, weekly and
   monthly closes, which ones have just changed sides on the 150 or 200, where the averages and the price have crossed,
   and how each name's day compares with its local index and its sector. The arithmetic is ma.ts (the old site's); this
   chooses what to run it on and in what order, the way the old watchlist page did.

   Failed and removed setups are left out of all of it: a failed setup is over, and a removed one is not the source's any more. */

/* ------------------------------------------------------------------ the index each listing is read against */

/** The local benchmark index for each listing country (Yahoo symbols, all probed live by the old page). The UAE has no
    index the feed serves usably, so names there sit out the "vs index" column rather than be compared with a wrong one.
    scripts/fetch_bars.py holds the same map to fetch their bars, and a test keeps the two equal. */
export const INDEX_MAP: Readonly<Record<string, string>> = {
  US: '^GSPC', Canada: '^GSPTSE', Japan: '^N225', UK: '^FTSE',
  France: '^FCHI', Italy: 'FTSEMIB.MI', Spain: '^IBEX', Germany: '^GDAXI',
  'Hong Kong': '^HSI', India: '^NSEI', Australia: '^AXJO', Turkey: 'XU100.IS',
  'South Africa': '^J203.JO', Netherlands: '^AEX', Belgium: '^BFX',
  Finland: '^OMXH25', Norway: 'OBX.OL', Sweden: '^OMX', Denmark: '^OMXC25',
  Singapore: '^STI', Ireland: '^ISEQ', Austria: '^ATX',
};

export const indexOf = (country: string | null | undefined): string | null => (country && INDEX_MAP[country]) || null;

/* ------------------------------------------------------------------ the weekly and monthly closes */

/** One symbol's closes on a slower timeframe, as scripts/fetch_bars.py writes them: the stamp of each bar and its close. */
export interface SeriesEntry {
  ccy: string | null;
  t: number[];
  c: number[];
}

export interface SeriesFile {
  generated_at: string;
  weekly: Record<string, SeriesEntry>;
  monthly: Record<string, SeriesEntry>;
}

const HOUR = 3600;
const DAY = 86400;

/** When the next genuine bar would be stamped, given the stamp of the bar that opened the period now in progress. Genuine
    bars sit on their period's start in the exchange's own time: a Monday for weekly, the 1st for monthly. That is a
    different UTC instant for every exchange, and often a different UTC day (Monday midnight in Tokyo or Frankfurt is
    still Sunday in UTC), so the length of the period is measured from the stamp of the bar before it, not from a calendar. */
function periodEnd(openedAt: number, tf: 'weekly' | 'monthly'): number {
  if (tf === 'weekly') return openedAt + 7 * DAY;
  // Local midnight on the 1st, read as a UTC date half a day on, names the month it opened (for zones within twelve hours of UTC).
  const m = new Date((openedAt + 12 * HOUR) * 1000);
  return openedAt + new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 0)).getUTCDate() * DAY;
}

/** The closes of a weekly or monthly series, with the phantom bar left out.

    Yahoo pads every weekly and monthly series with one more bar stamped at the last trade, which repeats the period already
    in progress. Left in, the current week or month is counted twice in every average, always toward the latest price. The
    test is whether the last bar falls inside the period the bar before it opened, not whether it repeats a close: the two
    carry different prices once the period is a day old. A bar that opens a new period never falls inside the last one, so a
    genuine last bar is kept, and so is the only bar of the period when its own bar has not been written yet. An hour is
    allowed for the clocks changing between two genuine stamps.

    The old site made the same test on the UTC date of each stamp, which is right for exchanges behind or on UTC and wrong
    for those ahead of it: Frankfurt's and Tokyo's genuine bars fall on the Sunday before, so the phantom stayed in. */
export function seriesCloses(entry: SeriesEntry | null | undefined, tf: 'weekly' | 'monthly'): number[] | null {
  if (!entry || !Array.isArray(entry.c) || !entry.c.length) return null;
  const n = entry.c.length;
  const phantom = n >= 2 && entry.t.length === n && entry.t[n - 1] < periodEnd(entry.t[n - 2], tf) - HOUR;
  const closes = phantom ? entry.c.slice(0, -1) : entry.c.slice();
  return closes.length ? closes : null;
}

/** Closes for one symbol on one timeframe, or null where there are none. */
export type CloseSource = (sym: string, tf: Timeframe) => readonly number[] | null;

/** A lookup over the settled daily closes and the weekly and monthly series, each worked out once. */
export function closeSource(hist: Record<string, History | undefined>, series: SeriesFile | null | undefined): CloseSource {
  const memo = new Map<string, readonly number[] | null>();
  return (sym, tf) => {
    const key = tf + '|' + sym;
    if (memo.has(key)) return memo.get(key) as readonly number[] | null;
    let v: readonly number[] | null;
    if (tf === 'daily') {
      const h = hist[sym];
      v = h && h.settled.length ? h.settled.map(x => x[1]) : null;
    } else {
      v = seriesCloses(series ? series[tf][sym] : null, tf);
    }
    memo.set(key, v);
    return v;
  };
}

/* ------------------------------------------------------------------ which setups, and in what order */

/** A setup that is still in play for the Signals page: not failed, not removed. */
export const isLive = (r: Row): boolean => r.section !== 'failed' && r.section !== 'removed';

/* ------------------------------------------------------------------ the average columns */

export interface MaColumn {
  period: number;
  read: MaRead | null;
  /** Only on the lines that carry a level test: which way the average itself is heading. */
  slope: MaSlope | null;
  /** The level test and the slope are shown for this period on this timeframe. */
  tagged: boolean;
}

/** One setup's reads on one timeframe, a column for each of its periods. */
export function ladderOf(vals: readonly number[] | null | undefined, tf: Timeframe): MaColumn[] {
  return PERIODS_BY_TF[tf].map(period => {
    const tagged = TAGGED[tf].includes(period);
    return { period, read: maRead(vals, period), slope: tagged ? maSlope(vals, period) : null, tagged };
  });
}

/* ------------------------------------------------------------------ fresh level changes */

export interface StructureEvent {
  row: Row;
  tf: Timeframe;
  period: 150 | 200;
  state: 'reclaimed' | 'lost';
  /** Bars since the close changed sides: 0 is the latest bar. */
  ago: number;
  /** The average now, and how far the last close on this timeframe sits from it, in %. */
  ma: number;
  dist: number;
  /** For this setup's direction: a long that reclaims, or a short that loses, an average is being helped. */
  helps: boolean;
}

/** Each timeframe's freshness window, in bars, in the order it ranks: a monthly 200 changes hands a handful of times in a
    decade, a daily 150 several times a year, and they should not queue equally. */
export const FRESH_WITHIN: readonly { tf: Timeframe; maxAgo: number }[] = [
  { tf: 'monthly', maxAgo: 1 }, { tf: 'weekly', maxAgo: 1 }, { tf: 'daily', maxAgo: 2 },
];

/** Among equals, the setups with money already in them first: one that has confirmed its breakout is a live position, so
    its structure turning matters more than the same turn on something still waiting. */
const STATE_RANK: Record<ReplayStatus, number> = { breakout: 0, target: 1, watch: 2, failed: 9 };

/** A close that has just changed sides on the 150 or 200, on any timeframe, for every live setup. Monthly first, then
    weekly, then daily; the 200 before the 150; then the setups already in trade. */
export function structureEvents(rows: readonly Row[], vals: CloseSource): StructureEvent[] {
  const out: StructureEvent[] = [];
  for (const r of rows) {
    if (!isLive(r)) continue;
    for (const { tf, maxAgo } of FRESH_WITHIN) {
      const closes = vals(r.p.sym, tf);
      if (!closes) continue;
      for (const period of [200, 150] as const) {
        const m = maRead(closes, period);
        if (!m || !m.state || m.crossedAgo == null || m.crossedAgo > maxAgo) continue;
        if (m.state !== 'reclaimed' && m.state !== 'lost') continue;
        const state: 'reclaimed' | 'lost' = m.state;
        out.push({ row: r, tf, period, state, ago: m.crossedAgo, ma: m.ma, dist: m.dist, helps: r.p.dir === 'long' ? state === 'reclaimed' : state === 'lost' });
      }
    }
  }
  const rank = (e: StructureEvent) => FRESH_WITHIN.findIndex(s => s.tf === e.tf);
  return out.sort((a, b) => rank(a) - rank(b) || (a.period === 200 ? 0 : 1) - (b.period === 200 ? 0 : 1) ||
    STATE_RANK[a.row.st.state] - STATE_RANK[b.row.st.state]);
}

/* ------------------------------------------------------------------ the cross scan */

/** Which setups the scan runs over. The populations answer different questions (a cross on something still waiting is a
    reason to watch it closer, the same cross on a position is money already at risk), so they are not pooled by default. */
export type ScanScope = 'watch' | 'trade' | 'all';

export const SCAN_SCOPES: readonly ScanScope[] = ['watch', 'trade', 'all'];

const IN_SCOPE: Record<ScanScope, (r: Row) => boolean> = {
  watch: r => r.section === 'watch',
  trade: r => r.section === 'breakout' || r.section === 'reentered',
  all: isLive,
};

/** The setups in a scope, one for each symbol that has a history: a name held both long and short, or listed twice, is one
    chart and should cross its own averages once. */
export function scanRows(rows: readonly Row[], scope: ScanScope, hist: Record<string, History | undefined>): Row[] {
  const seen = new Set<string>();
  const out: Row[] = [];
  for (const r of rows) {
    if (!IN_SCOPE[scope](r) || !hist[r.p.sym] || seen.has(r.p.sym)) continue;
    seen.add(r.p.sym);
    out.push(r);
  }
  return out;
}

export interface ScanHit extends Cross {
  row: Row;
}

export interface Scan {
  tf: Timeframe;
  /** How many bars back a cross counts. */
  lookback: number;
  /** Of `total`, how many have the 220 bars a 50-by-200 cross needs on this timeframe. */
  covered: number;
  total: number;
  hits: ScanHit[];
}

/** Every cross in the last `lookback` bars on one timeframe. A name without enough history is counted, not scanned: the
    page says how many qualified rather than quietly scanning fewer. */
export function scanOf(rows: readonly Row[], tf: Timeframe, vals: CloseSource): Scan {
  const lookback = TF_WORDS[tf].lookback;
  const hits: ScanHit[] = [];
  let covered = 0;
  for (const r of rows) {
    const closes = vals(r.p.sym, tf);
    if (!closes || closes.length < MIN_BARS) continue;
    covered++;
    for (const c of crosses(closes, lookback)) hits.push({ ...c, row: r });
  }
  return { tf, lookback, covered, total: rows.length, hits };
}

/* ------------------------------------------------------------------ the day against the market */

export interface Relative {
  /** The setup's own day move, in %. */
  day: number | null;
  /** The local index it is read against, and that index's own day move. */
  index: string | null;
  indexDay: number | null;
  /** Percentage points ahead of (positive) or behind the index; null without both moves. */
  vsIndex: number | null;
  /** How many names in the list share its sector (itself included), and the median of their day moves. */
  peers: number;
  sectorDay: number | null;
  /** Percentage points against the sector's median day; null with fewer than three names in the sector. */
  vsSector: number | null;
}

/** Sectors this small have no median worth comparing with. */
export const MIN_SECTOR_PEERS = 3;

/** Each name's day against its local index and against the median of the same sector's names across the whole list (failed
    and removed ones included, as the old page counted them: a day move is a day move). `rows` is the whole board. */
export function relatives(rows: readonly Row[], hist: Record<string, History | undefined>): Map<Row, Relative> {
  const bySector: Record<string, number[]> = {};
  for (const r of rows) {
    const sector = r.ev.sector;
    if (sector && r.dayPct != null) (bySector[sector] = bySector[sector] || []).push(r.dayPct);
  }
  const out = new Map<Row, Relative>();
  for (const r of rows) {
    const index = indexOf(r.p.country);
    const indexDay = index ? dayPctOf(hist[index]) : null;
    const peers = r.ev.sector ? bySector[r.ev.sector] || [] : [];
    const sectorDay = peers.length >= MIN_SECTOR_PEERS ? median(peers) : null;
    out.set(r, {
      day: r.dayPct, index, indexDay,
      vsIndex: r.dayPct != null && indexDay != null ? pct1(r.dayPct - indexDay) : null,
      peers: peers.length, sectorDay,
      vsSector: r.dayPct != null && sectorDay != null ? pct1(r.dayPct - sectorDay) : null,
    });
  }
  return out;
}

