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
   the next session's open where the bars have it, else the confirming close itself (Q6); or, under the trigger entry
   (revision 9), a buy-stop at the trigger: filled on the day that closes past the trigger, at the trigger, or at the
   open where that day opened past it. A setup imported already confirmed enters from the report that listed it
   (revision 8): the first session after the report's date, at its open, or at its close under the close entry; under
   the trigger entry the buy-stop rests from that session, filled at the first open at or past the trigger, or at the
   trigger on the first session whose range reaches it. The confirming close the lookback found is the other setting.

   The day the trigger filled. Its low or high is not read for a stop: the price came from the other side of the
   trigger, as the board reads no negation touch on the breakout day either; its close is read for the target, and on
   a touch basis a range past the target that day is the target, since the price passed the trigger on the way.

   Entries the rules would not take. Nobody buys a breakout whose confirming close is already at the target, or at a
   next open that is past the target, or at one that is already at or beyond the stop (the negation, for S3; S0's stop
   is the trigger, and only a fill beyond it is refused, since a fill at the trigger is its own entry): no leg is
   opened. After a refused open the setup stands where the board puts it, out after a breach, so S2 waits for the
   next close back past the trigger, and the others are done. S0 plays B1 only: a setup that pulled back to the
   trigger between its confirming close and the report that listed it is not taken.

   What ends a setup. A touch of the negation (failed is final: no re-entry after it), the target (on a close, or on
   a touch under that setting, even while out), the source's `reached` date, the removal date, and for S2 the stop-out
   after the last re-entry allowed. A close that is back past the trigger while out is a re-entry, unless it is also
   at the target: the setup is over then. A close-only day (the newest session, settled by its close alone) gives no
   touch and no re-entry, as the board's own counting reads none from it; its close still tests the negation and the
   target, as the replay's does, and a fill due at its open is still to come. */

export type ExitReason = 'stop' | 'negation' | 'target' | 'reached' | 'removed';

export type StopKind = 'last full day' | 'new last full day' | 'trailing stop' | 'negation' | 'trigger' | 'none';

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
  /** Why the first entry gave no leg: a fill still to come ("waiting for …"), or one the rules would not take. */
  note: string | null;
  /** A re-entry whose fill is a session that has not happened yet. */
  waiting: string | null;
  /** The days of re-entry closes whose next open was at or beyond the stop, so no leg was taken. */
  refused: string[];
}

export const WAITING = 'waiting for the next open';
/** The trigger entry on the newest session, known by its close alone: the fill is on its bar. */
export const WAITING_BAR = 'waiting for the session\'s bar';
/** A buy-stop at the trigger, resting from the report, that no session has filled yet. */
export const WAITING_TRIGGER = 'waiting for a session back at the trigger';
/** The same with no session after the report on file yet. */
export const WAITING_SESSION = 'waiting for the next session';
const NEGATED_RESTING = 'the negation was touched before the buy-stop at the trigger filled';
const PULLED_BACK = 'pulled back to the trigger before';

/** A note that says the fill is still to come, rather than refused. */
export const isWaiting = (note: string | null): boolean => note != null && note.startsWith('waiting for ');

