import { CALENDAR_KINDS, rowKeyOf } from './chips';
import { lfdRisk } from './derived';
import { activeStop } from './flags';
import type { Flag } from './flags';
import { daysUntil } from './format';
import type { Board, Row } from './row';
import type { Dir, History } from './types';

/* Positions: am I still right, and where do I get out? (plan A5)

   The stop ladder lists what is in trade, Confirmed and Re-entered, nearest its stop first. A stopped-out row is not on it
   (nothing is held; it waits for a re-entry close), and neither is one at its target. The stop is the last full day where
   one is known and tighter than the pattern, else the negation: the same level the near-stop flag reads.

   Everything here is read off the settled replay and the latest price, like the board. A journal fill never feeds back into
   the rules: "held" is a mark the page adds from the journal, not an input. */

export interface Entry {
  /** The date of the close the trade is measured from. */
  when: string;
  /** That close, or null where the bars do not show it (an imported row whose confirming close is not in the history). */
  price: number | null;
  /** The first close past the trigger, or the close that re-entered after an exit. */
  kind: 'confirmation' | 'reentry';
}

export interface Position {
  row: Row;
  key: string;
  entry: Entry | null;
  stop: { level: number; kind: 'last full day' | 'negation' } | null;
  /** Live price to the stop, in %: the give-back the trade can take. Negative once the price is past it. */
  gapPct: number | null;
  /** The same distance in ATRs, where the symbol has one. */
  atrs: number | null;
  /** The move since entry in multiples of the risk taken (entry to stop), signed the trade's way. */
  r: number | null;
  /** Calendar days since the entry. */
  days: number | null;
}

export interface PositionsView {
  /** In trade, nearest stop first. */
  ladder: Position[];
  /** Stopped out and waiting for a close back past the trigger, in the board's order. */
  stopped: Row[];
  tiles: {
    inTrade: number;
    stopped: number;
    /** The first rung of the ladder with a distance to measure. */
    nearest: Position | null;
    /** Earnings and ex-dividend dates inside the flags' window, on names in the ladder. */
    events: number;
  };
}

const closeOn = (hist: History | undefined, date: string): number | null => {
  if (!hist) return null;
  for (const [d, c] of hist.settled) if (d === date) return c;
  return null;
};

/** What the trade is measured from: the close that re-entered, else the close that confirmed the breakout. For a row
    imported already confirmed the replay has no close, so the confirming close the stop derivation found is looked up. */
export function entryOf(r: Row, hist: History | undefined): Entry | null {
  const T = r.btype;
  if (r.section === 'reentered' && T && T.reentry) return { when: T.reentry.when, price: T.reentry.close, kind: 'reentry' };
  const b = r.st.breakout;
  if (!b) return null;
  if (b.close != null) return { when: b.when, price: b.close, kind: 'confirmation' };
  const conf = r.lfd && r.lfd.conf;
  if (conf) return { when: conf, price: closeOn(hist, conf), kind: 'confirmation' };
  return { when: b.when, price: null, kind: 'confirmation' };
}

/** Multiples of the risk taken: how far price has moved from the entry, over how far the stop was from it. Null where
    there is no entry price or stop, or the stop was not on the losing side of the entry. */
export function rMultiple(dir: Dir, entry: number | null, stop: number | null, price: number | null): number | null {
  if (entry == null || stop == null || price == null) return null;
  const sgn = dir === 'long' ? 1 : -1;
  const risk = (entry - stop) * sgn;
  // `+ 0` keeps a short that has not moved from reading "-0".
  return risk > 0 ? (price - entry) * sgn / risk + 0 : null;
}

export function positionOf(r: Row, hist: History | undefined, today: string): Position {
  const entry = entryOf(r, hist);
  const stop = activeStop(r);
  const sgn = r.p.dir === 'long' ? 1 : -1;
  const price = r.live ?? r.prevClose;
  // The same give-back the Confirmed section sorts by, so the ladder and the section agree on who is nearest.
  const gapPct = stop ? (stop.kind === 'last full day' ? lfdRisk(r.p.dir, r.lfd, r.live) : r.risk) : null;
  const atr = r.ev.atr;
  const atrs = stop && price != null && atr != null && atr > 0 ? (price - stop.level) * sgn / atr : null;
  const since = entry ? daysUntil(entry.when, today) : null;
  return {
    row: r, key: rowKeyOf(r.p.sym, r.p.dir), entry, stop, gapPct, atrs,
    r: rMultiple(r.p.dir, entry ? entry.price : null, stop ? stop.level : null, price),
    days: since == null ? null : Math.max(0, -since),
  };
}

/** Nearest its stop first; a row with no distance to measure last. Equal distances keep the list's order. */
export function byNearestStop(a: Position, b: Position): number {
  if (a.gapPct == null && b.gapPct == null) return 0;
  if (a.gapPct == null) return 1;
  if (b.gapPct == null) return -1;
  return a.gapPct - b.gapPct;
}

export function positionsView(bd: Board, hist: Record<string, History | undefined>, flags: readonly Flag[], today: string): PositionsView {
  const rows = [...bd.bySection.breakout, ...bd.bySection.reentered];
  const ladder = rows.map(r => positionOf(r, hist[r.p.sym], today)).sort(byNearestStop);
  const onLadder = new Set(ladder.map(p => p.key));
  const events = flags.filter(f => CALENDAR_KINDS.includes(f.kind) && f.sym && f.dir && onLadder.has(rowKeyOf(f.sym, f.dir))).length;
  return {
    ladder,
    stopped: bd.bySection.stopped,
    tiles: { inTrade: ladder.length, stopped: bd.bySection.stopped.length, nearest: ladder.find(p => p.gapPct != null) ?? null, events },
  };
}
