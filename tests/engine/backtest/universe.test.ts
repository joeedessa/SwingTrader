import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../../src/engine/backtest/settings';
import { brokeOut, daysOf, payoffOf, universeOf } from '../../../src/engine/backtest/universe';
import { evaluate } from '../../../src/engine/row';
import type { Row } from '../../../src/engine/row';
import type { Bars, History, Setup } from '../../../src/engine/types';
import { closesOnly, LONG, series } from '../helpers';
import type { Day } from '../helpers';

const PATH: Day[] = [
  ['2026-01-02', 93, 97, 96, 94],        // inside the pattern: the bar before the run past the 97 boundary
  ['2026-01-05', 95, 99, 98, 96],
  ['2026-01-06', 98, 102, 101, 99],      // the confirming close
  ['2026-01-07', 99, 104, 103, 100],
  ['2026-01-08', 93, 99, 96, 97],        // a touch of a 94 stop
  ['2026-01-09', 97, 103, 102, 98],
];

const rowOf = (p: Setup, days: Day[] = PATH, h?: History): { row: Row; hist: Record<string, History>; bars: Record<string, Bars> } => {
  const { bars, hist } = series(days);
  const row = evaluate(p, h ?? hist, h ? undefined : bars, null, '2026-02-01');
  return { row, hist: { [p.sym]: h ?? hist }, bars: h ? {} : { [p.sym]: bars } };
};

describe('who broke out', () => {
  it('a row still waiting did not', () => {
    const { row } = rowOf({ ...LONG, breakthrough: 110 });
    expect(brokeOut(row)).toBe(false);
  });

  it('a breakout marked by hand counts, and is excluded for having no close to enter at', () => {
    const { row, hist, bars } = rowOf({ ...LONG, breakthrough: 110, manualState: 'breakout' });
    expect(row.section).toBe('breakout');
    expect(brokeOut(row)).toBe(true);
    const u = universeOf([row], hist, bars, DEFAULT_SETTINGS);
    expect(u.breakouts).toBe(1);
    expect(u.candidates).toEqual([]);
    expect(u.excluded[0].reason).toBe('marked as a breakout by hand: no confirming close in the bars');
  });

  it('a removed row counts only if it broke out on or before the removal date; put back in this browser, it counts whenever', () => {
    const before = rowOf({ ...LONG, removed: '2026-01-10', manualState: 'removed' }).row;
    expect(brokeOut(before)).toBe(true);
    const after = rowOf({ ...LONG, removed: '2026-01-05', manualState: 'removed' }).row;
    expect(after.section).toBe('removed');
    expect(brokeOut(after)).toBe(false);
    const back = rowOf({ ...LONG, removed: '2026-01-05', manualState: null }).row;
    expect(back.section).not.toBe('removed');
    expect(brokeOut(back)).toBe(true);
  });
});

describe('the days', () => {
  it('reads the open from a four-value bar and leaves it null on a three-value one, and adds a later settled close as a close-only day', () => {
    const bars: Bars = { '2026-01-05': [95, 99, 98, 96], '2026-01-06': [98, 102, 101], '2026-01-07': [99, 104, 103, null] };
    const hist: History = { settled: [['2026-01-05', 98], ['2026-01-06', 101], ['2026-01-07', 103], ['2026-01-08', 105]], live: 105, liveDate: '2026-01-08', currency: 'USD' };
    expect(daysOf(bars, hist)).toEqual([
      { when: '2026-01-05', lo: 95, hi: 99, c: 98, o: 96, closeOnly: false },
      { when: '2026-01-06', lo: 98, hi: 102, c: 101, o: null, closeOnly: false },
      { when: '2026-01-07', lo: 99, hi: 104, c: 103, o: null, closeOnly: false },
      { when: '2026-01-08', lo: 105, hi: 105, c: 105, o: null, closeOnly: true },
    ]);
  });

  it('drops a bar after the last settled close, as the board does', () => {
    const bars: Bars = { '2026-01-05': [95, 99, 98, 96], '2026-01-06': [98, 102, 101, 99] };
    const hist: History = { settled: [['2026-01-05', 98]], live: 98, liveDate: '2026-01-05', currency: 'USD' };
    expect(daysOf(bars, hist).map(d => d.when)).toEqual(['2026-01-05']);
    expect(daysOf(bars, null).map(d => d.when)).toEqual(['2026-01-05', '2026-01-06']);
  });
});

