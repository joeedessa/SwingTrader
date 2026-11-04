import { allHistories } from '../engine/bars';
import type { BarsFile, LatestFile } from '../engine/bars';
import type { Fill } from '../engine/journal';
import { indexOf } from '../engine/signals';
import type { SeriesFile } from '../engine/signals';
import type { History, Setup, SymbolEvents } from '../engine/types';
import { Store } from '../store';
import { reloadAcks } from './acks';
import { localKV } from './kv';
import { migrateLegacyKeys } from './migrate';
import { loadJson } from './load';
import { emptyOverlay, readOverlay, SETS, workingList, writeOverlay } from './overlay';
import type { Overlay, SetId } from './overlay';
import { parseBars, parseEvents, parseSeries, parseSetups } from './schema';
import { fetchBarsFor, fetchLive, mergeLive } from './sources';
import type { LiveResult } from './sources';
import { emptyLog, readLogOverlay, writeLogOverlay } from './tradelog';
import type { LogOverlay } from './tradelog';

/* Everything the board reads, in one place: the shared files, this browser's overlays, the snapshot, and the
   live upgrade laid over it. The board paints as soon as the snapshot is in; the live upgrade and the bars for
   symbols the data job has not reached yet arrive after, and each one re-derives the histories. */

export type LiveStatus = 'idle' | 'loading' | 'ok' | 'failed';

/** series.json, the weekly and monthly closes only the Signals page reads, is fetched when that page opens. */
export type SeriesStatus = 'idle' | 'loading' | 'ok' | 'failed';

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
  /** The shared journal (tradelog.json), and what this browser has added, edited or deleted on top of it. */
  tradelog: Fill[];
  log: LogOverlay;
  logSaveFailed: boolean;
  events: Record<string, SymbolEvents>;
  /** When watch-events.json was written, for the Method page's freshness table. */
  eventsAt: string | null;
  barsFile: BarsFile | null;
  snapshot: LatestFile | null;
  live: LiveResult | null;
  liveStatus: LiveStatus;
  /** Symbols whose bars could not be fetched at all. */
  noBars: string[];
  hist: Record<string, History>;
  /** The weekly and monthly closes, once the Signals page has asked for them, when this browser fetched them, and the symbols
      the file had that could not be read. */
  series: SeriesFile | null;
  seriesStatus: SeriesStatus;
  seriesAt: number | null;
  seriesProblems: string[];
  loadedAt: number | null;
  now: number;
}

/* Before anything reads the saved edits or the journal: copy what the old watchlist page saved into this site's own keys,
   once (see migrate.ts). */
migrateLegacyKeys(localKV());

export const app = new Store<AppState>({
  phase: 'loading',
  refreshing: false,
  error: null,
  problems: [],
  shared: { watchlist: [], benchmarks: [] },
  overlays: {
    watchlist: readOverlay(localKV(), SETS.watchlist.key),
    benchmarks: readOverlay(localKV(), SETS.benchmarks.key),
  },
  saveFailed: false,
  tradelog: [],
  log: readLogOverlay(localKV()),
  logSaveFailed: false,
  events: {},
  eventsAt: null,
  barsFile: null,
  snapshot: null,
  live: null,
  liveStatus: 'idle',
  noBars: [],
  hist: {},
  series: null,
  seriesStatus: 'idle',
  seriesAt: null,
  seriesProblems: [],
  loadedAt: null,
  now: Date.now(),
});

/** Histories from what is loaded now: settled closes from the bars, the tip (snapshot or live) spliced on. */
export function recompute(now: number = Date.now()): void {
  const s = app.get();
  app.set({ hist: allHistories(s.barsFile, mergeLive(s.snapshot, s.live), now), now });
}

/** Every symbol either list will draw, including rows added in this browser, and then the local index each listing is read
    against on Signals (the day move against it needs a live quote for the index too, or the two would be minutes apart). */
export function wantedSymbols(s: AppState = app.get()): string[] {
  const out = new Set<string>();
  const indexes = new Set<string>();
  for (const id of Object.keys(SETS) as SetId[]) {
    for (const p of workingList(s.shared[id], s.overlays[id])) {
      out.add(p.sym);
      const index = indexOf(p.country);
      if (index) indexes.add(index);
    }
  }
  for (const i of indexes) out.add(i);
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
    const [watch, bench, events, bars, latest, trades] = await Promise.all([
      tryLoad<unknown>('watchlist.json', problems),
      tryLoad<unknown>('benchmarks.json', problems),
      tryLoad<unknown>('watch-events.json', problems),
      tryLoad<unknown>('bars.json', problems),
      tryLoad<LatestFile>('prices-latest.json', problems),
      // The journal is optional: a missing file is an empty journal, not a problem to put on every page.
      loadJson<unknown>('tradelog.json').catch(() => null),
    ]);
    const lists: Partial<Record<SetId, Setup[]>> = {};
    if (watch) { const p = parseSetups(watch, 'watchlist.json'); lists.watchlist = p.rows; problems.push(...p.problems); }
    if (bench) { const p = parseSetups(bench, 'benchmarks.json'); lists.benchmarks = p.rows; problems.push(...p.problems); }
    const prev = app.get();
    let barsFile: BarsFile | null = null;
    if (bars) { const p = parseBars(bars); barsFile = p.file; problems.push(...p.problems); }
    const noLists = !lists.watchlist && !lists.benchmarks && !prev.shared.watchlist.length;
    app.set({
      phase: noLists ? 'error' : 'ready',
      error: noLists ? "The watchlist didn't load. Check the connection and try again." : null,
      problems,
      shared: { watchlist: lists.watchlist ?? prev.shared.watchlist, benchmarks: lists.benchmarks ?? prev.shared.benchmarks },
      events: events ? parseEvents(events).symbols : prev.events,
      eventsAt: events ? (parseEvents(events).generated_at ?? null) : prev.eventsAt,
      // A file that is missing or not a list leaves what was there.
      tradelog: Array.isArray(trades) ? (trades as Fill[]) : prev.tradelog,
      barsFile: barsFile ?? prev.barsFile,
      snapshot: latest ?? prev.snapshot,
      live: null,
      liveStatus: 'idle',
      loadedAt: Date.now(),
      refreshing: false,
    });
    recompute();
    if (!noLists) void upgrade();
    // Once Signals has asked for the slower timeframes, a refresh brings them up to date with the rest: when the copy is half an
    // hour old (the job rewrites the file about once a day, and it is 1.7 MB), or when the last try failed.
    if (prev.series ? Date.now() - (prev.seriesAt ?? 0) > SERIES_STALE_MS : prev.seriesStatus === 'failed') void loadSeries(true);
  })().finally(() => { loading = null; });
  return loading;
}

