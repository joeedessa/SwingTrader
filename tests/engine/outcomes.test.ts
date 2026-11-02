import { describe, expect, it } from 'vitest';
import { median, OUTCOME_TAGS, outcomesOf, spanDays } from '../../src/engine/outcomes';
import { evaluate } from '../../src/engine/row';
import type { Row } from '../../src/engine/row';
import type { Setup } from '../../src/engine/types';
import { LONG, series } from './helpers';
import type { Day } from './helpers';
import { frozenBoard } from '../ui/frozen';

const rowOf = (p: Setup, days: Day[]): Row => {
  const { bars, hist } = series(days);
  return evaluate(p, hist, bars, {}, '2026-02-01');
};

// Waiting, then confirmed on 01-08 (a close of 100.5 past the 100 trigger), the last full day 94.
const WAIT: Day[] = [['2026-01-05', 94, 96, 95], ['2026-01-06', 95, 98, 97.5], ['2026-01-07', 96, 99, 98]];
const B1: Day[] = [...WAIT, ['2026-01-08', 97.5, 101, 100.5], ['2026-01-09', 101, 105, 104]];
const TARGET: Day = ['2026-01-20', 110, 121, 120];
const P = { ...LONG, lfd: 94 };

const straight = rowOf(P, [...B1, ['2026-01-12', 110, 121, 120]]);                                     // B1, 4 days
const pulledBack = rowOf(P, [...B1, ['2026-01-12', 99.5, 103, 102], ['2026-01-13', 110, 121, 120]]);   // B2, 5 days
const throughStop = rowOf(P, [...B1,                                                                    // B3, 12 days
  ['2026-01-12', 99.5, 103, 102], ['2026-01-13', 99, 102, 101], ['2026-01-14', 100.5, 106, 105],
  ['2026-01-15', 98, 101, 100.2], ['2026-01-16', 93, 99, 97], ['2026-01-19', 95, 102, 101], TARGET]);
const negated = rowOf(P, [...B1, ['2026-01-12', 89, 99, 95]]);                                         // B4, 4 days
const byHand = rowOf({ ...P, manualState: 'failed' }, B1);
const stillOpen = rowOf(P, B1);
const waiting = rowOf(P, WAIT);

describe('what a setup ended as', () => {
  it('sorts each resolved setup by its type, and counts the failures as B4', () => {
    expect([straight, pulledBack, throughStop, negated].map(r => r.btype && r.btype.tag)).toEqual(['B1', 'B2', 'B3', 'B4']);
    const o = outcomesOf([straight, pulledBack, throughStop, negated]);
    expect(o.byType.map(t => [t.tag, t.count])).toEqual([['B1', 1], ['B2', 1], ['B3', 1], ['B4', 1]]);
    expect(o.byType.map(t => t.tag)).toEqual([...OUTCOME_TAGS]);
  });

  it('says how often a breakout reached its target rather than its negation, among those that resolved', () => {
    const o = outcomesOf([straight, pulledBack, throughStop, negated]);
    expect(o).toMatchObject({ reached: 3, failed: 1, resolved: 4, hitRate: 75 });
  });

  it('takes the middle number of days from the breakout, to the target or to the failure', () => {
    const o = outcomesOf([straight, pulledBack, throughStop, negated]);
    expect(o.byType.map(t => t.medianDays)).toEqual([4, 5, 12, 4]);
    expect(o.medianToTarget).toBe(5);
    expect(o.medianToFailure).toBe(4);
  });

  it('does not count a setup still in play, one moved to Failed by hand, or one that has not triggered', () => {
    expect([stillOpen.section, byHand.section, waiting.section]).toEqual(['breakout', 'failed', 'watch']);
    const o = outcomesOf([straight, stillOpen, byHand, waiting]);
    expect(o).toMatchObject({ reached: 1, failed: 0, resolved: 1, hitRate: 100, open: 1, byHand: 1 });
  });

  it('has no hit rate, and no medians, when nothing has resolved', () => {
    const o = outcomesOf([stillOpen, waiting]);
    expect(o.resolved).toBe(0);
    expect(o.hitRate).toBeNull();
    expect(o.medianToTarget).toBeNull();
    expect(o.medianToFailure).toBeNull();
    expect(o.byType.every(t => t.count === 0 && t.medianDays === null)).toBe(true);
    expect(outcomesOf([]).hitRate).toBeNull();
  });

  it('keeps a target reached without bars to type it out of B1 to B3, and says how many', () => {
    const { hist } = series([...B1, ['2026-01-12', 110, 121, 120]]);
    const noBars = evaluate(P, hist, null, {}, '2026-02-01');
    expect(noBars.section).toBe('target');
    const o = outcomesOf([noBars]);
    expect(o).toMatchObject({ reached: 1, untyped: 1 });
    expect(o.byType.map(t => t.count)).toEqual([0, 0, 0, 0]);
  });

  it('does not change what it is given', () => {
    const rows = [straight, negated];
    const copy = rows.slice();
    outcomesOf(rows);
    expect(rows).toEqual(copy);
  });
});

describe('the middle number', () => {
  it('is the middle one of an odd list, the mean of the two middle ones of an even list, and nothing for none', () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 2, 9])).toBe(3);
    expect(median([7])).toBe(7);
    expect(median([])).toBeNull();
  });

  it('counts whole calendar days between two dates', () => {
    expect(spanDays('2026-01-08', '2026-01-12')).toBe(4);
    expect(spanDays('2026-10-30', '2026-11-02')).toBe(3);
  });
});

describe('on the frozen board', () => {
  const rows = frozenBoard().rows;
  const o = outcomesOf(rows);
  const count = (s: Row['section']) => rows.filter(r => r.section === s).length;

  it('accounts for every row that has an outcome, and for every one still in play', () => {
    expect(o.reached).toBe(count('target'));
    expect(o.failed + o.byHand).toBe(count('failed'));
    expect(o.open).toBe(count('breakout') + count('reentered') + count('stopped'));
    expect(o.resolved).toBeGreaterThan(0);
  });

  it('the type tiles add up to the setups that resolved, less any that could not be typed', () => {
    expect(o.byType.reduce((n, t) => n + t.count, 0)).toBe(o.resolved - o.untyped);
    expect(o.byType.find(t => t.tag === 'B4')!.count).toBe(o.failed);
  });

  it('keeps the hit rate a whole per cent between 0 and 100', () => {
    expect(o.hitRate).not.toBeNull();
    expect(Number.isInteger(o.hitRate)).toBe(true);
    expect(o.hitRate!).toBeGreaterThanOrEqual(0);
    expect(o.hitRate!).toBeLessThanOrEqual(100);
  });

  it('gives a median number of days for each type that has any, and never a negative one', () => {
    for (const t of o.byType) {
      if (t.count === 0) continue;
      expect(t.medianDays, t.tag).not.toBeNull();
      expect(t.medianDays!, t.tag).toBeGreaterThanOrEqual(0);
    }
  });
});
