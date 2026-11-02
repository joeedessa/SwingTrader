import { describe, expect, it } from 'vitest';
import { cellOf, COLUMNS, DEFAULT_SORT, isChips, LIVE_SORT, nextSort, SYMBOL_SORT, sortRows } from '../../src/ui/columns';
import { isFiltered, marketsOf, matches, NO_FILTERS } from '../../src/ui/filters';
import { SECTIONS } from '../../src/engine/types';
import { sortValue } from '../../src/ui/cells';
import { frozenBoard, TODAY } from './frozen';

describe('columns', () => {
  it('every section keeps a handful of columns, and the default sort names one of them', () => {
    for (const s of SECTIONS) {
      const cols = COLUMNS[s];
      expect(cols.length, s).toBeGreaterThanOrEqual(2);
      expect(cols.length, s).toBeLessThanOrEqual(6);
      expect(cols.map(c => c.key), s).toContain(DEFAULT_SORT[s][0]);
      expect(new Set(cols.map(c => c.key)).size, s).toBe(cols.length);
    }
  });

  it('the sections keep what A4 of the plan says they keep', () => {
    const keys = (s: (typeof SECTIONS)[number]) => COLUMNS[s].map(c => c.label);
    expect(keys('watch')).toEqual(['Trigger', 'Target', 'Reward : risk', 'Tight stop', 'Flags']);
    expect(keys('breakout')).toEqual(['Trigger', 'Target', 'Type', 'Tight stop', 'Negation', 'Flags']);
    expect(keys('reentered')).toEqual(['Trigger', 'Status', 'Breaches', 'Target', 'Flags']);
    expect(keys('stopped')).toEqual(['Trigger', 'Breaches', 'Negation', 'Flags']);
    expect(keys('target')).toEqual(['Reached', 'Type', 'Target', 'Since target']);
    expect(keys('failed')).toEqual(['Failed', 'Negation', 'Reason', 'Still listed by source']);
    expect(keys('removed')).toEqual(['Trigger', 'Removed']);
  });

  it('the Flags column closes the four sections that are still in play, and no other', () => {
    const withFlags = SECTIONS.filter(s => COLUMNS[s].some(isChips));
    expect(withFlags).toEqual(['watch', 'breakout', 'reentered', 'stopped']);
    for (const s of withFlags) expect(COLUMNS[s][COLUMNS[s].length - 1].key, s).toBe('flags');
  });

  it('every cell of every column renders for every row in its section', () => {
    for (const s of SECTIONS) {
      for (const r of frozenBoard().bySection[s]) {
        for (const c of COLUMNS[s]) expect(typeof cellOf(c, r, s, TODAY).value, `${s} ${c.key} ${r.p.sym}`).toBe('string');
      }
    }
  });
});

describe('sorting', () => {
  const rows = frozenBoard().bySection.breakout;

  it('opens each section on its own question: the nearest tight stop first for Confirmed', () => {
    const sorted = sortRows(rows, 'breakout', DEFAULT_SORT.breakout);
    expect(sorted[0].p.sym).toBe('TVE.TO');
    const known = sorted.map(r => sortValue(r, 'lfd')).filter((x): x is number => typeof x === 'number');
    expect(known.length).toBeGreaterThan(1);       // enough to say anything about the order
    expect(known).toEqual([...known].sort((a, b) => a - b));
  });

  it('puts a row with nothing to sort by last, whichever way it runs', () => {
    const asc = sortRows(rows, 'breakout', ['lfd', true]);
    const desc = sortRows(rows, 'breakout', ['lfd', false]);
    const none = (r: (typeof rows)[number]) => !(r.lfd && r.lfd.at != null && !r.lfd.looser && r.live);
    expect(none(asc[asc.length - 1])).toBe(true);
    expect(none(desc[desc.length - 1])).toBe(true);
    expect(none(asc[0])).toBe(false);
  });

  it('orders text alphabetically and does not touch the input', () => {
    const copy = rows.slice();
    const sorted = sortRows(rows, 'breakout', [SYMBOL_SORT, true]);
    expect(sorted.map(r => r.p.sym)).toEqual(copy.map(r => r.p.sym).sort((a, b) => a.localeCompare(b)));
    expect(rows).toEqual(copy);
  });

  it('leaves a column that does not sort in place', () => {
    const failed = frozenBoard().bySection.failed;
    expect(sortRows(failed, 'failed', ['reason', true]).map(r => r.p.sym)).toEqual(failed.map(r => r.p.sym));
  });

  it('a header click flips the same column, and a new one starts the way its type reads best', () => {
    expect(nextSort('breakout', ['lfd', true], 'lfd')).toEqual(['lfd', false]);
    expect(nextSort('breakout', ['lfd', true], 'type')).toEqual(['type', true]);        // text: A to Z
    expect(nextSort('breakout', ['lfd', true], 'target')).toEqual(['target', false]);   // upside: biggest first
    expect(nextSort('watch', ['lfd', true], 'trigger')).toEqual(['trigger', true]);     // a distance: nearest first
    expect(nextSort('breakout', ['lfd', true], SYMBOL_SORT)).toEqual([SYMBOL_SORT, true]);
    expect(nextSort('breakout', ['lfd', true], LIVE_SORT)).toEqual([LIVE_SORT, false]);
  });
});

describe('filters', () => {
  const all = frozenBoard().rows;

  it('search matches the symbol or the name, in any case', () => {
    expect(all.filter(r => matches(r, { ...NO_FILTERS, q: 'tamarack' })).map(r => r.p.sym)).toEqual(['TVE.TO']);
    expect(all.filter(r => matches(r, { ...NO_FILTERS, q: ' ame ' })).map(r => r.p.sym)).toContain('AME');
    expect(all.filter(r => matches(r, { ...NO_FILTERS, q: 'zzz' }))).toEqual([]);
  });

  it('direction and market narrow it, and combine', () => {
    const shorts = all.filter(r => matches(r, { ...NO_FILTERS, dir: 'short' }));
    expect(shorts.length).toBeGreaterThan(5);
    expect(shorts.every(r => r.p.dir === 'short')).toBe(true);
    const canada = all.filter(r => matches(r, { ...NO_FILTERS, markets: ['Canada'] }));
    expect(canada.every(r => r.p.country === 'Canada')).toBe(true);
    const both = all.filter(r => matches(r, { q: '', dir: 'long', markets: ['Canada', 'Norway'] }));
    expect(both.every(r => r.p.dir === 'long' && (r.p.country === 'Canada' || r.p.country === 'Norway'))).toBe(true);
  });

  it('says whether anything is filtered', () => {
    expect(isFiltered(NO_FILTERS)).toBe(false);
    expect(isFiltered({ ...NO_FILTERS, q: ' ' })).toBe(false);
    expect(isFiltered({ ...NO_FILTERS, q: 'a' })).toBe(true);
    expect(isFiltered({ ...NO_FILTERS, dir: 'long' })).toBe(true);
    expect(isFiltered({ ...NO_FILTERS, markets: ['US'] })).toBe(true);
  });

  it('lists the markets with their counts, alphabetically', () => {
    const m = marketsOf(all);
    expect(m.map(x => x.name)).toEqual([...m.map(x => x.name)].sort((a, b) => a.localeCompare(b)));
    expect(m.find(x => x.name === 'Canada')).toEqual({ name: 'Canada', n: all.filter(r => r.p.country === 'Canada').length });
    expect(m.reduce((n, x) => n + x.n, 0)).toBe(all.filter(r => r.p.country).length);
  });
});
