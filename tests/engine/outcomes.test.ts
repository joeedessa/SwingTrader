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

// Waiting, then confirmed on 01-08 (a close of 100.5 past the 100 trigger), the last full day 94, the negation 90, the target 120.
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

// Reached the target on 01-12, then the negation was touched on 01-13: it ended Failed, having reached it first.
const targetThenNegated = rowOf(P, [...B1, ['2026-01-12', 110, 121, 120], ['2026-01-13', 85, 100, 95]]);
// The same after a pullback through the trigger: B2 at the target, and the negation does not change that.
const pulledBackThenNegated = rowOf(P, [...B1, ['2026-01-12', 99.5, 103, 102], ['2026-01-13', 110, 121, 120], ['2026-01-14', 85, 100, 95]]);
// The last full day is touched after the target, the negation is not: the counting stopped at the target, so it is B1 and At target.
const breachAfterTarget = rowOf(P, [...B1, ['2026-01-12', 110, 121, 120], ['2026-01-13', 93, 100, 97]]);
// The target close and the negation touch on one day: the touch is tested first, as in the replay.
const sameDay = rowOf(P, [...B1, ['2026-01-12', 89, 121, 120]]);
// Reached the target, and then it was moved to Failed by hand, or the source removed it.
const targetThenHand = rowOf({ ...P, manualState: 'failed' }, [...B1, ['2026-01-12', 110, 121, 120]]);
const targetThenRemoved = rowOf({ ...P, removed: '2026-01-14', manualState: 'removed' }, [...B1, ['2026-01-12', 110, 121, 120]]);

describe('what a setup ended as', () => {
  it('sorts each resolved setup by its type, and counts the misses as B4', () => {
    expect([straight, pulledBack, throughStop, negated].map(r => r.btype && r.btype.tag)).toEqual(['B1', 'B2', 'B3', 'B4']);
    const o = outcomesOf([straight, pulledBack, throughStop, negated]);
    expect(o.byType.map(t => [t.tag, t.count])).toEqual([['B1', 1], ['B2', 1], ['B3', 1], ['B4', 1]]);
    expect(o.byType.map(t => t.tag)).toEqual([...OUTCOME_TAGS]);
  });

  it('says how often a breakout reached its target rather than its negation, among those that resolved', () => {
    const o = outcomesOf([straight, pulledBack, throughStop, negated]);
    expect(o).toMatchObject({ hits: 3, misses: 1, resolved: 4, hitRate: 75 });
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
    expect(o).toMatchObject({ hits: 1, misses: 0, resolved: 1, hitRate: 100, open: 1, byHand: 1 });
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
    expect(o).toMatchObject({ hits: 1, untyped: 1 });
    expect(o.byType.map(t => t.count)).toEqual([0, 0, 0, 0]);
  });

  it('does not change what it is given', () => {
    const rows = [straight, negated];
    const copy = rows.slice();
    outcomesOf(rows);
    expect(rows).toEqual(copy);
  });
});

describe('a setup that reached its target and then ended some other way', () => {
  it('is a hit where the negation was touched afterwards, though the board puts it in Failed', () => {
    expect(targetThenNegated.section).toBe('failed');
    expect(targetThenNegated.st.targetHit).not.toBeNull();
    expect(targetThenNegated.hit).toMatchObject({ when: '2026-01-12', bySource: false });
    const o = outcomesOf([straight, negated, targetThenNegated]);
    expect(o).toMatchObject({ hits: 2, misses: 1, resolved: 3, hitRate: 67 });
    expect(o.moved).toEqual([{ sym: 'X', dir: 'long', section: 'failed', negated: true, when: '2026-01-12' }]);
  });

  it('keeps the type it had at the target, and B4 only for the ones the negation took first', () => {
    expect(targetThenNegated.btype!.tag).toBe('B4');
    expect(targetThenNegated.hit!.btype!.tag).toBe('B1');
    expect(pulledBackThenNegated.section).toBe('failed');
    expect(pulledBackThenNegated.btype!.tag).toBe('B4');
    expect(pulledBackThenNegated.hit!.btype!.tag).toBe('B2');
    const o = outcomesOf([targetThenNegated, pulledBackThenNegated, negated]);
    expect(o.byType.map(t => [t.tag, t.count])).toEqual([['B1', 1], ['B2', 1], ['B3', 0], ['B4', 1]]);
  });

  it('counts the days to the target for the hit, not to the negation that came after', () => {
    const o = outcomesOf([targetThenNegated]);
    expect(o.medianToTarget).toBe(4);                                  // 01-08 to 01-12
    expect(o.medianToFailure).toBeNull();
    expect(o.byType.find(t => t.tag === 'B1')!.medianDays).toBe(4);
  });

  it('stops reading the type at the target: a touch of the last full day after it changes nothing', () => {
    expect(breachAfterTarget.section).toBe('target');
    expect(breachAfterTarget.btype!.tag).toBe('B1');
    expect(breachAfterTarget.hit!.btype!.tag).toBe('B1');
  });

  it('is a miss, not a hit, when the target close and the negation touch fall on one day: the touch comes first', () => {
    expect(sameDay.section).toBe('failed');
    expect(sameDay.hit).toBeNull();
    expect(outcomesOf([sameDay])).toMatchObject({ hits: 0, misses: 1, hitRate: 0 });
  });

  it('is a hit where the source removed it afterwards, with the section left at Removed', () => {
    expect(targetThenRemoved.section).toBe('removed');
    const o = outcomesOf([straight, targetThenRemoved]);
    expect(o).toMatchObject({ hits: 2, misses: 0, resolved: 2, hitRate: 100, removedBeforeOutcome: 0 });
    expect(o.moved).toEqual([{ sym: 'X', dir: 'long', section: 'removed', negated: false, when: '2026-01-12' }]);
  });

  it('is a hit where you moved it to Failed by hand afterwards, and says it was by hand', () => {
    expect(targetThenHand.section).toBe('failed');
    const o = outcomesOf([targetThenHand]);
    expect(o).toMatchObject({ hits: 1, misses: 0, byHand: 0 });
    expect(o.moved).toEqual([{ sym: 'X', dir: 'long', section: 'failed', negated: false, when: '2026-01-12' }]);
  });

  it('lists the hits that left At target by the day they reached it, and none when none did', () => {
    const o = outcomesOf([targetThenRemoved, pulledBackThenNegated, targetThenNegated, straight]);
    expect(o.moved.map(m => m.when)).toEqual(['2026-01-12', '2026-01-12', '2026-01-13']);
    expect(o.moved.map(m => m.section).sort()).toEqual(['failed', 'failed', 'removed']);
    expect(outcomesOf([straight, negated]).moved).toEqual([]);
  });
});

