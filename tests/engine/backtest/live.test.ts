import { describe, expect, it } from 'vitest';
import { runModel } from '../../../src/engine/backtest/model';
import { DEFAULT_SETTINGS } from '../../../src/engine/backtest/settings';
import { brokeOut } from '../../../src/engine/backtest/universe';
import { allHistories } from '../../../src/engine/bars';
import type { BarsFile, LatestFile } from '../../../src/engine/bars';
import { board } from '../../../src/engine/row';
import { emptyOverlay, workingList } from '../../../src/data/overlay';
import { parseSetups } from '../../../src/data/schema';
import watchlist from '../../../public/data/watchlist.json';
import barsFile from '../../../public/data/bars.json';
import latest from '../../../public/data/prices-latest.json';

/* The model on the live files, whatever they hold today: the one acceptance check of phase 7, and what must be true of
   every row. Nothing here knows how many setups there are. */

describe('the model on the live files', () => {
  const bars = barsFile as unknown as BarsFile;
  const tip = latest as unknown as LatestFile;
  const now = Date.parse(tip.generated_at);
  const hist = allHistories(bars, tip, now);
  const list = workingList(parseSetups(watchlist, 'watchlist.json').rows, emptyOverlay());
  const bd = board(list, hist, bars.bars, {}, tip.generated_at.slice(0, 10));
  const m = runModel({ rows: bd.rows, hist, bars: bars.bars }, DEFAULT_SETTINGS);

  it('prints as its universe exactly the number of setups the engine says broke out', () => {
    const broke = bd.rows.filter(brokeOut).length;
    expect(broke).toBeGreaterThan(0);
    expect(m.universe.breakouts).toBe(broke);
    expect(m.universe.candidates.length + m.universe.excluded.length).toBe(broke);
  });

  it('gives every excluded setup a reason, and every leg a price, a mark and a day count', () => {
    for (const e of m.universe.excluded) expect(e.reason, e.key).toBeTruthy();
    for (const run of Object.values(m.runs)) {
      for (const l of run.legs) {
        expect(l.entry.price, `${run.id} ${l.key}`).toBeGreaterThan(0);
        expect(l.mark.price, `${run.id} ${l.key}`).toBeGreaterThan(0);
        expect(l.days, `${run.id} ${l.key}`).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(l.netPct), `${run.id} ${l.key}`).toBe(true);
        if (l.exit) expect(l.exit.when >= l.entry.when, `${run.id} ${l.key}`).toBe(true);
      }
    }
  });

  it('keeps every price in its listing currency: a leg carries the currency of its bars', () => {
    for (const l of m.runs.S3.legs) expect(l.currency, l.key).toBe(hist[l.sym].currency);
  });
});
