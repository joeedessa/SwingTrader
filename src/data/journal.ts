import { closeOnOrBefore } from '../engine/journal';
import type { History } from '../engine/types';
import { fetchBarsFor } from './sources';
import type { Deps } from './sources';

/* The prices a journal needs for a symbol that is on neither list: the settled close a new fill starts with (the close of the
   day traded, or the last session before it when the market was shut, so that a fill logged on Sunday for Friday's trade does
   not take Sunday's price), and the latest close an open position is worth. A symbol on the lists reads them from the
   histories already loaded; any other asks Yahoo once, through the same Worker as everything else, and the answer is kept for
   the visit. */

interface Bars {
  closes: [string, number][];
  ccy: string;
}

const extra = new Map<string, Bars | null>();

async function barsFor(sym: string, deps: Deps): Promise<Bars | null> {
  if (extra.has(sym)) return extra.get(sym) ?? null;
  const got = await fetchBarsFor([sym], deps);
  const bars = got.bars[sym];
  // A failed fetch is not remembered: the next try may work.
  if (!bars) return null;
  const out: Bars = {
    closes: Object.keys(bars).sort().filter(d => bars[d][2] != null).map(d => [d, bars[d][2] as number] as [string, number]),
    ccy: got.ccy[sym] ?? '',
  };
  extra.set(sym, out);
  return out;
}

export async function closeFor(
  sym: string, date: string, hist: Record<string, History | undefined>, deps: Deps = {},
): Promise<{ date: string; close: number } | null> {
  const h = hist[sym];
  if (h && h.settled.length) return closeOnOrBefore(h.settled.map(x => [x[0], x[1]] as const), date);
  const bars = await barsFor(sym, deps);
  return bars ? closeOnOrBefore(bars.closes, date) : null;
}

/** The latest settled close for a symbol, and its currency: from the histories for a symbol on a list, else from Yahoo. */
export async function latestCloseFor(
  sym: string, hist: Record<string, History | undefined>, deps: Deps = {},
): Promise<{ date: string; close: number; ccy: string } | null> {
  const h = hist[sym];
  if (h && h.settled.length) { const last = h.settled[h.settled.length - 1]; return { date: last[0], close: last[1], ccy: h.currency }; }
  const bars = await barsFor(sym, deps);
  if (!bars || !bars.closes.length) return null;
  const last = bars.closes[bars.closes.length - 1];
  return { date: last[0], close: last[1], ccy: bars.ccy };
}

/** For tests: forget what was fetched. */
export const forgetFetched = (): void => extra.clear();
