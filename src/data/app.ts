import { allHistories } from '../engine/bars';
import type { BarsFile, LatestFile } from '../engine/bars';
import type { History, Setup, SymbolEvents } from '../engine/types';
import { Store } from '../store';
import { loadJson } from './load';
import { emptyOverlay, readOverlay, SETS, workingList, writeOverlay } from './overlay';
import type { Overlay, SetId } from './overlay';
import { parseEvents, parseSetups } from './schema';
import { fetchBarsFor, fetchLive, mergeLive } from './sources';
import type { LiveResult } from './sources';

/* Everything the board reads, in one place: the shared files, this browser's overlays, the snapshot, and the
   live upgrade laid over it. The board paints as soon as the snapshot is in; the live upgrade and the bars for
   symbols the data job has not reached yet arrive after, and each one re-derives the histories. */

export type LiveStatus = 'idle' | 'loading' | 'ok' | 'failed';

export interface AppState {
  phase: 'loading' | 'ready' | 'error';
  refreshing: boolean;
  error: string | null;
  /** Files that failed to load and rows that failed validation, for the data line and the console. */
  problems: string[];
  shared: Record<SetId, Setup[]>;
  overlays: Record<SetId, Overlay>;
  /** The browser refused to save an edit (private mode, storage full). */
  saveFailed: boolean;
  events: Record<string, SymbolEvents>;
  barsFile: BarsFile | null;
  snapshot: LatestFile | null;
  live: LiveResult | null;
  liveStatus: LiveStatus;
  /** Symbols whose bars could not be fetched at all. */
  noBars: string[];
  hist: Record<string, History>;
  loadedAt: number | null;
  now: number;
}

const storage = (): Storage | null => {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
};

export const app = new Store<AppState>({
  phase: 'loading',
  refreshing: false,
  error: null,
  problems: [],
  shared: { watchlist: [], benchmarks: [] },
  overlays: {
    watchlist: readOverlay(storage(), SETS.watchlist.key),
    benchmarks: readOverlay(storage(), SETS.benchmarks.key),
  },
  saveFailed: false,
  events: {},
  barsFile: null,
  snapshot: null,
  live: null,
  liveStatus: 'idle',
  noBars: [],
  hist: {},
  loadedAt: null,
  now: Date.now(),
});

/** Histories from what is loaded now: settled closes from the bars, the tip (snapshot or live) spliced on. */
export function recompute(now: number = Date.now()): void {
  const s = app.get();
  app.set({ hist: allHistories(s.barsFile, mergeLive(s.snapshot, s.live), now), now });
}

/** Every symbol either list will draw, including rows added in this browser. */
export function wantedSymbols(s: AppState = app.get()): string[] {
  const out = new Set<string>();
  for (const id of Object.keys(SETS) as SetId[]) for (const p of workingList(s.shared[id], s.overlays[id])) out.add(p.sym);
  return [...out];
}

async function tryLoad<T>(name: string, problems: string[]): Promise<T | null> {
  try {
    return await loadJson<T>(name);
  } catch (e) {
    problems.push(`${name} did not load (${(e as Error).message})`);
    return null;
  }
}

let loading: Promise<void> | null = null;

/** Load (or reload) the shared files, paint, then upgrade. One load at a time. */
export function load(): Promise<void> {
  if (loading) return loading;
  loading = (async () => {
    const first = app.get().phase === 'loading';
    app.set({ refreshing: true, ...(first ? {} : { error: null }) });
    const problems: string[] = [];
    const [watch, bench, events, bars, latest] = await Promise.all([
      tryLoad<unknown>('watchlist.json', problems),
      tryLoad<unknown>('benchmarks.json', problems),
      tryLoad<unknown>('watch-events.json', problems),
      tryLoad<BarsFile>('bars.json', problems),
      tryLoad<LatestFile>('prices-latest.json', problems),
    ]);
    const lists: Partial<Record<SetId, Setup[]>> = {};
    if (watch) { const p = parseSetups(watch, 'watchlist.json'); lists.watchlist = p.rows; problems.push(...p.problems); }
    if (bench) { const p = parseSetups(bench, 'benchmarks.json'); lists.benchmarks = p.rows; problems.push(...p.problems); }
    const prev = app.get();
    const noLists = !lists.watchlist && !lists.benchmarks && !prev.shared.watchlist.length;
    app.set({
      phase: noLists ? 'error' : 'ready',
      error: noLists ? "The watchlist didn't load. Check the connection and try again." : null,
      problems,
      shared: { watchlist: lists.watchlist ?? prev.shared.watchlist, benchmarks: lists.benchmarks ?? prev.shared.benchmarks },
      events: events ? parseEvents(events).symbols : prev.events,
      barsFile: bars ?? prev.barsFile,
      snapshot: latest ?? prev.snapshot,
      live: null,
      liveStatus: 'idle',
      loadedAt: Date.now(),
      refreshing: false,
    });
    recompute();
    if (!noLists) void upgrade();
  })().finally(() => { loading = null; });
  return loading;
}

/** The live quotes, and bars for any symbol the snapshot does not have. Neither is allowed to fail loudly. */
async function upgrade(): Promise<void> {
  app.set({ liveStatus: 'loading' });
  const liveP = fetchLive(wantedSymbols()).then(live => {
    const ok = Object.keys(live.quotes).length > 0;
    app.set({ live: ok ? live : null, liveStatus: ok ? 'ok' : 'failed' });
    recompute();
  });
  await Promise.all([liveP, fillMissingBars()]);
}

/** Bars for symbols the data job has not reached: a setup added in this browser, or a row pushed since its last run. */
async function fillMissingBars(): Promise<void> {
  const have = app.get().barsFile?.bars ?? {};
  const missing = wantedSymbols().filter(s => !have[s]);
  if (!missing.length) return;
  const extra = await fetchBarsFor(missing);
  const s = app.get();
  const base: BarsFile = s.barsFile ?? { generated_at: '', ccy: {}, bars: {} };
  app.set({
    barsFile: { ...base, bars: { ...base.bars, ...extra.bars }, ccy: { ...base.ccy, ...extra.ccy } },
    noBars: extra.failed,
  });
  recompute();
}

/** Apply an overlay change for one list and keep it. If the browser refuses the write the edit still shows
    for this visit, and the page says it will not survive a reload. */
export function updateOverlay(set: SetId, fn: (ov: Overlay) => Overlay): void {
  const s = app.get();
  const next = fn(s.overlays[set] ?? emptyOverlay());
  const saved = writeOverlay(storage(), SETS[set].key, next);
  app.set({ overlays: { ...s.overlays, [set]: next }, saveFailed: !saved });
  // A setup added here may need bars the snapshot does not have.
  if (next.added.length !== s.overlays[set].added.length) void fillMissingBars();
}
