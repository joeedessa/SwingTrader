import { describe, expect, it } from 'vitest';
import type { Bars, History } from '../../src/engine/types';
import barsFile from '../../public/data/bars.json';
import dump from './old-page-2026-11-01.json';

/* Data parity: the bars the new repo fetched against the bars the old page
   fetched, both from Yahoo's chart endpoint. The one systematic difference is
   the date key: the old page used the UTC date of the bar's timestamp, this
   repo uses the exchange's own calendar date. They differ only where a
   session opens before midnight UTC, which is Sydney in daylight time, so
   every Australian bar from October to April sits one day earlier on the old
   page. See docs/PARITY.md. */

const old = dump as unknown as { BARS: Record<string, Bars>; HIST: Record<string, History> };
const mine = (barsFile as unknown as { bars: Record<string, Bars> }).bars;

const same = (a: number | null, b: number | null, tol = 1e-5) =>
  a == null || b == null ? a === b : Math.abs(a - b) <= tol * Math.max(1, Math.abs(a));
const nextDay = (d: string) => new Date(Date.parse(d) + 864e5).toISOString().slice(0, 10);
const isAussie = (sym: string) => sym.endsWith('.AX') || sym === '^AXJO';

describe('bars.json against the old page\'s bars', () => {
  it('has every symbol the old page had bars for', () => {
    expect(Object.keys(old.BARS).filter(s => !mine[s])).toEqual([]);
  });

  it('matches every bar exactly, except Australia, which matches on the next calendar day', () => {
    const wrong: string[] = [];
    for (const [sym, days] of Object.entries(old.BARS)) {
      for (const [d, [lo, hi, c]] of Object.entries(days)) {
        // Sydney: the same date in standard time, the next calendar day in daylight time.
        const candidates = isAussie(sym) ? [mine[sym][d], mine[sym][nextDay(d)]] : [mine[sym][d]];
        const ok = candidates.some(here => here && same(here[0], lo) && same(here[1], hi) && same(here[2], c));
        if (!ok) wrong.push(`${sym} ${d}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('matches every settled close the old page replayed on', () => {
    const wrong: string[] = [];
    for (const [sym, h] of Object.entries(old.HIST)) {
      // The country indices only feed the "vs index" column (Signals, phase 6b). Yahoo's spark feed
      // gave ^OMXC25 bars on five US holidays that its chart feed does not have; not an engine input.
      if (sym.startsWith('^')) continue;
      if (!mine[sym]) { wrong.push(sym + ' missing'); continue; }
      for (const [d, c] of h.settled) {
        const candidates = isAussie(sym) ? [mine[sym][d], mine[sym][nextDay(d)]] : [mine[sym][d]];
        // Spark rounds closes (0.697 for a 0.6975 chart close on LIN.AX), so a tenth of a percent.
        if (!candidates.some(here => here && same(here[2], c, 1e-3))) wrong.push(`${sym} ${d}`);
      }
    }
    expect(wrong).toEqual([]);
  });
});
