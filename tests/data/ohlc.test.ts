import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { closesOutsideRange, reviseDaysOf } from './ohlc';

// Bars are [low, high, close, open]. QUIRK is SL.MI's 13 Nov 2026 bar as first written: the close under the day's low.
const CLEAN = [38.4, 39.8, 39.2, 38.9];
const QUIRK = [38.58, 39.8, 38.44, 38.96];
const WINDOW = 5;

// Ten sessions, oldest first, with a weekend between the fifth and the sixth. The newest five are 9 to 13 Nov.
const DATES = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06',
               '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13'];

/** A symbol's days: clean bars throughout, except where `at` puts another bar on a date. */
const symbol = (at: Record<string, number[]> = {}, dates: string[] = DATES): Record<string, number[]> =>
  Object.fromEntries(dates.map((d) => [d, at[d] ?? CLEAN]));

describe('closesOutsideRange', () => {
  it('passes a symbol whose closes are all within their days', () => {
    expect(closesOutsideRange(symbol(), WINDOW)).toEqual([]);
  });

  describe('the same quirk (a close under the low)', () => {
    it('passes on a recent bar: a data run can still correct it', () => {
      expect(closesOutsideRange(symbol({ '2026-11-13': QUIRK }), WINDOW)).toEqual([]); // the newest
      expect(closesOutsideRange(symbol({ '2026-11-12': QUIRK }), WINDOW)).toEqual([]);
      expect(closesOutsideRange(symbol({ '2026-11-09': QUIRK }), WINDOW)).toEqual([]); // the fifth newest: the last one inside
    });

    it('fails on an older bar: no run will touch that day again', () => {
      expect(closesOutsideRange(symbol({ '2026-11-06': QUIRK }), WINDOW)).toEqual(['2026-11-06']); // the sixth newest: the first one outside
      expect(closesOutsideRange(symbol({ '2026-11-05': QUIRK }), WINDOW)).toEqual(['2026-11-05']);
      expect(closesOutsideRange(symbol({ '2026-11-02': QUIRK }), WINDOW)).toEqual(['2026-11-02']); // the oldest
    });

    it('is judged by its place on file at every position, with the line drawn between the fifth and sixth newest', () => {
      const verdicts = DATES.map((d) => closesOutsideRange(symbol({ [d]: QUIRK }), WINDOW).length === 0 ? 'passes' : 'fails');
      expect(verdicts).toEqual([...Array(DATES.length - WINDOW).fill('fails'), ...Array(WINDOW).fill('passes')]);
    });
  });

  it('reports only the older of two quirks on one symbol', () => {
    expect(closesOutsideRange(symbol({ '2026-11-04': QUIRK, '2026-11-13': QUIRK }), WINDOW)).toEqual(['2026-11-04']);
  });

  it('lists every older quirk, oldest first', () => {
    expect(closesOutsideRange(symbol({ '2026-11-05': QUIRK, '2026-11-03': QUIRK }), WINDOW)).toEqual(['2026-11-03', '2026-11-05']);
  });

  it('counts days on file, not calendar days: a holiday gap does not shorten the window', () => {
    // The newest five here are 22 to 29 Dec, eight calendar days, because of Christmas.
    const dates = ['2026-12-18', '2026-12-21', '2026-12-22', '2026-12-23', '2026-12-24', '2026-12-28', '2026-12-29'];
    expect(closesOutsideRange(symbol({ '2026-12-22': QUIRK }, dates), WINDOW)).toEqual([]);
    expect(closesOutsideRange(symbol({ '2026-12-21': QUIRK }, dates), WINDOW)).toEqual(['2026-12-21']);
  });

  it('passes a symbol with no more days than the window: nothing on it is older', () => {
    const young = ['2026-11-11', '2026-11-12', '2026-11-13'];
    expect(closesOutsideRange(symbol({ '2026-11-11': QUIRK }, young), WINDOW)).toEqual([]);
    const exact = DATES.slice(-WINDOW);
    expect(closesOutsideRange(symbol({ [exact[0]]: QUIRK }, exact), WINDOW)).toEqual([]);
  });

  it('keeps a close equal to the low or to the high inside, and a close over the high outside', () => {
    expect(closesOutsideRange(symbol({ '2026-11-03': [38.44, 39.8, 38.44, 38.96], '2026-11-04': [38.0, 39.8, 39.8, 38.9] }), WINDOW)).toEqual([]);
    expect(closesOutsideRange(symbol({ '2026-11-03': [38.0, 39.0, 39.5, 38.9] }), WINDOW)).toEqual(['2026-11-03']);
  });

  it('does not read the open: only the close is held to low-high', () => {
    expect(closesOutsideRange(symbol({ '2026-11-03': [38.4, 39.8, 39.2, 41.0], '2026-11-04': [38.4, 39.8, 39.2] }), WINDOW)).toEqual([]);
  });

  it('with a window of none is the strict check', () => {
    expect(closesOutsideRange(symbol({ '2026-11-13': QUIRK }), 0)).toEqual(['2026-11-13']);
  });

  it('refuses a window that is not a whole number of days, which would let every quirk through unseen', () => {
    for (const bad of [NaN, -1, 2.5, Infinity]) expect(() => closesOutsideRange(symbol({ '2026-11-02': QUIRK }), bad)).toThrow(RangeError);
  });
});

describe('reviseDaysOf', () => {
  it('reads the number from the line that sets it', () => {
    expect(reviseDaysOf('A = 1\nREVISE_DAYS = 7\nB = 2\n')).toBe(7);
    expect(reviseDaysOf('REVISE_DAYS=3  # days\n')).toBe(3);
  });

  it('ignores a mention that is not the setting: a comment, an indented line, a fraction', () => {
    for (const text of ['# REVISE_DAYS = 9\n', '    REVISE_DAYS = 9\n', 'REVISE_DAYS = 3.5\n', 'OLD_REVISE_DAYS = 9\n', 'REVISE_DAYS = five\n']) {
      expect(() => reviseDaysOf(text), text).toThrow(/REVISE_DAYS/);
    }
  });

  it('fails loudly, naming the script, where the data job no longer sets one', () => {
    expect(() => reviseDaysOf('print("no window here")')).toThrow(/fetch_bars\.py/);
  });

  it('finds a whole number of days, at least one, in the data job itself', () => {
    const n = reviseDaysOf(readFileSync(new URL('../../scripts/fetch_bars.py', import.meta.url), 'utf8'));
    expect(Number.isInteger(n) && n >= 1).toBe(true);
  });
});
