import { LFD_LOOKBACK } from '../lfd';
import { spanDays } from '../outcomes';
import { against, atOrAgainst, atOrPast, past } from '../precision';
import type { BreakoutTag, Dir } from '../types';
import { atrSeries } from './atr';
import { roundTripPct, TRAIL } from './settings';
import type { ModelSettings, Strategy } from './settings';
import type { Candidate, Day, StopSource } from './universe';

/* One setup under one strategy, day by day on settled bars, the way the board tracks it (plan B2): each day's low or
   high is read first (a touch of the stop, then of the negation), then its close (the target, a re-entry), then,
   for S4, the trail is moved for the next day.

   Fills. A stop or the negation fills at its level, or at the open where the day opened past it (a gap). A target on
   a close fills at that close; on a touch, at the target, or at the open where the day opened past it. The entry is
   the next session's open where the bars have it, else the confirming close itself (Q6).

   What ends a setup. A touch of the negation (failed is final: no re-entry after it), the target, the source's
   `reached` date, the removal date, and for S2 the stop-out after the last re-entry allowed. A close that is back
   past the trigger while out is a re-entry, unless it is also at the target: the setup is over then, and nobody
   would buy it. A close-only day (the newest session, settled by its close alone) gives no touch and no re-entry,
   as the board's own counting reads none from it; its close still tests the negation and the target, as the replay's
   does. */

export type ExitReason = 'stop' | 'negation' | 'target' | 'reached' | 'removed';

export type StopKind = 'last full day' | 'new last full day' | 'trailing stop' | 'negation' | 'none';

export type FillBasis = 'close' | 'open' | 'level';

export interface Fill {
  when: string;
  price: number;
  basis: FillBasis;
  /** Its day's index in the candidate's days. */
  index: number;
}

export interface Exit extends Fill {
  reason: ExitReason;
  /** The level that fired: the stop, the negation or the target; null for a close the source or the removal date set. */
  level: number | null;
  /** The stop that fired, for a stop exit. */
  stopKind?: StopKind;
}

export interface Leg {
  key: string;
  sym: string;
  dir: Dir;
  currency: string;
  /** 1 for the first entry, 2 for the first re-entry, and so on. */
  n: number;
  entry: Fill;
  exit: Exit | null;
  /** The tight stop in force at the entry, or null with none (the leg then runs on the negation). */
  stop: number | null;
  stopKind: StopKind;
  /** What the leg is measured to: the exit, or the latest settled close while it is open. */
  mark: { when: string; price: number };
  open: boolean;
  /** Entry to mark, in % of the entry, the setup's way. */
  grossPct: number;
  /** The same less both sides' costs. */
  netPct: number;
  /** The entry's distance to the stop (the negation with no stop) as a share of the entry, in %; null with no level on the losing side. */
  riskPct: number | null;
  /** The net return in multiples of the risk taken. */
  r: number | null;
  /** Calendar days from the entry to the exit or the mark. */
  days: number;
  tag: BreakoutTag | null;
  stopSource: StopSource;
  imported: boolean;
  c: Candidate;
}

export interface Simulation {
  legs: Leg[];
  /** Why a leg could not be opened: the fill is a session that has not happened yet, or the removal came first. */
  pending: string | null;
}

