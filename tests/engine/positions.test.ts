import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { allHistories } from '../../src/engine/bars';
import type { BarsFile, LatestFile } from '../../src/engine/bars';
import { CALENDAR_KINDS, rowKeyOf } from '../../src/engine/chips';
import { boardFlags } from '../../src/engine/flags';
import { board, evaluate } from '../../src/engine/row';
import type { Row } from '../../src/engine/row';
import { byNearestStop, entryOf, positionOf, positionsView, rMultiple } from '../../src/engine/positions';
import type { Position } from '../../src/engine/positions';
import type { Setup, SymbolEvents } from '../../src/engine/types';
import { emptyOverlay, workingList } from '../../src/data/overlay';
import { parseEvents, parseSetups } from '../../src/data/schema';
import { mergeLive } from '../../src/data/sources';
import { DEFAULT_SORT, sortRows } from '../../src/ui/columns';
import { LONG, series, SHORT } from './helpers';
import type { Day } from './helpers';
import { frozenBoard, frozenHist, TODAY } from '../ui/frozen';

const TODAY_ = '2026-01-20';
const rowOf = (p: Setup, days: Day[], ev: SymbolEvents = {}, live?: { price: number; date: string }): { r: Row; hist: ReturnType<typeof series>['hist'] } => {
  const { bars, hist } = series(days, live);
  return { r: evaluate(p, hist, bars, ev, TODAY_), hist };
};

// Waiting, then confirmed on 01-08 by a close of 100.5 past the 100 trigger, with the last full day 94 from the report.
const WAIT: Day[] = [['2026-01-05', 94, 96, 95], ['2026-01-06', 95, 98, 97.5], ['2026-01-07', 96, 99, 98]];
const B1: Day[] = [...WAIT, ['2026-01-08', 97.5, 101, 100.5], ['2026-01-09', 101, 105, 104]];
const P = { ...LONG, lfd: 94 };
// Pullbacks, an exit on 01-16 (a low of 93 under the 94), and a re-entry close of 101 on 01-19.
const PATH: Day[] = [...B1,
  ['2026-01-12', 99.5, 103, 102], ['2026-01-13', 99, 102, 101], ['2026-01-14', 100.5, 106, 105],
  ['2026-01-15', 98, 101, 100.2], ['2026-01-16', 93, 99, 97], ['2026-01-19', 95, 102, 101],
];

describe('R: how many multiples of the risk the trade has made', () => {
  it('is the move since the entry over the distance from the entry to the stop', () => {
    expect(rMultiple('long', 100, 90, 120)).toBe(2);
    expect(rMultiple('long', 100, 90, 95)).toBe(-0.5);
    expect(rMultiple('long', 100, 90, 100)).toBe(0);
  });

  it('is the mirror for a short', () => {
    expect(rMultiple('short', 100, 110, 80)).toBe(2);
    expect(rMultiple('short', 100, 110, 105)).toBe(-0.5);
  });

  it('is −1 at the stop itself: stopped out is one R against you', () => {
    expect(rMultiple('long', 100, 90, 90)).toBe(-1);
    expect(rMultiple('short', 100, 110, 110)).toBe(-1);
  });

  it('does not read "-0" for a trade that has not moved', () => {
    expect(Object.is(rMultiple('short', 100, 110, 100), 0)).toBe(true);
  });

  it('is nothing without an entry, a stop or a price, or when the stop is not on the losing side of the entry', () => {
    expect(rMultiple('long', null, 90, 100)).toBeNull();
    expect(rMultiple('long', 100, null, 100)).toBeNull();
    expect(rMultiple('long', 100, 90, null)).toBeNull();
    expect(rMultiple('long', 100, 100, 110)).toBeNull();
    expect(rMultiple('long', 100, 105, 110)).toBeNull();
    expect(rMultiple('short', 100, 95, 90)).toBeNull();
  });
});

describe('what a trade is measured from', () => {
  it('is the confirming close', () => {
    const { r, hist } = rowOf(P, B1);
    expect(entryOf(r, hist)).toEqual({ when: '2026-01-08', price: 100.5, kind: 'confirmation' });
  });

  it('is the close that re-entered, for a setup back in after an exit', () => {
    const { r, hist } = rowOf(P, PATH);
    expect(r.section).toBe('reentered');
    expect(entryOf(r, hist)).toEqual({ when: '2026-01-19', price: 101, kind: 'reentry' });
  });

  it('is the confirming close the stop derivation found, for a row imported already confirmed', () => {
    // Listed as confirmed on the weekend report's date: the replay has no close, the bars do.
    const imported = { ...P, confirmed: '2026-01-10' };
    const { r, hist } = rowOf(imported, B1);
    expect(r.st.breakout!.close).toBeNull();
    expect(entryOf(r, hist)).toEqual({ when: '2026-01-08', price: 100.5, kind: 'confirmation' });
  });

  it('keeps the date but not a price when the bars do not show the confirming close', () => {
    const imported = { ...P, confirmed: '2026-01-10' };
    const { r, hist } = rowOf(imported, B1);
    expect(entryOf(r, { ...hist, settled: [] })).toEqual({ when: '2026-01-08', price: null, kind: 'confirmation' });
  });

  it('is nothing for a setup that has not broken out', () => {
    const { r, hist } = rowOf(P, WAIT);
    expect(entryOf(r, hist)).toBeNull();
  });
});

