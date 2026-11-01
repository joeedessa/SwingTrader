import { describe, expect, it } from 'vitest';
import { typeOf } from '../../src/engine/btype';
import { sectionOf } from '../../src/engine/sections';
import { breakoutAt, lfdAt, LONG, series, SHORT } from './helpers';
import type { Day } from './helpers';

// Confirmed on 01-08 at the trigger 100, stop 94 from the report.
const CONF = '2026-01-08';
const ST = breakoutAt(CONF, 100.5);
const L = lfdAt(94, CONF);

const PATH: Day[] = [
  ['2026-01-08', 97.5, 101, 100.5],
  ['2026-01-09', 101, 105, 104],     // B1: nothing touched
  ['2026-01-12', 99.5, 103, 102],    // touch of the trigger: pullback 1
  ['2026-01-13', 99, 102, 101],      // still in it
  ['2026-01-14', 100.5, 106, 105],   // entirely past: the pullback ends
  ['2026-01-15', 98, 101, 100.2],    // pullback 2
  ['2026-01-16', 93, 99, 97],        // took out the last full day: exit 1
  ['2026-01-19', 95, 102, 101],      // close back past the trigger: re-entry 1
  ['2026-01-20', 99, 103, 102],      // a touch of the trigger after a re-entry is not a pullback
  ['2026-01-21', 93.5, 98, 96],      // exit 2
];

const upTo = (n: number) => series(PATH.slice(0, n));

describe('breakout type: the path', () => {
  it('starts as B1', () => {
    const { bars, hist } = upTo(2);
    const T = typeOf(LONG, ST, L, hist, bars);
    expect(T).toMatchObject({ tag: 'B1', final: false, pullbacks: [], breaches: [], reentries: [], out: false, noStop: false });
  });

  it('falls to B2 on a touch of the trigger, and counts pullbacks from touch to the first day entirely past', () => {
    const { bars, hist } = upTo(6);
    const T = typeOf(LONG, ST, L, hist, bars)!;
    expect(T.tag).toBe('B2');
    expect(T.pullbacks).toEqual([{ when: '2026-01-12', at: 99.5 }, { when: '2026-01-15', at: 98 }]);
    expect(T.retest).toEqual({ when: '2026-01-12', at: 99.5 });
    expect(sectionOf(LONG, ST, T)).toBe('breakout');
  });

  it('falls to B3 on a touch of the last full day: out of the trade', () => {
    const { bars, hist } = upTo(7);
    const T = typeOf(LONG, ST, L, hist, bars)!;
    expect(T.tag).toBe('B3');
    expect(T.breaches).toEqual([{ when: '2026-01-16', at: 93 }]);
    expect(T.stopHit).toEqual({ when: '2026-01-16', at: 93 });
    expect(T.out).toBe(true);
    expect(sectionOf(LONG, ST, T)).toBe('stopped');
  });

  it('re-enters on a close back past the trigger, with the original stop', () => {
    const { bars, hist } = upTo(9);
    const T = typeOf(LONG, ST, L, hist, bars)!;
    expect(T.reentries).toEqual([{ when: '2026-01-19', close: 101 }]);
    expect(T.reentry).toEqual({ when: '2026-01-19', close: 101 });
    expect(T.out).toBe(false);
    expect(T.pullbacks).toHaveLength(2);           // 01-20 is not counted
    expect(T.stop).toBe(94);
    expect(sectionOf(LONG, ST, T)).toBe('reentered');
  });

  it('the next touch of the stop is breach 2', () => {
    const { bars, hist } = upTo(10);
    const T = typeOf(LONG, ST, L, hist, bars)!;
    expect(T.breaches!.map(b => b.when)).toEqual(['2026-01-16', '2026-01-21']);
    expect(T.out).toBe(true);
  });

  it('a gap through the stop is a breach at the day\'s low', () => {
    const { bars, hist } = series([PATH[0], ['2026-01-09', 80, 85, 83]]);
    expect(typeOf(LONG, ST, L, hist, bars)!.breaches).toEqual([{ when: '2026-01-09', at: 80 }]);
  });
});

describe('breakout type: boundaries of the count', () => {
  it('stops counting at the target and is final', () => {
    const { bars, hist } = upTo(10);
    const st = { ...ST, state: 'target' as const, targetHit: { when: '2026-01-14', close: 105 } };
    const T = typeOf(LONG, st, L, hist, bars)!;
    expect(T).toMatchObject({ tag: 'B2', final: true });
    expect(T.pullbacks).toHaveLength(1);
    expect(T.breaches).toHaveLength(0);
  });

  it('ignores bars on or before the confirming close and after the last settled close', () => {
    const { bars, hist } = series([['2026-01-07', 90, 99, 98], ...PATH.slice(0, 7)]);
    hist.settled = hist.settled.slice(0, -1);      // 01-16 still forming
    const T = typeOf(LONG, ST, L, hist, bars)!;
    expect(T.tag).toBe('B2');
    expect(T.breaches).toHaveLength(0);
  });

  it('with no stop there are no breaches, and the row says so', () => {
    const { bars, hist } = upTo(10);
    const T = typeOf(LONG, ST, lfdAt(null, CONF), hist, bars)!;
    expect(T).toMatchObject({ tag: 'B2', noStop: true, stop: null });
    expect(T.breaches).toHaveLength(0);
    expect(typeOf(LONG, ST, null, hist, bars)).toMatchObject({ tag: 'B2', noStop: true });
  });

  it('a stop looser than the negation is not a stop', () => {
    const { bars, hist } = upTo(10);
    const T = typeOf(LONG, ST, lfdAt(94, CONF, { src: 'derived', looser: true }), hist, bars)!;
    expect(T.noStop).toBe(true);
    expect(T.breaches).toHaveLength(0);
  });

  it('is B4 when failed, null while waiting, and tag null without bars', () => {
    expect(typeOf(LONG, { ...ST, state: 'failed' }, L, null, null)).toEqual({ tag: 'B4' });
    expect(typeOf(LONG, { ...ST, state: 'watch' }, L, null, null)).toBeNull();
    expect(typeOf(LONG, ST, L, series(PATH).hist, null)).toEqual({ tag: null });
  });
});

describe('breakout type: shorts', () => {
  it('reads the high against the trigger and the stop', () => {
    const { bars, hist } = series([
      ['2026-01-08', 96, 101, 99],
      ['2026-01-09', 94, 100, 97],       // high at the trigger: pullback 1
      ['2026-01-12', 92, 97, 95],        // entirely below: ends
      ['2026-01-13', 95, 106.5, 101],    // high above the stop 106: exit 1
      ['2026-01-14', 97, 103, 98],       // close back below the trigger: re-entry
    ]);
    const T = typeOf(SHORT, breakoutAt('2026-01-08', 99), lfdAt(106, '2026-01-08'), hist, bars)!;
    expect(T.pullbacks).toEqual([{ when: '2026-01-09', at: 100 }]);
    expect(T.breaches).toEqual([{ when: '2026-01-13', at: 106.5 }]);
    expect(T.reentries).toEqual([{ when: '2026-01-14', close: 98 }]);
    expect(T.out).toBe(false);
  });
});
