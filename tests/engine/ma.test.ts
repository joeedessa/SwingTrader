import { describe, expect, it } from 'vitest';
import { crosses, emaSeries, maRead, maSlope, MIN_BARS, PERIODS_BY_TF, smaSeries, TAGGED, TF_WORDS, TIERS, TIMEFRAMES } from '../../src/engine/ma';
import type { Timeframe } from '../../src/engine/ma';
import golden from '../fixtures/ma-old-page.json';
import signals from '../fixtures/signals-old-page.json';

/* The moving-average read against the old site's ma.js, on the closes of the frozen capture: the golden file holds what
   that code answered, so the two agree to the last digit. Then the small cases that say what each function means. */

type Golden = { closes: number[]; sma150: number[]; reads: Record<string, unknown>; slopes: Record<string, unknown> };
const symbols = golden.symbols as Record<string, Golden>;

describe('against the old site\'s ma.js', () => {
  const names = Object.keys(symbols);

  it('has at least five symbols to compare, each with enough closes for the 200', () => {
    expect(names.length).toBeGreaterThanOrEqual(5);
    for (const n of names) expect(symbols[n].closes.length, n).toBeGreaterThan(201);
  });

  it('reads the same: where the last close sits, the level test, the last change of sides', () => {
    for (const n of names) for (const p of golden.periods) expect(maRead(symbols[n].closes, p), `${n} ${p}`).toEqual(symbols[n].reads[String(p)]);
  });

  it('says the same about which way each average is heading', () => {
    for (const n of names) for (const p of golden.periods) expect(maSlope(symbols[n].closes, p), `${n} ${p}`).toEqual(symbols[n].slopes[String(p)]);
  });

  it('takes the same rolling mean', () => {
    for (const n of names) expect(smaSeries(symbols[n].closes, 150).slice(-5), n).toEqual(symbols[n].sma150);
  });
});

describe('the rolling mean', () => {
  it('starts at the n-th value and is the mean of the last n', () => {
    expect(smaSeries([1, 2, 3, 4, 5], 3)).toEqual([2, 3, 4]);
    expect(smaSeries([1, 2, 3], 3)).toEqual([2]);
  });

  it('is empty for a series that is too short, or none', () => {
    expect(smaSeries([1, 2], 3)).toEqual([]);
    expect(smaSeries(null, 3)).toEqual([]);
    expect(smaSeries(undefined, 3)).toEqual([]);
  });
});

/** A steady climb of `step` a bar for `n` bars from 100. */
const ramp = (n: number, step: number) => Array.from({ length: n }, (_, i) => 100 + i * step);

describe('where the close sits', () => {
  it('needs two more bars than the period, or says nothing', () => {
    expect(maRead(ramp(150, 1), 150)).toBeNull();
    expect(maRead(ramp(151, 1), 150)).toBeNull();
    expect(maRead(ramp(152, 1), 150)).not.toBeNull();
    expect(maRead(null, 150)).toBeNull();
  });

  it('is above a rising average, by how far, with no test while price runs away from it', () => {
    const r = maRead(ramp(260, 1), 150)!;
    expect(r.above).toBe(true);
    expect(r.dist).toBeGreaterThan(0);
    expect(r.state).toBeNull();
    expect(r.crossedAgo).toBeNull();
  });

  it('calls a close that came back to the average and stayed above it held', () => {
    const flat = Array.from({ length: 215 }, () => 100);
    expect(maRead([...flat, 100.3, 100.4, 100.6, 100.8, 101], 50)!.state).toBe('held');
  });

  it('calls a close that dipped under the average and is back over it reclaimed', () => {
    // Above it by a point and a half, one close just under it (the nearest it came), then back over.
    const flat = Array.from({ length: 205 }, () => 100);
    const r = maRead([...flat, ...Array(10).fill(102), 100.2, 101.8, 101.9, 102, 102.1], 50)!;
    expect(r).toMatchObject({ state: 'reclaimed', above: true, crossedAgo: 4 });
  });

  it('calls a close whose nearest approach to the average was from over it, and that is now under it, lost', () => {
    const flat = Array.from({ length: 205 }, () => 100);
    const r = maRead([...flat, ...Array(10).fill(98), 99.8, 98.2, 98.1, 98, 97.9], 50)!;
    expect(r).toMatchObject({ state: 'lost', above: false });
  });

  it('calls a close whose nearest approach to the average was from under it, and that is still under it, rejected', () => {
    const flat = Array.from({ length: 205 }, () => 100);
    const r = maRead([...flat, ...Array(10).fill(102), 100.4, 99.2, 99.1, 99, 98.9], 50)!;
    expect(r).toMatchObject({ state: 'rejected', above: false });
  });

  it('is below a falling average, by how far, when price has run away under it', () => {
    const falling = [...Array.from({ length: 200 }, (_, i) => 130 - i * 0.1), 110.4, 110.2, 110.6, 110.3];
    const r = maRead(falling, 50)!;
    expect(r.above).toBe(false);
    expect(r.dist).toBeLessThan(0);
  });
});

