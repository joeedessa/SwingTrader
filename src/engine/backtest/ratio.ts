import { median } from '../outcomes';
import type { Leg } from './simulate';
import type { MoneyStats } from './stats';

/* "What ratio between A and B makes sense" (plan B3): how much to put on an S2 entry, or (revision 9) an S0 entry,
   for each unit on an S1 entry. Three answers, one primary:

   Equal risk per setup. The median, over setups, of the risk a setup makes you take in total (the entry-to-stop
   distance of every leg it opens, added up) under S1, over the same under S0 or S2-k. This follows from the rules, not
   from how the sample happened to go. A leg filled at its own stop (S0 at the trigger) has no distance to add.

   Equal maximum drawdown. Scale the strategy's flat amount until its deepest drawdown equals S1's. Both are linear in
   the amount, so the ratio is S1's drawdown over the strategy's.

   Equal capital in use. Scale until the peak amount held at once matches: S1's peak exposure over the strategy's. */

export interface Ratio {
  ratio: number | null;
  /** What is behind the number: the setups or legs on each side. */
  a: number;
  b: number;
  basis: 'setups' | 'legs';
}

export interface Ratios {
  equalRisk: Ratio;
  equalDrawdown: Ratio;
  equalCapital: Ratio;
}

/** Total risk per setup: the sum of each leg's entry-to-stop distance, in %, over the setups that have one. */
export function riskPerSetup(legs: readonly Leg[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const l of legs) if (l.riskPct != null) out.set(l.key, (out.get(l.key) || 0) + l.riskPct);
  return out;
}

export function equalRiskRatio(a: readonly Leg[], b: readonly Leg[]): Ratio {
  const ra = riskPerSetup(a), rb = riskPerSetup(b);
  const ma = median([...ra.values()]), mb = median([...rb.values()]);
  return { ratio: ma != null && mb != null && mb > 0 ? ma / mb : null, a: ra.size, b: rb.size, basis: 'setups' };
}

export function ratiosOf(a: { legs: readonly Leg[]; flat: MoneyStats }, b: { legs: readonly Leg[]; flat: MoneyStats }): Ratios {
  return {
    equalRisk: equalRiskRatio(a.legs, b.legs),
    equalDrawdown: { ratio: b.flat.maxDrawdown > 0 ? a.flat.maxDrawdown / b.flat.maxDrawdown : null, a: a.legs.length, b: b.legs.length, basis: 'legs' },
    equalCapital: { ratio: b.flat.peakExposure > 0 ? a.flat.peakExposure / b.flat.peakExposure : null, a: a.legs.length, b: b.legs.length, basis: 'legs' },
  };
}
