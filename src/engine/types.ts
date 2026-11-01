// The engine's inputs and outputs. Pure data: nothing here touches the page or the network.

export type Dir = 'long' | 'short';

/** A per-browser override of where a setup stands; `removed` in the shared file lands here too. */
export type ManualState = 'breakout' | 'failed' | 'removed' | null;

/** One watchlist row, after the browser's overlay has been applied. Prices are in the listing currency. */
export interface Setup {
  sym: string;
  dir: Dir;
  /** The trigger: the confirming close, usually the boundary plus the 3% filter. A row typed in by hand may leave it unset. */
  breakthrough?: number | null;
  target?: number | null;
  /** Published only once a setup has broken out, so null on a waiting row means "not yet set". */
  negation?: number | null;
  /** The pattern level the report states. */
  boundary?: number | null;
  /** Last full day from the breakout sheet; 0 means the sheet gives none; absent means derive it. */
  lfd?: number | null;
  created?: string | null;
  /** Set when the source already counted the breakout; the replay starts here. */
  confirmed?: string | null;
  /** The source counted the target as met on this date where our closes fell short. */
  reached?: string | null;
  removed?: string | null;
  removed_reason?: string | null;
  /** Sheet dates on which the source still listed a failed setup as ongoing. */
  source_open?: string[];
  hold?: boolean;
  manualState?: ManualState;
  /** Set by the overlay: true for a row from the shared list, false for one added in this browser. */
  shared?: boolean;
  ex_div?: string | null;
  note?: string;
  pattern?: string;
  exchange?: string;
  country?: string;
  duration_m?: number | null;
}

/** A settled daily bar: [low, high, close]. A long reads the low, a short the high. */
export type DayBar = [low: number, high: number, close: number | null];

/** Daily bars keyed by date (YYYY-MM-DD). */
export type Bars = Record<string, DayBar>;

/** A settled close. The old page carried the epoch as a third element; the engine reads the first two. */
export type SettledClose = readonly [date: string, close: number, ...rest: number[]];

/** Closes for one symbol, split into settled days and the live tick. */
export interface History {
  settled: SettledClose[];
  /** The latest price: the live tick while the session runs, else the last settled close. */
  live: number | null;
  liveDate: string;
  currency: string;
}

/** Earnings, dividend and volatility facts for one symbol, from watch-events.json. */
export interface SymbolEvents {
  earnings?: string | null;
  ex_div?: string | null;
  div_amount?: number | null;
  atr?: number | null;
  sector?: string | null;
  [key: string]: unknown;
}

export type ReplayStatus = 'watch' | 'breakout' | 'target' | 'failed';

export interface ReplayState {
  state: ReplayStatus;
  breakout: { when: string; close: number | null } | null;
  targetHit: { when: string; close: number | null; bySource?: boolean } | null;
  failed: { when: string; close: number; at: number; byTouch: boolean; reason: string } | null;
  /** A held position that touched its negation: recorded, not acted on. */
  touched?: { when: string; at: number; byTouch: boolean };
}

export type LfdSource = 'report' | 'derived' | 'none';

export interface Lfd {
  /** The stop level, or null when there is none. */
  at: number | null;
  src: LfdSource | null;
  /** What the derivation was anchored to. */
  kind: 'boundary' | 'trigger';
  /** True while the row is still waiting for its trigger. */
  pending: boolean;
  /** The confirming close's date, where the bars show one. */
  conf: string | null;
  /** The first close of the run past the anchor level. */
  anchor: string | null;
  /** The bar the level was read from: the one before the anchor. */
  bar: string | null;
  /** The confirmation-anchored reading, where it differs from the boundary-anchored one. */
  alt: { bar: string; at: number } | null;
  /** The first touch of the stop after the confirmation. */
  hit: { when: string; at: number } | null;
  /** A derived stop beyond the negation is no stop at all. */
  looser?: true;
}

export type BreakoutTag = 'B1' | 'B2' | 'B3' | 'B4';

export interface Touch {
  when: string;
  at: number;
}

export interface Reentry {
  when: string;
  close: number;
}

export interface BreakoutType {
  tag: BreakoutTag | null;
  final?: boolean;
  pullbacks?: Touch[];
  breaches?: Touch[];
  reentries?: Reentry[];
  /** Out of the trade: the last breach has not been followed by a re-entry close. */
  out?: boolean;
  trig?: number;
  stop?: number | null;
  stopHit?: Touch | null;
  retest?: Touch | null;
  reentry?: Reentry | null;
  noStop?: boolean;
}

export type Section = 'watch' | 'breakout' | 'reentered' | 'stopped' | 'target' | 'failed' | 'removed';

export const SECTIONS: readonly Section[] = ['watch', 'breakout', 'reentered', 'stopped', 'target', 'failed', 'removed'];

export const SECTION_LABELS: Record<Section, string> = {
  watch: 'Watching',
  breakout: 'Confirmed',
  reentered: 'Re-entered',
  stopped: 'Stopped out',
  target: 'At target',
  failed: 'Failed',
  removed: 'Removed',
};
