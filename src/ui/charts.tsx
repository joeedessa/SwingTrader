import { fmtD } from '../engine/format';

/* Two small line charts for the Model: the equity line and the drawdown under it, both in account units, drawn as SVG
   so they follow light and dark through the page's colours and scale to any width. Nothing interactive: the numbers
   behind them are in the tiles and the trade list. */

export interface ChartProps {
  dates: readonly string[];
  values: readonly number[];
  /** "equity" fills under the line from zero; "drawdown" draws the fall from each high, downward. */
  kind: 'equity' | 'drawdown';
  label: string;
  /** The unit, for the axis words. */
  unit: string;
}

export const CHART_W = 640;
export const CHART_H = 220;
const PAD = { l: 8, r: 8, t: 14, b: 22 };

const whole = (v: number): string => Math.round(v).toLocaleString('en-US');

/** The points of a line, as "x,y" pairs on the chart's grid; the scale is the data's own, with zero always on it. */
export function chartPath(values: readonly number[], w = CHART_W, h = CHART_H): { d: string; zeroY: number; min: number; max: number } {
  const min = Math.min(0, ...values), max = Math.max(0, ...values);
  const span = max - min || 1;
  const x = (i: number) => PAD.l + (values.length > 1 ? (i / (values.length - 1)) * (w - PAD.l - PAD.r) : (w - PAD.l - PAD.r) / 2);
  const y = (v: number) => PAD.t + ((max - v) / span) * (h - PAD.t - PAD.b);
  const d = values.map((v, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1)).join(' ');
  return { d, zeroY: y(0), min, max };
}

export function LineChart({ dates, values, kind, label, unit }: ChartProps) {
  if (!values.length) return <div class="chart empty"><p>Nothing to draw yet.</p></div>;
  const { d, zeroY, min, max } = chartPath(values);
  const last = values[values.length - 1];
  const area = d + ` L${(CHART_W - PAD.r).toFixed(1)} ${zeroY.toFixed(1)} L${PAD.l} ${zeroY.toFixed(1)} Z`;
  const first = dates[0], final = dates[dates.length - 1];
  const words = kind === 'equity'
    ? `${label}: from ${fmtD(first)} to ${fmtD(final)}, ending at ${whole(last)} ${unit}, between ${whole(min)} and ${whole(max)}`
    : `${label}: from ${fmtD(first)} to ${fmtD(final)}, deepest ${whole(min)} ${unit}`;
  return (
    <figure class={'chart ' + kind}>
      <figcaption>
        <span class="chartname">{label}</span>
        <span class="chartlast">{kind === 'equity' ? `${whole(last)} ${unit} at the latest close` : `${whole(min)} ${unit} at the deepest`}</span>
      </figcaption>
      <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} role="img" aria-label={words} preserveAspectRatio="none">
        <line class="chartzero" x1={PAD.l} x2={CHART_W - PAD.r} y1={zeroY} y2={zeroY} />
        <path class="chartfill" d={area} />
        <path class="chartline" d={d} />
        <text class="chartlabel" x={PAD.l} y={CHART_H - 6}>{fmtD(first)}</text>
        <text class="chartlabel end" x={CHART_W - PAD.r} y={CHART_H - 6} text-anchor="end">{fmtD(final)}</text>
        <text class="chartlabel" x={PAD.l} y={PAD.t - 4}>{whole(max)}</text>
        {min < 0 ? <text class="chartlabel end" x={CHART_W - PAD.r} y={PAD.t - 4} text-anchor="end">{whole(min)}</text> : null}
      </svg>
    </figure>
  );
}
