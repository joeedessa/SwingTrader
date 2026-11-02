import { fmt, MINUS } from '../engine/format';
import { maRead, maSlope } from '../engine/ma';
import type { MaRead, MaSlope } from '../engine/ma';

/* The daily 150 and 200 on a setup's drawer: where the last settled close sits against each simple average, whether the
   average was tested lately, and which way it is heading. The engine does the arithmetic (ma.ts, the old site's); this words it. */

export const DRAWER_PERIODS: readonly number[] = [150, 200];

export interface AverageRead {
  period: number;
  read: MaRead | null;
  slope: MaSlope | null;
}

export function averagesOf(closes: readonly number[] | null | undefined): AverageRead[] {
  return DRAWER_PERIODS.map(period => ({ period, read: maRead(closes, period), slope: maSlope(closes, period) }));
}

const signed1 = (v: number) => { const d = Math.round(v * 10) / 10; return (d > 0 ? '+' : d < 0 ? MINUS : '') + Math.abs(d).toFixed(1); };

export interface AverageLine {
  /** "150-day". */
  label: string;
  /** "▲ +4.2%": which side, and how far. */
  value: string;
  above: boolean | null;
  /** held, rejected, reclaimed or lost, while price is still near the line. */
  state: string | null;
  slope: { glyph: string; label: string; state: string } | null;
  /** The sentence, written out for a phone. */
  text: string;
}

export function averageLine(a: AverageRead): AverageLine {
  const label = a.period + '-day';
  if (!a.read) return { label, value: '–', above: null, state: null, slope: null, text: 'Not enough closes yet for a ' + label + ' average.' };
  const m = a.read;
  const level = fmt(m.ma);
  let text = (m.above ? 'Above' : 'Below') + ' the ' + label + ' average, which sits at ' + level;
  if (a.slope) {
    text += ', and is ' + a.slope.label + ' (' + signed1(a.slope.pct) + '% over ' + a.slope.bars + ' bars, against ' + signed1(a.slope.priorPct) + '% the ' + a.slope.bars + ' before)';
  }
  text += '.';
  if (m.state) text += ' Tested lately: ' + m.state + '.';
  if (m.crossedAgo != null) text += ' Last changed sides ' + m.crossedAgo + (m.crossedAgo === 1 ? ' session' : ' sessions') + ' ago.';
  return {
    label, value: (m.above ? '▲ ' : '▼ ') + signed1(m.dist) + '%', above: m.above, state: m.state,
    slope: a.slope ? { glyph: a.slope.glyph, label: a.slope.label, state: a.slope.state } : null,
    text,
  };
}
