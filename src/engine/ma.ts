/* Moving averages on a series of closes: where the last close sits against a simple average, whether that average was tested
   lately and what happened, and which way the average itself is heading. Ported from the old site's ma.js, function for
   function, so the two agree to the last digit (tests/fixtures/ma-old-page.json holds what the old one answered). The
   Signals page extends this with the weekly and monthly series; this is the part every page shares.

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

/** How far an instrument typically moves bar to bar over the last forty bars, as a fraction. A zero print is not a price. */
function typicalMove(vals: readonly number[]): number {
  let sumAbs = 0, cnt = 0;
  for (let k = Math.max(1, vals.length - 40); k < vals.length; k++) {
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

  const LOOK = Math.min(15, ma.length - 1);
  const tol = Math.min(0.04, Math.max(0.01, typicalMove(vals) * 0.5));
  let best: { d: number; k: number } | null = null;
  for (let k = ma.length - LOOK; k < ma.length; k++) {
    const d = vals[k + off] / ma[k] - 1;
    if (best === null || Math.abs(d) < Math.abs(best.d)) best = { d, k };
  }
  let state: MaState | null = null;
  const stillNear = Math.abs(dist / 100) <= tol * 3;
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
const SLOPE_PER_BAR = 0.04;

export function maSlope(vals: readonly number[] | null | undefined, period: number): MaSlope | null {
  if (!vals || vals.length < period + 2) return null;
  const ma = smaSeries(vals, period);
  const W = Math.max(3, Math.min(25, Math.round(period / 6)));
  if (ma.length < 2 * W + 1) return null;
  const L = ma.length - 1;
  if (!(ma[L - W] > 0) || !(ma[L - 2 * W] > 0)) return null;
  const now = ma[L] / ma[L - W] - 1;
  const prior = ma[L - W] / ma[L - 2 * W] - 1;
  const thr = typicalMove(vals) * W * SLOPE_PER_BAR;
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
