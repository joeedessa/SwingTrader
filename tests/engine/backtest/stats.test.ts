import { describe, expect, it } from 'vitest';
import { atrSeries } from '../../../src/engine/backtest/atr';
import { bootstrapMean, mulberry32 } from '../../../src/engine/backtest/bootstrap';
import { ratiosOf } from '../../../src/engine/backtest/ratio';
import { DEFAULT_SETTINGS, STRATEGIES, strategyId } from '../../../src/engine/backtest/settings';
import type { ModelSettings, StrategyId } from '../../../src/engine/backtest/settings';
import { simulate } from '../../../src/engine/backtest/simulate';
import type { Leg } from '../../../src/engine/backtest/simulate';
import { sizeOf, sizingContext } from '../../../src/engine/backtest/sizing';
import { moneyStatsOf, statsOf } from '../../../src/engine/backtest/stats';
import type { MoneyStats } from '../../../src/engine/backtest/stats';
import { universeOf } from '../../../src/engine/backtest/universe';
import type { Candidate, Day } from '../../../src/engine/backtest/universe';
import { evaluate } from '../../../src/engine/row';
import type { Setup } from '../../../src/engine/types';
import { LONG, series } from '../helpers';
import type { Day as TestDay } from '../helpers';

const WITH_LFD: Setup = { ...LONG, lfd: 94 };

function legsOf(p: Setup, days: TestDay[], id: StrategyId, o: Partial<ModelSettings> = {}, extraSettled: [string, number][] = []): Leg[] {
  const { bars, hist } = series(days);
  for (const e of extraSettled) hist.settled.push(e);
  const row = evaluate(p, hist, bars, null, '2026-02-01');
  const settings = { ...DEFAULT_SETTINGS, ...o };
  const u = universeOf([row], { [p.sym]: hist }, { [p.sym]: bars }, settings);
  return simulate(u.candidates[0], STRATEGIES.find(s => strategyId(s) === id)!, settings).legs;
}

// The gap fixture's path: filled at 100 on 01-07, out at 91 on 01-09 (−9.4% net).
const GAP: TestDay[] = [['2026-01-05', 95, 99, 98, 96], ['2026-01-06', 98, 102, 101, 99], ['2026-01-07', 99.5, 104, 103, 100], ['2026-01-08', 101, 105, 104, 103], ['2026-01-09', 88, 92, 90, 91]];
// The open fixture's path: filled at 100 on 01-07, marked at the close-only 01-12 (9.6% net).
const OPEN: TestDay[] = [['2026-01-05', 95, 99, 98, 96], ['2026-01-06', 98, 102, 101, 99], ['2026-01-07', 99, 104, 103, 100], ['2026-01-08', 101, 106, 105, 102], ['2026-01-09', 103, 108, 107, 104]];

const fake = (o: Partial<Leg>): Leg => ({
  key: 'X|long', sym: 'X', dir: 'long', currency: 'USD', n: 1,
  entry: { when: '2026-01-07', price: 100, basis: 'open', index: 0 }, exit: null, stop: 94, stopKind: 'last full day',
  mark: { when: '2026-01-09', price: 100 }, open: false, grossPct: 0, netPct: 0, riskPct: 6, r: 0, days: 2, tag: 'B1',
  stopSource: 'report', imported: false, c: {} as Candidate, ...o,
});

describe('the statistics of a list of legs', () => {
  const legs = [
    fake({ key: 'A|long', netPct: 10, r: 2, exit: { when: '2026-01-09', price: 110, basis: 'close', reason: 'target', level: 120, index: 2 }, days: 4, tag: 'B1' }),
    fake({ key: 'B|long', netPct: -5, r: -1, exit: { when: '2026-01-09', price: 95, basis: 'level', reason: 'stop', level: 94, index: 2 }, days: 2, tag: 'B3' }),
    fake({ key: 'C|short', netPct: 2.5, r: 0.5, open: true, days: 9, tag: 'B1' }),
    fake({ key: 'C|short', n: 2, netPct: 0, r: null, riskPct: null, open: true, days: 1, tag: null }),
  ];

  it('counts wins, losses and flat legs, the rates and the means, by hand', () => {
    const s = statsOf(legs);
    expect(s).toMatchObject({ legs: 4, setups: 3, wins: 2, losses: 1, flat: 1, withR: 3, open: 2 });
    expect(s.winRate).toBeCloseTo(50, 9);
    expect(s.expectancyPct).toBeCloseTo(1.875, 9);
    expect(s.expectancyR).toBeCloseTo(0.5, 9);
    expect(s.medianPct).toBeCloseTo(1.25, 9);
    expect(s.sumPct).toBeCloseTo(7.5, 9);
    expect(s.profitFactor).toBeCloseTo(2.5, 9);
    expect(s.medianDays).toBe(3);
    expect(s.byReason).toEqual({ target: 1, stop: 1, open: 2 });
    expect(s.byType.map(t => [t.tag, t.legs, t.setups, t.wins])).toEqual([['B1', 2, 2, 2], ['B2', 0, 0, 0], ['B3', 1, 1, 0], ['B4', 0, 0, 0], ['none', 1, 1, 0]]);
    expect(s.byType[0].expectancyPct).toBeCloseTo(6.25, 9);
  });

  it('is empty without legs, with no rates to show', () => {
    expect(statsOf([])).toMatchObject({ legs: 0, winRate: null, expectancyPct: null, expectancyR: null, profitFactor: null, medianDays: null, medianPct: null });
  });
});

