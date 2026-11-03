import { TRAIL } from './settings';
import type { Day } from './universe';

/* The average true range Wilder's way, the one TradingView prints and the Positions page reads (fetch_events.py checked
   it against an independent calculation): the first value is the plain mean of the first `period` true ranges, and
   each one after is (previous × (period − 1) + today's range) / period. Before the period is full the mean of what
   there is stands in, so a short history gives a rougher number rather than none.

   A true range needs the previous close: max(high − low, |high − previous close|, |low − previous close|). A close-only
   day has no range, so it carries the value before it, and a bar with no close leaves the previous close as it was. */
export function atrSeries(days: readonly Day[], period: number = TRAIL.period): (number | null)[] {
  const out: (number | null)[] = new Array(days.length).fill(null);
  let prevClose: number | null = null;
  let atr: number | null = null;
  let n = 0;
  let sum = 0;
  for (let i = 0; i < days.length; i++) {
    const d = days[i];
    if (d.closeOnly) { out[i] = atr; continue; }
    if (prevClose != null) {
      const tr = Math.max(d.hi - d.lo, Math.abs(d.hi - prevClose), Math.abs(d.lo - prevClose));
      n++;
      if (n <= period) { sum += tr; atr = sum / n; }
      else atr = ((atr as number) * (period - 1) + tr) / period;
    }
    out[i] = atr;
    if (d.c != null) prevClose = d.c;
  }
  return out;
}
