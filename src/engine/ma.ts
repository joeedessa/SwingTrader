/* Moving averages on a series of closes: where the last close sits against a simple average, whether that average was tested
   lately and what happened, which way the average itself is heading, and where the averages and the price have crossed one
   another. Ported from the old site's ma.js, function for function, so the two agree to the last digit
   (tests/fixtures/ma-old-page.json and ma-signals-old-page.json hold what the old one answered). The daily reads are on the
   drawer; the Signals page runs the same functions on weekly and monthly closes too.

   Everything is close-only: the feed carries no intraday high or low here. A spike through a level that closed back above
   it therefore reads as held, which is the outcome that matters, but a page must say so. */

/** The rolling mean of the last `n` values at each point from the n-th on. */
export function smaSeries(vals: readonly number[] | null | undefined, n: number): number[] {
  if (!vals || vals.length < n) return [];
  const out: number[] = [];
  let s = 0;
  for (let i = 0; i < vals.length; i++) {
    s += vals[i];
    if (i >= n) s -= vals[i - n];
    if (i >= n - 1) out.push(s / n);
  }
  return out;
}

/** The numbers the reads turn on, kept in one place so the Method page can say them. They are the old site's, to the digit. */
export const MA_RULES = {
  /** How many bars back a test of the average is looked for. */
  testBars: 15,
  /** How near the average counts as a test, as a share of the typical bar-to-bar move, with its floor and cap as fractions. */
  tolShare: 0.5, tolFloor: 0.01, tolCap: 0.04,
  /** A test counts only while the latest close is within this many times the tolerance of the average. */
  stillNear: 3,
  /** How many bars the typical move is averaged over. */
  typicalBars: 40,
  /** The window the slope is read over is the period over this, between a floor and a cap of bars. */
  slopeDivisor: 6, slopeFloor: 3, slopeCap: 25,
  /** "Flat" is this fraction of the typical move, for each bar of the window. */
  slopePerBar: 0.04,
} as const;

/** How far an instrument typically moves bar to bar over the last forty bars, as a fraction. A zero print is not a price. */
function typicalMove(vals: readonly number[]): number {
  let sumAbs = 0, cnt = 0;
  for (let k = Math.max(1, vals.length - MA_RULES.typicalBars); k < vals.length; k++) {
    if (!vals[k - 1]) continue;
    sumAbs += Math.abs(vals[k] / vals[k - 1] - 1);
    cnt++;
  }
  return cnt ? sumAbs / cnt : 0.02;
}

export type MaState = 'held' | 'rejected' | 'reclaimed' | 'lost';

export interface MaRead {
  /** The average now. */
  ma: number;
  /** The last close against it, in %. */
  dist: number;
  /** The last test of the average, while price is still near it; null otherwise. */
  state: MaState | null;
  /** Bars since the close last changed sides, or null if it never has within the series. */
  crossedAgo: number | null;
  above: boolean;
  /** How near counts as a test, as a fraction: half the typical bar-to-bar move, floored at 1% and capped at 4%. */
  tol: number;
}

/** Where the last close sits against the `period` average, whether it was tested lately, and how long ago it last changed
    sides. A test is a close within the tolerance of the average in the last fifteen bars, and counts only while the latest
    close is still within three times that tolerance of it. */
export function maRead(vals: readonly number[] | null | undefined, period: number): MaRead | null {
  if (!vals || vals.length < period + 2) return null;
  const ma = smaSeries(vals, period);
  const off = vals.length - ma.length;
  const last = vals[vals.length - 1], lastMa = ma[ma.length - 1];
  const dist = (last / lastMa - 1) * 100;
  const isAbove = dist >= 0;

  const LOOK = Math.min(MA_RULES.testBars, ma.length - 1);
  const tol = Math.min(MA_RULES.tolCap, Math.max(MA_RULES.tolFloor, typicalMove(vals) * MA_RULES.tolShare));
  let best: { d: number; k: number } | null = null;
  for (let k = ma.length - LOOK; k < ma.length; k++) {
    const d = vals[k + off] / ma[k] - 1;
    if (best === null || Math.abs(d) < Math.abs(best.d)) best = { d, k };
  }
  let state: MaState | null = null;
  const stillNear = Math.abs(dist / 100) <= tol * MA_RULES.stillNear;
  if (best && Math.abs(best.d) <= tol && stillNear) {
    const wasAbove = best.d >= 0;
    state = wasAbove && isAbove ? 'held'
      : !wasAbove && !isAbove ? 'rejected'
      : !wasAbove && isAbove ? 'reclaimed' : 'lost';
  }
  let crossedAgo: number | null = null;
  for (let k = ma.length - 2; k >= 0; k--) {
    if ((vals[k + off] >= ma[k]) !== isAbove) { crossedAgo = ma.length - 1 - k; break; }
  }
  return { ma: lastMa, dist, state, crossedAgo, above: isAbove, tol };
}

