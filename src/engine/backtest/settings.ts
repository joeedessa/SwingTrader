/* The Model's dials (plan B2 to B6, and the open questions Q2 to Q6, Q12 to Q14), and the strategies it runs.

   Everything here is a rule you could have followed on the day: the final type a setup ended with only breaks the
   results down, it never chooses a trade. Four strategies (S5, the other reading of "re-enter", was dropped in
   revision 7 when Q1 was answered), with S2 run at four re-entry depths. */

export type StrategyCode = 'S1' | 'S2' | 'S3' | 'S4';

export interface Strategy {
  code: StrategyCode;
  /** S2: how many re-entries a setup may take after a stop-out, Infinity for no limit. 0 for the others. */
  reentries: number;
}

export type StrategyId = 'S1' | 'S2-1' | 'S2-2' | 'S2-3' | 'S2-u' | 'S3' | 'S4';

export const STRATEGIES: readonly Strategy[] = [
  { code: 'S1', reentries: 0 },
  { code: 'S2', reentries: 1 },
  { code: 'S2', reentries: 2 },
  { code: 'S2', reentries: 3 },
  { code: 'S2', reentries: Infinity },
  { code: 'S3', reentries: 0 },
  { code: 'S4', reentries: 0 },
];

export const strategyId = (s: Strategy): StrategyId =>
  s.code === 'S2' ? (`S2-${s.reentries === Infinity ? 'u' : s.reentries}` as StrategyId) : s.code;

export const STRATEGY_IDS: readonly StrategyId[] = STRATEGIES.map(strategyId);

/** The S2 depths, each compared with S1 for the ratio question. */
export const S2_IDS: readonly StrategyId[] = STRATEGIES.filter(s => s.code === 'S2').map(strategyId);

/** The strategies that need a tight stop (the last full day): a setup without one is left out of them (Q13). */
export const NEEDS_STOP: Record<StrategyCode, boolean> = { S1: true, S2: true, S3: false, S4: true };

export interface StrategyWords {
  name: string;
  entry: string;
  exit: string;
  stop: string;
}

export const STRATEGY_WORDS: Record<StrategyCode, StrategyWords> = {
  S1: { name: 'B1/B2 only', entry: 'the confirming close', exit: 'a touch of the last full day, a touch of the negation, or a close at the target', stop: 'the last full day' },
  S2: { name: 'with re-entries', entry: 'as S1, then again at a settled close back past the trigger after a stop-out', exit: 'as S1, up to the chosen number of re-entries', stop: 'the original last full day (or a new one read from the re-entry run)' },
  S3: { name: 'negation only', entry: 'the confirming close', exit: 'a touch of the negation, or a close at the target', stop: 'the negation' },
  S4: { name: 'trailing', entry: 'the confirming close', exit: 'a touch of the higher of the last full day and a stop two ATRs under the highest close, a touch of the negation, or a close at the target', stop: 'the last full day, then the trail' },
};

export type SizingId = 'flat' | 'perStrategy' | 'payoff' | 'risk';

export const SIZINGS: readonly SizingId[] = ['flat', 'perStrategy', 'payoff', 'risk'];

export const SIZING_WORDS: Record<SizingId, string> = {
  flat: 'the same amount on every entry, re-entries included',
  perStrategy: 'the same amount on every entry, scaled for S2 by the equal-risk ratio against S1',
  payoff: 'the amount scaled by the setup\'s payoff against the median payoff, between half and double',
  risk: 'the amount that puts a fixed sum at risk between the entry and the stop, up to a cap',
};

/** The payoff-scaled size stays within these multiples of the flat amount. */
export const PAYOFF_SCALE = { min: 0.5, max: 2 } as const;

/** The ATR multiple of the S4 trail, and the ATR's period. */
export const TRAIL = { atrs: 2, period: 14 } as const;

export interface ModelSettings {
  /** Q6: the fill is the next session's open where the bars have it, or the confirming close itself. */
  entry: 'open' | 'close';
  /** Q2: the target counts on a settled close at or past it (the board's rule), or on an intraday touch. */
  targetOn: 'close' | 'touch';
  /** Q3: the stop after a re-entry is the original last full day, or a new one read from the re-entry run. */
  reentryStop: 'original' | 'new';
  /** Q12: setups the source removed after they broke out are closed at the removal date, or left out. */
  removed: 'include' | 'exclude';
  /** Q14: only breakouts confirmed on or after this date (null for all of them). */
  from: string | null;
  /** Commission per side, in % of the position. */
  commissionPct: number;
  /** Slippage per side, in % of the position. */
  slippagePct: number;
  /** Account units per entry under flat sizing (Q4). */
  size: number;
  /** Account units put at risk per entry under risk-based sizing. */
  riskUnits: number;
  /** The most a risk-based position may be, in account units. */
  maxSize: number;
  /** Bootstrap resamples of the trade list. */
  resamples: number;
  /** The bootstrap's seed: the same settings give the same interval. */
  seed: number;
}

export const DEFAULT_SETTINGS: ModelSettings = {
  entry: 'open',
  targetOn: 'close',
  reentryStop: 'original',
  removed: 'include',
  from: null,
  commissionPct: 0.1,
  slippagePct: 0.1,
  size: 10000,
  riskUnits: 500,
  maxSize: 20000,
  resamples: 1000,
  seed: 1,
};

/** The day the list began, with positions already confirmed on it: breakouts before it are the ones the source still
    listed then, which over-represents winners and open trades (plan B1). The "from" toggle starts here. */
export const LIST_BEGAN = '2026-08-08';

/** Both sides' costs on one leg, in % of the position. */
export const roundTripPct = (s: ModelSettings): number => 2 * (s.commissionPct + s.slippagePct);
