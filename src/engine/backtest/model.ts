import type { Row } from '../row';
import type { Bars, History } from '../types';
import { bootstrapMean } from './bootstrap';
import type { Interval } from './bootstrap';
import { ratiosOf } from './ratio';
import type { Ratios } from './ratio';
import { LIST_BEGAN, NEEDS_STOP, RATIO_IDS, SIZINGS, STRATEGIES, strategyId } from './settings';
import type { ModelSettings, SizingId, Strategy, StrategyId } from './settings';
import { isWaiting, simulate } from './simulate';
import type { Leg } from './simulate';
import { sizesOf, sizingContext } from './sizing';
import { moneyStatsOf, statsOf } from './stats';
import type { MoneyStats, Stats } from './stats';
import { STOP_WORDS, universeOf } from './universe';
import type { Excluded, Universe } from './universe';

/* The Model (plan B): the universe, every strategy run over it, each sized four ways, the ratio question answered
   three ways for S0 and each S2 depth against S1, the sensitivity grid, and the caveats counted from the trade list.
   Pure: the page passes in the board's rows and the bars and gets everything it prints. */

export interface ModelInput {
  /** The watchlist board's rows (the benchmarks have no model). */
  rows: readonly Row[];
  hist: Record<string, History | undefined>;
  bars: Record<string, Bars | undefined>;
}

export interface StrategyRun {
  strategy: Strategy;
  id: StrategyId;
  legs: Leg[];
  /** Setups with at least one leg. */
  setups: number;
  /** Left out of this strategy, with the reason: no stop it can run on, or an entry the rules would not take. */
  excluded: Excluded[];
  /** In the universe, but with no leg yet: the fill is a session that has not happened. */
  pending: Excluded[];
  /** Setups with legs whose next re-entry is a session that has not happened yet. */
  waitingReentries: Excluded[];
  /** Re-entry signals whose next open was at or beyond the stop, so no leg was taken, by setup. */
  refused: { key: string; days: string[] }[];
  stats: { closed: Stats; all: Stats };
  bootstrap: { pct: { closed: Interval | null; all: Interval | null }; r: { closed: Interval | null; all: Interval | null } };
  /** The scale under per-strategy sizing: 1, or for S0 and S2 the equal-risk ratio against S1. */
  scale: number;
  sizes: Record<SizingId, number[]>;
  money: Record<SizingId, MoneyStats>;
}

export interface GridCell {
  strategy: StrategyId;
  sizing: SizingId;
  legs: number;
  /** The mean net return per leg, in %: the same whatever the sizing. */
  expectancyPct: number | null;
  /** The mean net return weighted by what was put on each leg, in %. */
  weightedPct: number | null;
  /** The mean profit or loss per leg, in account units, under this sizing. */
  meanPnl: number | null;
  maxDrawdown: number;
  /** The equal-risk ratio against S1, for S0 and the S2 depths. */
  ratio: number | null;
}

export interface Caveats {
  /** Setups in the universe. */
  setups: number;
  /** The month with the most breakouts, and how many. */
  busiestMonth: { month: string; count: number } | null;
  shorts: number;
  /** Neither the target nor the negation nor a removal has ended them yet. */
  open: number;
  derivedStops: number;
  /** Without a tight stop: none in the report, or a derived one beyond the negation or unreadable. */
  noTightStop: number;
  /** Of those, the setups with none in the report, which S1, S2 and S4 run on the negation (revision 9). */
  onNegation: number;
  /** Imported already confirmed, their confirming close found by the lookback. */
  imported: number;
  reached: number;
  removed: number;
  /** Breakouts before the list began, which the "from" toggle leaves out. */
  beforeListBegan: number;
  listBegan: string;
}

export interface ModelResult {
  settings: ModelSettings;
  universe: Universe;
  runs: Record<StrategyId, StrategyRun>;
  /** S0 and each S2 depth against S1. */
  ratios: Partial<Record<StrategyId, Ratios>>;
  grid: GridCell[];
  caveats: Caveats;
  /** How long the run took, in milliseconds. */
  ms: number;
}

type Partial7 = Pick<StrategyRun, 'strategy' | 'id' | 'legs' | 'setups' | 'excluded' | 'pending' | 'waitingReentries' | 'refused' | 'stats' | 'bootstrap'>;

