import { describe, expect, it } from 'vitest';
import { DEFAULT_ROUTE, hashFor, PAGES, parseHash } from '../src/router';

describe('routes', () => {
  it('open on Today, and fall back to it for an address nobody knows', () => {
    expect(DEFAULT_ROUTE).toEqual({ page: 'today', row: null });
    for (const h of ['', '#', '#/', '#/nonsense', '#/method', '#//']) expect(parseHash(h), h).toEqual(DEFAULT_ROUTE);
  });

  it('know the pages that exist, Today first', () => {
    expect(PAGES).toEqual(['today', 'setups', 'benchmarks']);
    for (const page of PAGES) expect(parseHash('#/' + page)).toEqual({ page, row: null });
  });

  it('open a setup over any of them, so a trip into a drawer leaves the page it came from', () => {
    for (const page of PAGES) {
      expect(parseHash(`#/${page}/AME/long`)).toEqual({ page, row: { sym: 'AME', dir: 'long' } });
      expect(parseHash(`#/${page}/BANKINDIA.NS/short`)).toEqual({ page, row: { sym: 'BANKINDIA.NS', dir: 'short' } });
    }
  });

  it('round-trip, whatever characters a symbol has', () => {
    for (const sym of ['AME', '^GSPC', 'GC=F', 'ROKO-B.ST', '0135.HK', 'DX-Y.NYB', 'A B']) {
      for (const page of PAGES) {
        const r = { page, row: { sym, dir: 'short' as const } };
        expect(parseHash(hashFor(r)), sym).toEqual(r);
      }
    }
    expect(hashFor({ page: 'today', row: null })).toBe('#/today');
    expect(hashFor({ page: 'setups', row: { sym: 'GC=F', dir: 'long' } })).toBe('#/setups/GC%3DF/long');
  });

  it('ignore a half-written setup: it is the page, not a drawer', () => {
    expect(parseHash('#/today/AME')).toEqual({ page: 'today', row: null });
    expect(parseHash('#/today/AME/sideways')).toEqual({ page: 'today', row: null });
    expect(parseHash('#/today/%E0%A4%A/long')).toEqual({ page: 'today', row: null });
  });
});
