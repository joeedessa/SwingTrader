import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, STRATEGIES, strategyId } from '../../../src/engine/backtest/settings';
import type { ModelSettings, StrategyId } from '../../../src/engine/backtest/settings';
import { simulate, WAITING_BAR, WAITING_SESSION, WAITING_TRIGGER } from '../../../src/engine/backtest/simulate';
import { universeOf } from '../../../src/engine/backtest/universe';
import { evaluate } from '../../../src/engine/row';
import type { Setup } from '../../../src/engine/types';
import { LONG, series, SHORT } from '../helpers';
import type { Day } from '../helpers';

/* The simulation's edges, one rule each, on tiny hand-built paths (the whole-trade cases are in fixtures.test.ts). */

const WITH_LFD: Setup = { ...LONG, lfd: 94 };
const SHORT_LFD: Setup = { ...SHORT, lfd: 106 };

function run(p: Setup, days: Day[], id: StrategyId, o: Partial<ModelSettings> = {}, extraSettled: [string, number][] = []) {
  const { bars, hist } = series(days);
  for (const e of extraSettled) hist.settled.push(e);
  const row = evaluate(p, hist, bars, null, '2026-02-01');
  const settings = { ...DEFAULT_SETTINGS, ...o };
  const u = universeOf([row], { [p.sym]: hist }, { [p.sym]: bars }, settings);
  expect(u.candidates, 'in the universe').toHaveLength(1);
  return simulate(u.candidates[0], STRATEGIES.find(s => strategyId(s) === id)!, settings);
}

const BREAK: Day[] = [
  ['2026-01-05', 95, 99, 98, 96],
  ['2026-01-06', 98, 102, 101, 99],      // the confirming close
];

describe('re-entries', () => {
  it('a close back past the trigger that is also at the target is not a re-entry: the setup is over', () => {
    const sim = run(WITH_LFD, [...BREAK, ['2026-01-07', 93, 99, 96, 97], ['2026-01-08', 100, 122, 121, 101], ['2026-01-09', 118, 125, 124, 120]], 'S2-u', { entry: 'close' });
    expect(sim.legs).toHaveLength(1);
    expect(sim.legs[0].exit).toMatchObject({ when: '2026-01-07', reason: 'stop' });
  });

  it('stops after the depth allowed: S2-1 takes one re-entry and ignores the next signal', () => {
    const path: Day[] = [...BREAK,
      ['2026-01-07', 93, 99, 96, 97],      // exit 1
      ['2026-01-08', 97, 103, 102, 98],    // re-entry 1
      ['2026-01-09', 93, 99, 96, 97],      // exit 2
      ['2026-01-12', 97, 103, 102, 98],    // a second re-entry signal
      ['2026-01-13', 100, 105, 104, 101],
    ];
    expect(run(WITH_LFD, path, 'S2-1', { entry: 'close' }).legs.map(l => l.entry.when)).toEqual(['2026-01-06', '2026-01-08']);
    expect(run(WITH_LFD, path, 'S2-2', { entry: 'close' }).legs.map(l => l.entry.when)).toEqual(['2026-01-06', '2026-01-08', '2026-01-12']);
    expect(run(WITH_LFD, path, 'S1', { entry: 'close' }).legs.map(l => l.entry.when)).toEqual(['2026-01-06']);
  });

  it('a touch of the negation while out ends the setup: no re-entry on the close that follows', () => {
    const sim = run(WITH_LFD, [...BREAK, ['2026-01-07', 93, 99, 96, 97], ['2026-01-08', 89, 103, 102, 95]], 'S2-u', { entry: 'close' });
    expect(sim.legs).toHaveLength(1);
  });

  it('a re-entry fills at the next open under the default entry, and that day is read for exits', () => {
    const sim = run(WITH_LFD, [...BREAK,
      ['2026-01-07', 99, 104, 103, 100],   // the first fill, at the open
      ['2026-01-08', 93, 99, 96, 97],      // exit 1 at 94
      ['2026-01-09', 97, 103, 102, 98],    // re-entry close
      ['2026-01-12', 93.5, 104, 103, 99],  // filled at the open 99, and the low touches the stop the same day
    ], 'S2-u');
    expect(sim.legs.map(l => [l.n, l.entry.when, l.entry.price, l.entry.basis])).toEqual([[1, '2026-01-07', 100, 'open'], [2, '2026-01-12', 99, 'open']]);
    expect(sim.legs[1].exit).toMatchObject({ when: '2026-01-12', price: 94, basis: 'level', reason: 'stop' });
  });

  it('a new stop that would be beyond the negation leaves the re-entry with none, and its risk is to the negation', () => {
    const p: Setup = { ...LONG, negation: 95, lfd: 96 };
    const path: Day[] = [
      ['2026-01-05', 94.5, 99, 96, 95],    // inside the pattern; the low is under the (not yet live) negation
      ['2026-01-06', 97.5, 102, 101, 98],  // the confirming close; the run past the 97 boundary starts here
      ['2026-01-07', 95.5, 100, 98, 99],   // the 96 stop touched, the close still over the boundary
      ['2026-01-08', 97, 102, 101.5, 98],  // re-entry: the run reaches back to 01-06, so the new stop is the 01-05 low, 94.5, beyond the negation
      ['2026-01-09', 96, 104, 103, 100],
    ];
    const sim = run(p, path, 'S2-u', { entry: 'close', reentryStop: 'new' });
    expect(sim.legs).toHaveLength(2);
    expect(sim.legs[1]).toMatchObject({ stop: null, stopKind: 'none', open: true });
    expect(sim.legs[1].riskPct).toBeCloseTo((101.5 - 95) / 101.5 * 100, 6);
    expect(run(p, path, 'S2-u', { entry: 'close' }).legs[1]).toMatchObject({ stop: 96, stopKind: 'last full day' });
  });
});