export type SlopeState = 'turnup' | 'turndown' | 'rising' | 'falling' | 'flatup' | 'flatdown' | 'flat';

export interface MaSlope {
  /** How far the average moved over the window, in %, and over the window before it. */
  pct: number;
  priorPct: number;
  /** The window, in bars. */
  bars: number;
  /** The threshold between flat and moving, in %. */
  thr: number;
  state: SlopeState;
  label: string;
  glyph: string;
}

/** Which way the average itself is heading, and whether it is turning: the move over a window compared with the window
    before it, with "flat" scaled to how much the instrument normally moves. The window is the period over six, floored at
    three and capped at twenty-five bars. */
export function maSlope(vals: readonly number[] | null | undefined, period: number): MaSlope | null {
  if (!vals || vals.length < period + 2) return null;
  const ma = smaSeries(vals, period);
  const W = Math.max(MA_RULES.slopeFloor, Math.min(MA_RULES.slopeCap, Math.round(period / MA_RULES.slopeDivisor)));
  if (ma.length < 2 * W + 1) return null;
  const L = ma.length - 1;
  if (!(ma[L - W] > 0) || !(ma[L - 2 * W] > 0)) return null;
  const now = ma[L] / ma[L - W] - 1;
  const prior = ma[L - W] / ma[L - 2 * W] - 1;
  const thr = typicalMove(vals) * W * MA_RULES.slopePerBar;
  const sgn = (x: number) => (x > thr ? 1 : x < -thr ? -1 : 0);
  const a = sgn(now), b = sgn(prior);
  let state: SlopeState, label: string, glyph: string;
  if (a > 0 && b < 0) { state = 'turnup'; label = 'turning up'; glyph = '⤴'; }
  else if (a < 0 && b > 0) { state = 'turndown'; label = 'turning down'; glyph = '⤵'; }
  else if (a > 0) { state = 'rising'; label = 'rising'; glyph = '↑'; }
  else if (a < 0) { state = 'falling'; label = 'falling'; glyph = '↓'; }
  else if (b < 0) { state = 'flatup'; label = 'flattening from down'; glyph = '→'; }
  else if (b > 0) { state = 'flatdown'; label = 'flattening from up'; glyph = '→'; }
  else { state = 'flat'; label = 'flat'; glyph = '→'; }
  return { pct: now * 100, priorPct: prior * 100, bars: W, thr: thr * 100, state, label, glyph };
}

/* ------------------------------------------------------------------ the three timeframes */

export type Timeframe = 'daily' | 'weekly' | 'monthly';

export const TIMEFRAMES: readonly Timeframe[] = ['daily', 'weekly', 'monthly'];

/** The averages each timeframe's columns show. Daily lengths do not carry over to slower bars (a 200-period monthly is
    seventeen years, not a trend line), so weekly and monthly use the lengths chartists read: weekly 10, 30 (Weinstein's
    stage line), 40 (the 200-day in weeks) and 200; monthly 10 (Faber's line, the 200-day in months), 12 and 20. */
export const PERIODS_BY_TF: Record<Timeframe, readonly number[]> = {
  daily: [5, 21, 50, 150, 200],
  weekly: [10, 30, 40, 200],
  monthly: [10, 12, 20],
};

/** The lines that carry a level test and the slope of the average: the ones a chartist treats as support and resistance on
    that timeframe. Tagging every column would bury them. */
export const TAGGED: Record<Timeframe, readonly number[]> = {
  daily: [150, 200],
  weekly: [30, 40, 200],
  monthly: [10, 20],
};

