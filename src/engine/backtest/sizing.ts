import { median } from '../outcomes';
import { PAYOFF_SCALE } from './settings';
import type { ModelSettings, SizingId } from './settings';
import type { Leg } from './simulate';
import { payoffOf } from './universe';

/* How much goes on each entry (plan B3), in account units. Flat is the same amount on every entry, re-entries
   included. Per strategy is flat scaled by the strategy's ratio against S1 (S0 and the S2 depths), the ratio question's
   own answer, up to the same cap as the risk-based size: S0's stop, the trigger, is so near that its ratio can run to
   several times the flat amount. Payoff scales flat by the setup's payoff against the median payoff of the setups in
   the list, between half and double. Risk puts a fixed sum at risk between the entry and the stop (the negation with no
   stop), up to the cap; a leg with no level on the losing side takes the flat amount. */

export interface SizingContext {
  /** The strategy's scale under per-strategy sizing: 1 for S1, S3 and S4, the equal-risk ratio against S1 for S0 and S2. */
  scale: number;
  /** The median payoff (trigger to target, %) over the setups in the list, for payoff scaling. */
  medianPayoff: number | null;
}

export function sizingContext(legs: readonly Leg[], scale: number): SizingContext {
  const seen = new Map<string, number>();
  for (const l of legs) { const p = payoffOf(l.c); if (p != null && !seen.has(l.key)) seen.set(l.key, p); }
  return { scale, medianPayoff: median([...seen.values()]) };
}

export function sizeOf(leg: Leg, scheme: SizingId, s: ModelSettings, ctx: SizingContext): number {
  switch (scheme) {
    case 'flat': return s.size;
    case 'perStrategy': return Math.min(s.maxSize, s.size * ctx.scale);
    case 'payoff': {
      const p = payoffOf(leg.c);
      if (p == null || ctx.medianPayoff == null || ctx.medianPayoff <= 0) return s.size;
      return s.size * Math.min(PAYOFF_SCALE.max, Math.max(PAYOFF_SCALE.min, p / ctx.medianPayoff));
    }
    case 'risk': {
      if (leg.riskPct == null || leg.riskPct <= 0) return s.size;
      return Math.min(s.maxSize, s.riskUnits / (leg.riskPct / 100));
    }
  }
}

export const sizesOf = (legs: readonly Leg[], scheme: SizingId, s: ModelSettings, ctx: SizingContext): number[] =>
  legs.map(l => sizeOf(l, scheme, s, ctx));
