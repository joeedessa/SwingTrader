import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, STRATEGIES, strategyId } from '../../../src/engine/backtest/settings';
import type { ModelSettings, StrategyId } from '../../../src/engine/backtest/settings';
import { simulate } from '../../../src/engine/backtest/simulate';
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
    expect(sim.legs[0]).toMatchObject({ open: true, riskPct: null, r: null, stopKind: 'negation' });
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
