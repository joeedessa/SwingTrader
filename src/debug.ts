import type { AppState } from './data/app';
import type { ModelResult } from './engine/backtest/model';
import type { ModelSettings } from './engine/backtest/settings';
import type { Flag } from './engine/flags';
import type { Timeframe } from './engine/ma';
import type { Outcomes } from './engine/outcomes';
import type { PositionsView } from './engine/positions';
import type { Board } from './engine/row';
import type { Scan, ScanScope, StructureEvent } from './engine/signals';
import type { TodayView } from './engine/today';
import type { Section } from './engine/types';

/* `window.__board` is the page's own account of itself, so a check in the console is one expression:
   what it counts in each section, what each row resolved to, every flag it raises, and what went wrong loading.
   `window.__today` is the same for the Today page: what is in each tier and what the badge says. */

export interface BoardDebug {
  set: string;
  counts: Record<Section, number>;
  /** Counts after the search and the filters, which is what the segments show. */
  shown: Record<Section, number>;
  rows: { sym: string; dir: string; section: Section; tag: string | null; lfd: number | null; lfdSrc: string | null; pullbacks: number; breaches: number; reentries: number; broke: string | null; target: string | null; hit: string | null; hitTag: string | null; failed: string | null; stopHit: string | null }[];
  flags: { id: string; tier: string; kind: string; sym: string | null; dir: string | null; when: string }[];
  errors: string[];
  data: { snapshot: string | null; bars: string | null; live: string; symbols: number; withoutBars: string[] };
}

export interface TodayDebug {
  badge: number;
  fresh: number;
  live: string[];
  act: { count: number; fresh: number; groups: Record<string, number> };
  watch: { count: number; fresh: number; groups: Record<string, number> };
  acked: string[];
  data: string[];
  /** When the visit this page compares with ended; null before a first visit. */
  since: number | null;
}

export interface PositionsDebug {
  ladder: { key: string; section: string; gapPct: number | null; atrs: number | null; r: number | null; days: number | null; stop: number | null; stopKind: string | null; entry: string | null }[];
  stopped: string[];
  tiles: { inTrade: number; stopped: number; nearest: string | null; events: number };
}

export interface HistoryDebug {
  outcomes: Outcomes;
  counts: Record<Section, number>;
  fills: number;
}

export interface SignalsDebug {
  /** The setups in play: not failed, not removed. */
  rows: number;
  series: { generatedAt: string; weekly: number; monthly: number } | null;
  seriesStatus: string;
  events: { sym: string; dir: string; tf: Timeframe; period: number; state: string; ago: number; helps: boolean }[];
  scan: { tf: Timeframe; scope: ScanScope; covered: number; total: number; bullish: number; bearish: number };
  /** The crosses across everything in play, for each timeframe. */
  crosses: Record<Timeframe, { covered: number; total: number; bullish: number; bearish: number }>;
  /** Of the names in play with a weekly or monthly series, how many had their period in progress closed at a settled daily close (or a period added), and the most bars built for one. */
  built: Record<'weekly' | 'monthly', { names: number; most: number }>;
  relative: { sym: string; dir: string; vsIndex: number | null; vsSector: number | null; index: string | null; peers: number }[];
}

/** `window.__runModel()` runs the Model on what the page has loaded, with any settings overridden, and sums it up;
    the whole result is under `result`. It runs only when called, so no page pays for it. */
export interface ModelDebug {
  ms: number;
  /** The universe the page prints: every setup that broke out. */
  breakouts: number;
  candidates: number;
  excluded: { key: string; reason: string }[];
  runs: Record<string, { legs: number; setups: number; open: number; excluded: number; pending: number; winRate: number | null; expectancyPct: number | null; expectancyR: number | null; maxDrawdownFlat: number; ratio: number | null }>;
  caveats: ModelResult['caveats'];
  result: ModelResult;
}

declare global {
  interface Window {
    __board?: BoardDebug;
    __today?: TodayDebug;
    __positions?: PositionsDebug;
    __history?: HistoryDebug;
    __signals?: SignalsDebug;
    __runModel?: (overrides?: Partial<ModelSettings>) => ModelDebug;
  }
}