/** A leg opened, with the first index exits are read on; or why not, with the index of the fill that was refused. */
type Opened = { first: number } | { outcome: 'waiting' | 'removed' | 'atTarget' | 'pastTarget' | 'atStop' | 'beyondNegation' | 'pulledBack'; index: number; basis?: FillBasis };

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
  const byTrigger = settings.entry === 'trigger';
  const s0 = strategy.code === 'S0';

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
  // A level reached the trade's way (the target; the trigger, for a buy-stop at it): the same, from the other side.
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

  // Typed by assertion rather than by the first value, since `take` below assigns them from inside a closure.
  let state = 'done' as 'in' | 'out' | 'resting' | 'done';
  let leg = null as Leg | null;
  let stopNow = null as number | null;
  let stopKindNow: StopKind = 'none';
  let best = 0;   // S4: the best close since the entry
  let used = 0;   // re-entries taken
  let rested = false;   // a session was read with the buy-stop resting

  /** Takes a fill, or says why the rules would not. */
  const take = (fill: Fill, n: number, stop: number | null, kind: StopKind): Opened => {
    const level = stop ?? c.negation;
    if (c.negation != null && against(long, fill.price, c.negation)) return { outcome: 'beyondNegation', index: fill.index, basis: fill.basis };
    // S0's stop is the trigger, and a fill at the trigger is its own entry: only a fill beyond it is refused.
    if (level != null && (kind === 'trigger' ? against(long, fill.price, level) : atOrAgainst(long, fill.price, level))) return { outcome: 'atStop', index: fill.index, basis: fill.basis };
    if (c.target != null && atOrPast(long, fill.price, c.target)) return { outcome: 'pastTarget', index: fill.index, basis: fill.basis };
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
    // from the next day; a fill at an open or at the trigger is not, so the first close sets the best.
    best = fill.basis === 'close' ? fill.price : (long ? -Infinity : Infinity);
    if (atr && fill.basis === 'close') ratchet(fill.index);
    // Exits are read from the day after a fill at a close, and on the fill day itself after a fill at its open or at
    // the trigger (the trigger day's close, not its range: see the loop).
    return { first: fill.basis === 'close' ? fill.index + 1 : fill.index };
  };

  /** Opens a leg on a signal day, or says why not. */
  const open = (signal: number, n: number, stop: number | null, kind: StopKind): Opened => {
    const sc = days[signal].c as number;
    if (byTrigger) {
      // A buy-stop at the trigger, filled on the day that closed past it: the close that follows is read as any other,
      // so a close at the target that day is the exit, not a reason to refuse the fill.
      if (days[signal].closeOnly) return { outcome: 'waiting', index: signal };
      return take(fillPast(signal, c.trigger), n, stop, kind);
    }
    if (c.target != null && atOrPast(long, sc, c.target)) return { outcome: 'atTarget', index: signal };
    const next = signal + 1;
    let fill: Fill;
    if (settings.entry === 'open') {
      if (next > end) return { outcome: next < days.length ? 'removed' : 'waiting', index: next };
      const d = days[next];
      if (d.closeOnly) return { outcome: 'waiting', index: next };
      // A day written before opens were kept has none to fill at: the confirming close stands in.
      fill = d.o != null ? { when: d.when, price: d.o, basis: 'open', index: next } : closeFill(signal);
    } else if (n === 1 && c.signalKind === 'report') {
      // Entered from the report, which came out after the last close before it: the first session after it, at its close.
      if (next > end) return { outcome: next < days.length ? 'removed' : 'waiting', index: next };
      if (days[next].c == null) return { outcome: 'waiting', index: next };
      fill = closeFill(next);
    } else fill = closeFill(signal);
    // A report-day signal with no open on file to fill at fills at that first session's close, never at the close before the report.
    if (n === 1 && c.signalKind === 'report' && fill.index === signal) {
      if (days[next].c == null) return { outcome: 'waiting', index: next };
      fill = closeFill(next);
    }
    // B1 only, entered from the report at a close: a first session that touched the trigger was the pullback S0 does not play.
    if (s0 && n === 1 && c.signalKind === 'report' && fill.basis === 'close' && atOrAgainst(long, ext(days[fill.index]), c.trigger)) return { outcome: 'pulledBack', index: fill.index };
    return take(fill, n, stop, kind);
  };

  /** S4: the trail for tomorrow, from the best close so far less the ATR multiple; it only ever tightens what is in
      force: the stop, or the negation where the leg runs on it. */
  function ratchet(i: number): void {
    const a = atr ? atr[i] : null;
    if (a == null || !isFinite(best)) return;
    const trail = best - sgn * TRAIL.atrs * a;
    const floor = stopNow ?? c.negation;
    if (floor == null || (tighter(trail, floor) === trail && trail !== floor)) { stopNow = trail; stopKindNow = 'trailing stop'; }
  }

  /** The stop in force is touched: at or beyond the trigger (the board's pullback rule) for S0, strictly beyond otherwise. */
  const stopTouched = (d: Day): boolean =>
    stopNow != null && (stopKindNow === 'trigger' ? atOrAgainst(long, ext(d), stopNow) : against(long, ext(d), stopNow));

  // The fill a first entry was refused at: the next open; the open or the trigger under the trigger entry; the first
  // close after the report; or the confirming close itself.
  const fillWords = (basis: FillBasis | undefined): string =>
    basis === 'open' ? (byTrigger ? 'the open past the trigger' : 'the next open')
    : basis === 'level' ? 'the trigger'
    : byTrigger ? 'the close of a day entirely past the trigger'
    : c.signalKind === 'report' ? 'the first close after the report' : 'the confirming close';
  const words = (o: Exclude<Opened, { first: number }>): string => ({
    waiting: byTrigger ? WAITING_BAR : WAITING,
    removed: 'removed by the source before the fill',
    atTarget: c.signalKind === 'report' ? 'at the target on the last close before the report' : 'at the target on the confirming close',
    pastTarget: `${fillWords(o.basis)} was past the target`,
    atStop: `${fillWords(o.basis)} was ${s0 ? 'beyond the trigger' : `at or beyond the ${strategy.code === 'S3' ? 'negation' : 'stop'}`}`,
    beyondNegation: `${fillWords(o.basis)} was beyond the negation`,
    pulledBack: `${PULLED_BACK} the fill`,
  })[o.outcome];

  /** S0, entered from the report: whether the trigger was touched between the confirming close and the report's day. */
  const pulledBackBeforeReport = (): boolean => {
    if (!c.confirming) return false;
    const ci = days.findIndex(d => d.when === (c.confirming as { when: string }).when);
    for (let k = ci + 1; k <= c.signal.index; k++) if (!days[k].closeOnly && atOrAgainst(long, ext(days[k]), c.trigger)) return true;
    return false;
  };
  // S0 runs on the trigger; S3 on the negation; the others on the tight stop, or on the negation where the report gives none.
  const firstStop = s0 ? c.trigger : strategy.code === 'S3' ? null : c.stop;
  const firstKind: StopKind = s0 ? 'trigger' : strategy.code === 'S3' || firstStop == null ? (c.negation != null ? 'negation' : 'none') : 'last full day';

  let i: number;
  if (c.outAtSignal && strategy.code !== 'S3') {
    // The board had this setup out when the report came: no first leg; S2 waits for a close back past the trigger.
    if (strategy.code !== 'S2') { out.note = 'stopped out before the report, and this strategy does not re-enter'; return out; }
    out.note = 'stopped out before the report: in only on a close back past the trigger';
    state = 'out'; i = c.signal.index + 1;
  } else if (s0 && c.signalKind === 'report' && pulledBackBeforeReport()) {
    // B1 only: the trigger was touched between the confirming close and the report, so the setup was B2 by the time it was listed.
    out.note = `${PULLED_BACK} the report`;
    return out;
  } else if (byTrigger && c.signalKind === 'report') {
    // Entered from the report with a buy-stop at the trigger: it rests from the first session after the report.
    state = 'resting'; i = c.signal.index + 1;
  } else {
    const opened = open(c.signal.index, 1, firstStop, firstKind);
    if ('first' in opened) i = opened.first;
    else {
      out.note = words(opened);
      // A refused open on a breakout the board counts as breached: S2 waits for the close back past the trigger.
      if (opened.outcome === 'atStop' && strategy.code === 'S2') { state = 'out'; i = opened.index + 1; }
      else return out;
    }
  }
  for (; i <= end; i++) {
    const d = days[i];
    if (state === 'in') {
      const L = leg as Leg;
      // The range of the day the trigger filled is not read for a stop: the price came from the other side of the trigger.
      const intraday = !d.closeOnly && !(i === L.entry.index && L.entry.basis === 'level');
      // A day that opens at or past the target has it before anything else can happen, on a touch basis.
      if (touch && c.target != null && d.o != null && !d.closeOnly && atOrPast(long, d.o, c.target)) {
        close(L, { ...fillPast(i, c.target), reason: 'target', level: c.target });
        state = 'done'; break;
      }
      if (intraday) {
        if (stopTouched(d)) {
          const level = stopNow as number;
          close(L, { ...fillAgainst(i, level), reason: 'stop', level, stopKind: stopKindNow });
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
      } else if (d.closeOnly && c.negation != null && d.c != null && against(long, d.c, c.negation)) {
        close(L, { ...closeFill(i), reason: 'negation', level: c.negation });
        state = 'done'; break;
      }
      if (c.target != null) {
        // On the trigger's fill day a range past the target is a touch after the fill: the price passed the trigger on the way.
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
      const reentry = !d.closeOnly && d.c != null && past(long, d.c, c.trigger);
      // A touch of the target while out ends the setup, unless a buy-stop at the trigger filled that day on the way to it.
      if (touch && c.target != null && !d.closeOnly && atOrPast(long, far(d), c.target) && !(byTrigger && reentry)) { state = 'done'; break; }
      if (!reentry) continue;
      // A re-entry close that is also at the target: nobody buys there. Under the trigger entry the fill came before
      // that close, which is then the exit.
      if (!byTrigger && c.target != null && atOrPast(long, d.c as number, c.target)) { state = 'done'; break; }
      used++;
      const st = settings.reentryStop === 'original'
        ? { at: c.stop, kind: (c.stop != null ? 'last full day' : c.negation != null ? 'negation' : 'none') as StopKind }
        : newStop(i);
      const re = open(i, used + 1, st.at, st.kind);
      if ('first' in re) { i = re.first - 1; continue; }
      if (re.outcome === 'waiting') { out.waiting = `${byTrigger ? WAITING_BAR : WAITING} to re-enter (${used})`; state = 'done'; break; }
      if (re.outcome === 'atStop') {
        // The board counts a breach on that open; the setup is out again, with one re-entry fewer to take.
        out.refused.push(d.when);
        if (used >= strategy.reentries) { state = 'done'; break; }
        i = re.index;   // read on from the day after the fill that was refused
        continue;
      }
      state = 'done'; break;
    } else if (state === 'resting') {
      // A buy-stop at the trigger, resting from the report: filled at the open where a session opened at or past the
      // trigger (the day is then read as any other), else at the trigger where the session's range reached it; a day
      // with no open on file that traded entirely past the trigger fills at its close. Before a fill at the trigger, a
      // touch of the negation that day cancels the order: the board has the setup failed, and the low is read first.
      // S0 takes only a session that opened past the trigger: one that comes back to it is the pullback it does not play.
      rested = true;
      if (d.closeOnly) {
        if (c.negation != null && d.c != null && against(long, d.c, c.negation)) { out.note = NEGATED_RESTING; state = 'done'; break; }
        out.note = WAITING_BAR; state = 'done'; break;
      }
      const atOpen = d.o != null && atOrPast(long, d.o, c.trigger);
      const wholeDay = d.o == null && atOrPast(long, ext(d), c.trigger);
      if (!atOpen && !wholeDay) {
        if (s0) { out.note = `${PULLED_BACK} the fill`; state = 'done'; break; }
        if (c.negation != null && against(long, ext(d), c.negation)) { out.note = NEGATED_RESTING; state = 'done'; break; }
        if (!atOrPast(long, far(d), c.trigger)) {
          if (c.reached && d.when >= c.reached) { out.note = 'the source counted the target before the buy-stop at the trigger filled'; state = 'done'; break; }
          continue;
        }
      }
      const opened = take(fillPast(i, c.trigger), 1, firstStop, firstKind);
      if ('first' in opened) { i = opened.first - 1; continue; }
      out.note = words(opened);
      if (opened.outcome === 'atStop' && strategy.code === 'S2') { state = 'out'; continue; }
      state = 'done'; break;
    }
  }
  if (state === 'resting') out.note = c.removed ? 'removed by the source before the fill' : rested ? WAITING_TRIGGER : WAITING_SESSION;
  // The source dropped the setup with a leg still in: closed at the last close on or before the removal date.
  if (state === 'in' && leg && c.removed) {
    const L = leg as Leg;
    let k = end;
    while (k > L.entry.index && days[k].c == null) k--;
    if (days[k].c != null && k >= L.entry.index) close(L, { ...closeFill(k), reason: 'removed', level: null });
  }
  return out;
}
