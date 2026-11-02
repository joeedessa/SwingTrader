import { THRESHOLDS } from '../engine/flags';
import { fmt, fmtD, fmtRatio, MINUS } from '../engine/format';
import type { Position } from '../engine/positions';
import type { Row } from '../engine/row';
import type { Cell } from './cells';
import { trailingStopCell } from './cells';
import { flags } from './columns';
import type { ColSpec } from './columns';

/* What the stop ladder says in each cell, as plain data (the way cells.ts does for the board): the stop and how far off it
   is, what a 2×ATR trailing stop would be, how many multiples of the risk the trade has made, and how long it has run. */

const pct = (v: number) => fmt(Math.abs(Math.round(v * 10) / 10));

export function stopCell(p: Position): Cell {
  if (!p.stop) {
    return { value: '–', sub: 'no stop on file', title: 'Neither a last full day nor a negation is on file for this setup. Edit its levels to add one.' };
  }
  const { stop, gapPct, atrs, row } = p;
  const long = row.p.dir === 'long';
  const side = long ? 'above' : 'below';
  const past = gapPct != null && gapPct <= 0;
  const bits: string[] = [];
  if (gapPct != null) bits.push(past ? 'past it' : MINUS + pct(gapPct) + '%');
  if (atrs != null && !past) bits.push(fmtRatio(atrs) + ' ATR');
  if (stop.kind === 'negation') bits.push('negation');
  const near = !past && atrs != null && atrs <= THRESHOLDS.nearAtr;
  const why = stop.kind === 'last full day'
    ? 'The last full day (' + (long ? 'low' : 'high') + ' of the bar before the breakout run): a touch is an exit.'
    : 'No tight stop is on file for this trade, so the negation is the stop: a touch fails it.';
  return {
    value: fmt(stop.level),
    sub: bits.join(' · '),
    ...(past ? { subTone: 'bad' as const } : near ? { subTone: 'warn' as const } : {}),
    title: why + (gapPct != null ? ' The price is ' + (past ? 'already ' + (long ? 'below' : 'above') + ' it.' : pct(gapPct) + '% ' + side + ' it' + (atrs != null ? ' (' + fmtRatio(atrs) + ' ATR)' : '') + '.') : ''),
  };
}

export function rCell(p: Position): Cell {
  if (p.r == null) {
    return { value: '–', sub: p.entry && p.entry.price == null ? 'no entry close' : p.stop ? undefined : 'no stop', title: 'Needs the close the trade was entered at and a stop on the losing side of it.' };
  }
  const v = Math.round(p.r * 10) / 10;
  const e = p.entry!;
  return {
    value: (v > 0 ? '+' : v < 0 ? MINUS : '') + Math.abs(v).toFixed(1) + 'R',
    ...(v > 0 ? { tone: 'good' as const } : v < 0 ? { tone: 'bad' as const } : {}),
    sub: (e.kind === 'reentry' ? 're-entered ' : 'entered ') + fmt(e.price),
    title: 'The move since the ' + (e.kind === 'reentry' ? 're-entry' : 'confirming') + ' close (' + fmtD(e.when) + ', ' + fmt(e.price) + ') in multiples of the risk taken: ' +
      fmt(Math.abs((e.price as number) - (p.stop as { level: number }).level)) + ' from the entry to the stop at ' + fmt((p.stop as { level: number }).level) + '. 1R is the stop-out; a negative number is the trade down against its stop.',
  };
}

export function daysCell(p: Position): Cell {
  if (p.days == null || !p.entry) return { value: '–' };
  return {
    value: p.days + 'd',
    sub: (p.entry.kind === 'reentry' ? 're-entry ' : 'since ') + fmtD(p.entry.when),
    title: 'Calendar days since the ' + (p.entry.kind === 'reentry' ? 're-entry' : 'confirming') + ' close, ' + fmtD(p.entry.when) + '.',
  };
}

/** The ladder's own columns, after the symbol and the live price every board starts with. `posOf` finds a row's position. */
export function ladderColumns(posOf: (r: Row) => Position, today: string): ColSpec[] {
  return [
    { key: 'stop', label: 'Stop', sub: 'give-back · ATRs', sortBy: 'stopgap', asc: true, cell: r => stopCell(posOf(r)) },
    { key: 'trail', label: 'Trailing stop', sub: '2 × ATR below the price', cell: r => trailingStopCell(r, today) ?? { value: '–' } },
    { key: 'r', label: 'R so far', sub: 'from the entry', sortBy: 'r', cell: r => rCell(posOf(r)) },
    { key: 'days', label: 'In trade', sub: 'days since the entry', sortBy: 'days', cell: r => daysCell(posOf(r)) },
    flags,
  ];
}

/** The values the ladder's headers sort by, for sortRows. */
export function ladderSort(posOf: (r: Row) => Position): (r: Row, key: string) => number | null | undefined {
  return (r, key) => {
    const p = posOf(r);
    return key === 'stopgap' ? p.gapPct : key === 'r' ? p.r : key === 'days' ? p.days : undefined;
  };
}
