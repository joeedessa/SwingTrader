import { describe, expect, it } from 'vitest';
import { logRows } from '../../src/data/tradelog';
import type { LogOverlay } from '../../src/data/tradelog';
import { MINUS } from '../../src/engine/format';
import { closeOnOrBefore, dirOfSide, journalStats, pairFills, statsLine, unrealised } from '../../src/engine/journal';
import type { Fill } from '../../src/engine/journal';
import golden from '../fixtures/journal-old-page.json';

/* The journal's pairing against the old page's own, on a fixture. `tests/fixtures/journal-old-page.json` holds some fills
   and what the old page's logRows, pairFills and summary line answered for them (made by running those functions out of
   its source: the lines are named in the file, and docs/PARITY.md says how). Nothing here reads the old page. */

const shared = golden.shared as Fill[];
const overlay = golden.overlay as unknown as LogOverlay;
const want = golden.expected;

describe('the journal, against the old page', () => {
  const rows = logRows(shared, overlay);
  const { opens, closed } = pairFills(rows);

  it('puts the fills in the old page\'s order: the day traded, then the moment logged, with edits and deletes applied', () => {
    expect(rows.map(f => f.id)).toEqual(want.rows);
    expect(rows.map(f => f.id)).not.toContain('f11');                   // deleted here
    expect(rows.find(f => f.id === 'f12')!.price).toBe(63);             // edited here
  });

  it('pairs them the way it did: first in, first out, a sell with nothing open opens a short', () => {
    expect(opens.map(f => f.id)).toEqual(want.opens);
    expect(closed.map(c => ({ sym: c.sym, dir: c.dir, entry: c.entry.id, exit: c.exit.id, pattern: c.pattern, duration_m: c.duration_m, market: c.market, days: c.days })))
      .toEqual(want.closed.map(c => ({ sym: c.sym, dir: c.dir, entry: c.entry, exit: c.exit, pattern: c.pattern, duration_m: c.duration_m, market: c.market, days: c.days })));
  });

  it('gives the same P&L to the last digit', () => {
    expect(closed.map(c => c.pnl)).toEqual(want.closed.map(c => c.pnl));
  });

  it('says the same sentence, but for the minus sign', () => {
    expect(statsLine(journalStats(rows, opens, closed))).toBe(want.summary.replace('avg loss -', 'avg loss ' + MINUS));
  });

  it('keeps what a trade carries: the entry\'s pattern and duration win, a duration of 0 months is not "none"', () => {
    const nutx = closed.find(c => c.sym === 'NUTX')!;
    expect(nutx.duration_m).toBe(0);
    expect(nutx.pattern).toBe('Ascending triangle');
    // The exit's own pattern fills in when the entry has none.
    expect(pairFills([
      { id: 'a', sym: 'Z', side: 'buy', date: '2026-01-01', price: 10 },
      { id: 'b', sym: 'Z', side: 'sell', date: '2026-01-03', price: 11, pattern: 'Flag', market: 'US' },
    ]).closed[0]).toMatchObject({ pattern: 'Flag', market: 'US', duration_m: null, days: 2 });
  });
});

