import { LFD_LOOKBACK } from '../lfd';
import { spanDays } from '../outcomes';
import { against, atOrAgainst, atOrPast, past, sig7 } from '../precision';
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

   Entries the rules would not take. Nobody buys a breakout whose confirming close is already at the target, or at a
   next open that is past the target, or at one that is already at or beyond the stop (the negation, for S3): no leg
   is opened. After a refused open the setup stands where the board puts it, out after a breach, so S2 waits for the
   next close back past the trigger, and the others are done.

   What ends a setup. A touch of the negation (failed is final: no re-entry after it), the target (on a close, or on
   a touch under that setting, even while out), the source's `reached` date, the removal date, and for S2 the stop-out
   after the last re-entry allowed. A close that is back past the trigger while out is a re-entry, unless it is also
   at the target: the setup is over then. A close-only day (the newest session, settled by its close alone) gives no
   touch and no re-entry, as the board's own counting reads none from it; its close still tests the negation and the
   target, as the replay's does, and a fill due at its open is still to come. */

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
  /** The entry's distance to the stop (the negation with no stop) as a share of the entry, in %, at 7 significant digits; null with no level on the losing side. */
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
  /** Why the first entry gave no leg: a fill still to come ("waiting for the next open"), or one the rules would not take. */
  note: string | null;
  /** A re-entry whose fill is a session that has not happened yet. */
  waiting: string | null;
  /** The days of re-entry closes whose next open was at or beyond the stop, so no leg was taken. */
  refused: string[];
}

export const WAITING = 'waiting for the next open';

/** A leg opened, with the first index exits are read on; or why not, with the index of the fill that was refused. */
type Opened = { first: number } | { outcome: 'waiting' | 'removed' | 'atTarget' | 'pastTarget' | 'atStop' | 'beyondNegation'; index: number };