describe('which way the average is heading', () => {
  it('is rising on a climb, falling on a slide, flat on a flat line', () => {
    expect(maSlope(ramp(260, 1), 150)!.state).toBe('rising');
    expect(maSlope(ramp(260, -0.2), 150)!.state).toBe('falling');
    expect(maSlope(Array.from({ length: 260 }, () => 100), 150)).toMatchObject({ state: 'flat', glyph: '→', label: 'flat' });
  });

  it('turns up when a slide gives way to a climb, and down the other way round', () => {
    // A 3-bar average over a flat run, then a slide and a climb back: the average fell, then rose.
    const flat = Array.from({ length: 30 }, () => 100);
    expect(maSlope([...flat, 100, 100, 90, 80, 70, 70, 80, 90, 100], 3)).toMatchObject({ state: 'turnup', glyph: '⤴', label: 'turning up', bars: 3 });
    expect(maSlope([...flat, 100, 100, 110, 120, 130, 130, 120, 110, 100], 3)).toMatchObject({ state: 'turndown', glyph: '⤵', label: 'turning down' });
  });

  it('every state the old site\'s code reached on the real closes is labelled the way it labelled it', () => {
    const labels = new Set<string>();
    for (const n of Object.keys(symbols)) for (const p of golden.periods) {
      const g = symbols[n].slopes[String(p)] as { state: string; label: string; glyph: string } | null;
      if (!g) continue;
      const mine = maSlope(symbols[n].closes, p)!;
      expect([mine.state, mine.label, mine.glyph]).toEqual([g.state, g.label, g.glyph]);
      labels.add(g.state);
    }
    expect(labels.size).toBeGreaterThanOrEqual(2);
  });

  it('uses a window of the period over six, between three and twenty-five bars', () => {
    expect(maSlope(ramp(260, 1), 150)!.bars).toBe(25);
    expect(maSlope(ramp(260, 1), 50)!.bars).toBe(8);
    expect(maSlope(ramp(260, 1), 10)!.bars).toBe(3);
  });

  it('says nothing when the series is too short for two windows', () => {
    expect(maSlope(ramp(160, 1), 150)).toBeNull();
    expect(maSlope(null, 150)).toBeNull();
  });
});

/* ------------------------------------------------------------------ weekly, monthly and the cross ladder */

/* The same code run on three timeframes: the golden file holds what the old site's ma.js answered on the daily closes of the
   frozen 2026-11-01 capture and on the weekly and monthly closes of series.json of that day, for symbols chosen to
   exercise every outcome the code has (docs/PARITY.md says how it was made). */

type Gold = {
  closes: number[];
  reads: Record<string, unknown>;
  slopes: Record<string, unknown>;
  crosses: unknown[];
  ema5: number[];
  ema21: number[];
  emaLen: number;
};
const sample = signals.symbols as unknown as Record<string, Record<Timeframe, Gold>>;
const periodsOf = signals.periods as Record<Timeframe, number[]>;
const lookbackOf = signals.lookback as Record<Timeframe, number>;
const eachSample = (f: (sym: string, tf: Timeframe, g: Gold) => void) => {
  for (const sym of Object.keys(sample)) for (const tf of TIMEFRAMES) f(sym, tf, sample[sym][tf]);
};

