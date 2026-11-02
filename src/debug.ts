import type { AppState } from './data/app';
import type { Flag } from './engine/flags';
import type { Outcomes } from './engine/outcomes';
import type { PositionsView } from './engine/positions';
import type { Board } from './engine/row';
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
  rows: { sym: string; dir: string; section: Section; tag: string | null; lfd: number | null; lfdSrc: string | null; pullbacks: number; breaches: number; reentries: number; broke: string | null; target: string | null; failed: string | null; stopHit: string | null }[];
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

declare global {
  interface Window {
    __board?: BoardDebug;
    __today?: TodayDebug;
    __positions?: PositionsDebug;
    __history?: HistoryDebug;
  }
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