describe('a setup the source removed', () => {
  const run = (removed: string, days: Day[], over: Partial<Setup> = {}) => rowOf({ ...P, removed, manualState: 'removed', ...over }, days);
  const reached: Day = ['2026-01-12', 110, 121, 120];
  const touched: Day = ['2026-01-12', 89, 99, 95];

  it('counts what happened up to the day it was dropped: a target before that day is a hit, a touch a miss', () => {
    expect(outcomesOf([run('2026-01-12', [...B1, reached])])).toMatchObject({ hits: 1, misses: 0 });
    expect(outcomesOf([run('2026-01-14', [...B1, touched])])).toMatchObject({ hits: 0, misses: 1 });
  });

  it('does not count a target, or a touch, that came after it was dropped, only that it was removed first', () => {
    const afterTarget = run('2026-01-10', [...B1, reached]);
    expect(afterTarget.hit).not.toBeNull();                            // the engine still reads its bars
    expect(outcomesOf([afterTarget])).toMatchObject({ hits: 0, misses: 0, resolved: 0, removedBeforeOutcome: 1, moved: [] });
    expect(outcomesOf([run('2026-01-10', [...B1, touched])])).toMatchObject({ hits: 0, misses: 0, removedBeforeOutcome: 1 });
  });

  it('is a hit, not a miss, where the target came before it was dropped and the touch after', () => {
    const r = run('2026-01-12', [...B1, reached, ['2026-01-13', 85, 100, 95]]);
    expect(r.st.failed).not.toBeNull();
    expect(outcomesOf([r])).toMatchObject({ hits: 1, misses: 0 });
  });

  it('does not count a breakout that came after it was dropped, not even as removed first', () => {
    const o = outcomesOf([run('2026-01-07', B1)]);
    expect(o).toMatchObject({ hits: 0, misses: 0, open: 0, byHand: 0, removedBeforeOutcome: 0 });
  });

  it('counts one that broke out and was dropped before either as removed first, and one that never broke out as nothing', () => {
    expect(outcomesOf([run('2026-01-10', B1)]).removedBeforeOutcome).toBe(1);
    expect(outcomesOf([run('2026-01-10', WAIT)]).removedBeforeOutcome).toBe(0);
  });

  it('counts it all when this browser put it back: the removal date ends the record only while it sits in Removed', () => {
    const back = rowOf({ ...P, removed: '2026-01-10', manualState: null }, [...B1, reached]);
    expect(back.section).toBe('target');
    expect(outcomesOf([back])).toMatchObject({ hits: 1 });
  });

  it('counts a removal made in this browser, which has no date, by everything the bars show', () => {
    const mine = rowOf({ ...P, manualState: 'removed' }, [...B1, reached]);
    expect(mine.p.removed).toBeUndefined();
    expect(outcomesOf([mine])).toMatchObject({ hits: 1 });
  });
});

