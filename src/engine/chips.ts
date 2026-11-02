import { ackable, expired, latestSettled } from './flags';
import type { Acks, Flag, FlagKind } from './flags';
import type { History } from './types';

/* The Flags column of a board row (plan A4): up to three small chips that say why the row is interesting without a
   tooltip. A red dot for the most pressing thing waiting for a decision, an amber dot for the most pressing thing worth
   a look, and a calendar glyph for the nearest earnings report or ex-dividend date.

   A chip is a summary of the row's open flags, the same ones Today lists: not acknowledged, not aged out. So the board
   and Today cannot disagree, and a row goes quiet once it has been dealt with. `late-entry` has no other surface, so
   this is where it shows. Which sections draw the column is the board's business (see columns.ts); this only answers
   "what are this row's chips". */

export type ChipKind = 'act' | 'watch' | 'calendar';

export interface Chip {
  kind: ChipKind;
  /** The flag the chip leads with. */
  flag: Flag;
  /** How many other open flags of the same kind the row has behind it. */
  more: number;
}

/** Dated in the future, so they read as a date rather than as a tier. */
export const CALENDAR_KINDS: readonly FlagKind[] = ['earnings-7d', 'exdiv-7d', 'exdiv-2d'];

/** Which flag a chip leads with when a row has several of its tier: the most pressing first. A test holds every Act and
    Watch kind to exactly one of these lists or to CALENDAR_KINDS, so a kind added later cannot go missing from a chip. */
export const LEAD_ORDER: Record<'act' | 'watch', readonly FlagKind[]> = {
  act: ['live-negation', 'live-stop', 'exit', 'failed', 'target', 'reentry', 'breakout'],
  watch: ['live-trigger', 'near-stop', 'near-trigger', 'pullback', 'boundary', 'late-entry', 'source-kept'],
};

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export const rowKeyOf = (sym: string, dir: string): string => sym + '|' + dir;

/** The flags still open on each row, by `sym|dir`: Act and Watch, not acknowledged, not aged out. A live flag is open for
    as long as it is true. Rows with nothing open are absent. */
export function openByRow(flags: readonly Flag[], acks: Acks, hist: Record<string, History | undefined>): Map<string, Flag[]> {
  const latest = latestSettled(hist);
  const out = new Map<string, Flag[]>();
  for (const f of flags) {
    if (!f.sym || !f.dir || (f.tier !== 'act' && f.tier !== 'watch')) continue;
    if (ackable(f) && acks[f.id] != null) continue;
    if (expired(f, hist, latest)) continue;
    const k = rowKeyOf(f.sym, f.dir);
    const list = out.get(k);
    if (list) list.push(f); else out.set(k, [f]);
  }
  return out;
}

/** The flags of one tier that are not calendar items, the lead first: by the order above, then live before dated, then newest. */
function ranked(open: readonly Flag[], tier: 'act' | 'watch'): Flag[] {
  const rank = (k: FlagKind) => { const i = LEAD_ORDER[tier].indexOf(k); return i < 0 ? LEAD_ORDER[tier].length : i; };
  return open.filter(f => f.tier === tier && !CALENDAR_KINDS.includes(f.kind))
    .sort((a, b) => rank(a.kind) - rank(b.kind) || cmp(b.when, a.when) || cmp(a.id, b.id));
}

/** The nearest dated flag first. */
const calendarOf = (open: readonly Flag[]): Flag[] =>
  open.filter(f => CALENDAR_KINDS.includes(f.kind)).sort((a, b) => cmp(a.when, b.when) || cmp(a.id, b.id));

/** A row's chips, in the order the column draws them: what needs a decision, what is worth a look, what is coming. */
export function chipsOf(open: readonly Flag[]): Chip[] {
  const chips: Chip[] = [];
  const add = (kind: ChipKind, list: Flag[]) => { if (list.length) chips.push({ kind, flag: list[0], more: list.length - 1 }); };
  add('act', ranked(open, 'act'));
  add('watch', ranked(open, 'watch'));
  add('calendar', calendarOf(open));
  return chips;
}

/** How loud a row is, for sorting the column: decisions first, then things worth a look, then the calendar. */
export function flagRank(open: readonly Flag[] | undefined): number {
  let act = 0, watch = 0, cal = 0;
  for (const f of open ?? []) {
    if (CALENDAR_KINDS.includes(f.kind)) cal++;
    else if (f.tier === 'act') act++;
    else watch++;
  }
  return act * 10000 + watch * 100 + cal;
}