export function installModel(run: (overrides?: Partial<ModelSettings>) => ModelResult): void {
  window.__runModel = overrides => {
    const r = run(overrides);
    return {
      ms: r.ms,
      breakouts: r.universe.breakouts,
      candidates: r.universe.candidates.length,
      excluded: r.universe.excluded.map(e => ({ key: e.key, reason: e.reason })),
      runs: Object.fromEntries(Object.values(r.runs).map(x => [x.id, {
        legs: x.legs.length, setups: x.setups, open: x.stats.all.open, excluded: x.excluded.length, pending: x.pending.length,
        winRate: x.stats.all.winRate, expectancyPct: x.stats.all.expectancyPct, expectancyR: x.stats.all.expectancyR,
        maxDrawdownFlat: x.money.flat.maxDrawdown, ratio: r.ratios[x.id] ? r.ratios[x.id]!.equalRisk.ratio : null,
      }])),
      caveats: r.caveats,
      result: r,
    };
  };
}

export function publish(set: string, bd: Board, shown: Record<Section, number>, errors: string[], flags: Flag[], data: BoardDebug['data']): void {
  window.__board = {
    set,
    counts: bd.counts,
    shown,
    rows: bd.rows.map(r => ({
      sym: r.p.sym, dir: r.p.dir, section: r.section, tag: r.btype ? r.btype.tag : null,
      lfd: r.lfd ? r.lfd.at : null, lfdSrc: r.lfd ? r.lfd.src : null,
      pullbacks: r.btype?.pullbacks?.length ?? 0, breaches: r.btype?.breaches?.length ?? 0, reentries: r.btype?.reentries?.length ?? 0,
      broke: r.st.breakout ? r.st.breakout.when : null, target: r.st.targetHit ? r.st.targetHit.when : null, hit: r.hit ? r.hit.when : null, hitTag: r.hit && r.hit.btype ? r.hit.btype.tag : null, failed: r.st.failed ? r.st.failed.when : null, stopHit: r.lfd && r.lfd.hit ? r.lfd.hit.when : null,
    })),
    flags: flags.map(f => ({ id: f.id, tier: f.tier, kind: f.kind, sym: f.sym, dir: f.dir, when: f.when })),
    errors,
    data,
  };
}

export function publishToday(v: TodayView, since: number | null): void {
  const tier = (t: TodayView['act']) => ({ count: t.count, fresh: t.fresh, groups: Object.fromEntries(t.groups.map(g => [g.kind, g.flags.length])) });
  window.__today = {
    badge: v.badge, fresh: v.fresh, live: v.live.map(f => f.id), act: tier(v.act), watch: tier(v.watch),
    acked: v.acked.map(f => f.id), data: v.data.map(f => f.id), since,
  };
}

export function publishPositions(v: PositionsView): void {
  window.__positions = {
    ladder: v.ladder.map(p => ({
      key: p.key, section: p.row.section, gapPct: p.gapPct, atrs: p.atrs, r: p.r, days: p.days,
      stop: p.stop ? p.stop.level : null, stopKind: p.stop ? p.stop.kind : null, entry: p.entry ? p.entry.when + (p.entry.price != null ? ' @ ' + p.entry.price : '') : null,
    })),
    stopped: v.stopped.map(r => r.p.sym + '|' + r.p.dir),
    tiles: { inTrade: v.tiles.inTrade, stopped: v.tiles.stopped, nearest: v.tiles.nearest ? v.tiles.nearest.key : null, events: v.tiles.events },
  };
}

export function publishHistory(outcomes: Outcomes, counts: Record<Section, number>, fills: number): void {
  window.__history = { outcomes, counts, fills };
}

export function publishSignals(d: {
  rows: number; series: SignalsDebug['series']; seriesStatus: string; events: readonly StructureEvent[]; scan: Scan; scope: ScanScope;
  all: Record<Timeframe, Scan>; relative: SignalsDebug['relative']; built: SignalsDebug['built'];
}): void {
  const count = (s: Scan) => ({ covered: s.covered, total: s.total, bullish: s.hits.filter(h => h.bullish).length, bearish: s.hits.filter(h => !h.bullish).length });
  window.__signals = {
    rows: d.rows, series: d.series, seriesStatus: d.seriesStatus,
    events: d.events.map(e => ({ sym: e.row.p.sym, dir: e.row.p.dir, tf: e.tf, period: e.period, state: e.state, ago: e.ago, helps: e.helps })),
    scan: { tf: d.scan.tf, scope: d.scope, ...count(d.scan) },
    crosses: { daily: count(d.all.daily), weekly: count(d.all.weekly), monthly: count(d.all.monthly) },
    built: d.built,
    relative: d.relative,
  };
}

/** What the console check says about the data behind a board, the same on every page. */
export function dataInfo(s: AppState): BoardDebug['data'] {
  return {
    snapshot: s.snapshot ? s.snapshot.generated_at : null,
    bars: s.barsFile ? s.barsFile.generated_at : null,
    live: s.liveStatus,
    symbols: Object.keys(s.hist).length,
    withoutBars: s.noBars,
  };
}