describe('a target the source counted', () => {
  const REACHED = '2026-01-12';
  const days = (over: Day[]): Day[] => [...B1, ['2026-01-12', 99.5, 106, 105], ...over];
  const negation = (d: string): Day => [d, 85, 100, 95];

  it('is a hit where the negation was touched after that day, typed as it stood on the day', () => {
    const r = rowOf({ ...P, reached: REACHED }, days([negation('2026-01-13')]));
    expect(r.section).toBe('failed');
    expect(r.st.targetHit).toBeNull();                                 // the closes never got to 120
    expect(r.hit).toMatchObject({ when: REACHED, bySource: true });
    expect(r.hit!.btype!.tag).toBe('B2');                              // the 01-12 low went through the trigger
    expect(outcomesOf([r])).toMatchObject({ hits: 1, misses: 0 });
  });

  it('is not, where the touch came on that day or before it', () => {
    expect(rowOf({ ...P, reached: REACHED }, days([])).hit).toMatchObject({ bySource: true });       // no touch at all: the replay's own
    const sameDay = rowOf({ ...P, reached: '2026-01-13' }, days([negation('2026-01-13')]));
    expect(sameDay.hit).toBeNull();
    expect(rowOf({ ...P, reached: '2026-01-14' }, days([negation('2026-01-13')])).hit).toBeNull();
    expect(outcomesOf([sameDay])).toMatchObject({ hits: 0, misses: 1 });
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
  // What the bars say, read from the replay's own facts and not from `hit`, and the removal date as the cut-off.
  const upTo = (r: Row, when: string) => r.section !== 'removed' || !r.p.removed || when <= r.p.removed;
  const reachedFirst = rows.filter(r => r.st.targetHit && upTo(r, r.st.targetHit.when));
  const negatedFirst = rows.filter(r => !r.st.targetHit && r.st.failed && upTo(r, r.st.failed.when));

  it('counts every setup that reached its target before the negation as a hit, wherever the board put it', () => {
    expect(o.hits).toBeGreaterThan(0);
    expect(o.hits).toBe(reachedFirst.length);
    expect(o.hits).toBeGreaterThanOrEqual(count('target'));
    expect(rows.filter(r => r.section === 'target').every(r => reachedFirst.includes(r))).toBe(true);
  });

  it('counts every setup the negation took first as a miss, and nothing else', () => {
    expect(o.misses).toBe(negatedFirst.length);
    expect(o.resolved).toBe(o.hits + o.misses);
    expect(negatedFirst.every(r => r.section === 'failed' || r.section === 'removed')).toBe(true);
  });

  it('leaves out of the rate the ones still in play, the ones moved to Failed by hand, and the ones removed first', () => {
    expect(o.open).toBe(count('breakout') + count('reentered') + count('stopped'));
    expect(o.byHand).toBe(rows.filter(r => r.section === 'failed' && !r.st.failed && !r.st.targetHit).length);
    const removedFirst = rows.filter(r => r.section === 'removed' && r.st.breakout && upTo(r, r.st.breakout.when)
      && !reachedFirst.includes(r) && !negatedFirst.includes(r));
    expect(o.removedBeforeOutcome).toBe(removedFirst.length);
    for (const r of removedFirst) expect(r.p.removed, r.p.sym).toBeTruthy();
  });

  it('lists exactly the hits that are not At target, and each is in Failed or Removed', () => {
    const away = reachedFirst.filter(r => r.section !== 'target');
    expect(o.moved.map(m => m.sym + '|' + m.dir).sort()).toEqual(away.map(r => r.p.sym + '|' + r.p.dir).sort());
    for (const m of o.moved) expect(['failed', 'removed']).toContain(m.section);
    expect(o.moved.map(m => m.when)).toEqual(o.moved.map(m => m.when).sort());
  });

  it('types a hit as it stood at the target: never B4, and the same as the board\'s type for one still At target', () => {
    for (const r of rows) {
      if (!r.hit) continue;
      expect(r.hit.btype, r.p.sym).not.toBeNull();
      expect(r.hit.btype!.tag, r.p.sym).not.toBe('B4');
      if (r.section === 'target') expect(r.hit.btype!.tag, r.p.sym).toBe(r.btype!.tag);
      if (r.st.failed) expect(r.hit.when < r.st.failed.when, r.p.sym).toBe(true);
    }
  });

  it('adds the type tiles up to the hits less any that could not be typed, and the misses', () => {
    const [b1, b2, b3, b4] = o.byType.map(t => t.count);
    expect(b1 + b2 + b3).toBe(o.hits - o.untyped);
    expect(b4).toBe(o.misses);
  });

  it('keeps the hit rate a whole per cent between 0 and 100', () => {
    expect(o.hitRate).not.toBeNull();
    expect(Number.isInteger(o.hitRate)).toBe(true);
    expect(o.hitRate!).toBeGreaterThanOrEqual(0);
    expect(o.hitRate!).toBeLessThanOrEqual(100);
    expect(o.hitRate).toBe(Math.round(o.hits / o.resolved * 100));
  });

  it('gives a median number of days for each type that has any, and never a negative one', () => {
    for (const t of o.byType) {
      if (t.count === 0) continue;
      expect(t.medianDays, t.tag).not.toBeNull();
      expect(t.medianDays!, t.tag).toBeGreaterThanOrEqual(0);
    }
  });
});
