import type { Row } from '../engine/row';
import type { Section } from '../engine/types';
import {
  breachesCell, failedCell, lfdCell, negationCell, reachedCell, reasonText, removedCell, rrCell,
  sinceTargetCell, sortValue, srcOpenCell, statusCell, targetCell, triggerCell, typeCell,
} from './cells';
import type { Cell, SortContext } from './cells';

/* The columns each section keeps, after the two every section starts with (symbol, then live price). Only what
   decides the section's question stays on the board; the rest (pattern, boundary, calendar, market, trailing
   stop, added date) lives in the drawer. The table and the phone card are both read from this one list, so
   they cannot disagree. */

interface ColBase {
  key: string;
  label: string;
  /** A second, quieter line under the label saying what the cell's sub-line means. */
  sub?: string;
  /** Words, not numbers: left-aligned. */
  text?: boolean;
  /** The sort key (see sortValue) where it differs from `key`; absent means the column does not sort. */
  sortBy?: string;
  /** Direction of the first click on the header: ascending for text and for distances, else descending. */
  asc?: boolean;
}

/** A column whose cell is a value and a sub-line. */
export interface CellCol extends ColBase {
  chips?: undefined;
  cell: (r: Row, section: Section, today: string) => Cell;
}

/** The Flags column: chips drawn from the row's open flags, which the page supplies (see chips.ts). */
export interface ChipsCol extends ColBase {
  chips: true;
}

export type ColSpec = CellCol | ChipsCol;

/** Narrows a column to the one that draws chips. */
export const isChips = (c: ColSpec): c is ChipsCol => c.chips === true;

/** A cell column's cell; the chips column has none. Tests and the pages that only read values use this. */
export const cellOf = (c: ColSpec, r: Row, section: Section, today: string): Cell =>
  isChips(c) ? { value: '' } : c.cell(r, section, today);

const trigger = (sub: string, sortBy: string, asc = false): ColSpec =>
  ({ key: 'trigger', label: 'Trigger', sub, sortBy, asc, cell: (r, s) => triggerCell(r, s) });
const target = (sub: string): ColSpec =>
  ({ key: 'target', label: 'Target', sub, sortBy: 'upside', cell: (r, s) => targetCell(r, s) });
const lfd = (sub: string): ColSpec =>
  ({ key: 'lfd', label: 'Tight stop', sub, sortBy: 'lfd', asc: true, cell: (r, s) => lfdCell(r, s) });
const negation = (sub?: string): ColSpec =>
  ({ key: 'negation', label: 'Negation', ...(sub ? { sub } : {}), sortBy: 'risk', asc: true, cell: (r, s) => negationCell(r, s) });
const breaches: ColSpec = { key: 'breaches', label: 'Breaches', sub: 'exits at the last full day', sortBy: 'breaches', cell: r => breachesCell(r) };
const type = (sub: string): ColSpec => ({ key: 'type', label: 'Type', sub, text: true, sortBy: 'btype', asc: true, cell: r => typeCell(r) });
export const flags: ChipsCol = { key: 'flags', label: 'Flags', sub: 'what needs a look', text: true, sortBy: 'flags', chips: true };

export const COLUMNS: Record<Section, ColSpec[]> = {
  watch: [
    trigger('to trigger', 'gap', true),
    target('payoff'),
    { key: 'rr', label: 'Reward : risk', sub: 'at the trigger', sortBy: 'rr', cell: r => rrCell(r) },
    lfd('set at the boundary close'),
    flags,
  ],
  breakout: [
    trigger('past it · move used', 'runup'),
    target('to go'),
    type('so far'),
    lfd('last full day'),
    negation('live →'),
    flags,
  ],
  reentered: [
    trigger('past it · move used', 'runup'),
    { key: 'status', label: 'Status', sub: 'back in, original stop', text: true, sortBy: 'lfd', asc: true, cell: r => statusCell(r) },
    breaches,
    target('to go'),
    flags,
  ],
  stopped: [
    trigger('close past it re-enters', 'reentry', true),
    breaches,
    negation('live →'),
    flags,
  ],
  target: [
    { key: 'when', label: 'Reached', sortBy: 'when', cell: r => reachedCell(r) },
    type('how it got there'),
    { key: 'target', label: 'Target', sortBy: 'target', cell: (r, s) => targetCell(r, s) },
    { key: 'since', label: 'Since target', sub: 'move after reaching it', sortBy: 'since', cell: r => sinceTargetCell(r) },
  ],
  failed: [
    { key: 'when', label: 'Failed', sortBy: 'when', cell: r => failedCell(r) },
    { key: 'negation', label: 'Negation', sortBy: 'negation', cell: (r, s) => negationCell(r, s) },
    { key: 'reason', label: 'Reason', text: true, cell: r => ({ value: reasonText(r) }) },
    { key: 'srcopen', label: 'Still listed by source', sub: 'negation hit, analyst kept it', text: true, sortBy: 'srcopen', cell: r => srcOpenCell(r) },
  ],
  removed: [
    trigger('to trigger', 'gap', true),
    { key: 'removed', label: 'Removed', sub: 'date · reason', text: true, sortBy: 'removed', cell: r => removedCell(r) },
  ],
};

/** Each section opens sorted by the question it answers: the nearest trigger, the nearest stop, the latest outcome. */
export const DEFAULT_SORT: Record<Section, [key: string, asc: boolean]> = {
  watch: ['trigger', true],
  breakout: ['lfd', true],
  reentered: ['status', true],
  stopped: ['trigger', true],
  target: ['when', false],
  failed: ['when', false],
  removed: ['trigger', true],
};

export type Sort = [key: string, asc: boolean];

/** The two fixed columns sort too. */
export const SYMBOL_SORT = 'sym';
export const LIVE_SORT = 'live';

/** A section's columns, or any other list a page draws the same way (the Positions ladder has its own). */
export type Cols = Section | readonly ColSpec[];
const colsOf = (c: Cols): readonly ColSpec[] => (typeof c === 'string' ? COLUMNS[c] : c);

function sortKeyOf(cols: Cols, key: string): string | null {
  if (key === SYMBOL_SORT || key === LIVE_SORT) return key;
  return colsOf(cols).find(c => c.key === key)?.sortBy ?? null;
}

/** Numbers numerically, text alphabetically, and a row with no value last whichever way it runs. */
export function sortRows(rows: Row[], cols: Cols, sort: Sort, ctx?: SortContext): Row[] {
  const sk = sortKeyOf(cols, sort[0]);
  if (!sk) return rows.slice();
  const [, asc] = sort;
  return rows.slice().sort((a, b) => {
    const va = sortValue(a, sk, ctx), vb = sortValue(b, sk, ctx);
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    const cmp = typeof va === 'string' || typeof vb === 'string' ? String(va).localeCompare(String(vb)) : va - vb;
    return asc ? cmp : -cmp;
  });
}

/** What a header click does: the same column flips direction, a new one starts the way its type reads best. */
export function nextSort(cols: Cols, current: Sort, key: string): Sort {
  if (current[0] === key) return [key, !current[1]];
  if (key === SYMBOL_SORT) return [key, true];
  if (key === LIVE_SORT) return [key, false];
  return [key, colsOf(cols).find(c => c.key === key)?.asc ?? false];
}