describe('fills', () => {
  it('the negation fills at the open where the day opened past it (S3), the stop too for a short', () => {
    const sim = run(WITH_LFD, [...BREAK, ['2026-01-07', 99, 104, 103, 100], ['2026-01-08', 84, 92, 90, 85]], 'S3');
    expect(sim.legs[0].exit).toMatchObject({ price: 85, basis: 'open', reason: 'negation', level: 90 });
    const s = run(SHORT_LFD, [['2026-01-05', 99, 104, 101, 102], ['2026-01-06', 97, 101, 99, 100], ['2026-01-07', 95, 100.5, 97, 100], ['2026-01-08', 106.5, 109.5, 108, 107]], 'S1');
    expect(s.legs[0].exit).toMatchObject({ price: 107, basis: 'open', reason: 'stop', level: 106 });
  });

  it('with no open on file, a day that traded entirely past the stop fills at its close, a partial one at the level', () => {
    const whole = run(WITH_LFD, [...BREAK, ['2026-01-07', 99, 104, 103], ['2026-01-08', 85, 89, 87]], 'S1');
    expect(whole.legs[0]).toMatchObject({ entry: { when: '2026-01-06', price: 101, basis: 'close' } });   // no open to fill at: the confirming close
    expect(whole.legs[0].exit).toMatchObject({ price: 87, basis: 'close', reason: 'stop' });
    const part = run(WITH_LFD, [...BREAK, ['2026-01-07', 99, 104, 103], ['2026-01-08', 92, 99, 95]], 'S1');
    expect(part.legs[0].exit).toMatchObject({ price: 94, basis: 'level', reason: 'stop' });
  });

  it('entered from a report with no open on file, the fill is the first session\'s close, never the close before the report', () => {
    const p: Setup = { ...WITH_LFD, confirmed: '2026-01-10' };
    const sim = run(p, [['2026-01-05', 95, 99, 98], ['2026-01-06', 98, 102, 101], ['2026-01-07', 100, 104, 103], ['2026-01-12', 101, 105, 104], ['2026-01-13', 103, 107, 106]], 'S1');
    expect(sim.legs[0].entry).toMatchObject({ when: '2026-01-12', price: 104, basis: 'close' });
    expect(sim.legs[0].mark).toEqual({ when: '2026-01-13', price: 106 });
    // With the first session not on file yet, the setup waits.
    expect(run(p, [['2026-01-05', 95, 99, 98], ['2026-01-06', 98, 102, 101], ['2026-01-07', 100, 104, 103]], 'S1')).toMatchObject({ legs: [], note: 'waiting for the next open' });
  });

  it('a target touched at the open fills at the open; one closed through fills at the close', () => {
    const touch = run(WITH_LFD, [...BREAK, ['2026-01-07', 99, 104, 103, 100], ['2026-01-08', 119, 125, 118, 121]], 'S1', { targetOn: 'touch' });
    expect(touch.legs[0].exit).toMatchObject({ price: 121, basis: 'open', reason: 'target', level: 120 });
    const close = run(WITH_LFD, [...BREAK, ['2026-01-07', 99, 104, 103, 100], ['2026-01-08', 115, 125, 122, 116]], 'S1');
    expect(close.legs[0].exit).toMatchObject({ price: 122, basis: 'close', reason: 'target', level: 120 });
    // On a close basis the touch alone does nothing.
    const none = run(WITH_LFD, [...BREAK, ['2026-01-07', 99, 104, 103, 100], ['2026-01-08', 115, 125, 118, 116]], 'S1');
    expect(none.legs[0].exit).toBeNull();
  });

  it('with no costs the net return is the gross one', () => {
    const sim = run(WITH_LFD, [...BREAK, ['2026-01-07', 99, 104, 103, 100], ['2026-01-08', 115, 125, 122, 116]], 'S1', { commissionPct: 0, slippagePct: 0 });
    expect(sim.legs[0].netPct).toBe(sim.legs[0].grossPct);
    expect(sim.legs[0].grossPct).toBeCloseTo(22, 9);
  });
});

