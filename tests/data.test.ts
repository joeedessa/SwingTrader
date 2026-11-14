import { describe, expect, it } from 'vitest';
import watchlist from '../public/data/watchlist.json';
import benchmarks from '../public/data/benchmarks.json';
import bars from '../public/data/bars.json';
import frozen from './parity/watchlist-2026-11-01.json';
import { parseSetups } from '../src/data/schema';

// negation and lfd are null on some rows, and the engine has to handle that, so they are not required here.
type Row = { sym: string; dir: string; breakthrough: number; negation: number | null; target: number; removed?: string };

const rows = watchlist as Row[];
const keyOf = (r: { sym: string; dir: string }) => `${r.sym}|${r.dir}`;

/* The lists change every week (names are added, and dropped ones are marked removed), so nothing here knows how many
   rows there are: only what is true of every row, whatever the count. */
function checkList(file: string, list: unknown[]) {
  it('is not empty', () => {
    expect(list.length).toBeGreaterThan(0);
  });

  it('passes the same validation the page applies, row for row', () => {
    const parsed = parseSetups(list, file);
    expect(parsed.problems).toEqual([]);
    expect(parsed.rows.length).toBe(list.length);
  });

  it('has unique symbol and direction pairs', () => {
    const keys = (list as Row[]).map(keyOf);
    expect(new Set(keys).size).toBe(keys.length);
  });
}

describe('watchlist.json', () => {
  checkList('watchlist.json', rows);

  it('has the levels the engine reads on every row (a negation may be null: the source publishes one only after a breakout)', () => {
    for (const r of rows) {
      expect(r.breakthrough, r.sym).toBeTypeOf('number');
      expect(r.target, r.sym).toBeTypeOf('number');
      expect(r.negation === null || typeof r.negation === 'number', r.sym).toBe(true);
    }
  });

  it('still has every setup it had on 2026-11-01: the sync marks a dropped row removed and never deletes it', () => {
    const now = new Set(rows.map(keyOf));
    expect((frozen as Row[]).map(keyOf).filter((k) => !now.has(k))).toEqual([]);
  });
});

describe('benchmarks.json', () => {
  checkList('benchmarks.json', benchmarks);
});

describe('bars.json', () => {
  const data = bars as { bars: Record<string, Record<string, number[]>>; missing: string[] };

  it('has daily [low, high, close, open] bars for every watchlist symbol except the recorded gaps', () => {
    const gaps = new Set(data.missing);
    const uncovered = [...new Set(rows.map((r) => r.sym))].filter((s) => !data.bars[s] && !gaps.has(s));
    expect(uncovered).toEqual([]);
  });

  // Yahoo's own OHLC does not always hold close within low-high: the FX series
  // (JPY=X) takes its close from a different time of day than its high and low, and
  // FSR.JO, ZN=F and SL.MI each have one day (SL.MI: 13 Nov 2026, a close of 38.44 under
  // its low of 38.58). The bars are kept as received; these are the known cases, listed
  // here so any new one fails the test.
  const KNOWN_OHLC_QUIRKS = new Set(['JPY=X', 'FSR.JO', 'ZN=F', 'SL.MI']);
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

  // The open (a fourth value, kept from November 2026 for the Model page's fills) is a price where it is there. It is
  // not held within low-high: Yahoo's opens sit outside the day's range on a dozen feeds, far more than its closes do.
  it('has an open on nearly every day, and every open is a price', () => {
    const badOpens: string[] = [];
    let withOpen = 0, total = 0;
    for (const [sym, days] of Object.entries(data.bars)) {
      for (const [date, bar] of Object.entries(days)) {
        total++;
        if (bar.length < 4) continue;
        withOpen++;
        const open = bar[3];
        if (!(typeof open === 'number' && isFinite(open) && open > 0)) badOpens.push(`${sym} ${date}`);
      }
    }
    expect(badOpens).toEqual([]);
    expect(withOpen / total).toBeGreaterThan(0.95);
  });
});
