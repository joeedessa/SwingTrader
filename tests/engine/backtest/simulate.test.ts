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
    expect(out.pending).toBeNull();
  });
});

describe('the record', () => {
  it('a setup removed before its fill has no leg and says so', () => {
    const p: Setup = { ...WITH_LFD, removed: '2026-01-07', removed_reason: 'morphing', manualState: 'removed' };
    const sim = run(p, [...BREAK, ['2026-01-09', 99, 104, 103, 100]], 'S1');
    expect(sim.legs).toHaveLength(0);
    expect(sim.pending).toBe('removed by the source before the fill');
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