describe('the newest session, settled by its close alone', () => {
  it('tests the negation and the target on that close, and gives no touch of the stop and no re-entry', () => {
    const base: Day[] = [...BREAK, ['2026-01-07', 99, 104, 103, 100]];
    const neg = run(WITH_LFD, base, 'S1', {}, [['2026-01-08', 89]]);
    expect(neg.legs[0].exit).toMatchObject({ when: '2026-01-08', price: 89, basis: 'close', reason: 'negation' });
    const tgt = run(WITH_LFD, base, 'S1', {}, [['2026-01-08', 120]]);
    expect(tgt.legs[0].exit).toMatchObject({ when: '2026-01-08', price: 120, basis: 'close', reason: 'target' });
    // Under the stop but over the negation: no bar, so no touch; the leg is marked there.
    const low = run(WITH_LFD, base, 'S1', {}, [['2026-01-08', 92]]);
    expect(low.legs[0]).toMatchObject({ open: true, mark: { when: '2026-01-08', price: 92 } });
    // Out after a stop-out, a close-only day back over the trigger is not a re-entry yet.
    const out = run(WITH_LFD, [...base, ['2026-01-08', 93, 99, 96, 97]], 'S2-u', {}, [['2026-01-09', 103]]);
    expect(out.legs).toHaveLength(1);
    expect(out.waiting).toBeNull();
  });

  it('a fill due at the open of a close-only session is still to come, so the setup waits', () => {
    const sim = run(WITH_LFD, BREAK, 'S1', {}, [['2026-01-07', 104]]);
    expect(sim.legs).toHaveLength(0);
    expect(sim.note).toBe('waiting for the next open');
    // A re-entry in the same position waits too, and the legs taken stand.
    const re = run(WITH_LFD, [...BREAK, ['2026-01-07', 99, 104, 103, 100], ['2026-01-08', 93, 99, 96, 97], ['2026-01-09', 97, 103, 102, 98]], 'S2-u', {}, [['2026-01-12', 104]]);
    expect(re.legs).toHaveLength(1);
    expect(re.waiting).toBe('waiting for the next open to re-enter (1)');
    expect(re.note).toBeNull();
  });
});

describe('entries the rules would not take', () => {
  it('none at a confirming close already at the target, nor at a next open past it', () => {
    const atClose = run({ ...WITH_LFD, target: 101 }, [...BREAK, ['2026-01-07', 99, 104, 103, 100]], 'S1');
    expect(atClose.legs).toHaveLength(0);
    expect(atClose.note).toBe('at the target on the confirming close');
    const atOpen = run({ ...WITH_LFD, target: 103 }, [...BREAK, ['2026-01-07', 102, 108, 107, 104]], 'S2-u');
    expect(atOpen.legs).toHaveLength(0);
    expect(atOpen.note).toBe('the next open was past the target');
  });

  it('none at a next open at or beyond the stop: S2 waits for the next close back past the trigger, the others are done', () => {
    const path: Day[] = [...BREAK, ['2026-01-07', 91, 95, 92, 93], ['2026-01-08', 97, 103, 102, 98], ['2026-01-09', 100, 105, 104, 101]];
    const s1 = run(WITH_LFD, path, 'S1');
    expect(s1.legs).toHaveLength(0);
    expect(s1.note).toBe('the next open was at or beyond the stop');
    // The same with the fill at the confirming close names that close.
    const p2: Setup = { ...WITH_LFD, lfd: 101.5 };
    expect(run(p2, [...BREAK, ['2026-01-07', 102, 106, 105, 103]], 'S1', { entry: 'close' }).note).toBe('the confirming close was at or beyond the stop');
    const s2 = run(WITH_LFD, path, 'S2-u');
    expect(s2.note).toBe('the next open was at or beyond the stop');
    expect(s2.legs.map(l => [l.n, l.entry.when, l.entry.price])).toEqual([[2, '2026-01-09', 101]]);
    const s3 = run(WITH_LFD, [...BREAK, ['2026-01-07', 85, 95, 92, 86]], 'S3');
    expect(s3.legs).toHaveLength(0);
    expect(s3.note).toBe('the next open was beyond the negation');
    // On the stop within float noise is at it: the comparison is at 7 significant digits.
    const on = run({ ...WITH_LFD, lfd: 93 }, [...BREAK, ['2026-01-07', 92, 95, 94, 93.00000041723251]], 'S1');
    expect(on.legs).toHaveLength(0);
    expect(on.note).toBe('the next open was at or beyond the stop');
  });

  it('a re-entry whose next open is at or beyond the stop is refused, counts as taken, and the setup is out again', () => {
    const path: Day[] = [...BREAK,
      ['2026-01-07', 93, 99, 96, 97],      // exit 1 at 94
      ['2026-01-08', 97, 103, 102, 98],    // a re-entry close
      ['2026-01-09', 92, 96, 95, 93.5],    // its open is under the stop: refused
      ['2026-01-12', 97, 103, 102, 98],    // the next re-entry close
      ['2026-01-13', 100, 105, 104, 101],  // filled
    ];
    const s2 = run(WITH_LFD, path, 'S2-u', { entry: 'open' });
    expect(s2.refused).toEqual(['2026-01-08']);
    expect(s2.legs.map(l => [l.n, l.entry.when, l.entry.price])).toEqual([[1, '2026-01-07', 97], [3, '2026-01-13', 101]]);
    expect(s2.legs[0].exit).toMatchObject({ when: '2026-01-07', price: 94 });
    // With one re-entry allowed, the refused one was it.
    expect(run(WITH_LFD, path, 'S2-1', { entry: 'open' }).legs.map(l => l.n)).toEqual([1]);
  });

  it('the risk is measured at 7 significant digits, like every comparison with a level', () => {
    const p: Setup = { ...LONG, breakthrough: 12.6, boundary: 12.4, target: 14, negation: 11.5, lfd: 12.3 };
    const sim = run(p, [['2026-01-05', 12.2, 12.5, 12.45, 12.3], ['2026-01-06', 12.4, 12.8, 12.7, 12.45], ['2026-01-07', 12.31, 12.9, 12.85, 12.3100004196167]], 'S1');
    expect(sim.legs[0].riskPct).toBeCloseTo((12.31 - 12.3) / 12.31 * 100, 9);
  });
});

