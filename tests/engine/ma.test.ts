import { describe, expect, it } from 'vitest';
import { maRead, maSlope, smaSeries } from '../../src/engine/ma';
import golden from '../fixtures/ma-old-page.json';

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