describe('on all three timeframes, against the old site\'s ma.js', () => {
  it('compares at least five symbols, each with the 220 bars the cross scan needs on every timeframe', () => {
    expect(Object.keys(sample).length).toBeGreaterThanOrEqual(5);
    eachSample((sym, tf, g) => expect(g.closes.length, `${sym} ${tf}`).toBeGreaterThanOrEqual(MIN_BARS));
  });

  it('uses the periods the old columns used', () => {
    for (const tf of TIMEFRAMES) expect([...PERIODS_BY_TF[tf]], tf).toEqual(periodsOf[tf]);
    expect(PERIODS_BY_TF.weekly).toEqual([10, 30, 40, 200]);
    expect(PERIODS_BY_TF.monthly).toEqual([10, 12, 20]);
  });

  it('reads every average the same: where the last close sits, the level test, the last change of sides', () => {
    eachSample((sym, tf, g) => { for (const p of periodsOf[tf]) expect(maRead(g.closes, p), `${sym} ${tf} ${p}`).toEqual(g.reads[String(p)]); });
  });

  it('says the same about which way each average is heading', () => {
    eachSample((sym, tf, g) => { for (const p of periodsOf[tf]) expect(maSlope(g.closes, p), `${sym} ${tf} ${p}`).toEqual(g.slopes[String(p)]); });
  });

  it('takes the same exponential averages, seeded from the first close', () => {
    eachSample((sym, tf, g) => {
      expect(emaSeries(g.closes, 5).slice(-3), `${sym} ${tf} 5`).toEqual(g.ema5);
      expect(emaSeries(g.closes, 21).slice(-3), `${sym} ${tf} 21`).toEqual(g.ema21);
      expect(emaSeries(g.closes, 21).length, `${sym} ${tf}`).toBe(g.emaLen);
    });
  });

  it('finds the same crosses, in the same order, with the same whipsaw marks', () => {
    eachSample((sym, tf, g) => expect(crosses(g.closes, lookbackOf[tf]), `${sym} ${tf}`).toEqual(g.crosses));
  });

  it('looks back as far as the scan did: ten sessions, thirteen weeks, twelve months', () => {
    expect(TIMEFRAMES.map(tf => TF_WORDS[tf].lookback)).toEqual([lookbackOf.daily, lookbackOf.weekly, lookbackOf.monthly]);
    expect(TIMEFRAMES.map(tf => TF_WORDS[tf].lookback)).toEqual([10, 13, 12]);
  });

  it('is a sample that reaches every outcome: all four level tests, the slopes, bullish and bearish crosses, held and whipsawed', () => {
    const tags = new Set<string>(), slopes = new Set<string>(), kinds = new Set<string>(), tiers = new Set<string>();
    eachSample((_sym, tf, g) => {
      for (const p of periodsOf[tf]) {
        const r = g.reads[String(p)] as { state: string | null } | null;
        if (r && r.state) tags.add(tf + ':' + r.state);
        const sl = g.slopes[String(p)] as { state: string } | null;
        if (sl) slopes.add(tf + ':' + sl.state);
      }
      for (const c of g.crosses as { key: string; bullish: boolean; whip: boolean }[]) {
        kinds.add(`${tf}:${c.bullish ? 'bull' : 'bear'}:${c.whip ? 'whip' : 'held'}`);
        tiers.add(c.key);
      }
    });
    for (const tf of TIMEFRAMES) for (const st of ['held', 'rejected', 'reclaimed', 'lost']) expect(tags, tf + ' ' + st).toContain(tf + ':' + st);
    for (const tf of TIMEFRAMES) expect([...slopes].filter(x => x.startsWith(tf + ':')).length, tf).toBeGreaterThanOrEqual(5);
    for (const tf of TIMEFRAMES) for (const k of ['bull:held', 'bear:held', 'bull:whip', 'bear:whip']) expect(kinds, tf + ' ' + k).toContain(tf + ':' + k);
    expect([...tiers].sort()).toEqual(TIERS.map(t => t.key).sort());
  });
});