describe('the setup is over', () => {
  it('no re-entry once the source has counted the target, once the target touched while out, or once the stop and the target came the same day', () => {
    const reached = run({ ...WITH_LFD, reached: '2026-01-09' }, [...BREAK, ['2026-01-07', 93, 99, 96, 97], ['2026-01-08', 95, 99, 98, 97], ['2026-01-09', 97, 104, 99, 98], ['2026-01-12', 99, 106, 105, 100], ['2026-01-13', 104, 108, 107, 105]], 'S2-u', { entry: 'close' });
    expect(reached.legs).toHaveLength(1);
    const sameDay = run(WITH_LFD, [...BREAK, ['2026-01-07', 93, 121, 120, 100], ['2026-01-08', 110, 119, 115, 118]], 'S2-u', { entry: 'close' });
    expect(sameDay.legs).toHaveLength(1);
    expect(sameDay.legs[0].exit).toMatchObject({ when: '2026-01-07', reason: 'stop', price: 94 });
    const touched = run(WITH_LFD, [...BREAK, ['2026-01-07', 93, 99, 96, 97], ['2026-01-08', 96, 121, 110, 97]], 'S2-u', { entry: 'close', targetOn: 'touch' });
    expect(touched.legs).toHaveLength(1);
  });

  it('on a touch basis a day that opens past the target has it before a stop touch later that day', () => {
    const sim = run(WITH_LFD, [...BREAK, ['2026-01-07', 99, 104, 103, 100], ['2026-01-08', 93, 123, 95, 121]], 'S1', { targetOn: 'touch' });
    expect(sim.legs[0].exit).toMatchObject({ when: '2026-01-08', price: 121, basis: 'open', reason: 'target' });
    expect(run(WITH_LFD, [...BREAK, ['2026-01-07', 99, 104, 103, 100], ['2026-01-08', 93, 123, 95, 121]], 'S1').legs[0].exit).toMatchObject({ reason: 'stop', price: 94 });
  });
});

describe('the new stop with no boundary', () => {
  it('is read from the bar before the re-entry close, as the first stop is from the bar before the trigger close', () => {
    const p: Setup = { ...WITH_LFD, boundary: null };
    const path: Day[] = [...BREAK,
      ['2026-01-07', 93, 103, 102, 97],    // the stop touched, the close back over the trigger
      ['2026-01-08', 99, 104, 103, 100],   // re-entry: the bar before it is 01-07, low 93
      ['2026-01-09', 94, 105, 104, 100],   // under the 01-05 low (95) a run-based reading would give, not under 93
    ];
    const sim = run(p, path, 'S2-u', { entry: 'close', reentryStop: 'new' });
    expect(sim.legs).toHaveLength(2);
    expect(sim.legs[1]).toMatchObject({ stop: 93, stopKind: 'new last full day', open: true });
  });
});

describe('the record', () => {
  it('a setup removed before its fill has no leg and says so', () => {
    const p: Setup = { ...WITH_LFD, removed: '2026-01-07', removed_reason: 'morphing', manualState: 'removed' };
    const sim = run(p, [...BREAK, ['2026-01-09', 99, 104, 103, 100]], 'S1');
    expect(sim.legs).toHaveLength(0);
    expect(sim.note).toBe('removed by the source before the fill');
  });

  it('a setup with no negation on file never fails, and its risk is unknown without a stop', () => {
    const p: Setup = { ...WITH_LFD, negation: null, lfd: 0 };
    const sim = run(p, [...BREAK, ['2026-01-07', 99, 104, 103, 100], ['2026-01-08', 80, 99, 85, 97]], 'S3');
    expect(sim.legs[0]).toMatchObject({ open: true, riskPct: null, r: null, stopKind: 'none' });
  });

  it('an open leg is marked at every settled close as it goes, and days count from the entry', () => {
    const sim = run(WITH_LFD, [...BREAK, ['2026-01-07', 99, 104, 103, 100], ['2026-01-08', 101, 106, 105, 102], ['2026-01-15', 103, 108, 107, 104]], 'S1');
    expect(sim.legs[0]).toMatchObject({ open: true, mark: { when: '2026-01-15', price: 107 }, days: 8 });
    expect(sim.legs[0].grossPct).toBeCloseTo(7, 9);
  });
});