export function simulate(c: Candidate, strategy: Strategy, settings: ModelSettings): Simulation {
  const long = c.dir === 'long';
  const sgn = long ? 1 : -1;
  const days = c.days;
  const cost = roundTripPct(settings);
  const legs: Leg[] = [];
  let pending: string | null = null;
  // The record ends at the removal date where the source dropped the setup.
  let end = days.length - 1;
  if (c.removed) while (end >= 0 && days[end].when > c.removed) end--;
  const atr = strategy.code === 'S4' ? atrSeries(days) : null;

  const ext = (d: Day): number => long ? d.lo : d.hi;   // the side a stop or the negation is touched on
  const far = (d: Day): number => long ? d.hi : d.lo;   // the side the target is touched on
  const closeFill = (i: number): Fill => ({ when: days[i].when, price: days[i].c as number, basis: 'close', index: i });
  // A level touched against the trade: the open where the day opened past it, else the level. A day with no open on
  // file that traded entirely past the level fills at its close, the one print it has.
  const fillAgainst = (i: number, level: number): Fill => {
    const d = days[i];
    if (d.o != null && against(long, d.o, level)) return { when: d.when, price: d.o, basis: 'open', index: i };
    if (d.o == null && against(long, far(d), level) && d.c != null) return closeFill(i);
    return { when: d.when, price: level, basis: 'level', index: i };
  };
  const fillPast = (i: number, level: number): Fill => {
    const d = days[i];
    if (d.o != null && atOrPast(long, d.o, level)) return { when: d.when, price: d.o, basis: 'open', index: i };
    if (d.o == null && atOrPast(long, ext(d), level) && d.c != null) return closeFill(i);
    return { when: d.when, price: level, basis: 'level', index: i };
  };

  const measure = (L: Leg, when: string, price: number): void => {
    L.mark = { when, price };
    L.grossPct = (price / L.entry.price - 1) * sgn * 100;
    L.netPct = L.grossPct - cost;
    L.r = L.riskPct ? L.netPct / L.riskPct : null;
    L.days = spanDays(L.entry.when, when);
  };
  const close = (L: Leg, exit: Exit): void => { L.exit = exit; L.open = false; measure(L, exit.when, exit.price); };

  /* The stop a re-entry gets when it is not the original: read as the first one was, from the bar before the run of
     closes past the boundary (the trigger with no boundary) that carries into the re-entry close; none when that
     bar is beyond the negation or out of the lookback. */
  const newStop = (ri: number): { at: number | null; kind: StopKind } => {
    const anchor = c.boundary ?? c.trigger;
    let a = ri, n = 0;
    while (a > 0 && n < LFD_LOOKBACK && days[a - 1].c != null && past(long, days[a - 1].c as number, anchor)) { a--; n++; }
    if (n >= LFD_LOOKBACK || a < 1 || days[a - 1].closeOnly) return { at: null, kind: 'none' };
    const at = ext(days[a - 1]);
    if (c.negation != null && atOrAgainst(long, at, c.negation)) return { at: null, kind: 'none' };
    return { at, kind: 'new last full day' };
  };

  // Typed by assertion rather than by the first value, since `open` below assigns them from inside a closure.
  let state = 'done' as 'in' | 'out' | 'done';
  let leg = null as Leg | null;
  let stopNow: number | null = null;
  let stopKindNow: StopKind = 'none';
  let best = 0;   // S4: the best close since the entry
  let used = 0;   // re-entries taken

  /** Opens a leg on a signal day; returns the first index exits are read on, or -1 when the fill has not happened yet. */
  const open = (signal: number, n: number, stop: number | null, kind: StopKind): number => {
    const next = signal + 1;
    let fill: Fill;
    if (settings.entry === 'open') {
      if (next > end) {
        pending = next < days.length ? 'removed by the source before the fill' : n === 1 ? 'waiting for the next open' : `waiting for the next open to re-enter (${n - 1})`;
        return -1;
      }
      const d = days[next];
      fill = d.o != null && !d.closeOnly ? { when: d.when, price: d.o, basis: 'open', index: next } : closeFill(signal);
    } else fill = closeFill(signal);
    const level = stop ?? c.negation;
    const riskRaw = level == null ? null : (fill.price - level) * sgn / fill.price * 100;
    const L: Leg = {
      key: c.key, sym: c.sym, dir: c.dir, currency: c.currency, n, entry: fill, exit: null, stop, stopKind: kind,
      mark: { when: fill.when, price: fill.price }, open: true, grossPct: 0, netPct: -cost,
      riskPct: riskRaw != null && riskRaw > 0 ? riskRaw : null, r: null, days: 0,
      tag: c.tag, stopSource: c.stopSource, imported: c.imported, c,
    };
    L.r = L.riskPct ? L.netPct / L.riskPct : null;
    legs.push(L);
    leg = L; state = 'in'; stopNow = stop; stopKindNow = kind; best = fill.price;
    return fill.index === signal ? signal + 1 : fill.index;
  };

  const firstStop = strategy.code === 'S3' ? null : c.stop;
  let i = open(c.signal.index, 1, firstStop, strategy.code === 'S3' ? 'negation' : firstStop != null ? 'last full day' : 'none');
  for (; i >= 0 && i <= end; i++) {
    const d = days[i];
    if (state === 'in') {
      const L = leg as Leg;
      if (!d.closeOnly) {
        if (stopNow != null && against(long, ext(d), stopNow)) {
          close(L, { ...fillAgainst(i, stopNow), reason: 'stop', level: stopNow, stopKind: stopKindNow });
          const failed = c.negation != null && against(long, ext(d), c.negation);
          state = !failed && strategy.code === 'S2' && used < strategy.reentries ? 'out' : 'done';
          if (state === 'done') break;
          continue;
        }
        if (c.negation != null && against(long, ext(d), c.negation)) {
          close(L, { ...fillAgainst(i, c.negation), reason: 'negation', level: c.negation });
          state = 'done'; break;
        }
      } else if (c.negation != null && d.c != null && against(long, d.c, c.negation)) {
        close(L, { ...closeFill(i), reason: 'negation', level: c.negation });
        state = 'done'; break;
      }
      if (c.target != null) {
        if (settings.targetOn === 'touch' && !d.closeOnly && atOrPast(long, far(d), c.target)) {
          close(L, { ...fillPast(i, c.target), reason: 'target', level: c.target });
          state = 'done'; break;
        }
        if (d.c != null && atOrPast(long, d.c, c.target)) {
          close(L, { ...closeFill(i), reason: 'target', level: c.target });
          state = 'done'; break;
        }
      }
      if (c.reached && d.when >= c.reached && d.c != null) {
        close(L, { ...closeFill(i), reason: 'reached', level: null });
        state = 'done'; break;
      }
      if (atr && d.c != null) {
        // The trail for tomorrow: the best close since the entry less the ATR multiple, and it only tightens.
        best = long ? Math.max(best, d.c) : Math.min(best, d.c);
        const a = atr[i];
        if (a != null) {
          const trail = best - sgn * TRAIL.atrs * a;
          if (stopNow == null || (long ? trail > stopNow : trail < stopNow)) { stopNow = trail; stopKindNow = 'trailing stop'; }
        }
      }
      if (d.c != null) measure(L, d.when, d.c);
    } else if (state === 'out') {
      if (c.negation != null && against(long, ext(d), c.negation)) { state = 'done'; break; }
      if (d.closeOnly || d.c == null || !past(long, d.c, c.trigger)) continue;
      if (c.target != null && atOrPast(long, d.c, c.target)) { state = 'done'; break; }
      used++;
      const st = settings.reentryStop === 'original'
        ? { at: c.stop, kind: (c.stop != null ? 'last full day' : 'none') as StopKind }
        : newStop(i);
      const first = open(i, used + 1, st.at, st.kind);
      if (first < 0) { state = 'done'; break; }
      i = first - 1;
    }
  }
  // The source dropped the setup with a leg still in: closed at the last close on or before the removal date.
  if (state === 'in' && leg && c.removed) {
    const L = leg as Leg;
    let k = end;
    while (k > L.entry.index && days[k].c == null) k--;
    if (days[k].c != null && k >= L.entry.index) close(L, { ...closeFill(k), reason: 'removed', level: null });
  }
  return { legs, pending };
}
