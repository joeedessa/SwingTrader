import { describe, expect, it } from 'vitest';
import { earningsReaction, earningsView, fmtBig, hasEarningsCard, HEADLINES } from '../../src/engine/earnings';
import type { History, SymbolEvents } from '../../src/engine/types';

const hist = (closes: [string, number][]): History => ({ settled: closes, live: null, liveDate: '', currency: 'USD' });
const H = hist([['2026-08-10', 100], ['2026-08-11', 100], ['2026-08-12', 110], ['2026-08-13', 99], ['2026-08-14', 99]]);

describe('large figures', () => {
  it('are written the way the old page wrote them', () => {
    expect(fmtBig(2_073_000_000)).toBe('2.07bn');
    expect(fmtBig(42_856_000_000)).toBe('42.86bn');
    expect(fmtBig(1_500_000_000_000)).toBe('1.50tn');
    expect(fmtBig(12_300_000)).toBe('12.3m');
    expect(fmtBig(4_500)).toBe('4.5k');
    expect(fmtBig(950)).toBe('950');
    expect(fmtBig(-2_500_000)).toBe('-2.5m');
    expect(fmtBig(null)).toBeNull();
  });
});

describe('how the market took the last report', () => {
  it('reads a result released after the close on the next session', () => {
    expect(earningsReaction(H, { reported: '2026-08-11', when: 'after close' })).toEqual({ pct: 10, when: '2026-08-12' });
  });

  it('reads a result with no slot as released after the close, the old page\'s reading', () => {
    expect(earningsReaction(H, { reported: '2026-08-11' })).toEqual({ pct: 10, when: '2026-08-12' });
  });

  it('reads one released before the open, or during the session, on the same day', () => {
    expect(earningsReaction(H, { reported: '2026-08-12', when: 'before open' })).toEqual({ pct: 10, when: '2026-08-12' });
    expect(earningsReaction(H, { reported: '2026-08-12', when: 'during session' })).toEqual({ pct: 10, when: '2026-08-12' });
  });

  it('is a move to one decimal, and may be a fall', () => {
    expect(earningsReaction(H, { reported: '2026-08-12', when: 'after close' })).toEqual({ pct: -10, when: '2026-08-13' });
  });

  it('is nothing without a date, without closes, or when the traded session is not in the history yet', () => {
    expect(earningsReaction(H, { when: 'after close' })).toBeNull();
    expect(earningsReaction(null, { reported: '2026-08-11' })).toBeNull();
    expect(earningsReaction(H, null)).toBeNull();
    expect(earningsReaction(H, { reported: '2026-08-14', when: 'after close' })).toBeNull();
    // Reported before the history starts: there is no close before it to measure the move from.
    expect(earningsReaction(H, { reported: '2026-08-10', when: 'before open' })).toBeNull();
  });
});

const EV: SymbolEvents = {
  sector: 'Utilities', earnings: '2026-11-20', earnings_when: 'after close',
  last_eps: { reported: '2026-08-11', when: 'after close', actual: 8.43, estimate: 2.18, surprise_pct: 286.7, revenue: 2_073_000_000, revenue_est: 2_267_865_000, revenue_surprise_pct: -8.6, eps_yoy: 12.5 },
  next_est: { eps: 1.77, revenue: 2_400_783_000 },
  target_avg: 120, ratings: { buy: 3, over: 1, hold: 2, under: 1, sell: 0, total: 7 },
  wire: { cues: ['beat', 'guidance cut', 'dividend/buyback'], heads: Array.from({ length: 6 }, (_, i) => ({ t: 'Headline ' + i, u: 'https://example.com/' + i, d: '2026-08-1' + i, s: 'Wire' })) },
};

describe('the card', () => {
  const v = earningsView(EV, { live: 100, target: 130, next: '2026-11-20', hist: H });

  it('says what the last report delivered against what was expected, and how it was taken', () => {
    expect(v.last).toEqual({
      reported: '2026-08-11', when: 'after close',
      eps: { actual: 8.43, estimate: 2.18, surprise: { value: 286.7, good: true } },
      revenue: { actual: 2_073_000_000, estimate: 2_267_865_000, surprise: { value: -8.6, good: false } },
      epsYoy: { value: 12.5, good: true },
      reaction: { pct: 10, when: '2026-08-12', good: true },
    });
  });

  it('classifies the language of the headlines it shows, and shows only the first few, as published', () => {
    expect(v.wire!.cues).toEqual([{ text: 'beat', tone: 'good' }, { text: 'guidance cut', tone: 'bad' }, { text: 'dividend/buyback', tone: 'plain' }]);
    expect(v.wire!.heads).toHaveLength(HEADLINES);
    expect(v.wire!.heads[0]).toEqual({ t: 'Headline 0', u: 'https://example.com/0', d: '2026-08-10', s: 'Wire' });
  });

  it('says what the street expects next', () => {
    expect(v.next).toEqual({ date: '2026-11-20', when: 'after close', eps: 1.77, revenue: 2_400_783_000 });
  });

  it('puts the street\'s target against the price now and against yours, and counts the analysts', () => {
    expect(v.street).toEqual({
      targetAvg: 120, vsLive: { value: 20, good: true },
      yours: { target: 130, streetIs: 'below' },
      analysts: { total: 7, bullish: 4, hold: 2, bearish: 1 },
    });
    expect(earningsView(EV, { live: 100, target: 110, next: null, hist: H }).street!.yours).toEqual({ target: 110, streetIs: 'above' });
  });

  it('dates the latest activity: the newest of the last report and the newest headline', () => {
    expect(v.latest).toBe('2026-08-15');
    expect(earningsView({ last_eps: { reported: '2026-09-01' } }, { live: null, target: null, next: null, hist: null }).latest).toBe('2026-09-01');
  });

  it('leaves out what the feed does not have, and has no card for a name with nothing to say', () => {
    const bare = earningsView({ sector: 'Energy', atr: 1.2 }, { live: 10, target: 12, next: null, hist: H });
    expect(bare).toMatchObject({ last: null, wire: null, street: null, latest: null });
    expect(hasEarningsCard(bare)).toBe(false);
    expect(hasEarningsCard(v)).toBe(true);
    expect(hasEarningsCard(earningsView({}, { live: 1, target: 1, next: '2026-11-20', hist: null }))).toBe(true);
  });

  it('keeps a missing estimate missing, so the page can say there is no consensus on file', () => {
    const noEst = earningsView({ last_eps: { reported: '2026-08-11', actual: 1.2, revenue: 5_000_000 } }, { live: null, target: null, next: null, hist: H });
    expect(noEst.last!.eps).toEqual({ actual: 1.2, estimate: null, surprise: null });
    expect(noEst.last!.revenue).toEqual({ actual: 5_000_000, estimate: null, surprise: null });
  });

  it('has no street view without a target or any analysts, and no analyst line without a total', () => {
    expect(earningsView({ ratings: { buy: 0, total: 0 } }, { live: 1, target: 1, next: null, hist: null }).street).toBeNull();
    expect(earningsView({ target_avg: 50 }, { live: null, target: null, next: null, hist: null }).street).toEqual({ targetAvg: 50, vsLive: null, yours: null, analysts: null });
  });
});