describe('S4', () => {
  it('trails closes, not the fill: an open far above the closes that follow sets no trail', () => {
    const sim = run(WITH_LFD, [...BREAK, ['2026-01-07', 103, 112, 104, 110], ['2026-01-08', 103, 106, 105, 104], ['2026-01-09', 96, 105, 100, 104]], 'S4');
    // The best close is 105 and the ATR about 6, so the trail (93) stays under the 94 last full day; the 01-09 low of 96 touches neither.
    expect(sim.legs[0]).toMatchObject({ entry: { price: 110 }, open: true });
  });

  it('a fill at the confirming close is a close, so the trail from it is in force from the next day', () => {
    const p: Setup = { ...LONG, negation: 85, lfd: 88 };
    const sim = run(p, [...BREAK, ['2026-01-07', 92, 103, 102, 100]], 'S4', { entry: 'close' });
    // One true range so far, 4: the trail is 101 − 8 = 93, over the 88 last full day, and the 01-07 low of 92 is under it.
    expect(sim.legs[0].exit).toMatchObject({ when: '2026-01-07', price: 93, basis: 'level', reason: 'stop', stopKind: 'trailing stop' });
  });

  it('for a short the trail only ever comes down, and the exit says which stop fired', () => {
    const path: Day[] = [
      ['2026-01-05', 99, 104, 101, 102], ['2026-01-06', 97, 101, 99, 100],
      ['2026-01-07', 95, 100.5, 97, 100], ['2026-01-08', 94, 99, 95, 96], ['2026-01-09', 88, 96, 90, 92],
      ['2026-01-12', 95, 103, 102, 96],    // the high, 103, is over the trail (101.25) but under the 106 last full day
    ];
    const sim = run(SHORT_LFD, path, 'S4');
    expect(sim.legs[0].exit).toMatchObject({ when: '2026-01-12', basis: 'level', reason: 'stop', stopKind: 'trailing stop' });
    expect(sim.legs[0].exit!.level).toBeCloseTo(101.25, 6);
    expect(run(SHORT_LFD, path, 'S1').legs[0].exit).toBeNull();
  });
});

describe('S0, B1 only', () => {
  const IN: Day = ['2026-01-07', 101, 104, 103, 102];   // the fill at the open, 102

  it('leaves on the first touch of the trigger, at the trigger, and is done: no re-entry on a close back past it', () => {
    const sim = run(WITH_LFD, [...BREAK, IN, ['2026-01-08', 100, 105, 104, 103], ['2026-01-09', 101, 106, 105, 102]], 'S0');
    expect(sim.legs).toHaveLength(1);
    expect(sim.legs[0]).toMatchObject({ entry: { when: '2026-01-07', price: 102, basis: 'open' }, stop: 100, stopKind: 'trigger' });
    expect(sim.legs[0].exit).toMatchObject({ when: '2026-01-08', price: 100, basis: 'level', reason: 'stop', stopKind: 'trigger', level: 100 });
    expect(sim.legs[0].riskPct).toBeCloseTo((102 - 100) / 102 * 100, 9);
    // The same day leaves S1 alone: its stop is the last full day, 94.
    expect(run(WITH_LFD, [...BREAK, IN, ['2026-01-08', 100, 105, 104, 103]], 'S1').legs[0].exit).toBeNull();
  });

  it('fills at the open where the day opened through the trigger', () => {
    const sim = run(WITH_LFD, [...BREAK, IN, ['2026-01-08', 97, 101, 100.5, 98]], 'S0');
    expect(sim.legs[0].exit).toMatchObject({ when: '2026-01-08', price: 98, basis: 'open', reason: 'stop', stopKind: 'trigger' });
  });

  it('needs no last full day: a setup with none in the report runs, on the trigger', () => {
    const sim = run({ ...LONG, lfd: 0 }, [...BREAK, IN], 'S0');
    expect(sim.legs[0]).toMatchObject({ stop: 100, stopKind: 'trigger', open: true });
  });

  it('entered from a report, a setup that had already pulled back to the trigger is not taken', () => {
    const p: Setup = { ...WITH_LFD, confirmed: '2026-01-09' };
    const dip: Day[] = [...BREAK, ['2026-01-07', 99.5, 104, 103, 102], ['2026-01-08', 101, 105, 104, 102], ['2026-01-09', 102, 106, 105, 103], ['2026-01-12', 104, 108, 107, 105]];
    const sim = run(p, dip, 'S0');
    expect(sim.legs).toHaveLength(0);
    expect(sim.note).toBe('pulled back to the trigger before the report');
    // With the 01-07 low over the trigger the setup is still B1 when the report comes, and S0 is in at the next open.
    const held: Day[] = dip.map(d => (d[0] === '2026-01-07' ? ['2026-01-07', 100.5, 104, 103, 102] : d));
    expect(run(p, held, 'S0').legs[0]).toMatchObject({ entry: { when: '2026-01-12', price: 105, basis: 'open' }, stopKind: 'trigger' });
    // S1 does not mind the pullback.
    expect(run(p, dip, 'S1').legs).toHaveLength(1);
  });

  it('under the trigger entry a fill at the trigger is its own entry, with no risk to the stop, and the exits are read from the next day', () => {
    const sim = run(WITH_LFD, [...BREAK, ['2026-01-07', 99.5, 104, 103, 102]], 'S0', { entry: 'trigger' });
    expect(sim.legs).toHaveLength(1);
    expect(sim.legs[0]).toMatchObject({ entry: { when: '2026-01-06', price: 100, basis: 'level' }, riskPct: null, r: null });
    expect(sim.legs[0].exit).toMatchObject({ when: '2026-01-07', price: 100, basis: 'level', reason: 'stop', stopKind: 'trigger' });
    expect(sim.legs[0].grossPct).toBeCloseTo(0, 9);
  });

  it('entered from a report at the close, a first session that touched the trigger is the pullback: no leg', () => {
    const p: Setup = { ...WITH_LFD, confirmed: '2026-01-07' };
    const base: Day[] = [...BREAK, ['2026-01-07', 100.5, 104, 103, 101]];
    const dipped = run(p, [...base, ['2026-01-08', 99.5, 105, 104, 102]], 'S0', { entry: 'close' });
    expect(dipped.legs).toHaveLength(0);
    expect(dipped.note).toBe('pulled back to the trigger before the fill');
    expect(run(p, [...base, ['2026-01-08', 100.5, 105, 104, 102]], 'S0', { entry: 'close' }).legs[0].entry).toMatchObject({ when: '2026-01-08', price: 104, basis: 'close' });
    // S1 takes the close either way.
    expect(run(p, [...base, ['2026-01-08', 99.5, 105, 104, 102]], 'S1', { entry: 'close' }).legs).toHaveLength(1);
  });

  it('under the trigger entry, from a report, takes only a first session that opens past the trigger', () => {
    const p: Setup = { ...WITH_LFD, confirmed: '2026-01-07' };
    const base: Day[] = [...BREAK, ['2026-01-07', 100.5, 104, 103, 101]];
    expect(run(p, [...base, ['2026-01-08', 102, 106, 105, 103]], 'S0', { entry: 'trigger' }).legs[0]).toMatchObject({ entry: { when: '2026-01-08', price: 103, basis: 'open' } });
    const back = run(p, [...base, ['2026-01-08', 97, 103, 102, 99]], 'S0', { entry: 'trigger' });
    expect(back.legs).toHaveLength(0);
    expect(back.note).toBe('pulled back to the trigger before the fill');
    // S1's buy-stop fills at the trigger that day.
    expect(run(p, [...base, ['2026-01-08', 97, 103, 102, 99]], 'S1', { entry: 'trigger' }).legs[0]).toMatchObject({ entry: { when: '2026-01-08', price: 100, basis: 'level' } });
  });
});

