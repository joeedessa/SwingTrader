import { MINUS } from './format';
import type { Dir } from './types';

/* The trade journal: an independent record of the fills actually made, ported from the old page unchanged.

   It is deliberately disconnected from the rules. Logging a buy on a name that is still waiting does not promote it, and
   a setup failing does not touch the log. The tables of setups answer "what is the market doing to my setups"; the
   journal answers "what did I actually do", and conflating the two is how a journal quietly becomes fiction.

   There are no quantities by design: it is a price-and-date journal, and each fill pairs one for one, first in first
   out, to make round trips. A sell with no open buy opens a short and pairs against the next buy, symmetrically.
   P&L is in each instrument's own currency, price-based: nothing is converted. */

export type Side = 'buy' | 'sell';

/** One fill, as the old page wrote it and as tradelog.json holds it. Other keys a file may carry are kept as they are. */
export interface Fill {
  id: string;
  sym: string;
  side: Side | string;
  /** ISO date of the trade, not of the day it was logged. */
  date: string;
  price: number;
  /** True once the price was typed by hand: the date then stops setting it. */
  priceManual?: boolean;
  pattern?: string | null;
  duration_m?: number | null;
  market?: string | null;
  note?: string | null;
  logged_at?: string;
  [key: string]: unknown;
}

export interface ClosedTrade {
  sym: string;
  dir: Dir;
  entry: Fill;
  exit: Fill;
  /** The move in %, signed the trade's way. */
  pnl: number;
  /** Calendar days from the entry's date to the exit's. */
  days: number;
  pattern: string;
  duration_m: number | null;
  market: string;
}

/** A buy opens a long and a sell opens a short. */
export const dirOfSide = (side: string): Dir => (side === 'buy' ? 'long' : 'short');

const DAY = 864e5;

/** Fills in the order they were made (see `logRows`), paired. `opens` lists what is still open, by symbol in the order each
    was first traded; `closed` is oldest exit first. */
export function pairFills(rows: readonly Fill[]): { opens: Fill[]; closed: ClosedTrade[] } {
  const open = new Map<string, Fill[]>();
  const closed: ClosedTrade[] = [];
  for (const f of rows) {
    let q = open.get(f.sym);
    if (!q) { q = []; open.set(f.sym, q); }
    if (q.length && q[0].side !== f.side) {
      const e = q.shift() as Fill;
      const long = e.side === 'buy';
      const pnl = long ? (f.price / e.price - 1) * 100 : (e.price / f.price - 1) * 100;
      closed.push({
        sym: f.sym, dir: long ? 'long' : 'short', entry: e, exit: f, pnl,
        days: Math.round((Date.parse(f.date) - Date.parse(e.date)) / DAY),
        pattern: e.pattern || f.pattern || '', duration_m: e.duration_m ?? null,
        market: e.market || f.market || '',
      });
    } else q.push(f);
  }
  const opens: Fill[] = [];
  for (const q of open.values()) opens.push(...q);
  return { opens, closed };
}

/** The move since an open fill, in %, against the latest price; null without one. */
export function unrealised(e: Fill, live: number | null | undefined): number | null {
  if (live == null || !isFinite(live) || !e.price) return null;
  return e.side === 'buy' ? (live / e.price - 1) * 100 : (e.price / live - 1) * 100;
}

export interface JournalStats {
  logged: number;
  open: number;
  closed: number;
  winners: number;
  /** Winners as a share of closed trades, rounded to a whole percent; null with none closed. */
  winPct: number | null;
  avgWin: number | null;
  avgLoss: number | null;
}

/** A trade that ends exactly flat counts as a loss, as it did on the old page. */
export function journalStats(rows: readonly Fill[], opens: readonly Fill[], closed: readonly ClosedTrade[]): JournalStats {
  const wins = closed.filter(c => c.pnl > 0);
  const losses = closed.filter(c => c.pnl <= 0);
  const avg = (a: ClosedTrade[]) => (a.length ? a.reduce((x, y) => x + y.pnl, 0) / a.length : null);
  return {
    logged: rows.length, open: opens.length, closed: closed.length, winners: wins.length,
    winPct: closed.length ? Math.round(wins.length / closed.length * 100) : null,
    avgWin: avg(wins), avgLoss: avg(losses),
  };
}

/** "5 open · 4 closed · 3 winners (75%) · avg win +8.2% · avg loss −2.0% — P&L in each instrument's own currency, ...".
    The old page's sentence; the one change is a real minus sign. */
export function statsLine(s: JournalStats): string {
  if (!s.logged) return 'Nothing logged yet.';
  const one = (v: number) => (v < 0 ? MINUS : '') + Math.abs(v).toFixed(1);
  return s.open + ' open · ' + s.closed + ' closed' +
    (s.closed ? ' · ' + s.winners + ' winners (' + s.winPct + '%)' +
      (s.avgWin != null ? ' · avg win +' + one(s.avgWin) + '%' : '') +
      (s.avgLoss != null ? ' · avg loss ' + one(s.avgLoss) + '%' : '') : '') +
    " — P&L in each instrument's own currency, price-based, no sizes.";
}

/** The settled close on or before a date, from closes sorted oldest first: the price a fill defaults to. */
export function closeOnOrBefore(closes: readonly (readonly [string, number])[], date: string): { date: string; close: number } | null {
  let best: { date: string; close: number } | null = null;
  for (const [d, c] of closes) { if (d <= date) best = { date: d, close: c }; else break; }
  return best;
}

/** What the journal says is held: the open fills by `sym|dir`, oldest first. A buy that is open means a long is held, a sell
    that is open a short. This marks a row on the Positions page; it is never an input to the rules. */
export function heldMap(opens: readonly Fill[]): Map<string, Fill[]> {
  const out = new Map<string, Fill[]>();
  for (const f of opens) {
    const k = f.sym + '|' + dirOfSide(f.side);
    const list = out.get(k);
    if (list) list.push(f); else out.set(k, [f]);
  }
  return out;
}