function runStrategy(u: Universe, strategy: Strategy, settings: ModelSettings): Partial7 {
  const legs: Leg[] = [];
  const excluded: Excluded[] = [];
  const pending: Excluded[] = [];
  const waitingReentries: Excluded[] = [];
  const refused: StrategyRun['refused'] = [];
  for (const c of u.candidates) {
    const no = (reason: string) => excluded.push({ key: c.key, sym: c.sym, dir: c.dir, reason });
    if (NEEDS_STOP[strategy.code] && c.stop == null) {
      // No last full day in the report: the setup runs on the negation (revision 9). The other cases without a stop stay out.
      if (c.stopSource !== 'none') { no(STOP_WORDS[c.stopSource]); continue; }
      if (c.negation == null) { no(STOP_WORDS.none + ', and no negation on file'); continue; }
    }
    if (strategy.code === 'S3' && c.negation == null) { no('no negation on file'); continue; }
    const sim = simulate(c, strategy, settings);
    legs.push(...sim.legs);
    if (!sim.legs.length) {
      if (isWaiting(sim.note)) pending.push({ key: c.key, sym: c.sym, dir: c.dir, reason: sim.note as string });
      else no(sim.note ?? 'no leg');
    }
    if (sim.waiting) waitingReentries.push({ key: c.key, sym: c.sym, dir: c.dir, reason: sim.waiting });
    if (sim.refused.length) refused.push({ key: c.key, days: sim.refused });
  }
  const closed = legs.filter(l => !l.open);
  const boot = (ls: Leg[], pick: (l: Leg) => number | null, seed: number) =>
    bootstrapMean(ls.map(pick).filter((v): v is number => v != null), settings.resamples, seed);
  return {
    strategy, id: strategyId(strategy), legs, setups: new Set(legs.map(l => l.key)).size, excluded, pending, waitingReentries, refused,
    stats: { closed: statsOf(closed), all: statsOf(legs) },
    bootstrap: {
      pct: { closed: boot(closed, l => l.netPct, settings.seed), all: boot(legs, l => l.netPct, settings.seed) },
      r: { closed: boot(closed, l => l.r, settings.seed + 1), all: boot(legs, l => l.r, settings.seed + 1) },
    },
  };
}

function caveatsOf(u: Universe, s3: Leg[], listBegan: string): Caveats {
  const months = new Map<string, number>();
  for (const c of u.candidates) { const m = c.signal.when.slice(0, 7); months.set(m, (months.get(m) || 0) + 1); }
  let busiestMonth: Caveats['busiestMonth'] = null;
  for (const [month, count] of months) if (!busiestMonth || count > busiestMonth.count) busiestMonth = { month, count };
  return {
    setups: u.candidates.length,
    busiestMonth,
    shorts: u.candidates.filter(c => c.dir === 'short').length,
    open: s3.filter(l => l.open).length,
    derivedStops: u.candidates.filter(c => c.stopSource === 'derived').length,
    noTightStop: u.candidates.filter(c => c.stop == null).length,
    onNegation: u.candidates.filter(c => c.stop == null && c.stopSource === 'none' && c.negation != null).length,
    imported: u.candidates.filter(c => c.imported).length,
    reached: u.candidates.filter(c => c.reached != null).length,
    removed: u.candidates.filter(c => c.removed != null).length,
    beforeListBegan: u.candidates.filter(c => c.signal.when < listBegan).length + u.excluded.filter(e => e.reason.startsWith('broke out before ')).length,
    listBegan,
  };
}

export function runModel(input: ModelInput, settings: ModelSettings, listBegan: string = LIST_BEGAN): ModelResult {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const universe = universeOf(input.rows, input.hist, input.bars, settings);
  const partial = new Map<StrategyId, ReturnType<typeof runStrategy>>();
  for (const s of STRATEGIES) partial.set(strategyId(s), runStrategy(universe, s, settings));
  const s1 = partial.get('S1') as ReturnType<typeof runStrategy>;
  const flatOf = (p: ReturnType<typeof runStrategy>) => moneyStatsOf(p.legs, sizesOf(p.legs, 'flat', settings, sizingContext(p.legs, 1)));
  const s1Flat = flatOf(s1);
  const ratios: Partial<Record<StrategyId, Ratios>> = {};
  const runs = {} as Record<StrategyId, StrategyRun>;
  for (const [id, p] of partial) {
    let scale = 1;
    if (RATIO_IDS.includes(id)) {
      const r = ratiosOf({ legs: s1.legs, flat: s1Flat }, { legs: p.legs, flat: id === 'S1' ? s1Flat : flatOf(p) });
      ratios[id] = r;
      scale = r.equalRisk.ratio ?? 1;
    }
    const ctx = sizingContext(p.legs, scale);
    const sizes = {} as Record<SizingId, number[]>;
    const money = {} as Record<SizingId, MoneyStats>;
    for (const sz of SIZINGS) { sizes[sz] = sizesOf(p.legs, sz, settings, ctx); money[sz] = moneyStatsOf(p.legs, sizes[sz]); }
    runs[id] = { ...p, scale, sizes, money };
  }
  const grid: GridCell[] = [];
  for (const s of STRATEGIES) {
    const id = strategyId(s);
    const run = runs[id];
    for (const sz of SIZINGS) {
      const sizes = run.sizes[sz];
      const put = sizes.reduce((a, b) => a + b, 0);
      const pnl = run.legs.reduce((a, l, k) => a + sizes[k] * l.netPct / 100, 0);
      grid.push({ strategy: id, sizing: sz, legs: run.legs.length, expectancyPct: run.stats.all.expectancyPct,
                  weightedPct: put > 0 ? pnl / put * 100 : null, meanPnl: run.legs.length ? pnl / run.legs.length : null,
                  maxDrawdown: run.money[sz].maxDrawdown, ratio: ratios[id] ? ratios[id]!.equalRisk.ratio : null });
    }
  }
  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return { settings, universe, runs, ratios, grid, caveats: caveatsOf(universe, runs.S3.legs, listBegan), ms: t1 - t0 };
}