describe('the equity line', () => {
  it('one leg, 10,000 on it: its value at each close, then at the exit', () => {
    const legs = legsOf(WITH_LFD, GAP, 'S1');
    const m = moneyStatsOf(legs, [10000]);
    expect(m.curve.dates).toEqual(['2026-01-07', '2026-01-08', '2026-01-09']);
    expect(m.curve.equity.map(v => Math.round(v))).toEqual([260, 360, -940]);
    expect(m).toMatchObject({ peakOpen: 1, avgOpen: 1, peakExposure: 10000 });
    expect(m.peakEquity).toBeCloseTo(360, 6);
    expect(m.maxDrawdown).toBeCloseTo(1300, 6);
    expect(m.totalPnl).toBeCloseTo(-940, 6);
    expect(m.curve.open).toEqual([1, 1, 1]);
  });

  it('two legs in different names add day by day, a leg carrying its value on days its name did not trade', () => {
    const gap = legsOf(WITH_LFD, GAP, 'S1');
    const open = legsOf({ ...WITH_LFD, sym: 'O' }, OPEN, 'S1', {}, [['2026-01-12', 110]]);
    const m = moneyStatsOf([...gap, ...open], [10000, 10000]);
    expect(m.curve.dates).toEqual(['2026-01-07', '2026-01-08', '2026-01-09', '2026-01-12']);
    expect(m.curve.equity.map(v => Math.round(v))).toEqual([520, 820, -280, 20]);
    expect(m.curve.open).toEqual([2, 2, 2, 1]);
    expect(m.curve.exposure).toEqual([20000, 20000, 20000, 10000]);
    expect(m.maxDrawdown).toBeCloseTo(1100, 6);
    expect(m).toMatchObject({ peakOpen: 2, avgOpen: 1.75, peakExposure: 20000 });
    expect(m.totalPnl).toBeCloseTo(20, 6);
  });

  it('is nothing without legs', () => {
    expect(moneyStatsOf([], [])).toMatchObject({ totalPnl: 0, maxDrawdown: 0, peakOpen: 0, avgOpen: null, peakExposure: 0, curve: { dates: [], equity: [] } });
  });
});

describe('sizing', () => {
  const s = DEFAULT_SETTINGS;
  const leg = (riskPct: number | null, target: number) => fake({ riskPct, c: { dir: 'long', trigger: 100, target } as Candidate });

  it('flat is the amount; per strategy scales it', () => {
    expect(sizeOf(leg(6, 120), 'flat', s, { scale: 0.3, medianPayoff: 20 })).toBe(10000);
    expect(sizeOf(leg(6, 120), 'perStrategy', s, { scale: 0.3, medianPayoff: 20 })).toBeCloseTo(3000, 9);
  });

  it('payoff scales by the setup\'s payoff over the median, between half and double', () => {
    const ctx = { scale: 1, medianPayoff: 20 };
    expect(sizeOf(leg(6, 130), 'payoff', s, ctx)).toBeCloseTo(15000, 9);
    expect(sizeOf(leg(6, 110), 'payoff', s, ctx)).toBeCloseTo(5000, 9);
    expect(sizeOf(leg(6, 160), 'payoff', s, ctx)).toBeCloseTo(20000, 9);
    expect(sizeOf(leg(6, 90), 'payoff', s, ctx)).toBe(10000);                       // no payoff: the flat amount
    expect(sizeOf(leg(6, 130), 'payoff', s, { scale: 1, medianPayoff: null })).toBe(10000);
  });

  it('risk puts the fixed sum between the entry and the stop, up to the cap', () => {
    expect(sizeOf(leg(5, 120), 'risk', s, { scale: 1, medianPayoff: null })).toBeCloseTo(10000, 9);
    expect(sizeOf(leg(2, 120), 'risk', s, { scale: 1, medianPayoff: null })).toBeCloseTo(20000, 9);
    expect(sizeOf(leg(10, 120), 'risk', s, { scale: 1, medianPayoff: null })).toBeCloseTo(5000, 9);
    expect(sizeOf(leg(null, 120), 'risk', s, { scale: 1, medianPayoff: null })).toBe(10000);
  });

  it('the median payoff counts each setup once', () => {
    const ctx = sizingContext([leg(6, 120), leg(6, 120), fake({ key: 'Y|long', c: { dir: 'long', trigger: 100, target: 140 } as Candidate })], 1);
    expect(ctx.medianPayoff).toBeCloseTo(30, 9);
  });
});