describe('the universe', () => {
  it('turns a breakout into a candidate: the confirming close, the stop and where it came from, the days', () => {
    const { row, hist, bars } = rowOf({ ...LONG, lfd: 94 });
    const u = universeOf([row], hist, bars, DEFAULT_SETTINGS);
    expect(u.breakouts).toBe(1);
    expect(u.excluded).toEqual([]);
    const c = u.candidates[0];
    expect(c).toMatchObject({ key: 'X|long', trigger: 100, target: 120, negation: 90, boundary: 97, stop: 94, stopSource: 'report',
      signal: { when: '2026-01-06', price: 101, index: 2 }, imported: false, removed: null, reached: null, currency: 'USD', tag: 'B3' });
    expect(c.days).toHaveLength(6);
  });

  it('a derived stop is marked so, none in the report is none, and one beyond the negation is looser', () => {
    const derived = universeOf([rowOf(LONG).row], rowOf(LONG).hist, rowOf(LONG).bars, DEFAULT_SETTINGS).candidates[0];
    expect(derived).toMatchObject({ stop: 93, stopSource: 'derived' });   // the 01-02 low, the bar before the first close past the 97 boundary
    const none = rowOf({ ...LONG, lfd: 0 });
    expect(universeOf([none.row], none.hist, none.bars, DEFAULT_SETTINGS).candidates[0]).toMatchObject({ stop: null, stopSource: 'none' });
    const looser = rowOf({ ...LONG, negation: 94 });
    expect(universeOf([looser.row], looser.hist, looser.bars, DEFAULT_SETTINGS).candidates[0]).toMatchObject({ stop: null, stopSource: 'looser' });
  });

  it('an imported row, under the confirming-close entry, is signalled from the close the lookback found (the latest close at or past the trigger before the report\'s date)', () => {
    const atClose = { ...DEFAULT_SETTINGS, importedEntry: 'close' as const };
    const { row, hist, bars } = rowOf({ ...LONG, confirmed: '2026-01-10', lfd: 94 });
    const c = universeOf([row], hist, bars, atClose).candidates[0];
    expect(c.signal).toEqual({ when: '2026-01-09', price: 102, index: 5 });
    expect(c).toMatchObject({ imported: true, signalKind: 'close', confirming: { when: '2026-01-09', price: 102 } });
    // With one cross only, it is that one.
    const once = rowOf({ ...LONG, confirmed: '2026-01-10', lfd: 94 }, PATH.slice(0, 4));
    expect(universeOf([once.row], once.hist, once.bars, atClose).candidates[0].signal).toEqual({ when: '2026-01-06', price: 101, index: 2 });
  });

  it('an imported row, by default, is signalled from the last close on or before the report\'s date, and keeps the confirming close on record', () => {
    // Confirmed on Saturday 01-10: the last close before it is Wednesday 01-07's (the bars end there), two days after the confirming close.
    const { row, hist, bars } = rowOf({ ...LONG, confirmed: '2026-01-10', lfd: 94 }, PATH.slice(0, 4));
    const c = universeOf([row], hist, bars, DEFAULT_SETTINGS).candidates[0];
    expect(c.signal).toEqual({ when: '2026-01-07', price: 103, index: 3 });
    expect(c).toMatchObject({ imported: true, signalKind: 'report', confirming: { when: '2026-01-06', price: 101 } });
    // A report dated a trading day is read as published after that day's close.
    const onFriday = rowOf({ ...LONG, confirmed: '2026-01-09', lfd: 94 });
    expect(universeOf([onFriday.row], onFriday.hist, onFriday.bars, DEFAULT_SETTINGS).candidates[0].signal.when).toBe('2026-01-09');
  });

  it('excludes, with the reason: no bars, no trigger, a confirming close the lookback could not find', () => {
    const noBars = rowOf({ ...LONG, lfd: 94 }, PATH, closesOnly(PATH));
    expect(universeOf([noBars.row], noBars.hist, noBars.bars, DEFAULT_SETTINGS).excluded).toEqual([{ key: 'X|long', sym: 'X', dir: 'long', reason: 'no daily bars' }]);
    const noTrigger = rowOf({ ...LONG, breakthrough: null, confirmed: '2026-01-06' });
    expect(universeOf([noTrigger.row], noTrigger.hist, noTrigger.bars, DEFAULT_SETTINGS).excluded[0].reason).toBe('no trigger level');
    // Confirmed by the source on a date whose 40 sessions never closed at or past the trigger.
    const notFound = rowOf({ ...LONG, breakthrough: 150, confirmed: '2026-01-09' });
    const u = universeOf([notFound.row], notFound.hist, notFound.bars, DEFAULT_SETTINGS);
    expect(u.breakouts).toBe(1);
    expect(u.excluded[0].reason).toMatch(/not found/);
  });

  it('the settings leave out breakouts before the chosen date and setups the source removed', () => {
    const { row, hist, bars } = rowOf({ ...LONG, lfd: 94 });
    expect(universeOf([row], hist, bars, { ...DEFAULT_SETTINGS, from: '2026-01-07' }).excluded[0].reason).toBe('broke out before 2026-01-07');
    expect(universeOf([row], hist, bars, { ...DEFAULT_SETTINGS, from: '2026-01-06' }).candidates).toHaveLength(1);
    const gone = rowOf({ ...LONG, lfd: 94, removed: '2026-01-10', manualState: 'removed' });
    const u = universeOf([gone.row], gone.hist, gone.bars, { ...DEFAULT_SETTINGS, removed: 'exclude' });
    expect(u.breakouts).toBe(1);
    expect(u.excluded[0].reason).toBe('removed by the source after breaking out');
    expect(universeOf([gone.row], gone.hist, gone.bars, DEFAULT_SETTINGS).candidates[0]).toMatchObject({ removed: '2026-01-10' });
  });

  it('a removed setup is typed as it stood on the removal date, not by the bars after it', () => {
    const path: Day[] = [
      ['2026-01-02', 93, 97, 96, 94], ['2026-01-05', 95, 99, 98, 96], ['2026-01-06', 98, 102, 101, 99],
      ['2026-01-07', 100, 104, 103, 100],   // a touch of the trigger: B2
      ['2026-01-12', 92, 99, 95, 98],       // a breach, after the removal
    ];
    const { row, hist, bars } = rowOf({ ...LONG, lfd: 94, removed: '2026-01-10', manualState: 'removed' }, path);
    expect(row.btype!.tag).toBe('B3');
    expect(universeOf([row], hist, bars, DEFAULT_SETTINGS).candidates[0].tag).toBe('B2');
  });

  it('a stop that could not be read from the bars is marked so', () => {
    // The run past the boundary starts on the first bar on file: nothing before it to read a stop from.
    const { row, hist, bars } = rowOf(LONG, PATH.slice(1));
    expect(universeOf([row], hist, bars, DEFAULT_SETTINGS).candidates[0]).toMatchObject({ stop: null, stopSource: 'underived' });
  });

  it('the tag is the type at the first outcome: a target reached before a later negation keeps its B2', () => {
    const path: Day[] = [
      ['2026-01-05', 95, 99, 98, 96], ['2026-01-06', 98, 102, 101, 99],
      ['2026-01-07', 100, 125, 121, 102],   // a touch of the trigger, then the target on the close
      ['2026-01-08', 85, 100, 88, 99],      // the negation afterwards
    ];
    const { row, hist, bars } = rowOf({ ...LONG, lfd: 94 }, path);
    expect(row.section).toBe('failed');
    expect(universeOf([row], hist, bars, DEFAULT_SETTINGS).candidates[0].tag).toBe('B2');
  });

  it('payoff is trigger to target the setup\'s way, and null when the target is the wrong side', () => {
    expect(payoffOf({ dir: 'long', trigger: 100, target: 120 })).toBeCloseTo(20, 9);
    expect(payoffOf({ dir: 'short', trigger: 100, target: 80 })).toBeCloseTo(20, 9);
    expect(payoffOf({ dir: 'long', trigger: 100, target: 90 })).toBeNull();
    expect(payoffOf({ dir: 'long', trigger: 100, target: null })).toBeNull();
  });
});