describe('one position', () => {
  it('reads the stop, how far the price is from it, in per cent and in ATRs, the R so far, and the days', () => {
    const { r, hist } = rowOf(P, B1, { atr: 2 });
    const p = positionOf(r, hist, TODAY_);
    expect(p.stop).toEqual({ level: 94, kind: 'last full day' });
    expect(p.gapPct).toBe(9.6);                        // 104 → 94
    expect(p.atrs).toBe(5);                            // 10 / 2
    expect(p.r).toBeCloseTo((104 - 100.5) / (100.5 - 94), 10);
    expect(p.days).toBe(12);                           // 01-08 → 01-20
  });

  it('falls back to the negation where there is no tight stop, and says which it used', () => {
    const { r, hist } = rowOf({ ...LONG, lfd: 0 }, B1, { atr: 2 });
    const p = positionOf(r, hist, TODAY_);
    expect(p.stop).toEqual({ level: 90, kind: 'negation' });
    expect(p.gapPct).toBe(13.5);                       // 104 → 90 (live → negation, the row's own risk)
    expect(p.gapPct).toBe(r.risk);
  });

  it('has no distance in ATRs for a name with no ATR, and keeps the rest', () => {
    const { r, hist } = rowOf(P, B1);
    const p = positionOf(r, hist, TODAY_);
    expect(p.atrs).toBeNull();
    expect(p.gapPct).not.toBeNull();
  });

  it('is already past its stop when the price is: a negative give-back', () => {
    const { r, hist } = rowOf(P, B1, { atr: 2 }, { price: 93, date: '2026-01-20' });
    const p = positionOf(r, hist, TODAY_);
    expect(p.gapPct!).toBeLessThan(0);
    expect(p.atrs!).toBeLessThan(0);
    expect(p.r!).toBeLessThan(-1);
  });

  it('reads a short the other way round', () => {
    const days: Day[] = [
      ['2026-01-05', 106, 108, 107], ['2026-01-06', 103, 105, 104], ['2026-01-07', 101, 104, 102],
      ['2026-01-08', 98, 102, 99], ['2026-01-09', 95, 99, 96],
    ];
    const { r, hist } = rowOf({ ...SHORT, lfd: 105, boundary: 103 }, days, { atr: 2 });
    expect(r.section).toBe('breakout');
    const p = positionOf(r, hist, TODAY_);
    expect(p.stop).toEqual({ level: 105, kind: 'last full day' });
    expect(p.gapPct).toBe(9.4);                        // 96 → 105: a give-back is positive on the right side of the stop, for a short too
    expect(p.atrs!).toBeCloseTo(4.5, 10);
    expect(p.r!).toBeCloseTo((99 - 96) / (105 - 99), 10);
  });

  it('is never fewer than zero days into the trade', () => {
    const { r, hist } = rowOf(P, B1);
    expect(positionOf(r, hist, '2026-01-01').days).toBe(0);
  });
});

describe('nearest stop first', () => {
  const at = (gapPct: number | null): Position => ({ gapPct } as unknown as Position);

  it('orders by the give-back, the smallest first, and puts a row with none last', () => {
    const list = [at(5), at(null), at(-1), at(0.4), at(null)].sort(byNearestStop);
    expect(list.map(p => p.gapPct)).toEqual([-1, 0.4, 5, null, null]);
  });
});

