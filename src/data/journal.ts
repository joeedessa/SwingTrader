import { closeOnOrBefore } from '../engine/journal';
import type { History } from '../engine/types';
import { fetchBarsFor } from './sources';
import type { Deps } from './sources';

/* The price a new fill starts with: the settled close of the day traded (or the last session before it, when the market was
   shut), so that a fill logged on Sunday for Friday's trade does not take Sunday's price. A symbol on the lists reads it
   from the histories already loaded; any other symbol asks Yahoo once, through the same Worker as everything else, and
   keeps the answer for the visit. */

const extra = new Map<string, [string, number][] | null>();

export async function closeFor(
  sym: string, date: string, hist: Record<string, History | undefined>, deps: Deps = {},
): Promise<{ date: string; close: number } | null> {
  const h = hist[sym];
  if (h && h.settled.length) return closeOnOrBefore(h.settled.map(x => [x[0], x[1]] as const), date);
  if (!extra.has(sym)) {
    const got = await fetchBarsFor([sym], deps);
    const bars = got.bars[sym];
    // A failed fetch is not remembered: the next try may work.
    if (!bars) return null;
    extra.set(sym, Object.keys(bars).sort().filter(d => bars[d][2] != null).map(d => [d, bars[d][2] as number] as [string, number]));
  }
  const closes = extra.get(sym);
  return closes ? closeOnOrBefore(closes, date) : null;
}

/** For tests: forget what was fetched. */
export const forgetFetched = (): void => extra.clear();