describe('the lines that carry a level test', () => {
  it('are the structural ones on each timeframe: daily 150 and 200, weekly 30, 40 and 200, monthly 10 and 20', () => {
    expect(TAGGED).toEqual({ daily: [150, 200], weekly: [30, 40, 200], monthly: [10, 20] });
    for (const tf of TIMEFRAMES) for (const p of TAGGED[tf]) expect(PERIODS_BY_TF[tf], tf).toContain(p);
  });
});

describe('the exponential average', () => {
  it('is seeded from the first value, run over the whole series, and drops the first n', () => {
    const e = emaSeries([1, 2, 3, 4, 5], 2);
    expect(e).toHaveLength(3);
    expect(e[0]).toBeCloseTo(2.5556, 4);
    expect(e[1]).toBeCloseTo(3.5185, 4);
    expect(e[2]).toBeCloseTo(4.5062, 4);
  });

  it('is empty for a series shorter than n, or none', () => {
    expect(emaSeries([1, 2], 3)).toEqual([]);
    expect(emaSeries(null, 3)).toEqual([]);
  });
});

describe('the cross ladder', () => {
  const flat = (n: number) => Array<number>(n).fill(100);
  const tag = (c: { key: string; bullish: boolean; ago: number; whip: boolean }) => `${c.key} ${c.bullish ? 'up' : 'down'} ${c.ago}${c.whip ? ' whip' : ''}`;

  it('is five tiers, from the quickest and noisiest to the slowest, each said in words', () => {
    expect(TIERS.map(t => t.label)).toEqual(['5 × 21', 'price × 50', '21 × 50', 'price × 200', '50 × 200']);
    expect(TIERS.map(t => t.sub)).toEqual(['EMA timing trigger', 'swing trend break', 'intermediate turn', 'regime change', 'golden / death']);
  });

  it('reports a close that goes from under its averages to over them on the latest bar as three bullish crosses, no bars ago', () => {
    expect(crosses([...flat(225), 95, 95, 95, 95, 106], 10).map(tag)).toEqual(['e5x21 up 0', 'px50 up 0', 'px200 up 0']);
  });

  it('reports a fall through them as bearish', () => {
    expect(crosses([...flat(225), 105, 105, 105, 105, 94], 10).map(tag)).toEqual(['e5x21 down 0', 'px50 down 0', 'px200 down 0']);
  });

  it('marks a cross that was given back a bar later as whipsawed, and reports the way back too', () => {
    expect(crosses([...flat(225), 95, 95, 95, 95, 106, 96], 10).map(tag)).toEqual([
      'e5x21 up 1 whip', 'e5x21 down 0', 'px50 up 1 whip', 'px50 down 0', 'px200 up 1 whip', 'px200 down 0',
    ]);
  });

  it('needs 220 bars: a 50-by-200 cross cannot be found on fewer', () => {
    expect(MIN_BARS).toBe(220);
    expect(crosses([...flat(214), 95, 95, 95, 95, 106], 10)).toEqual([]);
    expect(crosses([...flat(215), 95, 95, 95, 95, 106], 10)).toHaveLength(3);
    expect(crosses(null, 10)).toEqual([]);
  });

  it('finds a golden cross, with the quicker tiers having turned first, when the window reaches back far enough', () => {
    const decline = Array.from({ length: 150 }, (_, i) => 150 - i * 0.4);
    const rise = Array.from({ length: 120 }, (_, i) => 90.4 + i * 0.9);
    expect(crosses([...decline, ...rise], 120).map(tag)).toEqual(['e5x21 up 113', 'px50 up 110', 'e21x50 up 105', 's50x200 up 63']);
    // Ten bars back sees none of them: the ladder reports only what is fresh.
    expect(crosses([...decline, ...rise], 10)).toEqual([]);
  });

  it('does not count a touch as a cross: a difference of exactly zero is skipped', () => {
    expect(crosses(flat(260), 10)).toEqual([]);
  });
});