describe('the ladder on the frozen board', () => {
  const bd = frozenBoard();
  const flags = boardFlags(bd.rows, { today: TODAY, nowMs: Date.parse(TODAY + 'T12:00:00Z'), page: 'setups' });
  const view = positionsView(bd, frozenHist(), flags, TODAY);

  it('holds exactly what is in trade: every Confirmed row and every Re-entered one, and nothing else', () => {
    const want = [...bd.bySection.breakout, ...bd.bySection.reentered].map(r => rowKeyOf(r.p.sym, r.p.dir)).sort();
    expect(view.ladder.map(p => p.key).sort()).toEqual(want);
    expect(view.stopped).toBe(bd.bySection.stopped);
  });

  it('is sorted nearest its stop first, with the rows that have no distance last', () => {
    const gaps = view.ladder.map(p => p.gapPct);
    const known = gaps.filter((g): g is number => g != null);
    expect(known).toEqual([...known].sort((a, b) => a - b));
    expect(gaps.slice(known.length).every(g => g == null)).toBe(true);
  });

  it('puts the Confirmed rows that have a tight stop in the same order as the Confirmed section\'s own sort (the plan\'s check)', () => {
    const section = sortRows(bd.bySection.breakout, 'breakout', DEFAULT_SORT.breakout);
    const withStop = (r: Row) => !!(r.lfd && r.lfd.at != null && !r.lfd.looser && r.live);
    const fromSection = section.filter(withStop).map(r => rowKeyOf(r.p.sym, r.p.dir));
    const fromLadder = view.ladder.filter(p => p.row.section === 'breakout' && withStop(p.row)).map(p => p.key);
    expect(fromSection.length).toBeGreaterThan(1);
    expect(fromLadder).toEqual(fromSection);
  });

  it('does the same for the Re-entered rows against their own section', () => {
    const section = sortRows(bd.bySection.reentered, 'reentered', DEFAULT_SORT.reentered);
    const withStop = (r: Row) => !!(r.lfd && r.lfd.at != null && !r.lfd.looser && r.live);
    expect(view.ladder.filter(p => p.row.section === 'reentered' && withStop(p.row)).map(p => p.key))
      .toEqual(section.filter(withStop).map(r => rowKeyOf(r.p.sym, r.p.dir)));
  });

  it('counts its tiles from the same rows', () => {
    expect(view.tiles.inTrade).toBe(view.ladder.length);
    expect(view.tiles.stopped).toBe(bd.bySection.stopped.length);
    expect(view.tiles.nearest).toBe(view.ladder.find(p => p.gapPct != null) ?? null);
    const onLadder = new Set(view.ladder.map(p => p.key));
    expect(view.tiles.events).toBe(flags.filter(f => CALENDAR_KINDS.includes(f.kind) && onLadder.has(rowKeyOf(f.sym as string, f.dir as string))).length);
  });

  it('gives every rung an entry, a stop where one exists, and a number of days that is not negative', () => {
    for (const p of view.ladder) {
      expect(p.entry, p.key).not.toBeNull();
      if (p.days != null) expect(p.days, p.key).toBeGreaterThanOrEqual(0);
      if (p.stop && p.entry && p.entry.price != null) expect(p.r == null || Number.isFinite(p.r), p.key).toBe(true);
    }
  });
});

/* The same holds on the live files, whatever the count: what is true of every row, not how many there are. */
describe('the ladder on the live data files', () => {
  const file = (name: string) => JSON.parse(readFileSync(new URL('../../public/data/' + name, import.meta.url), 'utf8'));
  const bars = file('bars.json') as BarsFile;
  const latest = file('prices-latest.json') as LatestFile;
  const now = Date.parse(latest.generated_at) + 60_000;
  const today = new Date(now).toISOString().slice(0, 10);
  const hist = allHistories(bars, mergeLive(latest, null), now);
  const list = workingList(parseSetups(file('watchlist.json'), 'watchlist.json').rows, emptyOverlay());
  const bd = board(list, hist, bars.bars, parseEvents(file('watch-events.json')).symbols, today);
  const flags = boardFlags(bd.rows, { today, nowMs: now, page: 'setups' });
  const view = positionsView(bd, hist, flags, today);

  it('holds every Confirmed and Re-entered row once, sorted nearest its stop first', () => {
    expect(view.ladder.length).toBe(bd.bySection.breakout.length + bd.bySection.reentered.length);
    expect(new Set(view.ladder.map(p => p.key)).size).toBe(view.ladder.length);
    const known = view.ladder.map(p => p.gapPct).filter((g): g is number => g != null);
    expect(known).toEqual([...known].sort((a, b) => a - b));
  });

  it('keeps the Confirmed order for the rows with a tight stop, as the plan asks', () => {
    const section = sortRows(bd.bySection.breakout, 'breakout', DEFAULT_SORT.breakout);
    const withStop = (r: Row) => !!(r.lfd && r.lfd.at != null && !r.lfd.looser && r.live);
    expect(view.ladder.filter(p => p.row.section === 'breakout' && withStop(p.row)).map(p => p.key))
      .toEqual(section.filter(withStop).map(r => rowKeyOf(r.p.sym, r.p.dir)));
  });

  it('can say what every rung is measured from, except a row whose bars do not show it', () => {
    for (const p of view.ladder) {
      if (!p.entry) continue;
      expect(typeof p.entry.when, p.key).toBe('string');
      if (p.entry.price != null) expect(Number.isFinite(p.entry.price), p.key).toBe(true);
    }
  });
});