describe('the entry at the trigger', () => {
  it('fills at the trigger on the day that closes past it, with the risk to the last full day', () => {
    const sim = run(WITH_LFD, [...BREAK, ['2026-01-07', 99, 104, 103, 100]], 'S1', { entry: 'trigger' });
    expect(sim.legs[0]).toMatchObject({ entry: { when: '2026-01-06', price: 100, basis: 'level' }, mark: { when: '2026-01-07', price: 103 }, open: true });
    expect(sim.legs[0].riskPct).toBeCloseTo(6, 9);
  });

  it('fills at the open where the breakout day opened past the trigger, and that day is read for exits', () => {
    const sim = run(WITH_LFD, [['2026-01-05', 95, 99, 98, 96], ['2026-01-06', 100.5, 104, 103, 101]], 'S1', { entry: 'trigger' });
    expect(sim.legs[0]).toMatchObject({ entry: { when: '2026-01-06', price: 101, basis: 'open' }, mark: { when: '2026-01-06', price: 103 } });
    // The same day's low under the stop is a stop exit that day.
    const stopped = run(WITH_LFD, [['2026-01-05', 95, 99, 98, 96], ['2026-01-06', 93, 104, 103, 101]], 'S1', { entry: 'trigger' });
    expect(stopped.legs[0].entry).toMatchObject({ when: '2026-01-06', price: 101, basis: 'open' });
    expect(stopped.legs[0].exit).toMatchObject({ when: '2026-01-06', price: 94, basis: 'level', reason: 'stop' });
    const gapTooFar = run({ ...WITH_LFD, target: 101 }, [['2026-01-05', 95, 99, 98, 96], ['2026-01-06', 100.5, 104, 103, 102]], 'S1', { entry: 'trigger' });
    expect(gapTooFar.legs).toHaveLength(0);
    expect(gapTooFar.note).toBe('the open past the trigger was past the target');
  });

  it('does not read the fill day\'s range for the stop, but does read its close for the target, and its range on a touch basis', () => {
    const p: Setup = { ...WITH_LFD, lfd: 98 };
    const day: Day[] = [['2026-01-05', 95, 99, 98, 96], ['2026-01-06', 96, 121, 120.5, 97]];
    const sim = run(p, day, 'S1', { entry: 'trigger' });
    expect(sim.legs[0].exit).toMatchObject({ when: '2026-01-06', price: 120.5, basis: 'close', reason: 'target' });
    expect(run(p, day, 'S1', { entry: 'trigger', targetOn: 'touch' }).legs[0].exit).toMatchObject({ when: '2026-01-06', price: 120, basis: 'level', reason: 'target' });
    // The same breakout under the open entry is refused: its confirming close is at the target.
    expect(run(p, day, 'S1').note).toBe('at the target on the confirming close');
    // A fill day whose low is under the stop but whose close is not at the target stays in.
    expect(run(p, [['2026-01-05', 95, 99, 98, 96], ['2026-01-06', 96, 104, 103, 97]], 'S1', { entry: 'trigger' }).legs[0].open).toBe(true);
  });

  it('a re-entry fills at the trigger, or at the open where the re-entry day opened past it', () => {
    const path: Day[] = [...BREAK, ['2026-01-07', 93, 99, 96, 97], ['2026-01-08', 97, 103, 102, 98], ['2026-01-09', 101, 106, 105, 102]];
    const sim = run(WITH_LFD, path, 'S2-u', { entry: 'trigger' });
    expect(sim.legs.map(l => [l.n, l.entry.when, l.entry.price, l.entry.basis])).toEqual([[1, '2026-01-06', 100, 'level'], [2, '2026-01-08', 100, 'level']]);
    expect(sim.legs[0].exit).toMatchObject({ when: '2026-01-07', price: 94 });
    expect(sim.legs[1]).toMatchObject({ open: true, mark: { when: '2026-01-09', price: 105 } });
    const gapped: Day[] = path.map(d => (d[0] === '2026-01-08' ? ['2026-01-08', 100.5, 103, 102, 101] : d));
    expect(run(WITH_LFD, gapped, 'S2-u', { entry: 'trigger' }).legs[1].entry).toMatchObject({ when: '2026-01-08', price: 101, basis: 'open' });
  });

  it('from a report the buy-stop rests: filled at the first open at or past the trigger, or at the trigger on the first session back at it', () => {
    const p: Setup = { ...WITH_LFD, confirmed: '2026-01-07' };
    const base: Day[] = [...BREAK, ['2026-01-07', 100, 104, 103, 101]];
    const atOpen = run(p, [...base, ['2026-01-08', 102, 106, 105, 103]], 'S1', { entry: 'trigger' });
    expect(atOpen.legs[0].entry).toEqual({ when: '2026-01-08', price: 103, basis: 'open', index: 3 });
    const later = run(p, [...base, ['2026-01-08', 98.5, 99.5, 99, 99], ['2026-01-09', 99, 103, 102, 99.5]], 'S1', { entry: 'trigger' });
    expect(later.legs[0]).toMatchObject({ entry: { when: '2026-01-09', price: 100, basis: 'level' }, mark: { when: '2026-01-09', price: 102 } });
    expect(later.note).toBeNull();
  });

  it('a resting buy-stop is cancelled by a touch of the negation, and waits while no session has come back to the trigger', () => {
    const p: Setup = { ...WITH_LFD, confirmed: '2026-01-07' };
    const base: Day[] = [...BREAK, ['2026-01-07', 100, 104, 103, 101]];
    const negated = run(p, [...base, ['2026-01-08', 89, 99, 95, 98], ['2026-01-09', 99, 103, 102, 99.5]], 'S1', { entry: 'trigger' });
    expect(negated.legs).toHaveLength(0);
    expect(negated.note).toBe('the negation was touched before the buy-stop at the trigger filled');
    const resting = run(p, [...base, ['2026-01-08', 98.5, 99.5, 99, 99]], 'S1', { entry: 'trigger' });
    expect(resting.legs).toHaveLength(0);
    expect(resting.note).toBe(WAITING_TRIGGER);
  });

  it('a resting buy-stop is cancelled when the session that comes back to the trigger also touches the negation, on either side', () => {
    const p: Setup = { ...WITH_LFD, confirmed: '2026-01-07' };
    const base: Day[] = [...BREAK, ['2026-01-07', 100, 104, 103, 101]];
    for (const id of ['S1', 'S2-u', 'S3'] as const) {
      const sim = run(p, [...base, ['2026-01-08', 88, 100.5, 99, 95], ['2026-01-09', 99, 103, 102, 99.5]], id, { entry: 'trigger' });
      expect(sim.legs, id).toHaveLength(0);
      expect(sim.note, id).toBe('the negation was touched before the buy-stop at the trigger filled');
    }
    const short = run({ ...SHORT_LFD, confirmed: '2026-01-07' }, [['2026-01-05', 99, 104, 101, 102], ['2026-01-06', 97, 101, 99, 100], ['2026-01-07', 96, 100, 98, 99], ['2026-01-08', 99.5, 112, 101, 105]], 'S1', { entry: 'trigger' });
    expect(short.legs).toHaveLength(0);
    expect(short.note).toBe('the negation was touched before the buy-stop at the trigger filled');
    // Opened past the trigger, the order fills at the open and the day is read: the stop takes the leg out (the negation under S3).
    const atOpen = run(p, [...base, ['2026-01-08', 88, 103, 95, 101]], 'S1', { entry: 'trigger' });
    expect(atOpen.legs[0].entry).toMatchObject({ when: '2026-01-08', price: 101, basis: 'open' });
    expect(atOpen.legs[0].exit).toMatchObject({ when: '2026-01-08', price: 94, basis: 'level', reason: 'stop' });
    expect(run(p, [...base, ['2026-01-08', 88, 103, 95, 101]], 'S3', { entry: 'trigger' }).legs[0].exit).toMatchObject({ when: '2026-01-08', price: 90, basis: 'level', reason: 'negation' });
  });

  it('with the target on a touch, a re-entry day that reaches the target is a leg in at the trigger and out at the target', () => {
    const path: Day[] = [...BREAK, ['2026-01-07', 93, 99, 96, 97], ['2026-01-08', 97, 121, 110, 98]];
    const touched = run(WITH_LFD, path, 'S2-u', { entry: 'trigger', targetOn: 'touch' });
    expect(touched.legs).toHaveLength(2);
    expect(touched.legs[1].entry).toMatchObject({ when: '2026-01-08', price: 100, basis: 'level' });
    expect(touched.legs[1].exit).toMatchObject({ when: '2026-01-08', price: 120, basis: 'level', reason: 'target' });
    // On a close basis the leg stays in; under the next-open entry the touch while out ends the setup.
    expect(run(WITH_LFD, path, 'S2-u', { entry: 'trigger' }).legs[1]).toMatchObject({ entry: { price: 100 }, open: true });
    expect(run(WITH_LFD, path, 'S2-u', { targetOn: 'touch' }).legs).toHaveLength(1);
  });

  it('with no session after the report on file yet, the buy-stop waits for the next session', () => {
    const sim = run({ ...WITH_LFD, confirmed: '2026-01-07' }, [...BREAK, ['2026-01-07', 100, 104, 103, 101]], 'S1', { entry: 'trigger' });
    expect(sim.legs).toHaveLength(0);
    expect(sim.note).toBe(WAITING_SESSION);
  });

  it('a breakout on the newest session, known by its close alone, waits for its bar', () => {
    const sim = run(WITH_LFD, [['2026-01-05', 95, 99, 98, 96]], 'S1', { entry: 'trigger' }, [['2026-01-06', 101]]);
    expect(sim.legs).toHaveLength(0);
    expect(sim.note).toBe(WAITING_BAR);
  });
});

