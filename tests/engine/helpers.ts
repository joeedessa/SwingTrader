import type { Bars, History, Lfd, ReplayState, Setup } from '../../src/engine/types';

/** A day as the tests write it: [date, low, high, close]. */
export type Day = [string, number, number, number];

/** Bars and the settled closes from the same days; the live tick defaults to the last close. */
export function series(days: Day[], live?: { price: number; date: string }): { bars: Bars; hist: History } {
  const bars: Bars = {};
  for (const [d, lo, hi, c] of days) bars[d] = [lo, hi, c];
  const settled = days.map(([d, , , c]) => [d, c] as [string, number]);
  const last = days[days.length - 1];
  return {
    bars,
    hist: {
      settled,
      live: live ? live.price : last ? last[3] : null,
      liveDate: live ? live.date : last ? last[0] : '',
      currency: 'USD',
    },
  };
}

/** Closes only, the way the old page ran before the bars arrived. */
export function closesOnly(days: Day[]): History {
  return series(days).hist;
}

export const LONG: Setup = {
  sym: 'X', dir: 'long', breakthrough: 100, boundary: 97, target: 120, negation: 90, created: '2026-01-01',
};

export const SHORT: Setup = {
  sym: 'Y', dir: 'short', breakthrough: 100, boundary: 103, target: 80, negation: 110, created: '2026-01-01',
};

export const breakoutAt = (when: string, close: number | null = null): ReplayState =>
  ({ state: 'breakout', breakout: { when, close }, targetHit: null, failed: null });

export const lfdAt = (at: number | null, conf: string | null, extra: Partial<Lfd> = {}): Lfd =>
  ({ at, src: at == null ? 'none' : 'report', kind: 'boundary', pending: false, conf, anchor: conf,
     bar: null, alt: null, hit: null, ...extra });
