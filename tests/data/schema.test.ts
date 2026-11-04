import { describe, expect, it } from 'vitest';
import { parseEvents, parseSetups } from '../../src/data/schema';
import watchlist from '../../public/data/watchlist.json';
import benchmarks from '../../public/data/benchmarks.json';

describe('parseSetups', () => {
  it('accepts every row of the shared watchlist and benchmarks, unchanged except for the legacy fields', () => {
    for (const [name, file] of [['watchlist.json', watchlist], ['benchmarks.json', benchmarks]] as const) {
      const { rows, problems } = parseSetups(file, name);
      expect(problems).toEqual([]);
      expect(rows).toHaveLength((file as unknown[]).length);
      rows.forEach((r, i) => {
        const raw = { ...(file as Record<string, unknown>[])[i] };
        for (const f of ['state', 'hold', 'alert', 'alertOp']) delete raw[f];
        expect(r).toEqual(raw);
      });
    }
  });

  it('strips the fields the engine never reads, so they cannot move a row', () => {
    const { rows } = parseSetups([{ sym: 'X', dir: 'long', state: 'breakout', hold: true, alert: 5, alertOp: '>', target: 9 }], 'f');
    expect(rows[0]).toEqual({ sym: 'X', dir: 'long', target: 9 });
  });

  it('keeps unset and null apart: a missing lfd is derived, lfd 0 is "none published"', () => {
    const { rows } = parseSetups([{ sym: 'A', dir: 'long' }, { sym: 'B', dir: 'long', lfd: 0 }, { sym: 'C', dir: 'long', negation: null }], 'f');
    expect('lfd' in rows[0]).toBe(false);
    expect(rows[1].lfd).toBe(0);
    expect(rows[2].negation).toBeNull();
  });

  it('reports and drops what cannot be a setup', () => {
    const { rows, problems } = parseSetups([
      { sym: 'OK', dir: 'short' },
      { dir: 'long' },
      { sym: 'BAD', dir: 'up' },
      { sym: 'OK', dir: 'short' },
      'text',
      null,
    ], 'f.json');
    expect(rows.map(r => r.sym)).toEqual(['OK']);
    expect(problems).toHaveLength(5);
    expect(problems[0]).toContain('f.json[1]');
  });

  it('treats a non-numeric level or a malformed date as unset, and says so', () => {
    const { rows, problems } = parseSetups([{ sym: 'X', dir: 'long', target: '12.5', negation: NaN, created: '08/08/2026', removed: '2026-10-31', source_open: 'x' }], 'f');
    expect(rows[0]).toMatchObject({ target: null, negation: null, created: null, removed: '2026-10-31' });
    expect('source_open' in rows[0]).toBe(false);
    expect(problems).toHaveLength(4);
  });

  it('rejects a file that is not a list', () => {
    expect(parseSetups({ rows: [] }, 'f').problems).toEqual(['f: expected a list of setups']);
  });
});

describe('parseEvents', () => {
  it('reads {symbols}, and treats anything else as an empty feed', () => {
    expect(parseEvents({ generated_at: 'x', symbols: { A: { atr: 1 } } })).toEqual({ generated_at: 'x', symbols: { A: { atr: 1 } } });
    expect(parseEvents(null)).toEqual({ symbols: {} });
    expect(parseEvents([])).toEqual({ symbols: {} });
    expect(parseEvents({ symbols: [] })).toEqual({ symbols: {} });
  });
});

describe('bars.json as the page reads it', () => {
  it('keeps every bar with prices in it, three or four values, and a null close', async () => {
    const { parseBars } = await import('../../src/data/schema');
    const r = parseBars({ generated_at: '2026-11-04T04:47:17Z', missing: ['HLX'], ccy: { AME: 'USD' }, bars: { AME: { '2026-11-02': [1, 2, 1.5], '2026-11-03': [1, 2, 1.5, 1.2], '2026-11-04': [1, 2, null, 1.1] } } });
    expect(r.problems).toEqual([]);
    expect(r.file).toEqual({ generated_at: '2026-11-04T04:47:17Z', missing: ['HLX'], ccy: { AME: 'USD' }, bars: { AME: { '2026-11-02': [1, 2, 1.5], '2026-11-03': [1, 2, 1.5, 1.2], '2026-11-04': [1, 2, null, 1.1] } } });
  });

  it('leaves out a bar with a zero or nothing in it, and says which, since a low of zero would touch every negation', async () => {
    const { parseBars } = await import('../../src/data/schema');
    const r = parseBars({ bars: { '^OMXC25': { '2026-10-30': [1968.58, 1981.61, 1974.38, 1976.04], '2026-11-03': [0, 0, 1990.4, 0] }, X: { '2026-11-03': [-1, 2, 1.5], '2026-11-04': 'nope', '2026-11-05': [1, 2] }, Y: 7 } });
    expect(r.file!.bars).toEqual({ '^OMXC25': { '2026-10-30': [1968.58, 1981.61, 1974.38, 1976.04] } });
    expect(r.problems).toEqual([
      'bars.json ^OMXC25 2026-11-03: a bar with no price in it was left out',
      'bars.json X 2026-11-03: a bar with no price in it was left out',
      'bars.json X 2026-11-04: a bar with no price in it was left out',
      'bars.json X 2026-11-05: a bar with no price in it was left out',
      'bars.json Y: not a map of days; left out',
    ]);
    expect(r.file!.generated_at).toBe('');
    expect(r.file!.missing).toEqual([]);
  });

  it('is no file at all when the shape is wrong', async () => {
    const { parseBars } = await import('../../src/data/schema');
    expect(parseBars(null)).toEqual({ file: null, problems: ['bars.json: not an object'] });
    expect(parseBars({ ccy: {} })).toEqual({ file: null, problems: ['bars.json: no bars'] });
  });
});