export function simulate(c: Candidate, strategy: Strategy, settings: ModelSettings): Simulation {
  const long = c.dir === 'long';
  const sgn = long ? 1 : -1;
  const days = c.days;
  const cost = roundTripPct(settings);
  const legs: Leg[] = [];
  const out: Simulation = { legs, note: null, waiting: null, refused: [] };
  // The record ends at the removal date where the source dropped the setup.
  let end = days.length - 1;
  if (c.removed) while (end >= 0 && days[end].when > c.removed) end--;
  const atr = strategy.code === 'S4' ? atrSeries(days) : null;
  const touch = settings.targetOn === 'touch';

  const ext = (d: Day): number => long ? d.lo : d.hi;   // the side a stop or the negation is touched on
  const far = (d: Day): number => long ? d.hi : d.lo;   // the side the target is touched on
  const tighter = (a: number, b: number): number => long ? Math.max(a, b) : Math.min(a, b);
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

  /* The stop a re-entry gets when it is not the original: read as the first one was (lfd.ts), from the bar before the
     run of closes past the boundary that carries into the re-entry close, or, with no boundary, from the bar before
     the re-entry close itself; none when that bar is beyond the negation or out of the lookback. */
  const newStop = (ri: number): { at: number | null; kind: StopKind } => {
    let a = ri, n = 0;
    if (c.boundary != null) {
      while (a > 0 && n < LFD_LOOKBACK && days[a - 1].c != null && past(long, days[a - 1].c as number, c.boundary)) { a--; n++; }
      if (n >= LFD_LOOKBACK) return { at: null, kind: 'none' };
    }
    if (a < 1 || days[a - 1].closeOnly) return { at: null, kind: 'none' };
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

  /** Opens a leg on a signal day, or says why not. */
  const open = (signal: number, n: number, stop: number | null, kind: StopKind): Opened => {
    const sc = days[signal].c as number;
    if (c.target != null && atOrPast(long, sc, c.target)) return { outcome: 'atTarget', index: signal };
    const next = signal + 1;
    let fill: Fill;
    if (settings.entry === 'open') {
      if (next > end) return { outcome: next < days.length ? 'removed' : 'waiting', index: next };
      const d = days[next];
      if (d.closeOnly) return { outcome: 'waiting', index: next };
      // A day written before opens were kept has none to fill at: the confirming close stands in.
      fill = d.o != null ? { when: d.when, price: d.o, basis: 'open', index: next } : closeFill(signal);
    } else fill = closeFill(signal);
    const level = stop ?? c.negation;
    if (c.negation != null && against(long, fill.price, c.negation)) return { outcome: 'beyondNegation', index: fill.index };
    if (level != null && atOrAgainst(long, fill.price, level)) return { outcome: 'atStop', index: fill.index };
    if (c.target != null && atOrPast(long, fill.price, c.target)) return { outcome: 'pastTarget', index: fill.index };
    const riskRaw = level == null ? null : (sig7(fill.price) - sig7(level)) * sgn / sig7(fill.price) * 100;
    const L: Leg = {
      key: c.key, sym: c.sym, dir: c.dir, currency: c.currency, n, entry: fill, exit: null, stop, stopKind: kind,
      mark: { when: fill.when, price: fill.price }, open: true, grossPct: 0, netPct: -cost,
      riskPct: riskRaw != null && riskRaw > 0 ? riskRaw : null, r: null, days: 0,
      tag: c.tag, stopSource: c.stopSource, imported: c.imported, c,
    };
    L.r = L.riskPct ? L.netPct / L.riskPct : null;
    legs.push(L);
    leg = L; state = 'in'; stopNow = stop; stopKindNow = kind;
    // S4: the trail follows closes only. A fill at the confirming close is one, and the trail from it is in force
    // from the next day; a fill at an open is not, so the first close sets the best.
    best = fill.basis === 'close' ? fill.price : (long ? -Infinity : Infinity);
    if (atr && fill.basis === 'close') ratchet(fill.index);
    return { first: fill.index === signal ? signal + 1 : fill.index };
  };

  /** S4: the trail for tomorrow, from the best close so far less the ATR multiple; it only ever tightens. */
  function ratchet(i: number): void {
    const a = atr ? atr[i] : null;
    if (a == null || !isFinite(best)) return;
    const trail = best - sgn * TRAIL.atrs * a;
    if (stopNow == null || tighter(trail, stopNow) === trail && trail !== stopNow) { stopNow = trail; stopKindNow = 'trailing stop'; }
  }

  const words: Record<Exclude<Opened, { first: number }>['outcome'], string> = {
    waiting: WAITING,
    removed: 'removed by the source before the fill',
    atTarget: 'at the target on the confirming close',
    pastTarget: 'the next open was past the target',
    atStop: strategy.code === 'S3' ? 'the next open was at or beyond the negation' : 'the next open was at or beyond the stop',
    beyondNegation: 'the next open was beyond the negation',
  };

  const firstStop = strategy.code === 'S3' ? null : c.stop;
  const opened = open(c.signal.index, 1, firstStop, strategy.code === 'S3' ? 'negation' : firstStop != null ? 'last full day' : 'none');
  let i: number;
  if ('first' in opened) i = opened.first;
  else {
    out.note = words[opened.outcome];
    // A refused open on a breakout the board counts as breached: S2 waits for the close back past the trigger.
    if (opened.outcome === 'atStop' && strategy.code === 'S2') { state = 'out'; i = opened.index + 1; }
    else return out;
  }
  for (; i <= end; i++) {
    const d = days[i];
    if (state === 'in') {
      const L = leg as Leg;
      // A day that opens at or past the target has it before anything else can happen, on a touch basis.
      if (touch && c.target != null && d.o != null && !d.closeOnly && atOrPast(long, d.o, c.target)) {
        close(L, { ...fillPast(i, c.target), reason: 'target', level: c.target });
        state = 'done'; break;
      }
      if (!d.closeOnly) {
        if (stopNow != null && against(long, ext(d), stopNow)) {
          close(L, { ...fillAgainst(i, stopNow), reason: 'stop', level: stopNow, stopKind: stopKindNow });
          const over = (c.negation != null && against(long, ext(d), c.negation))
            || (c.target != null && d.c != null && atOrPast(long, d.c, c.target))
            || (touch && c.target != null && atOrPast(long, far(d), c.target))
            || (c.reached != null && d.when >= c.reached);
          state = !over && strategy.code === 'S2' && used < strategy.reentries ? 'out' : 'done';
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
        if (touch && !d.closeOnly && atOrPast(long, far(d), c.target)) {
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
      if (atr && d.c != null && !d.closeOnly) {
        best = long ? Math.max(best, d.c) : Math.min(best, d.c);
        ratchet(i);
      }
      if (d.c != null) measure(L, d.when, d.c);
    } else if (state === 'out') {
      if (c.negation != null && against(long, ext(d), c.negation)) { state = 'done'; break; }
      if (c.reached && d.when >= c.reached) { state = 'done'; break; }
      if (touch && c.target != null && !d.closeOnly && atOrPast(long, far(d), c.target)) { state = 'done'; break; }
      if (d.closeOnly || d.c == null || !past(long, d.c, c.trigger)) continue;
      if (c.target != null && atOrPast(long, d.c, c.target)) { state = 'done'; break; }
      used++;
      const st = settings.reentryStop === 'original'
        ? { at: c.stop, kind: (c.stop != null ? 'last full day' : 'none') as StopKind }
        : newStop(i);
      const re = open(i, used + 1, st.at, st.kind);
      if ('first' in re) { i = re.first - 1; continue; }
      if (re.outcome === 'waiting') { out.waiting = `${WAITING} to re-enter (${used})`; state = 'done'; break; }
      if (re.outcome === 'atStop') {
        // The board counts a breach on that open; the setup is out again, with one re-entry fewer to take.
        out.refused.push(d.when);
        if (used >= strategy.reentries) { state = 'done'; break; }
        i = re.index;   // read on from the day after the fill that was refused
        continue;
      }
      state = 'done'; break;
    }
  }
  // The source dropped the setup with a leg still in: closed at the last close on or before the removal date.
  if (state === 'in' && leg && c.removed) {
    const L = leg as Leg;
    let k = end;
    while (k > L.entry.index && days[k].c == null) k--;
    if (days[k].c != null && k >= L.entry.index) close(L, { ...closeFill(k), reason: 'removed', level: null });
  }
  return out;
}
