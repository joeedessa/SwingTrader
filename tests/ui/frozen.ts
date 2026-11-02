import { readFileSync } from 'node:fs';
import { board } from '../../src/engine/row';
import type { Board, Row } from '../../src/engine/row';
import type { Bars, History, Setup } from '../../src/engine/types';
import { workingList } from '../../src/data/overlay';
import { emptyOverlay } from '../../src/data/overlay';

/* The board as it stood on Sunday 2026-11-01 with every market shut: the frozen inputs of the parity test, run
   through the whole working-list path. UI tests read real rows from it instead of inventing them. */

export const TODAY = '2026-11-01';

let cache: Board | null = null;
let histCache: Record<string, History> | null = null;
let barsCache: Record<string, Bars> | null = null;
let sharedCache: Setup[] | null = null;

function load(): { BARS: Record<string, Bars>; HIST: Record<string, History> } {
  return JSON.parse(readFileSync(new URL('../parity/old-page-2026-11-01.json', import.meta.url), 'utf8'));
}

export function frozenBoard(): Board {
  if (cache) return cache;
  const dump = load();
  const shared = JSON.parse(readFileSync(new URL('../parity/watchlist-2026-11-01.json', import.meta.url), 'utf8')) as Setup[];
  histCache = dump.HIST;
  barsCache = dump.BARS;
  sharedCache = shared;
  cache = board(workingList(shared, emptyOverlay()), dump.HIST, dump.BARS, {}, TODAY);
  return cache;
}

/** The shared list and the daily bars of that day, for tests that load the app's own store. */
export function frozenInputs(): { shared: Setup[]; bars: Record<string, Bars>; hist: Record<string, History> } {
  frozenBoard();
  return { shared: sharedCache as Setup[], bars: barsCache as Record<string, Bars>, hist: histCache as Record<string, History> };
}

/** The settled closes of the same day, for the rules that count sessions. */
export function frozenHist(): Record<string, History> {
  frozenBoard();
  return histCache as Record<string, History>;
}

export function rowOf(sym: string, dir: 'long' | 'short' = 'long'): Row {
  const r = frozenBoard().rows.find(x => x.p.sym === sym && x.p.dir === dir);
  if (!r) throw new Error('no such row in the frozen board: ' + sym + ' ' + dir);
  return r;
}
