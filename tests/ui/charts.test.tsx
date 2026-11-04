import { describe, expect, it } from 'vitest';
import { render } from 'preact-render-to-string';
import { CHART_H, CHART_W, chartPath, LineChart } from '../../src/ui/charts';

/* The equity and drawdown lines: the path on the chart's own grid, zero always on it, the words in HTML with a unit. */

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

describe('the chart path', () => {
  it('puts zero on the grid and scales the values to it', () => {
    const { d, zeroY, min, max } = chartPath([0, 100, -50, 25]);
    expect(min).toBe(-50);
    expect(max).toBe(100);
    expect(d.startsWith('M')).toBe(true);
    expect(d.split('L')).toHaveLength(4);
    expect(zeroY).toBeGreaterThan(0);
    expect(zeroY).toBeLessThan(CHART_H);
    // All-negative data has zero at the top, all-positive at the bottom.
    expect(chartPath([-10, -20]).zeroY).toBeLessThan(10);
    expect(chartPath([10, 20]).zeroY).toBeGreaterThan(CHART_H - 10);
  });

  it('draws a single day as a flat line across the width, not a dot in a corner', () => {
    const { d } = chartPath([500]);
    const [from, to] = d.split('L');
    expect(from.trim().startsWith('M2.0')).toBe(true);
    expect(to.trim().startsWith(String(CHART_W - 2))).toBe(true);
    expect(from.trim().split(' ')[1]).toBe(to.trim().split(' ')[1]);
  });
});

describe('the chart', () => {
  it('says the unit on every figure, with a real minus, and the dates at the ends', () => {
    const html = render(<LineChart dates={['2026-01-05', '2026-01-06', '2026-01-07']} values={[0, -350.4, 120]} kind="equity" label="Equity" unit="units" />);
    const t = text(html);
    expect(t).toContain('Equity');
    expect(t).toContain('120 units at the latest close');
    expect(t).toContain('high 120 units · low −350 units');
    expect(t).toContain('05-01-26');
    expect(t).toContain('07-01-26');
    expect(html).not.toContain('<text');
    expect(html).toContain('aria-label="Equity: from 05-01-26 to 07-01-26, ending at 120 units, between −350 units and 120 units"');
    const dd = text(render(<LineChart dates={['2026-01-05', '2026-01-06']} values={[0, -35125]} kind="drawdown" label="Drawdown" unit="EUR" />));
    expect(dd).toContain('−35,125 EUR at the deepest');
    expect(dd).not.toContain('-35');
  });

  it('says so with nothing to draw', () => {
    expect(text(render(<LineChart dates={[]} values={[]} kind="equity" label="Equity" unit="units" />))).toBe('Nothing to draw yet.');
  });
});
