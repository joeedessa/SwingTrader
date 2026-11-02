import { boardFlags } from '../engine/flags';
import type { Flag } from '../engine/flags';
import { board, isoToday } from '../engine/row';
import type { Board } from '../engine/row';
import { todayView } from '../engine/today';
import type { TodayView } from '../engine/today';
import { ackStore } from './acks';
import type { AppState } from './app';
import { workingList } from './overlay';
import type { SetId, WorkingSetup } from './overlay';

/* What the pages derive from the loaded data, computed once and shared. The board, the Today page and the badge on the
   Today tab all read the same replay, so each of them asks here instead of running the engine again. Each result is
   remembered for the inputs it was made from and recomputed only when one of them is a different object. */

export interface BoardView {
  list: WorkingSetup[];
  bd: Board;
  /** The engine's today: the UTC date. */
  today: string;
}

function lastResult<R>(): (key: readonly unknown[], make: () => R) => R {
  let prev: { key: readonly unknown[]; val: R } | null = null;
  return (key, make) => {
    if (prev && prev.key.length === key.length && prev.key.every((k, i) => k === key[i])) return prev.val;
    const val = make();
    prev = { key, val };
    return val;
  };
}

const boardCache: Record<SetId, ReturnType<typeof lastResult<BoardView>>> = { watchlist: lastResult(), benchmarks: lastResult() };
const flagCache: Record<SetId, ReturnType<typeof lastResult<Flag[]>>> = { watchlist: lastResult(), benchmarks: lastResult() };

export function boardView(s: AppState, set: SetId): BoardView {
  const today = isoToday(new Date(s.now));
  return boardCache[set]([s.shared[set], s.overlays[set], s.hist, s.barsFile, s.events, today], () => {
    const list = workingList(s.shared[set], s.overlays[set]);
    return { list, bd: board(list, s.hist, s.barsFile?.bars ?? {}, s.events, today), today };
  });
}

/** Every flag one list raises, newest-first within its tier. Empty until the data has loaded: before that every symbol
    would look like it has no history. */
export function flagsOf(s: AppState, set: SetId): Flag[] {
  if (s.phase !== 'ready') return [];
  const v = boardView(s, set);
  return flagCache[set]([v, s.liveStatus, s.snapshot, s.now], () => boardFlags(
    v.bd.rows,
    { today: v.today, nowMs: s.now, page: set === 'watchlist' ? 'setups' : 'benchmarks' },
    {
      symbols: v.list.map(p => p.sym), hist: s.hist, bars: s.barsFile?.bars ?? {}, events: s.events,
      snapshotAt: s.snapshot ? s.snapshot.generated_at : null, liveStatus: s.liveStatus, checkEvents: set === 'watchlist',
    }));
}

/** Local midnight, for "acknowledged today". */
export const startOfDay = (ms: number): number => {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

/** The Today page's content for this list as of the loaded data and this browser's acknowledgements. */
export function todayOf(s: AppState, set: SetId, seen: ReadonlySet<string> | null): TodayView {
  return todayView({ flags: flagsOf(s, set), acks: ackStore.get().acks[set], hist: s.hist, seen, dayStart: startOfDay(s.now) });
}
