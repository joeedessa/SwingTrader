import type { Row } from './row';

/* The line above everything: how much of the active list is red on the day. A broad down day means a name's own
   weakness is the market's, not the stock's. This is the old page's gauge, as data: failed and removed setups are
   not part of the tape (they are kept for the record, not for the day), and a row counts once per setup. */

export type TapeTone = 'calm' | 'warn' | 'bad';

/** Share of names down, above which the tape is called mixed and broadly risk-off. */
export const TAPE_MIXED_ABOVE = 40;
export const TAPE_BROAD_ABOVE = 60;

export interface Tape {
  down: number;
  /** Names with a day move to count. */
  known: number;
  pctDown: number;
  tone: TapeTone;
  /** What the share means for reading single names. */
  read: string;
}

const READ: Record<TapeTone, string> = {
  bad: 'broad risk-off — read individual weakness as market forces',
  warn: 'mixed tape — weigh single names against it',
  calm: 'tape supportive — moves are mostly stock-specific',
};

export function tapeOf(rows: Row[]): Tape | null {
  const known = rows.filter(r => r.section !== 'failed' && r.section !== 'removed' && r.dayPct != null);
  if (!known.length) return null;
  const down = known.filter(r => (r.dayPct as number) < 0).length;
  const pctDown = Math.round(down / known.length * 100);
  const tone: TapeTone = pctDown > TAPE_BROAD_ABOVE ? 'bad' : pctDown > TAPE_MIXED_ABOVE ? 'warn' : 'calm';
  return { down, known: known.length, pctDown, tone, read: READ[tone] };
}
