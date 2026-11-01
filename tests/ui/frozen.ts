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

export function frozenBoard(): Board {
  if (cache) return cache;
  const dump = JSON.parse(readFileSync(new URL('../parity/old-page-2026-11-01.json', import.meta.url), 'utf8')) as {
    BARS: Record<string, Bars>; HIST: Record<string, History>;
  };
  const shared = JSON.parse(readFileSync(new URL('../parity/watchlist-2026-11-01.json', import.meta.url), 'utf8')) as Setup[];
  cache = board(workingList(shared, emptyOverlay()), dump.HIST, dump.BARS, {}, TODAY);
  return cache;
}

export function rowOf(sym: string, dir: 'long' | 'short' = 'long'): Row {
  const r = frozenBoard().rows.find(x => x.p.sym === sym && x.p.dir === dir);
  if (!r) throw new Error('no such row in the frozen board: ' + sym + ' ' + dir);
  return r;
}