describe('pairing on its own terms', () => {
  const fill = (id: string, sym: string, side: string, date: string, price: number): Fill => ({ id, sym, side, date, price });

  it('pairs the oldest open fill first, and leaves the rest open', () => {
    const { opens, closed } = pairFills([
      fill('1', 'A', 'buy', '2026-01-01', 10), fill('2', 'A', 'buy', '2026-01-02', 12), fill('3', 'A', 'sell', '2026-01-05', 11),
    ]);
    expect(closed.map(c => [c.entry.id, c.exit.id])).toEqual([['1', '3']]);
    expect(opens.map(f => f.id)).toEqual(['2']);
  });

  it('a short is a sell first: it gains when the price falls, and its P&L is the long\'s mirror', () => {
    const { closed } = pairFills([fill('1', 'A', 'sell', '2026-01-01', 100), fill('2', 'A', 'buy', '2026-01-04', 80)]);
    expect(closed[0].dir).toBe('short');
    expect(closed[0].pnl).toBeCloseTo(25, 10);                          // 100/80 - 1
    expect(pairFills([fill('1', 'A', 'buy', '2026-01-01', 80), fill('2', 'A', 'sell', '2026-01-04', 100)]).closed[0].pnl).toBeCloseTo(25, 10);
  });

  it('keeps symbols apart, and long and short trades of one symbol follow each other', () => {
    const { opens, closed } = pairFills([
      fill('1', 'A', 'buy', '2026-01-01', 10), fill('2', 'B', 'sell', '2026-01-01', 20), fill('3', 'A', 'sell', '2026-01-02', 11),
      fill('4', 'A', 'sell', '2026-01-03', 12), fill('5', 'A', 'buy', '2026-01-04', 9),
    ]);
    expect(closed.map(c => [c.sym, c.dir])).toEqual([['A', 'long'], ['A', 'short']]);
    expect(opens.map(f => f.id)).toEqual(['2']);
  });

  it('lists what is open by symbol in the order each was first traded', () => {
    const { opens } = pairFills([fill('1', 'B', 'buy', '2026-01-01', 1), fill('2', 'A', 'buy', '2026-01-02', 1), fill('3', 'B', 'buy', '2026-01-03', 1)]);
    expect(opens.map(f => f.id)).toEqual(['1', '3', '2']);
  });

  it('counts the days between two dates in whole calendar days, a trade opened and closed the same day as 0', () => {
    expect(pairFills([fill('1', 'A', 'buy', '2026-01-01', 1), fill('2', 'A', 'sell', '2026-01-01', 2)]).closed[0].days).toBe(0);
    expect(pairFills([fill('1', 'A', 'buy', '2026-10-01', 1), fill('2', 'A', 'sell', '2026-11-02', 2)]).closed[0].days).toBe(32);
  });

  it('does not touch what it is given', () => {
    const rows = [fill('1', 'A', 'buy', '2026-01-01', 10), fill('2', 'A', 'sell', '2026-01-02', 11)];
    const copy = JSON.parse(JSON.stringify(rows));
    pairFills(rows);
    expect(rows).toEqual(copy);
  });

  it('a buy is long and a sell is short', () => {
    expect(dirOfSide('buy')).toBe('long');
    expect(dirOfSide('sell')).toBe('short');
  });
});

describe('the summary', () => {
  it('says nothing is logged when nothing is', () => {
    expect(statsLine(journalStats([], [], []))).toBe('Nothing logged yet.');
  });

  it('with fills but no closed trade, only counts what is open', () => {
    const rows: Fill[] = [{ id: '1', sym: 'A', side: 'buy', date: '2026-01-01', price: 1 }];
    const { opens, closed } = pairFills(rows);
    expect(statsLine(journalStats(rows, opens, closed))).toBe("1 open · 0 closed — P&L in each instrument's own currency, price-based, no sizes.");
  });

  it('counts a trade that ends flat as a loss, as the old page did, and has no average win without a winner', () => {
    const rows: Fill[] = [
      { id: '1', sym: 'A', side: 'buy', date: '2026-01-01', price: 10 }, { id: '2', sym: 'A', side: 'sell', date: '2026-01-02', price: 10 },
    ];
    const s = journalStats(rows, [], pairFills(rows).closed);
    expect(s).toMatchObject({ winners: 0, winPct: 0, avgWin: null, avgLoss: 0 });
    expect(statsLine(s)).toContain('0 winners (0%)');
    expect(statsLine(s)).not.toContain('avg win');
  });
});

describe('what an open fill is worth now', () => {
  const buy: Fill = { id: '1', sym: 'A', side: 'buy', date: '2026-01-01', price: 100 };
  const sell: Fill = { ...buy, side: 'sell' };

  it('is the move against the price paid for a long, and the mirror of it for a short', () => {
    expect(unrealised(buy, 110)).toBeCloseTo(10, 10);
    expect(unrealised(sell, 80)).toBeCloseTo(25, 10);
    expect(unrealised(sell, 125)).toBeCloseTo(-20, 10);
  });

  it('is unknown without a price', () => {
    expect(unrealised(buy, null)).toBeNull();
    expect(unrealised(buy, undefined)).toBeNull();
    expect(unrealised(buy, NaN)).toBeNull();
  });
});

describe('the price a fill starts with', () => {
  const closes: [string, number][] = [['2026-10-28', 10], ['2026-10-29', 11], ['2026-10-30', 12], ['2026-11-02', 13]];

  it('is the settled close of the day traded', () => {
    expect(closeOnOrBefore(closes, '2026-10-29')).toEqual({ date: '2026-10-29', close: 11 });
  });

  it('is the last close before it when the market was shut that day', () => {
    expect(closeOnOrBefore(closes, '2026-11-01')).toEqual({ date: '2026-10-30', close: 12 });
  });

  it('is nothing for a date before the first close, or without history', () => {
    expect(closeOnOrBefore(closes, '2026-10-01')).toBeNull();
    expect(closeOnOrBefore([], '2026-10-29')).toBeNull();
  });
});