describe('no last full day in the report', () => {
  const NO_LFD: Setup = { ...LONG, lfd: 0 };

  it('S1 runs on the negation: the leg has no tight stop, its risk is to the negation, and a touch of it is the exit', () => {
    const sim = run(NO_LFD, [...BREAK, ['2026-01-07', 99, 104, 103, 100], ['2026-01-08', 89, 99, 95, 98]], 'S1');
    expect(sim.legs[0]).toMatchObject({ stop: null, stopKind: 'negation', entry: { price: 100 } });
    expect(sim.legs[0].riskPct).toBeCloseTo(10, 9);
    expect(sim.legs[0].exit).toMatchObject({ when: '2026-01-08', price: 90, basis: 'level', reason: 'negation', level: 90 });
  });

  it('under S2 a negation touch is final: no re-entry on the close back past the trigger', () => {
    const sim = run(NO_LFD, [...BREAK, ['2026-01-07', 99, 104, 103, 100], ['2026-01-08', 89, 99, 95, 98], ['2026-01-09', 99, 103, 102, 100]], 'S2-u');
    expect(sim.legs).toHaveLength(1);
    expect(sim.legs[0].exit).toMatchObject({ reason: 'negation' });
  });

  it('S4 starts on the negation and trails from there: a trail beyond the negation is not taken, a tighter one is', () => {
    const sim = run(NO_LFD, [...BREAK, ['2026-01-07', 99, 104, 103, 100], ['2026-01-08', 101, 106, 105, 102]], 'S4');
    expect(sim.legs[0]).toMatchObject({ stop: null, stopKind: 'negation', open: true });
    // Wide bars: the ATR is 30, so the trail from the 101 fill sits at 41, under the 90 negation, and the negation stays the stop.
    const wide = run(NO_LFD, [['2026-01-05', 70, 100, 98, 80], ['2026-01-06', 75, 105, 101, 80], ['2026-01-07', 40, 103, 95, 100]], 'S4', { entry: 'close' });
    expect(wide.legs[0].exit).toMatchObject({ when: '2026-01-07', price: 90, basis: 'level', reason: 'negation', level: 90 });
    // Narrow bars: the trail is over the negation and takes over.
    const tight = run(NO_LFD, [...BREAK, ['2026-01-07', 99, 104, 103, 100], ['2026-01-08', 93, 100, 98, 99]], 'S4', { entry: 'close' });
    expect(tight.legs[0].exit).toMatchObject({ when: '2026-01-08', basis: 'level', reason: 'stop', stopKind: 'trailing stop' });
    expect(tight.legs[0].exit!.level).toBeGreaterThan(90);
  });
});
