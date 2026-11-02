import { beforeEach, describe, expect, it } from 'vitest';
import { closeFor, forgetFetched } from '../../src/data/journal';
import type { History } from '../../src/engine/types';

const hist = (closes: [string, number][]): History => ({ settled: closes, live: null, liveDate: '', currency: 'USD' });

/** A Worker that answers one v8 chart request for each symbol it is given bars for, and counts the requests. */
function fakeWorker(days: Record<string, [string, number][]>) {
  const calls: string[] = [];
  const fetch = async (url: string) => {
    calls.push(url);
    const sym = decodeURIComponent((/chart\/([^?]+)/.exec(decodeURIComponent(url)) || /chart%2F([^%?]+)/.exec(url) || [])[1] || '');
    const rows = days[sym];
    if (!rows) return { ok: false, status: 404, json: async () => ({}) };
    return {
      ok: true, status: 200,
      json: async () => ({ chart: { result: [{
        meta: { currency: 'USD' },
        timestamp: rows.map(([d]) => Date.parse(d + 'T21:00:00Z') / 1000),
        indicators: { quote: [{ low: rows.map(r => r[1] - 1), high: rows.map(r => r[1] + 1), close: rows.map(r => r[1]) }] },
      }] } }),
    };
  };
  return { fetch, calls };
}

beforeEach(forgetFetched);

describe('the price a fill starts with', () => {
  it('reads a symbol on the lists from the closes already loaded, without asking anyone', async () => {
    const w = fakeWorker({});
    const h = { AME: hist([['2026-10-29', 10], ['2026-10-30', 11]]) };
    expect(await closeFor('AME', '2026-10-30', h, { fetch: w.fetch })).toEqual({ date: '2026-10-30', close: 11 });
    expect(await closeFor('AME', '2026-11-01', h, { fetch: w.fetch })).toEqual({ date: '2026-10-30', close: 11 });
    expect(w.calls).toEqual([]);
  });

  it('asks once for any other symbol and keeps the answer for the visit', async () => {
    const w = fakeWorker({ GDX: [['2026-10-28', 60], ['2026-10-29', 61], ['2026-10-30', 62]] });
    const env = { local: false, base: '/' };
    expect(await closeFor('GDX', '2026-10-29', {}, { fetch: w.fetch, env })).toEqual({ date: '2026-10-29', close: 61 });
    expect(await closeFor('GDX', '2026-10-30', {}, { fetch: w.fetch, env })).toEqual({ date: '2026-10-30', close: 62 });
    expect(w.calls).toHaveLength(1);
  });

  it('is nothing when Yahoo has no history for the symbol, and tries again next time', async () => {
    const w = fakeWorker({});
    const env = { local: false, base: '/' };
    expect(await closeFor('NOPE', '2026-10-29', {}, { fetch: w.fetch, env })).toBeNull();
    expect(await closeFor('NOPE', '2026-10-29', {}, { fetch: w.fetch, env })).toBeNull();
    expect(w.calls).toHaveLength(2);
  });

  it('is nothing for a date before the history starts', async () => {
    const h = { AME: hist([['2026-10-29', 10]]) };
    expect(await closeFor('AME', '2026-01-01', h)).toBeNull();
  });
});
