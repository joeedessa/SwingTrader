import type { Row } from '../row';
import type { Bars, History } from '../types';
import { bootstrapMean } from './bootstrap';
import type { Interval } from './bootstrap';
import { ratiosOf } from './ratio';
import type { Ratios } from './ratio';
import { LIST_BEGAN, NEEDS_STOP, S2_IDS, SIZINGS, STRATEGIES, strategyId } from './settings';
import type { ModelSettings, SizingId, Strategy, StrategyId } from './settings';
import { simulate } from './simulate';
import type { Leg } from './simulate';
import { sizesOf, sizingContext } from './sizing';
import { moneyStatsOf, statsOf } from './stats';
import type { MoneyStats, Stats } from './stats';
import { universeOf } from './universe';
import type { Excluded, Universe } from './universe';

/* The Model (plan B): the universe, every strategy run over it, each sized four ways, the ratio question answered
   three ways, the sensitivity grid, and the caveats counted from the trade list. Pure: the page passes in the board's
   rows and the bars and gets everything it prints. */

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
  /** Left out of this strategy, with the reason. */
  excluded: Excluded[];
  /** In the universe, but with no leg yet: the fill is a session that has not happened. */
  pending: Excluded[];
  stats: { closed: Stats; all: Stats };
  bootstrap: { pct: { closed: Interval | null; all: Interval | null }; r: { closed: Interval | null; all: Interval | null } };
  /** The scale under per-strategy sizing: 1, or for S2 the equal-risk ratio against S1. */
  scale: number;
  sizes: Record<SizingId, number[]>;
  money: Record<SizingId, MoneyStats>;
}

export interface GridCell {
  strategy: StrategyId;
  sizing: SizingId;
  legs: number;
  expectancyPct: number | null;
  maxDrawdown: number;
  /** The equal-risk ratio against S1, for the S2 depths. */
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
  noTightStop: number;
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
  /** Each S2 depth against S1. */
  ratios: Partial<Record<StrategyId, Ratios>>;
  grid: GridCell[];
  caveats: Caveats;
  /** How long the run took, in milliseconds. */
  ms: number;
}

function runStrategy(u: Universe, strategy: Strategy, settings: ModelSettings): Pick<StrategyRun, 'strategy' | 'id' | 'legs' | 'setups' | 'excluded' | 'pending' | 'stats' | 'bootstrap'> {
  const legs: Leg[] = [];
  const excluded: Excluded[] = [];
  const pending: Excluded[] = [];
  for (const c of u.candidates) {
    if (NEEDS_STOP[strategy.code] && c.stop == null) {
      excluded.push({ key: c.key, sym: c.sym, dir: c.dir, reason: c.stopSource === 'looser'
        ? 'no tight stop: the derived last full day is beyond the negation' : 'no tight stop: none in the report' });
      continue;
    }
    const sim = simulate(c, strategy, settings);
    legs.push(...sim.legs);
    if (sim.pending) pending.push({ key: c.key, sym: c.sym, dir: c.dir, reason: sim.pending });
  }
  const closed = legs.filter(l => !l.open);
  const boot = (ls: Leg[], pick: (l: Leg) => number | null, seed: number) =>
    bootstrapMean(ls.map(pick).filter((v): v is number => v != null), settings.resamples, seed);
  return {
    strategy, id: strategyId(strategy), legs, setups: new Set(legs.map(l => l.key)).size, excluded, pending,
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
    imported: u.candidates.filter(c => c.imported).length,
    reached: u.candidates.filter(c => c.reached != null).length,
    removed: u.candidates.filter(c => c.removed != null).length,
    beforeListBegan: u.candidates.filter(c => c.signal.when < listBegan).length,
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
    if (S2_IDS.includes(id)) {
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
    for (const sz of SIZINGS) {
      grid.push({ strategy: id, sizing: sz, legs: runs[id].legs.length, expectancyPct: runs[id].stats.all.expectancyPct,
                  maxDrawdown: runs[id].money[sz].maxDrawdown, ratio: ratios[id] ? ratios[id]!.equalRisk.ratio : null });
    }
  }
  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return { settings, universe, runs, ratios, grid, caveats: caveatsOf(universe, runs.S3.legs, listBegan), ms: t1 - t0 };
}