let seriesLoading: Promise<void> | null = null;
const SERIES_STALE_MS = 30 * 60 * 1000;

/** The weekly and monthly closes for Signals: once, when the page first opens, and again with each refresh after that. It is
    1.7 MB, so no other page pays for it. A failure leaves what was there, and the page says the slower timeframes are missing. */
export function loadSeries(force = false): Promise<void> {
  if (seriesLoading) return seriesLoading;
  if (app.get().series && !force) return Promise.resolve();
  app.set({ seriesStatus: 'loading' });
  seriesLoading = (async () => {
    try {
      const { file, problems } = parseSeries(await loadJson<unknown>('series.json'));
      app.set(file
        ? { series: file, seriesStatus: 'ok', seriesAt: Date.now(), seriesProblems: problems }
        : { seriesStatus: app.get().series ? 'ok' : 'failed', seriesProblems: app.get().series ? app.get().seriesProblems : problems });
    } catch {
      app.set({ seriesStatus: app.get().series ? 'ok' : 'failed' });
    }
  })().finally(() => { seriesLoading = null; });
  return seriesLoading;
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

/* Three things this page writes are shared with other tabs, and some with the old watchlist page, which uses the same keys: the
   saved edits, the journal and the acknowledgements. A change is applied to what the browser has stored now, not to what was
   stored when this page loaded, or writing it back would erase whatever another tab wrote in between. Where the last write
   failed, or there is no storage, what is in memory is all there is. */

/** Apply an overlay change for one list and keep it. If the browser refuses the write the edit still shows
    for this visit, and the page says it will not survive a reload. */
export function updateOverlay(set: SetId, fn: (ov: Overlay) => Overlay): void {
  const s = app.get();
  const kv = localKV();
  const base = kv && !s.saveFailed ? readOverlay(kv, SETS[set].key) : s.overlays[set] ?? emptyOverlay();
  const next = fn(base);
  const saved = writeOverlay(kv, SETS[set].key, next);
  app.set({ overlays: { ...s.overlays, [set]: next }, saveFailed: !saved });
  // A setup added here (or in another tab) may need bars the snapshot does not have.
  if (next.added.length !== s.overlays[set].added.length) void fillMissingBars();
}

/** Apply a change to this browser's journal and keep it. If the browser refuses the write the change still shows for
    this visit, and the page says it will not survive a reload. */
export function updateLog(fn: (ov: LogOverlay) => LogOverlay): void {
  const s = app.get();
  const kv = localKV();
  const base = kv && !s.logSaveFailed ? readLogOverlay(kv) : s.log ?? emptyLog();
  const next = fn(base);
  const saved = writeLogOverlay(kv, next);
  app.set({ log: next, logSaveFailed: !saved });
}

/** Take in what another tab, or the old page, wrote since this page last looked: the saved edits, the journal and the
    acknowledgements. Anything identical leaves the state alone, so nothing redraws for nothing. Called when the tab comes
    back to the front and when the browser says another document changed storage. */
export function reloadStored(): void {
  const kv = localKV();
  if (kv) {
    const s = app.get();
    const patch: Partial<AppState> = {};
    if (!s.saveFailed) {
      const overlays = { ...s.overlays };
      for (const id of Object.keys(SETS) as SetId[]) {
        const next = readOverlay(kv, SETS[id].key);
        if (JSON.stringify(next) !== JSON.stringify(s.overlays[id])) overlays[id] = next;
      }
      if ((Object.keys(SETS) as SetId[]).some(id => overlays[id] !== s.overlays[id])) patch.overlays = overlays;
    }
    if (!s.logSaveFailed) {
      const log = readLogOverlay(kv);
      if (JSON.stringify(log) !== JSON.stringify(s.log)) patch.log = log;
    }
    if (Object.keys(patch).length) {
      app.set(patch);
      if (patch.overlays) void fillMissingBars();
    }
  }
  reloadAcks();
}
