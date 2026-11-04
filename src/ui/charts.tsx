import { fmtD } from '../engine/format';
import { money } from './modelcells';

/* Two small line charts for the Model: the equity line and the drawdown under it, both in account units, drawn as SVG
   so they follow light and dark through the page's colours and stretch to any width. The words (the dates, the high
   and the low) are HTML around the drawing, so they keep their size whatever the drawing is stretched to. Nothing
   interactive: the numbers behind the lines are in the tiles and the trade list. */

export interface ChartProps {
  dates: readonly string[];
  values: readonly number[];
  /** "equity" fills under the line from zero; "drawdown" draws the fall from each high, downward. */
  kind: 'equity' | 'drawdown';
  label: string;
  /** The unit, printed with every figure. */
  unit: string;
}

export const CHART_W = 640;
export const CHART_H = 200;
const PAD = { l: 2, r: 2, t: 6, b: 6 };

/** The points of a line as a path on the chart's grid; the scale is the data's own, with zero always on it. One point
    draws as a flat segment across the width, so a single day is a line and not a dot in a corner. */
export function chartPath(values: readonly number[], w = CHART_W, h = CHART_H): { d: string; zeroY: number; min: number; max: number } {
  const min = Math.min(0, ...values), max = Math.max(0, ...values);
  const span = max - min || 1;
  const x = (i: number) => PAD.l + (values.length > 1 ? (i / (values.length - 1)) * (w - PAD.l - PAD.r) : 0);
  const y = (v: number) => PAD.t + ((max - v) / span) * (h - PAD.t - PAD.b);
  const pts = values.length === 1 ? [[PAD.l, y(values[0])], [w - PAD.r, y(values[0])]] : values.map((v, i) => [x(i), y(v)]);
  const d = pts.map(([px, py], i) => (i ? 'L' : 'M') + px.toFixed(1) + ' ' + py.toFixed(1)).join(' ');
  return { d, zeroY: y(0), min, max };
}

export function LineChart({ dates, values, kind, label, unit }: ChartProps) {
  if (!values.length) return <div class="chart empty"><p>Nothing to draw yet.</p></div>;
  const { d, zeroY, min, max } = chartPath(values);
  const last = values[values.length - 1];
  const area = d + ` L${(CHART_W - PAD.r).toFixed(1)} ${zeroY.toFixed(1)} L${PAD.l} ${zeroY.toFixed(1)} Z`;
  const first = dates[0], final = dates[dates.length - 1];
  const words = kind === 'equity'
    ? `${label}: from ${fmtD(first)} to ${fmtD(final)}, ending at ${money(last, unit)}, between ${money(min, unit)} and ${money(max, unit)}`
    : `${label}: from ${fmtD(first)} to ${fmtD(final)}, deepest ${money(min, unit)}`;
  return (
    <figure class={'chart ' + kind}>
      <figcaption>
        <span class="chartname">{label}</span>
        <span class="chartlast">{kind === 'equity' ? `${money(last, unit)} at the latest close` : `${money(min, unit)} at the deepest`}</span>
      </figcaption>
      <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} role="img" aria-label={words} preserveAspectRatio="none">
        <line class="chartzero" x1={PAD.l} x2={CHART_W - PAD.r} y1={zeroY} y2={zeroY} />
        <path class="chartfill" d={area} />
        <path class="chartline" d={d} />
      </svg>
      <div class="chartaxis" aria-hidden="true">
        <span>{fmtD(first)}</span>
        <span class="chartrange">{kind === 'equity' ? `high ${money(max, unit)} · low ${money(min, unit)}` : `low ${money(min, unit)}`}</span>
        <span>{fmtD(final)}</span>
      </div>
    </figure>
  );
}
