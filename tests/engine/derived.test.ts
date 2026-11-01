import { describe, expect, it } from 'vitest';
import { dayPctOf, divAhead, gapTo, lfdRisk, pct1, riskOf, rrOf, runupOf, stopFor, upsideOf } from '../../src/engine/derived';
import { lfdAt, LONG, SHORT } from './helpers';

describe('derived values', () => {
  it('pct1 rounds to one decimal and passes null through', () => {
    expect(pct1(12.345)).toBe(12.3);
    expect(pct1(null)).toBeNull();
    expect(pct1(NaN)).toBeNull();
  });

  it('gap to trigger: positive while short of it, signed the setup\'s way, waiting rows only', () => {
    expect(gapTo(LONG, 95, true)).toEqual({ pct: 5.3, abs: 5 });
    expect(gapTo(SHORT, 105, true)).toEqual({ pct: -4.8, abs: 5 });
    expect(gapTo(LONG, 102, true)).toEqual({ pct: -2, abs: -2 });
    expect(gapTo(LONG, 95, false)).toEqual({ pct: null, abs: null });
  });

  it('upside is trigger → target while waiting, live → target once confirmed', () => {
    expect(upsideOf(LONG, 110, true)).toBe(20);
    expect(upsideOf(LONG, 110, false)).toBe(9.1);
    expect(upsideOf(SHORT, 90, false)).toBe(11.1);
    expect(upsideOf(LONG, null, false)).toBeNull();
  });

  it('risk is live → negation on confirmed rows', () => {
    expect(riskOf(LONG, 100, false)).toBe(10);
    expect(riskOf(SHORT, 100, false)).toBe(10);
    expect(riskOf(LONG, 100, true)).toBeNull();
  });

  it('day % uses the live tick against the prior settled close', () => {
    const settled = [['2026-01-05', 100], ['2026-01-06', 102]] as [string, number][];
    expect(dayPctOf({ settled, live: 104.04, liveDate: '2026-01-07', currency: 'USD' })).toBeCloseTo(2, 6);
    // Session over: the live tick is the last settled close, measured against the one before.
    expect(dayPctOf({ settled, live: 102, liveDate: '2026-01-06', currency: 'USD' })).toBeCloseTo(2, 6);
    expect(dayPctOf(null)).toBeNull();
  });

  it('give-back to the tight stop has the same sign as risk', () => {
    expect(lfdRisk('long', lfdAt(94, null), 100)).toBe(6);
    expect(lfdRisk('short', lfdAt(106, null), 100)).toBe(6);
    expect(lfdRisk('long', lfdAt(94, null, { looser: true }), 100)).toBeNull();
    expect(lfdRisk('long', null, 100)).toBeNull();
  });

  it('run-up measures past the trigger, the move used and the reward : risk of entering now', () => {
    const r = runupOf(LONG, 105, 104, lfdAt(94, null))!;
    expect(r.past).toBeCloseTo(5, 6);
    expect(r.used).toBeCloseTo(0.25, 6);
    expect(r.rr).toBeCloseTo(15 / 11, 6);
    expect(r.vs).toBe('tight stop');
    // No tight stop: the negation is the risk.
    expect(runupOf(LONG, 105, null, null)).toMatchObject({ vs: 'negation', rr: 15 / 15 });
    // Falls back to the last close without a live price; nothing without either.
    expect(runupOf(LONG, null, 104, null)!.past).toBeCloseTo(4, 6);
    expect(runupOf(LONG, null, null, null)).toBeNull();
  });

  it('reward : risk at the trigger uses the tight stop where known, else the negation', () => {
    expect(rrOf(LONG, lfdAt(94, null))).toEqual({ ratio: 20 / 6, vs: 'tight stop', stop: 94 });
    expect(rrOf(LONG, null)).toEqual({ ratio: 2, vs: 'negation', stop: 90 });
    expect(rrOf(SHORT, null)).toEqual({ ratio: 2, vs: 'negation', stop: 110 });
    expect(rrOf({ ...LONG, negation: null }, null)).toBeNull();
    expect(rrOf({ ...LONG, negation: 101 }, null)).toBeNull();     // risk must be positive
  });

  it('the trailing stop is 2×ATR, widened for a long while a dividend is ahead', () => {
    const ev = { atr: 2, ex_div: '2026-01-10', div_amount: 0.5 };
    expect(stopFor(LONG, 100, ev, '2026-01-08')).toEqual({ at: 95.5, plain: 96, widenedBy: 0.5, atr: 2, exDiv: '2026-01-10' });
    expect(stopFor(SHORT, 100, ev, '2026-01-08')).toMatchObject({ at: 104, plain: 104, widenedBy: 0 });
    expect(stopFor(LONG, 100, ev, '2026-01-11')).toMatchObject({ at: 96, widenedBy: 0 });    // ex-date passed
    expect(stopFor(LONG, 100, { atr: null }, '2026-01-08')).toBeNull();
    expect(divAhead(ev, '2026-01-10')).toBe(true);     // the ex-date itself counts
    expect(divAhead({ ex_div: '2026-01-10' }, '2026-01-08')).toBe(false);
  });
});
