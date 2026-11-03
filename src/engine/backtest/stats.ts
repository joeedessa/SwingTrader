import { median } from '../outcomes';
import type { Leg } from './simulate';

/* What a list of legs adds up to (plan B5). The currency-free statistics are in % of the position and in multiples of
   the risk taken, so legs in eleven listing currencies add without converting anything. Money enters only through
   the position sizes handed to `moneyStatsOf`, in account units, under the stated assumption that FX stays constant
   over each trade (plan B4). */

export interface TypeStats {
  tag: string;
  legs: number;
  setups: number;
  wins: number;
  winRate: number | null;
  expectancyPct: number | null;
  sumPct: number;
}

export interface Stats {
  legs: number;
  setups: number;
  wins: number;
  losses: number;
  /** Legs that came out at exactly nothing after costs. */
  flat: number;
  /** Wins as a share of legs, in %. */
  winRate: number | null;
  /** The mean net return per leg, in %. */
  expectancyPct: number | null;
  /** The mean net return per leg in multiples of its risk, over the legs that have one. */
  expectancyR: number | null;
  withR: number;
  medianPct: number | null;
  sumPct: number;
  /** Gains over losses, net; null with no losses. */
  profitFactor: number | null;
  medianDays: number | null;
  open: number;
  byType: TypeStats[];
  byReason: Record<string, number>;
}

const TAGS = ['B1', 'B2', 'B3', 'B4'] as const;

const mean = (xs: readonly number[]): number | null => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;

export function statsOf(legs: readonly Leg[]): Stats {
  const pct = legs.map(l => l.netPct);
  const rs = legs.filter(l => l.r != null).map(l => l.r as number);
  const wins = legs.filter(l => l.netPct > 0).length;
  const losses = legs.filter(l => l.netPct < 0).length;
  const gains = pct.filter(v => v > 0).reduce((a, b) => a + b, 0);
  const lost = -pct.filter(v => v < 0).reduce((a, b) => a + b, 0);
  const byReason: Record<string, number> = {};
  for (const l of legs) { const k = l.exit ? l.exit.reason : 'open'; byReason[k] = (byReason[k] || 0) + 1; }
  const typeOf = (tag: string) => {
    const of = legs.filter(l => (l.tag ?? 'none') === tag);
    const w = of.filter(l => l.netPct > 0).length;
    return { tag, legs: of.length, setups: new Set(of.map(l => l.key)).size, wins: w,
             winRate: of.length ? w / of.length * 100 : null, expectancyPct: mean(of.map(l => l.netPct)),
             sumPct: of.reduce((a, l) => a + l.netPct, 0) };
  };
  const byType = TAGS.map(typeOf);
  if (legs.some(l => l.tag == null)) byType.push(typeOf('none'));
  return {
    legs: legs.length,
    setups: new Set(legs.map(l => l.key)).size,
    wins, losses, flat: legs.length - wins - losses,
    winRate: legs.length ? wins / legs.length * 100 : null,
    expectancyPct: mean(pct),
    expectancyR: mean(rs),
    withR: rs.length,
    medianPct: median(pct),
    sumPct: pct.reduce((a, b) => a + b, 0),
    profitFactor: lost > 0 ? gains / lost : null,
    medianDays: median(legs.map(l => l.days)),
    open: legs.filter(l => l.open).length,
    byType, byReason,
  };
}

export interface Curve {
  dates: string[];
  /** The running sum of every leg's profit and loss, in account units, marked daily at the settled close. */
  equity: number[];
  /** Legs held on the day, the exit day included. */
  open: number[];
  /** Account units in those legs. */
  exposure: number[];
}

export interface MoneyStats {
  totalPnl: number;
  /** The deepest fall from a high of the equity line, in account units. */
  maxDrawdown: number;
  peakEquity: number;
  /** Over the days on which at least one leg was held. */
  avgOpen: number | null;
  peakOpen: number;
  peakExposure: number;
  curve: Curve;
}

/** The daily equity line of a list of legs, each sized in account units, and what it says. A leg counts from its entry
    day to its exit day (or its mark, while open); between those its value is its size times its net return at each
    settled close, and on the exit day it is the size times the leg's net return at the exit price. On a day its symbol
    did not trade, a leg keeps the value of the day before. */
export function moneyStatsOf(legs: readonly Leg[], sizes: readonly number[]): MoneyStats {
  const dates = new Set<string>();
  const series: { dates: string[]; values: number[]; size: number; from: string; to: string }[] = [];
  legs.forEach((L, k) => {
    const size = sizes[k];
    const last = L.exit ? L.exit.index : L.c.days.findIndex(d => d.when === L.mark.when);
    const ds: string[] = [], vs: number[] = [];
    const sgn = L.dir === 'long' ? 1 : -1;
    const cost = L.grossPct - L.netPct;
    let value = -size * cost / 100;
    for (let i = L.entry.index; i <= last; i++) {
      const d = L.c.days[i];
      if (i === last) value = size * L.netPct / 100;
      else if (d.c != null) value = size * ((d.c / L.entry.price - 1) * sgn * 100 - cost) / 100;
      ds.push(d.when); vs.push(value); dates.add(d.when);
    }
    // An open leg is held through the last date, whether or not its name traded on it.
    series.push({ dates: ds, values: vs, size, from: L.entry.when, to: L.open ? '￿' : L.mark.when });
  });
  const all = [...dates].sort();
  const equity: number[] = [], open: number[] = [], exposure: number[] = [];
  const at = series.map(() => -1);
  for (const day of all) {
    let eq = 0, n = 0, ex = 0;
    series.forEach((s, k) => {
      while (at[k] + 1 < s.dates.length && s.dates[at[k] + 1] <= day) at[k]++;
      if (at[k] >= 0) eq += s.values[at[k]];
      if (s.from <= day && day <= s.to) { n++; ex += s.size; }
    });
    equity.push(eq); open.push(n); exposure.push(ex);
  }
  let peak = 0, dd = 0;
  for (const e of equity) { if (e > peak) peak = e; if (peak - e > dd) dd = peak - e; }
  const held = open.filter(n => n > 0);
  return {
    totalPnl: equity.length ? equity[equity.length - 1] : 0,
    maxDrawdown: dd,
    peakEquity: peak,
    avgOpen: held.length ? held.reduce((a, b) => a + b, 0) / held.length : null,
    peakOpen: open.length ? Math.max(...open) : 0,
    peakExposure: exposure.length ? Math.max(...exposure) : 0,
    curve: { dates: all, equity, open, exposure },
  };
}
