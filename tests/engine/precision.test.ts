import { describe, expect, it } from 'vitest';
import { against, atOrAgainst, atOrPast, past, sig7 } from '../../src/engine/precision';
import { typeOf } from '../../src/engine/btype';
import { lfdOf } from '../../src/engine/lfd';
import { replay } from '../../src/engine/replay';
import { breakoutAt, lfdAt, LONG, series, SHORT } from './helpers';
import type { Day } from './helpers';

/* Revision 3 of the plan (Joe): prices and levels are compared at 7 significant digits, so a price exactly on a level
   follows the written rule whichever way Yahoo's float32 noise points. "At or past" is used only to find an imported
   setup's confirming close. */

// Float32 widened to double, as Yahoo sends them: just under and just over the decimal price.
const UNDER = { '5.43': 5.429999828338623, '17.48': 17.479999542236328, '145.3': 145.3000030517578, '19.52': 19.520000457763672 };

describe('sig7', () => {
  it('recovers the printed price from float32 noise, either side', () => {
    expect(sig7(5.429999828338623)).toBe(5.43);
    expect(sig7(145.3000030517578)).toBe(145.3);
    expect(sig7(74.2300033569336)).toBe(74.23);      // noise six decimals rounding would keep
    expect(sig7(16.999999046325684)).toBe(17);
    expect(sig7(4838)).toBe(4838);
    expect(sig7(0.6975)).toBe(0.6975);
    expect(sig7(123456.78125)).toBe(123456.8);
  });

  it('decides each comparison by the rule, not by the noise', () => {
    // A long: past is above, against is below.
    expect(past(true, UNDER['5.43'], 5.43)).toBe(false);
    expect(past(true, 5.430000305, 5.43)).toBe(false);       // noise over: still not strictly past
    expect(atOrPast(true, UNDER['5.43'], 5.43)).toBe(true);
    expect(against(true, UNDER['5.43'], 5.43)).toBe(false);  // a low on the level is not beyond it
    expect(atOrAgainst(true, 145.3000030517578, 145.3)).toBe(true);
    // A short mirrors it.
    expect(past(false, 5.4299, 5.43)).toBe(true);
    expect(against(false, UNDER['19.52'], 19.52)).toBe(false);
    expect(atOrAgainst(false, UNDER['19.52'], 19.52)).toBe(true);
  });
});

describe('the engine at a tie', () => {
  it('a close exactly on the trigger is not a breakout; the next close past it is', () => {
    const p = { ...LONG, breakthrough: 5.43, boundary: null, target: 7, negation: 4 };
    const { bars, hist } = series([
      ['2026-01-05', 5.2, 5.5, 5.430000305175781],   // 5.43 with the noise over: not strictly past
      ['2026-01-06', 5.3, 5.6, 5.5],
    ]);
    expect(replay(p, hist, bars).breakout).toEqual({ when: '2026-01-06', close: 5.5 });
  });

  it('a close exactly on the target reaches it, even with the noise under', () => {
    const p = { ...LONG, breakthrough: 5, boundary: null, target: 5.43, negation: 4 };
    const { bars, hist } = series([
      ['2026-01-05', 4.9, 5.2, 5.1],
      ['2026-01-06', 5.2, 5.5, UNDER['5.43']],
    ]);
    expect(replay(p, hist, bars).targetHit).toEqual({ when: '2026-01-06', close: UNDER['5.43'] });
  });

  it('a low exactly on the negation does not fail the trade; one tick through it does', () => {
    const p = { ...LONG, breakthrough: 18, boundary: null, target: 25, negation: 17.48 };
    const touch: Day[] = [['2026-01-05', 17.9, 18.5, 18.2], ['2026-01-06', UNDER['17.48'], 18.4, 18]];
    expect(replay(p, series(touch).hist, series(touch).bars).state).toBe('breakout');
    const through: Day[] = [...touch, ['2026-01-07', 17.47, 18, 17.9]];
    expect(replay(p, series(through).hist, series(through).bars).failed).toMatchObject({ when: '2026-01-07', at: 17.47 });
  });

  it('a short\'s high exactly on the last full day is not a breach (DAKT, 22-10-26)', () => {
    const { bars, hist } = series([
      ['2026-01-08', 18, 18.6, 18.3],
      ['2026-01-09', 18.2, UNDER['19.52'], 19],       // equals the 19.52 stop: not beyond it
      ['2026-01-12', 18.9, 19.6, 19.3],               // beyond: exit 1
    ]);
    const T = typeOf(SHORT, breakoutAt('2026-01-08', 18.3), lfdAt(19.52, '2026-01-08'), hist, bars)!;
    expect(T.breaches!.map(b => b.when)).toEqual(['2026-01-12']);
  });

  it('a low exactly on the trigger is a touch: it starts a pullback and keeps one going (WAWI.OL, GEI.TO)', () => {
    const p = { ...LONG, breakthrough: 145.3 };
    const { bars, hist } = series([
      ['2026-01-08', 144, 147, 146],
      ['2026-01-09', 145.3000030517578, 149, 148],    // on the trigger: pullback 1
      ['2026-01-12', 145.3000030517578, 150, 149],    // still on it: the same pullback
      ['2026-01-13', 146, 151, 150],                  // entirely past: it ends
    ]);
    const T = typeOf(p, breakoutAt('2026-01-08', 146), lfdAt(140, '2026-01-08'), hist, bars)!;
    expect(T.pullbacks!.map(x => x.when)).toEqual(['2026-01-09']);
  });

  it('an imported setup\'s confirming close is found when its close is the trigger exactly (KRO, UBER)', () => {
    const p = { ...LONG, breakthrough: 7.12, boundary: null, target: 9, negation: 6, created: '2026-01-10', confirmed: '2026-01-10' };
    const { bars, hist } = series([
      ['2026-01-06', 6.8, 7.0, 6.9],
      ['2026-01-07', 6.9, 7.2, 7.119999885559082],    // the stored trigger is this close's price: at or past
      ['2026-01-08', 7.0, 7.4, 7.3],
    ]);
    const L = lfdOf(p, replay(p, hist, bars), hist, bars)!;
    expect(L).toMatchObject({ conf: '2026-01-07', anchor: '2026-01-07', bar: '2026-01-06', at: 6.8, src: 'derived' });
  });

  it('a close exactly on the boundary is not past it, so it does not start the run (1038.HK)', () => {
    const p = { ...LONG, breakthrough: 70, boundary: 67.15, target: 80, negation: 60 };
    const { bars, hist } = series([
      ['2026-01-05', 66, 67.5, 67.1500015258789],     // on the boundary: not strictly past
      ['2026-01-06', 66.5, 68.2, 67.6],               // the run starts here
      ['2026-01-07', 67, 71, 70.5],                   // confirmed
    ]);
    const L = lfdOf(p, replay(p, hist, bars), hist, bars)!;
    expect(L).toMatchObject({ anchor: '2026-01-06', bar: '2026-01-05', at: 66 });
  });
});
