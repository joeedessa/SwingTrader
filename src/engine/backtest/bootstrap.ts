/* A bootstrap interval on the mean of a trade list (plan B5): the list is resampled with replacement many times, the
   mean of each resample taken, and the middle 90% of those means is the interval. It shows how much the expectancy
   rests on the few trades there are. The generator is seeded, so the same settings give the same interval and a
   scenario link reproduces its numbers. */

export interface Interval {
  mean: number;
  low: number;
  high: number;
  /** The values resampled. */
  n: number;
  resamples: number;
  /** The share of the resample means inside [low, high]. */
  level: number;
}

/** A small, fast, seeded generator (mulberry32): uniform in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function bootstrapMean(values: readonly number[], resamples: number, seed: number, level = 0.9): Interval | null {
  const n = values.length;
  if (!n || resamples < 1) return null;
  const rand = mulberry32(seed);
  const means = new Float64Array(resamples);
  for (let k = 0; k < resamples; k++) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += values[Math.floor(rand() * n)];
    means[k] = sum / n;
  }
  means.sort();
  const at = (q: number) => means[Math.min(resamples - 1, Math.max(0, Math.round(q * (resamples - 1))))];
  return { mean: values.reduce((a, b) => a + b, 0) / n, low: at((1 - level) / 2), high: at(1 - (1 - level) / 2), n, resamples, level };
}
