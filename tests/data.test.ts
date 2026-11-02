import { describe, expect, it } from 'vitest';
import watchlist from '../public/data/watchlist.json';
import benchmarks from '../public/data/benchmarks.json';
import bars from '../public/data/bars.json';

// negation and lfd are null on some rows, and the engine has to handle that, so they are not required here.
type Row = { sym: string; dir: string; breakthrough: number; negation: number | null; target: number; removed?: string };

const rows = watchlist as Row[];

describe('watchlist.json', () => {
  it('carries at least the 148 setups from the report-sync data (rows are never deleted)', () => {
    expect(rows.length).toBeGreaterThanOrEqual(148);
  });

  it('has the fields the engine reads on every row', () => {
    for (const r of rows) {
      expect(r.sym, r.sym).toBeTypeOf('string');
      expect(['long', 'short'], r.sym).toContain(r.dir);
      expect(r.breakthrough, r.sym).toBeTypeOf('number');
      expect(r.target, r.sym).toBeTypeOf('number');
      expect(r.negation === null || typeof r.negation === 'number', r.sym).toBe(true);
    }
  });

  it('has unique symbol and direction pairs', () => {
    const keys = rows.map((r) => `${r.sym}|${r.dir}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('benchmarks.json', () => {
  it('lists the 23 benchmarks', () => {
    expect(benchmarks).toHaveLength(23);
  });
});

describe('bars.json', () => {
  const data = bars as { bars: Record<string, Record<string, number[]>>; missing: string[] };

  it('has daily [low, high, close] bars for every watchlist symbol except the recorded gaps', () => {
    const gaps = new Set(data.missing);
    const uncovered = [...new Set(rows.map((r) => r.sym))].filter((s) => !data.bars[s] && !gaps.has(s));
    expect(uncovered).toEqual([]);
  });

  // Yahoo's own OHLC does not always hold close within low-high: the FX series
  // (JPY=X) takes its close from a different time of day than its high and low, and
  // FSR.JO and ZN=F each have one day. The bars are kept as received; these are the
  // known cases, listed here so any new one fails the test.
  const KNOWN_OHLC_QUIRKS = new Set(['JPY=X', 'FSR.JO', 'ZN=F']);
  const DATE = /^\d{4}-\d{2}-\d{2}$/;

  it('writes every bar with a date key, and close within low-high except for the known feed quirks', () => {
    // Plain comparisons collected into lists, with one assertion each at the end: an expect() per
    // bar is ~90,000 matcher objects and took 1s alone, over the 5s default under CPU load.
    const badDates: string[] = [];
    const outside = new Set<string>();
    for (const [sym, days] of Object.entries(data.bars)) {
      for (const [date, [low, high, close]] of Object.entries(days)) {
        if (!DATE.test(date)) badDates.push(`${sym} ${date}`);
        if (!(low <= close && close <= high)) outside.add(sym);
      }
    }
    expect(badDates).toEqual([]);
    expect([...outside].filter((s) => !KNOWN_OHLC_QUIRKS.has(s))).toEqual([]);
  });
});