/** What one bar is called on each timeframe, and how far back the cross scan looks. */
export const TF_WORDS: Record<Timeframe, { label: string; name: string; unit: string; word: string; one: string; lookback: number }> = {
  daily: { label: 'Daily', name: 'day', unit: 'd', word: 'sessions', one: 'session', lookback: 10 },
  weekly: { label: 'Weekly', name: 'week', unit: 'w', word: 'weeks', one: 'week', lookback: 13 },
  monthly: { label: 'Monthly', name: 'month', unit: 'mo', word: 'months', one: 'month', lookback: 12 },
};

/* ------------------------------------------------------------------ the cross ladder */

/** 200 periods for the slowest average plus room for the window. Anything shorter cannot produce a 50-by-200 cross at all. */
export const MIN_BARS = 220;

/** Seeded from the first value and iterated over the whole series, then the first n dropped, the way the old pages always
    did it, so the crosses reported are the same ones they reported before. */
export function emaSeries(vals: readonly number[] | null | undefined, n: number): number[] {
  if (!vals || vals.length < n) return [];
  const k = 2 / (n + 1);
  let prev = vals[0];
  const out: number[] = [];
  for (let i = 0; i < vals.length; i++) {
    prev = vals[i] * k + prev * (1 - k);
    out.push(prev);
  }
  return out.slice(n);
}

export type TierKey = 'e5x21' | 'px50' | 'e21x50' | 'px200' | 's50x200';

export interface Tier {
  key: TierKey;
  label: string;
  sub: string;
}

/** The escalation ladder, left to right: each step costs time and buys confidence. Price leads its own averages
    arithmetically, so a name normally lights up on the left and works rightward. The 5 and 21 of the first two tiers are
    exponential averages, as the old scan has always had them. */
export const TIERS: readonly Tier[] = [
  { key: 'e5x21', label: '5 × 21', sub: 'EMA timing trigger' },
  { key: 'px50', label: 'price × 50', sub: 'swing trend break' },
  { key: 'e21x50', label: '21 × 50', sub: 'intermediate turn' },
  { key: 'px200', label: 'price × 200', sub: 'regime change' },
  { key: 's50x200', label: '50 × 200', sub: 'golden / death' },
];

export interface Cross {
  key: TierKey;
  label: string;
  bullish: boolean;
  /** Bars since the cross; 0 is the latest bar. */
  ago: number;
  /** The sign flipped back again later inside the window: a cross that was given back. */
  whip: boolean;
}

/** Sign changes in (fast − slow) inside the window. Every series is end-aligned (the averages drop their warm-up from the
    front), so the two legs are compared by offset from the last bar and not joined on a date, which is what lets one
    function read a daily array and a monthly one alike. */
export function crosses(vals: readonly number[] | null | undefined, lookback: number): Cross[] {
  if (!vals || vals.length < MIN_BARS) return [];
  const s50 = smaSeries(vals, 50), s200 = smaSeries(vals, 200), e21 = emaSeries(vals, 21), e5 = emaSeries(vals, 5);
  const legs: Record<TierKey, [readonly number[], readonly number[]]> = {
    e5x21: [e5, e21], px50: [vals, s50], e21x50: [e21, s50], px200: [vals, s200], s50x200: [s50, s200],
  };
  const out: Cross[] = [];
  for (const t of TIERS) {
    const [fast, slow] = legs[t.key];
    if (!fast.length || !slow.length) continue;
    const span = Math.min(fast.length, slow.length, lookback + 1);
    if (span < 2) continue;
    const d: number[] = [];
    for (let i = span - 1; i >= 0; i--) d.push(fast[fast.length - 1 - i] - slow[slow.length - 1 - i]);
    for (let i = 1; i < d.length; i++) {
      const prev = d[i - 1], now = d[i];
      if (prev === 0 || now === 0 || (prev < 0) === (now < 0)) continue;
      let whip = false;
      for (let k = i + 1; k < d.length; k++) if ((d[k] < 0) !== (now < 0)) { whip = true; break; }
      out.push({ key: t.key, label: t.label, bullish: now > 0, ago: d.length - 1 - i, whip });
    }
  }
  return out;
}
