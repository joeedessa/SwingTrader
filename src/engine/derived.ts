import type { Dir, History, Lfd, ReplayState, Setup, SymbolEvents } from './types';

/** One decimal, or null. Percentages on the board are shown this way. */
export const pct1 = (v: number | null | undefined): number | null =>
  v == null || !isFinite(v) ? null : Math.round(v * 10) / 10;

/** Last close → trigger, for a waiting row. `pct` is signed the setup's way (a short reads negative);
    `abs` is the move in money, positive while price is still short of the trigger. */
export function gapTo(p: Setup, prevClose: number | null, waiting: boolean): { pct: number | null; abs: number | null } {
  if (!waiting || prevClose == null || p.breakthrough == null) return { pct: null, abs: null };
  const long = p.dir === 'long';
  const gap = pct1((long ? p.breakthrough / prevClose - 1 : 1 - p.breakthrough / prevClose) * 100);
  return { pct: gap == null ? null : (long ? gap : -gap),
           abs: long ? p.breakthrough - prevClose : prevClose - p.breakthrough };
}

/** Payoff: trigger → target while waiting (the pattern's own), live → target once confirmed (what is left). */
export function upsideOf(p: Setup, live: number | null, waiting: boolean): number | null {
  const long = p.dir === 'long';
  if (waiting) {
    return (p.breakthrough && p.target)
      ? pct1((long ? p.target / p.breakthrough - 1 : 1 - p.target / p.breakthrough) * 100) : null;
  }
  return (live && p.target) ? pct1((long ? p.target / live - 1 : 1 - p.target / live) * 100) : null;
}

/** Live → negation, the give-back to invalidation. Confirmed rows only. */
export function riskOf(p: Setup, live: number | null, waiting: boolean): number | null {
  if (waiting || !live || !p.negation) return null;
  return pct1((p.dir === 'long' ? 1 - p.negation / live : p.negation / live - 1) * 100);
}

/** Day-over-day % using the live tick against the prior settled close
    (the last two settled closes once the session has ended). */
export function dayPctOf(hist: History | null | undefined): number | null {
  if (!hist || hist.live == null) return null;
  const s = hist.settled;
  if (!s.length) return null;
  let base = s[s.length - 1];
  if (hist.liveDate === base[0]) base = s[s.length - 2];
  if (!base || base[1] == null) return null;
  return (hist.live / base[1] - 1) * 100;
}

/** Live → last-full-day stop, as a give-back, the same sign as risk. */
export function lfdRisk(dir: Dir, lfd: Lfd | null, live: number | null): number | null {
  return (lfd && lfd.at != null && !lfd.looser && live)
    ? pct1((dir === 'long' ? 1 - lfd.at / live : lfd.at / live - 1) * 100) : null;
}

export interface Runup {
  /** How far price has run past the trigger, in %. */
  past: number;
  /** Share of the trigger → target move already used (1 = all of it). */
  used: number | null;
  /** Reward : risk of entering here against the tight stop (the negation where there is none). */
  rr: number | null;
  vs: 'tight stop' | 'negation';
}

/** Is it still worth entering? Measured from the live price, else the last close. */
export function runupOf(p: Setup, live: number | null, prevClose: number | null, lfd: Lfd | null): Runup | null {
  const base = live != null ? live : prevClose;
  if (base == null || p.breakthrough == null) return null;
  const sgn = p.dir === 'long' ? 1 : -1;
  const past = (base / p.breakthrough - 1) * 100 * sgn;
  const span = p.target != null ? (p.target - p.breakthrough) * sgn : null;
  const used = span != null && span > 0 ? (base - p.breakthrough) * sgn / span : null;
  const tight = lfd && lfd.at != null && !lfd.looser;
  const stop = tight ? lfd.at : p.negation;
  const reward = p.target != null ? (p.target - base) * sgn : null;
  const risk = stop != null ? (base - stop) * sgn : null;
  return { past, used, rr: reward != null && risk != null && reward > 0 && risk > 0 ? reward / risk : null,
           vs: tight ? 'tight stop' : 'negation' };
}

export interface RewardRisk {
  ratio: number;
  vs: 'tight stop' | 'negation';
  stop: number;
}

/** Reward : risk for a setup still waiting, as you would size it at the trigger:
    payoff (trigger → target) over the distance from the trigger to the stop. */
export function rrOf(p: Setup, lfd: Lfd | null): RewardRisk | null {
  if (p.breakthrough == null || p.target == null) return null;
  const useLfd = !!(lfd && lfd.at != null && !lfd.looser);
  const stop = useLfd ? (lfd as Lfd).at : p.negation;
  if (stop == null) return null;
  const sgn = p.dir === 'long' ? 1 : -1;
  const reward = (p.target - p.breakthrough) * sgn, risk = (p.breakthrough - stop) * sgn;
  if (!(reward > 0) || !(risk > 0)) return null;
  return { ratio: reward / risk, vs: useLfd ? 'tight stop' : 'negation', stop };
}

/** True while a dividend is still ahead. The ex-date itself counts: the drop lands at that morning's open. */
export function divAhead(ev: SymbolEvents | null | undefined, today: string): boolean {
  if (!ev || !ev.ex_div || ev.div_amount == null) return false;
  return ev.ex_div >= today;
}

export interface TrailingStop {
  at: number;
  plain: number;
  widenedBy: number;
  atr: number;
  exDiv: string | null | undefined;
}

/** Where a 2×ATR trailing stop sits, widened for a long while a dividend is still to come out of the price.
    Longs only: the ex-dividend drop is a gift to a short's stop, not a risk to it. */
export function stopFor(p: Setup, live: number | null, ev: SymbolEvents | null | undefined, today: string): TrailingStop | null {
  if (!ev || ev.atr == null || live == null) return null;
  const wide = (p.dir !== 'short' && divAhead(ev, today)) ? (ev.div_amount || 0) : 0;
  const dist = 2 * ev.atr + wide;
  return { at: p.dir === 'short' ? live + dist : live - dist,
           plain: p.dir === 'short' ? live + 2 * ev.atr : live - 2 * ev.atr,
           widenedBy: wide, atr: ev.atr, exDiv: ev.ex_div };
}

/** The move since the target was reached, in %, signed the setup's way (positive: it kept going).
    Measured from the close on the day it was reached, or from the target level itself where the source
    counted it and our closes fell short. */
export function sinceTarget(p: Setup, st: ReplayState, live: number | null): number | null {
  if (!st.targetHit || live == null) return null;
  const base = st.targetHit.close ?? p.target;
  if (base == null || base === 0) return null;
  return pct1((live / base - 1) * 100 * (p.dir === 'long' ? 1 : -1));
}