describe('the bootstrap', () => {
  it('is the same for the same seed and settings, and different for another seed', () => {
    const values = [10, -5, 2.5, 7, -3, 1];
    const a = bootstrapMean(values, 500, 7)!;
    expect(bootstrapMean(values, 500, 7)).toEqual(a);
    expect(bootstrapMean(values, 500, 8)).not.toEqual(a);
    expect(a).toMatchObject({ n: 6, resamples: 500, level: 0.9 });
    expect(a.mean).toBeCloseTo(12.5 / 6, 9);
    expect(a.low).toBeLessThanOrEqual(a.mean);
    expect(a.high).toBeGreaterThanOrEqual(a.mean);
    expect(a.low).toBeGreaterThanOrEqual(-5);
    expect(a.high).toBeLessThanOrEqual(10);
  });

  it('a list of one value has no spread; an empty list has no interval', () => {
    expect(bootstrapMean([4], 100, 1)).toMatchObject({ mean: 4, low: 4, high: 4 });
    expect(bootstrapMean([], 100, 1)).toBeNull();
  });

  it('the generator is uniform enough and repeatable', () => {
    const r = mulberry32(42);
    const xs = Array.from({ length: 2000 }, r);
    expect(xs.every(x => x >= 0 && x < 1)).toBe(true);
    expect(xs.reduce((a, b) => a + b, 0) / xs.length).toBeGreaterThan(0.45);
    expect(xs.reduce((a, b) => a + b, 0) / xs.length).toBeLessThan(0.55);
    expect(Array.from({ length: 5 }, mulberry32(42))).toEqual(xs.slice(0, 5));
  });
});

describe('the ratios', () => {
  it('equal drawdown and equal capital are S1\'s figure over S2\'s, under flat sizing', () => {
    const money = (maxDrawdown: number, peakExposure: number): MoneyStats =>
      ({ totalPnl: 0, maxDrawdown, peakEquity: 0, avgOpen: null, peakOpen: 0, peakExposure, curve: { dates: [], equity: [], open: [], exposure: [] } });
    const a = { legs: [fake({ key: 'A|long', riskPct: 5 })], flat: money(1000, 20000) };
    const b = { legs: [fake({ key: 'A|long', riskPct: 5 }), fake({ key: 'A|long', n: 2, riskPct: 7 })], flat: money(2500, 30000) };
    const r = ratiosOf(a, b);
    expect(r.equalRisk).toMatchObject({ a: 1, b: 1, basis: 'setups' });
    expect(r.equalRisk.ratio).toBeCloseTo(5 / 12, 9);
    expect(r.equalDrawdown.ratio).toBeCloseTo(0.4, 9);
    expect(r.equalCapital.ratio).toBeCloseTo(2 / 3, 9);
    expect(ratiosOf(a, { legs: [], flat: money(0, 0) })).toMatchObject({ equalRisk: { ratio: null }, equalDrawdown: { ratio: null }, equalCapital: { ratio: null } });
  });
});

describe('the ATR', () => {
  const day = (when: string, lo: number, hi: number, c: number | null, closeOnly = false): Day => ({ when, lo, hi, c, o: null, closeOnly });

  it('is Wilder\'s: the mean of the first period\'s ranges, then smoothed, by hand with a period of 2', () => {
    const days = [day('d1', 10, 12, 11), day('d2', 10, 12, 12), day('d3', 9, 13, 10), day('d4', 9.5, 12.5, 12), day('d5', 11, 12, 11.5)];
    // True ranges: d2 max(2, 1, 1) = 2; d3 max(4, 1, 3) = 4; d4 max(3, 2.5, 0.5) = 3; d5 max(1, 0, 1) = 1.
    // ATR(2): d2 2; d3 (2 + 4) / 2 = 3; d4 (3 + 3) / 2 = 3; d5 (3 + 1) / 2 = 2.
    expect(atrSeries(days, 2)).toEqual([null, 2, 3, 3, 2]);
  });

  it('a close-only day carries the value before it, and a bar with no close keeps the previous close for the next range', () => {
    const days = [day('d1', 10, 12, 11), day('d2', 10, 12, 12), day('d3', 12, 12, 12, true), day('d4', 9, 13, null), day('d5', 9.5, 12.5, 12)];
    // d2 TR 2 → 2; d3 carries 2; d4 TR max(4, |13 − 12|, |9 − 12|) = 4 → (2 + 4) / 2 = 3; d5 against the previous close 12 still: max(3, 0.5, 2.5) = 3 → (3 + 3) / 2 = 3.
    expect(atrSeries(days, 2)).toEqual([null, 2, 2, 3, 3]);
  });
});
