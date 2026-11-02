import { describe, expect, it } from 'vitest';
import {
  ackable, activeStop, badgeCount, boardFlags, dataFlags, expired, flagId, inTrade, parseFlagId, RULES,
  sessionsSince, setupFlags, sortFlags, THRESHOLDS, weekdaysBetween,
} from '../../src/engine/flags';
import type { Flag, FlagContext, FlagKind } from '../../src/engine/flags';
import { setupEvents } from '../../src/engine/events';
import { evaluate } from '../../src/engine/row';
import type { Row } from '../../src/engine/row';
import type { Setup, SymbolEvents } from '../../src/engine/types';
import { LONG, series, SHORT } from './helpers';
import type { Day } from './helpers';
import { frozenBoard, TODAY } from '../ui/frozen';

const CTX: FlagContext = { today: '2026-01-20', nowMs: Date.parse('2026-01-20T12:00:00Z'), page: 'setups' };

const rowOf = (p: Setup, days: Day[], ev: SymbolEvents = {}, live?: { price: number; date: string }): Row => {
  const { bars, hist } = series(days, live);
  return evaluate(p, hist, bars, ev, CTX.today);
};
const flagsOf = (r: Row, ctx: FlagContext = CTX) => setupFlags(r, ctx);
const ofKind = (fs: Flag[], kind: FlagKind) => fs.filter(f => f.kind === kind);

// Waiting: closed past the 97 boundary on 01-06, last close 98 on 01-07, trigger 100.
const WAIT: Day[] = [
  ['2026-01-05', 94, 96, 95],
  ['2026-01-06', 95, 98, 97.5],
  ['2026-01-07', 96, 99, 98],
];
// Confirmed on 01-08 (B1), last close 104 on 01-09. Derived stop: the 01-05 low, 94.
const B1: Day[] = [...WAIT, ['2026-01-08', 97.5, 101, 100.5], ['2026-01-09', 101, 105, 104]];
// The B1 → B2 → B3 path, with the report's stop at 94: pullbacks 01-12 and 01-15, exit 01-16, re-entry 01-19.
const PATH: Day[] = [...B1,
  ['2026-01-12', 99.5, 103, 102],
  ['2026-01-13', 99, 102, 101],
  ['2026-01-14', 100.5, 106, 105],
  ['2026-01-15', 98, 101, 100.2],
  ['2026-01-16', 93, 99, 97],
  ['2026-01-19', 95, 102, 101],
];
const P = { ...LONG, lfd: 94 };

describe('the rule table is the plan\'s (A2)', () => {
  it('has the 19 kinds in order, with their tiers, surfaces and how they clear', () => {
    expect(Object.keys(RULES)).toEqual([
      'breakout', 'reentry', 'exit', 'failed', 'target', 'live-negation', 'live-stop', 'exdiv-2d',
      'live-trigger', 'near-trigger', 'near-stop', 'pullback', 'boundary', 'late-entry', 'earnings-7d', 'exdiv-7d', 'source-kept',
      'removed', 'data',
    ]);
    const tiers = Object.fromEntries(Object.entries(RULES).map(([k, r]) => [k, r.tier]));
    expect(Object.entries(tiers).filter(([, t]) => t === 'act').map(([k]) => k)).toEqual(['breakout', 'reentry', 'exit', 'failed', 'target', 'live-negation', 'live-stop', 'exdiv-2d']);
    expect(Object.entries(tiers).filter(([, t]) => t === 'info').map(([k]) => k)).toEqual(['removed', 'data']);
    expect(Object.entries(RULES).filter(([, r]) => r.live).map(([k]) => k)).toEqual(['live-negation', 'live-stop', 'live-trigger']);
    expect(Object.entries(RULES).filter(([, r]) => r.clears === 'ack').map(([k]) => k)).toEqual(['breakout', 'reentry', 'exit', 'failed', 'target', 'pullback', 'boundary', 'removed']);
    expect(RULES['late-entry'].surfaces).toEqual(['setups']);
    expect(RULES['source-kept'].surfaces).toEqual(['history']);
    expect(RULES.data.surfaces).toEqual(['today', 'method']);
  });

  it('names its thresholds', () => {
    expect(THRESHOLDS).toEqual({ nearAtr: 1, lateUsed: 0.5, dividendAtr: 0.25, exdivActDays: 2, exdivWatchDays: 7, earningsDays: 7, sourceSheets: 2, staleTipHours: 6, expirySessions: 5, expiryWeekdays: 10 });
  });
});

/* ------------------------------------------------------------------ Act */

describe('1. breakout', () => {
  it('is the first settled close strictly past the trigger, dated that day', () => {
    const [f] = ofKind(flagsOf(rowOf(LONG, B1)), 'breakout');
    expect(f).toMatchObject({ id: 'X|long|breakout|2026-01-08', tier: 'act', clears: 'ack', when: '2026-01-08', route: '#/setups/X/long', surfaces: ['today', 'setups'] });
    expect(f.text).toBe('X long — BREAKOUT CONFIRMED: closed above the trigger at 100.5 (trigger 100)');
  });

  it('is not raised for a setup imported already confirmed: that breakout happened before the list', () => {
    expect(ofKind(flagsOf(rowOf({ ...LONG, confirmed: '2026-01-09' }, B1)), 'breakout')).toEqual([]);
  });
});

describe('2. reentry and 3. exit', () => {
  it('a touch of the last full day is exit N, a close back past the trigger is re-entry N, each dated', () => {
    const fs = flagsOf(rowOf(P, PATH));
    expect(ofKind(fs, 'exit').map(f => [f.id, f.n, f.tier])).toEqual([['X|long|exit|2026-01-16', 1, 'act']]);
    expect(ofKind(fs, 'reentry').map(f => [f.id, f.n, f.tier])).toEqual([['X|long|reentry|2026-01-19', 1, 'act']]);
    expect(ofKind(fs, 'exit')[0].surfaces).toEqual(['today', 'positions']);
    expect(ofKind(fs, 'reentry')[0].text).toBe('X long — re-entry 1: closed 101 above the trigger 100. Stop back at the last full day 94');
  });
});

describe('4. failed', () => {
  it('is the negation touched after the breakout (B4)', () => {
    const [f] = ofKind(flagsOf(rowOf(LONG, [...B1, ['2026-01-12', 89, 99, 95]])), 'failed');
    expect(f).toMatchObject({ id: 'X|long|failed|2026-01-12', tier: 'act', surfaces: ['today', 'history'] });
    expect(f.text).toBe('X long — failed breakout: touched 89 vs negation 90 (B4)');
  });
});

describe('5. target', () => {
  it('is a settled close at or past the target', () => {
    const [f] = ofKind(flagsOf(rowOf(LONG, [...B1, ['2026-01-12', 110, 121, 120]])), 'target');
    expect(f).toMatchObject({ id: 'X|long|target|2026-01-12', tier: 'act' });
    expect(f.text).toBe('X long — reached its target on the close (120 vs target 120)');
  });

  it('or the source\'s `reached` date, which the old log left out', () => {
    const [f] = ofKind(flagsOf(rowOf({ ...LONG, reached: '2026-01-12' }, [...B1, ['2026-01-12', 110, 119.9, 119.8]])), 'target');
    expect(f).toMatchObject({ id: 'X|long|target|2026-01-12' });
    expect(f.text).toBe('X long — reached its target per the source (12-01-26); our closes fell just short of 120');
  });
});

describe('6. live-negation', () => {
  it('is a live price beyond the negation while in the trade, until the condition ends', () => {
    const [f] = ofKind(flagsOf(rowOf(LONG, B1, {}, { price: 89, date: '2026-01-12' })), 'live-negation');
    expect(f).toMatchObject({ id: 'X|long|live-negation|live', tier: 'act', when: 'live', clears: 'itself' });
    expect(ackable(f)).toBe(false);
    expect(ofKind(flagsOf(rowOf(LONG, B1, {}, { price: 91, date: '2026-01-12' })), 'live-negation')).toEqual([]);
  });

  it('is not raised on a stopped-out row, which has no position (the plan says in trade)', () => {
    const out = rowOf(P, PATH.slice(0, -1), {}, { price: 89, date: '2026-01-19' });
    expect(out.section).toBe('stopped');
    expect(setupEvents(out).some(e => e.kind === 'live-negation')).toBe(true);   // the old log raised it
    expect(ofKind(flagsOf(out), 'live-negation')).toEqual([]);
  });

  it('is not raised once the session has settled: then it is a failure or nothing', () => {
    expect(ofKind(flagsOf(rowOf(LONG, B1, {}, { price: 89, date: '2026-01-09' })), 'live-negation')).toEqual([]);
  });
});

describe('7. live-stop', () => {
  it('is a live price beyond the last full day while in the trade', () => {
    const [f] = ofKind(flagsOf(rowOf(LONG, B1, {}, { price: 93, date: '2026-01-12' })), 'live-stop');
    expect(f).toMatchObject({ id: 'X|long|live-stop|live', tier: 'act', clears: 'itself' });
    expect(f.text).toBe('X long — trading below its last full day low (93 vs 94): a touch is exit 1');
  });

  it('is not raised while out of the trade', () => {
    expect(ofKind(flagsOf(rowOf(P, PATH.slice(0, -1), {}, { price: 92, date: '2026-01-19' })), 'live-stop')).toEqual([]);
  });
});

describe('8. exdiv-2d and 16. exdiv-7d', () => {
  const div = (ex_div: string, div_amount = 0.5, atr = 1): SymbolEvents => ({ ex_div, div_amount, atr });

  it('a long in the trade, ex-date two days or fewer away, dividend at least a quarter of an ATR: Act', () => {
    const [f] = flagsOf(rowOf(LONG, B1, div('2026-01-22'))).filter(x => x.kind.startsWith('exdiv'));
    expect(f).toMatchObject({ id: 'X|long|exdiv-2d|2026-01-22', kind: 'exdiv-2d', tier: 'act', clears: 'itself', surfaces: ['today', 'positions'] });
    expect(f.text).toBe('X goes ex-dividend in 2 days (22-01-26): 0.5 is 50% of one ATR, so a 2×ATR stop loses 25% of its room to a drop that means nothing — widen to 101.5 until it has passed, then back to 102');
    expect(flagsOf(rowOf(LONG, B1, div('2026-01-20'))).find(x => x.kind === 'exdiv-2d')!.text).toContain('goes ex-dividend today');
  });

  it('three to seven days away: Watch; beyond that, nothing', () => {
    const k = (d: string) => flagsOf(rowOf(LONG, B1, div(d))).filter(x => x.kind.startsWith('exdiv')).map(x => [x.kind, x.tier]);
    expect(k('2026-01-23')).toEqual([['exdiv-7d', 'watch']]);
    expect(k('2026-01-27')).toEqual([['exdiv-7d', 'watch']]);
    expect(k('2026-01-28')).toEqual([]);
    expect(k('2026-01-19')).toEqual([]);           // passed
  });

  it('nothing for a small dividend, a short, a waiting row or a stopped-out one', () => {
    const none = (r: Row) => expect(flagsOf(r).filter(x => x.kind.startsWith('exdiv'))).toEqual([]);
    none(rowOf(LONG, B1, div('2026-01-22', 0.2)));                       // 0.2 ATR
    none(rowOf(SHORT, [['2026-01-05', 103, 107, 104], ['2026-01-06', 101, 105, 102.5], ['2026-01-07', 98, 103, 99.5]], div('2026-01-22')));
    none(rowOf(LONG, WAIT, div('2026-01-22')));
    none(rowOf(P, PATH.slice(0, -1), div('2026-01-22')));
  });

  it('a manual ex-dividend date wins over the feed\'s', () => {
    const r = rowOf({ ...LONG, ex_div: '2026-01-21' }, B1, div('2026-02-20'));
    expect(flagsOf(r).find(x => x.kind === 'exdiv-2d')!.id).toBe('X|long|exdiv-2d|2026-01-21');
  });
});

/* ------------------------------------------------------------------ Watch */

describe('9. live-trigger', () => {
  it('is a waiting row trading past its trigger while the session runs', () => {
    const [f] = ofKind(flagsOf(rowOf(LONG, WAIT, {}, { price: 100.5, date: '2026-01-08' })), 'live-trigger');
    expect(f).toMatchObject({ id: 'X|long|live-trigger|live', tier: 'watch', clears: 'itself', surfaces: ['today', 'setups'] });
    expect(ofKind(flagsOf(rowOf(LONG, WAIT, {}, { price: 100, date: '2026-01-08' })), 'live-trigger')).toEqual([]);   // on it is not past it
  });
});

describe('10. near-trigger', () => {
  it('is a waiting row whose last close is within 1.0 ATR of the trigger, read on that session', () => {
    const [f] = ofKind(flagsOf(rowOf(LONG, WAIT, { atr: 2.5 })), 'near-trigger');
    expect(f).toMatchObject({ id: 'X|long|near-trigger|2026-01-07', tier: 'watch', when: '2026-01-07' });
    expect(f.text).toBe('X long — last close 98 is 2 USD (0.8 ATR) from its trigger 100');
  });

  it('counts exactly one ATR, not more, and needs an ATR', () => {
    expect(ofKind(flagsOf(rowOf(LONG, WAIT, { atr: 2 })), 'near-trigger')).toHaveLength(1);
    expect(ofKind(flagsOf(rowOf(LONG, WAIT, { atr: 1.99 })), 'near-trigger')).toEqual([]);
    expect(ofKind(flagsOf(rowOf(LONG, WAIT)), 'near-trigger')).toEqual([]);
  });

  it('works the other way for a short', () => {
    const r = rowOf(SHORT, [['2026-01-05', 103, 107, 104], ['2026-01-06', 100.5, 102, 101]], { atr: 1.5 });
    expect(ofKind(flagsOf(r), 'near-trigger')[0].text).toBe('Y short — last close 101 is 1 USD (0.7 ATR) from its trigger 100');
  });
});

describe('11. near-stop', () => {
  it('is a row in the trade whose last close is within 1.0 ATR of its last full day', () => {
    const [f] = ofKind(flagsOf(rowOf(LONG, B1, { atr: 12 })), 'near-stop');
    expect(f).toMatchObject({ id: 'X|long|near-stop|2026-01-09', tier: 'watch', surfaces: ['today', 'positions'] });
    expect(f.text).toBe('X long — last close 104 is 10 USD (0.8 ATR) from its last full day 94');
    expect(ofKind(flagsOf(rowOf(LONG, B1, { atr: 5 })), 'near-stop')).toEqual([]);
  });

  it('measures to the negation where there is no last full day', () => {
    const [f] = ofKind(flagsOf(rowOf({ ...LONG, lfd: 0 }, B1, { atr: 15 })), 'near-stop');
    expect(f.text).toBe('X long — last close 104 is 14 USD (0.9 ATR) from its negation 90 (no last full day)');
    expect(activeStop(rowOf({ ...LONG, lfd: 0, negation: null }, B1))).toBeNull();
  });

  it('is not raised out of the trade', () => {
    expect(ofKind(flagsOf(rowOf(P, PATH.slice(0, -1), { atr: 50 })), 'near-stop')).toEqual([]);
    expect(ofKind(flagsOf(rowOf(LONG, WAIT, { atr: 50 })), 'near-stop')).toEqual([]);
  });
});

describe('12. pullback', () => {
  it('is pullback N through the trigger, dated the day it started', () => {
    const fs = ofKind(flagsOf(rowOf(P, PATH)), 'pullback');
    expect(fs.map(f => [f.id, f.n, f.tier, f.clears])).toEqual([
      ['X|long|pullback|2026-01-12', 1, 'watch', 'ack'],
      ['X|long|pullback|2026-01-15', 2, 'watch', 'ack'],
    ]);
  });
});

describe('13. boundary', () => {
  it('is a close past the boundary with the stop recorded, saying it is not yet confirmed', () => {
    const [f] = ofKind(flagsOf(rowOf(LONG, WAIT)), 'boundary');
    expect(f).toMatchObject({ id: 'X|long|boundary|2026-01-06', tier: 'watch', clears: 'ack' });
    expect(f.text).toBe('X long — closed above its pattern boundary (97); last full day low 94 recorded. Not confirmed until a close above 100');
  });

  it('stays on the record after the confirmation, as the old log kept it', () => {
    expect(ofKind(flagsOf(rowOf(LONG, B1)), 'boundary')[0].text).toBe('X long — closed above its pattern boundary (97); last full day low 94 recorded');
  });
});

describe('14. late-entry', () => {
  it('is a confirmed row still B1 with half or more of the trigger → target move used, on the last close', () => {
    const [f] = ofKind(flagsOf(rowOf({ ...LONG, target: 107 }, B1)), 'late-entry');
    expect(f).toMatchObject({ id: 'X|long|late-entry|2026-01-08', tier: 'watch', surfaces: ['setups'], clears: 'itself' });
    expect(f.text).toBe('X long — still B1 with 57% of the trigger → target move used; entering now pays 0.3 : 1 against the tight stop');
    expect(ofKind(flagsOf(rowOf({ ...LONG, target: 110 }, B1)), 'late-entry')).toEqual([]);     // 40%
    expect(ofKind(flagsOf(rowOf({ ...LONG, target: 108 }, B1)), 'late-entry')).toHaveLength(1); // exactly 50%
  });

  it('is not raised once the row is a B2', () => {
    expect(ofKind(flagsOf(rowOf({ ...P, target: 101 }, PATH.slice(0, 6))), 'late-entry')).toEqual([]);
  });
});

describe('15. earnings-7d', () => {
  it('is a report within seven days on a row in the trade', () => {
    const [f] = ofKind(flagsOf(rowOf(LONG, B1, { earnings: '2026-01-25' })), 'earnings-7d');
    expect(f).toMatchObject({ id: 'X|long|earnings-7d|2026-01-25', tier: 'watch', surfaces: ['today', 'positions'] });
    expect(f.text).toBe('X long — reports in 5 days (25-01-26), with the trade on');
  });

  it('or on a waiting row near its trigger; not on one far from it, nor beyond seven days, nor after', () => {
    expect(ofKind(flagsOf(rowOf(LONG, WAIT, { earnings: '2026-01-27', atr: 2.5 })), 'earnings-7d')[0].text).toBe('X long — reports in 7 days (27-01-26), close to its trigger');
    expect(ofKind(flagsOf(rowOf(LONG, WAIT, { earnings: '2026-01-23', atr: 1 })), 'earnings-7d')).toEqual([]);
    expect(ofKind(flagsOf(rowOf(LONG, B1, { earnings: '2026-01-28' })), 'earnings-7d')).toEqual([]);
    expect(ofKind(flagsOf(rowOf(LONG, B1, { earnings: '2026-01-19' })), 'earnings-7d')).toEqual([]);
  });
});

describe('17. source-kept', () => {
  it('is a failed row the source still lists on two sheets or more', () => {
    const failed = [...B1, ['2026-01-12', 89, 99, 95]] as Day[];
    const [f] = ofKind(flagsOf(rowOf({ ...LONG, source_open: ['2026-01-17', '2026-01-24'] }, failed)), 'source-kept');
    expect(f).toMatchObject({ id: 'X|long|source-kept|2026-01-24', tier: 'watch', surfaces: ['history'] });
    expect(f.text).toBe('X long — failed on 12-01-26, but Tech Charts still lists it as ongoing (2 sheets, 17-01-26 → 24-01-26)');
    expect(ofKind(flagsOf(rowOf({ ...LONG, source_open: ['2026-01-17'] }, failed)), 'source-kept')).toEqual([]);
  });
});

/* ------------------------------------------------------------------ Info */

describe('18. removed', () => {
  it('is a removed date, and a removed row raises nothing else', () => {
    const fs = flagsOf(rowOf({ ...P, removed: '2026-01-17', removed_reason: 'pattern morphing', manualState: 'removed' }, PATH, { atr: 50 }, { price: 89, date: '2026-01-20' }));
    expect(fs.map(f => [f.id, f.tier, f.clears])).toEqual([['X|long|removed|2026-01-17', 'info', 'ack']]);
    expect(fs[0].text).toBe('X long — dropped by the source on 17-01-26 (pattern morphing)');
  });
});

describe('19. data', () => {
  const ok = series(B1);
  it('says which symbols have no history, no bars or no calendar, and when the prices are not live or the tip is old', () => {
    const fs = dataFlags({
      symbols: ['A', 'B', 'C', 'D', 'A'],
      hist: { A: ok.hist, B: ok.hist, C: { settled: [], live: null, liveDate: '', currency: 'USD' } },
      bars: { A: ok.bars },
      events: { A: { atr: 1 } },
      snapshotAt: '2026-01-20T02:00:00Z',
      liveStatus: 'failed',
    }, CTX);
    expect(fs.map(f => [f.id, f.topic, f.syms ?? null])).toEqual([
      ['*|*|data.no-history|2026-01-20', 'no-history', ['C', 'D']],
      ['*|*|data.no-bars|2026-01-20', 'no-bars', ['B']],
      ['*|*|data.snapshot|2026-01-20', 'snapshot', null],
      ['*|*|data.stale-tip|2026-01-20', 'stale-tip', null],
      ['*|*|data.no-events|2026-01-20', 'no-events', ['B', 'C', 'D']],
    ]);
    expect(fs.every(f => f.tier === 'info' && f.kind === 'data' && f.route === '#/method' && f.clears === 'itself')).toBe(true);
    expect(fs[3].text).toBe('The latest-price file is 10 hours old');
  });

  it('is quiet when everything is in order, and a list without a calendar is not asked for one', () => {
    expect(dataFlags({ symbols: ['A'], hist: { A: ok.hist }, bars: { A: ok.bars }, events: { A: {} }, snapshotAt: '2026-01-20T10:00:00Z', liveStatus: 'ok' }, CTX)).toEqual([]);
    expect(dataFlags({ symbols: ['A'], hist: { A: ok.hist }, bars: { A: ok.bars }, events: {}, snapshotAt: null, liveStatus: 'loading', checkEvents: false }, CTX)).toEqual([]);
  });
});

/* ------------------------------------------------------------------ ids */

describe('acknowledgement ids', () => {
  const idsOf = (fs: Flag[]) => fs.map(f => f.id);

  it('are sym|dir|kind|when, and parse back', () => {
    expect(flagId('X', 'long', 'breakout', '2026-01-08')).toBe('X|long|breakout|2026-01-08');
    for (const sym of ['^GSPC', 'GC=F', 'ROKO-B.ST', '0135.HK', 'DX-Y.NYB']) {
      expect(parseFlagId(flagId(sym, 'short', 'exit', '2026-01-16'))).toEqual({ sym, dir: 'short', kind: 'exit', when: '2026-01-16' });
    }
    expect(parseFlagId('nonsense')).toBeNull();
    expect(parseFlagId('a|b||d')).toBeNull();
  });

  it('are unique across the whole board, and no symbol on the list contains the separator', () => {
    const fs = boardFlags(frozenBoard().rows, { today: TODAY, nowMs: Date.parse('2026-11-01T18:00:00Z'), page: 'setups' });
    expect(fs.length).toBeGreaterThan(0);
    expect(new Set(idsOf(fs)).size).toBe(fs.length);
    expect(frozenBoard().rows.some(r => r.p.sym.includes('|'))).toBe(false);
    for (const f of fs) expect(parseFlagId(f.id), f.id).not.toBeNull();
  });

  it('come out the same however often and in whatever order the board is computed', () => {
    const ctx = { today: TODAY, nowMs: 0, page: 'setups' as const };
    const rows = frozenBoard().rows;
    const a = idsOf(boardFlags(rows, ctx));
    expect(idsOf(boardFlags(rows, ctx))).toEqual(a);
    expect(idsOf(boardFlags(rows.slice().reverse(), ctx))).toEqual(a);
  });

  it('survive a new session: every event already flagged keeps its id', () => {
    const before = flagsOf(rowOf(P, PATH.slice(0, -1))).filter(f => f.clears === 'ack');
    const after = idsOf(flagsOf(rowOf(P, PATH)));
    for (const f of before) expect(after, f.id).toContain(f.id);
  });

  it('survive a price move: a live flag is the same flag at any price', () => {
    const live = (price: number) => idsOf(flagsOf(rowOf(LONG, B1, {}, { price, date: '2026-01-12' })).filter(f => f.when === 'live'));
    expect(live(89)).toEqual(live(88.5));
    expect(live(89)).toEqual(['X|long|live-stop|live', 'X|long|live-negation|live']);
  });

  it('survive an edit that does not change what happened: a new target leaves the breakout\'s id alone', () => {
    const a = flagsOf(rowOf(LONG, B1)).find(f => f.kind === 'breakout')!;
    const b = flagsOf(rowOf({ ...LONG, target: 140 }, B1)).find(f => f.kind === 'breakout')!;
    expect(b.id).toBe(a.id);
  });

  it('survive a move between sections: the same event keeps its id when the row fails later', () => {
    const before = flagsOf(rowOf(LONG, B1)).find(f => f.kind === 'breakout')!;
    const after = flagsOf(rowOf(LONG, [...B1, ['2026-01-12', 89, 99, 95]])).find(f => f.kind === 'breakout')!;
    expect(after.id).toBe(before.id);
  });

  it('never let the long and the short of one name share an id', () => {
    const long = idsOf(flagsOf(rowOf({ ...LONG, sym: 'Z' }, B1)));
    const short = idsOf(flagsOf(rowOf({ ...SHORT, sym: 'Z' }, [['2026-01-05', 103, 107, 104], ['2026-01-06', 101, 105, 102.5], ['2026-01-07', 98, 103, 99.5]])));
    expect(long.filter(id => short.includes(id))).toEqual([]);
  });

  it('do not depend on which board the row is on; the route does', () => {
    const a = flagsOf(rowOf(LONG, B1));
    const b = flagsOf(rowOf(LONG, B1), { ...CTX, page: 'benchmarks' });
    expect(idsOf(b)).toEqual(idsOf(a));
    expect(b[0].route).toBe('#/benchmarks/X/long');
  });
});

/* ------------------------------------------------------------------ the figure */

describe('the figure a flag turns on', () => {
  const fig = (r: Row, kind: FlagKind, id?: string) => flagsOf(r).find(f => f.kind === kind && (!id || f.id === id))!.figure;
  const SHORT_FAIL: Day[] = [
    ['2026-01-05', 103, 107, 104], ['2026-01-06', 101, 105, 102.5], ['2026-01-07', 98, 103, 99.5], ['2026-01-09', 98, 111, 105],
  ];

  it('is the price the rule read, against the level it read it against, in the listing currency', () => {
    expect(fig(rowOf(LONG, B1), 'breakout')).toEqual({ read: 'close', price: 100.5, vs: 'trigger', level: 100, ccy: 'USD' });
    expect(fig(rowOf(LONG, [...B1, ['2026-01-12', 110, 121, 120]]), 'target')).toEqual({ read: 'close', price: 120, vs: 'target', level: 120, ccy: 'USD' });
    expect(fig(rowOf(LONG, B1), 'boundary')).toEqual({ read: 'last full day', price: 94, vs: 'boundary', level: 97, ccy: 'USD' });
  });

  it('a touch is the low for a long and the high for a short', () => {
    expect(fig(rowOf(LONG, [...B1, ['2026-01-12', 89, 99, 95]]), 'failed')).toEqual({ read: 'low', price: 89, vs: 'negation', level: 90, ccy: 'USD' });
    expect(fig(rowOf(SHORT, SHORT_FAIL), 'failed')).toEqual({ read: 'high', price: 111, vs: 'negation', level: 110, ccy: 'USD' });
  });

  it('pullback, exit and re-entry are numbered, each with its own bar', () => {
    const r = rowOf(P, PATH);
    expect(fig(r, 'pullback', 'X|long|pullback|2026-01-12')).toEqual({ read: 'low', price: 99.5, vs: 'trigger', level: 100, ccy: 'USD' });
    expect(fig(r, 'pullback', 'X|long|pullback|2026-01-15')).toEqual({ read: 'low', price: 98, vs: 'trigger', level: 100, ccy: 'USD' });
    expect(fig(r, 'exit')).toEqual({ read: 'low', price: 93, vs: 'last full day', level: 94, ccy: 'USD' });
    expect(fig(r, 'reentry')).toEqual({ read: 'close', price: 101, vs: 'trigger', level: 100, ccy: 'USD' });
  });

  it('a live flag reads the live price', () => {
    expect(fig(rowOf(LONG, B1, {}, { price: 93, date: '2026-01-12' }), 'live-stop')).toEqual({ read: 'live', price: 93, vs: 'last full day', level: 94, ccy: 'USD' });
    expect(fig(rowOf(LONG, B1, {}, { price: 89, date: '2026-01-12' }), 'live-negation')).toEqual({ read: 'live', price: 89, vs: 'negation', level: 90, ccy: 'USD' });
    expect(fig(rowOf(LONG, WAIT, {}, { price: 100.5, date: '2026-01-08' }), 'live-trigger')).toEqual({ read: 'live', price: 100.5, vs: 'trigger', level: 100, ccy: 'USD' });
  });

  it('a proximity flag carries the distance in ATRs, to the stop it was measured to', () => {
    const t = fig(rowOf(LONG, WAIT, { atr: 2.5 }), 'near-trigger')!;
    expect(t).toMatchObject({ read: 'last close', price: 98, vs: 'trigger', level: 100, ccy: 'USD' });
    expect(t.atrs).toBeCloseTo(0.8, 10);
    const s = fig(rowOf(LONG, B1, { atr: 12 }), 'near-stop')!;
    expect(s).toMatchObject({ read: 'last close', price: 104, vs: 'last full day', level: 94 });
    expect(s.atrs).toBeCloseTo(10 / 12, 10);
    expect(fig(rowOf({ ...LONG, lfd: 0 }, B1, { atr: 15 }), 'near-stop')).toMatchObject({ vs: 'negation', level: 90 });
  });

  it('a calendar flag has none: its date is the number', () => {
    expect(fig(rowOf(LONG, B1, { earnings: '2026-01-25' }), 'earnings-7d')).toBeUndefined();
    expect(fig(rowOf(LONG, B1, { ex_div: '2026-01-22', div_amount: 0.5, atr: 1 }), 'exdiv-2d')).toBeUndefined();
  });

  it('is on every event flag of every row on the board, with real numbers', () => {
    const ctx = { today: TODAY, nowMs: 0, page: 'setups' as const };
    const kinds = ['breakout', 'target', 'failed', 'boundary', 'pullback', 'exit', 'reentry'];
    for (const r of frozenBoard().rows) {
      for (const f of setupFlags(r, ctx).filter(x => kinds.includes(x.kind))) {
        const label = f.id;
        const g = f.figure;
        // A target the source counted, with no close behind it, is the one flag that may have no number.
        if (!g) { expect(f.kind === 'target' && !!r.st.targetHit && r.st.targetHit.bySource, label).toBe(true); continue; }
        expect(Number.isFinite(g.price) && Number.isFinite(g.level), label).toBe(true);
        expect(g.ccy, label).toBe(r.currency);
      }
    }
  });
});

/* ------------------------------------------------------------------ the old weekly log */

describe('the settled flags carry every event the old weekly log showed', () => {
  it('on every row of the board, with the same date and the same words', () => {
    const ctx = { today: TODAY, nowMs: 0, page: 'setups' as const };
    for (const r of frozenBoard().rows) {
      const settled = setupEvents(r).filter(e => e.when !== 'live').map(e => [e.kind, e.when, e.text]);
      const flags = setupFlags(r, ctx)
        .filter(f => ['breakout', 'target', 'failed', 'boundary', 'pullback', 'exit', 'reentry'].includes(f.kind))
        .filter(f => !(f.kind === 'target' && r.st.targetHit && r.st.targetHit.bySource))
        .map(f => [f.kind, f.when, f.text]);
      expect(flags, r.p.sym + ' ' + r.p.dir).toEqual(settled);
    }
  });
});

/* ------------------------------------------------------------------ order, expiry and the badge */

describe('order', () => {
  it('puts Act before Watch before Info, live first within a tier, then the newest', () => {
    const fs = sortFlags([
      ...dataFlags({ symbols: ['Q'], hist: {}, bars: {}, events: {}, snapshotAt: null, liveStatus: 'ok' }, CTX),
      ...flagsOf(rowOf(P, PATH, { atr: 50 }, { price: 93, date: '2026-01-20' })),
    ]);
    expect(fs.map(f => f.tier)).toEqual([...fs.map(f => f.tier)].sort((a, b) => ['act', 'watch', 'info'].indexOf(a) - ['act', 'watch', 'info'].indexOf(b)));
    expect(fs[0]).toMatchObject({ kind: 'live-stop', when: 'live' });
    const act = fs.filter(f => f.tier === 'act' && f.when !== 'live').map(f => f.when);
    expect(act).toEqual([...act].sort().reverse());
  });
});

describe('expiry after five sessions', () => {
  const r = rowOf(P, PATH);
  const hist = { X: series(PATH).hist };

  it('counts the symbol\'s own sessions after the day a flag is about', () => {
    const fs = flagsOf(r);
    expect(sessionsSince(fs.find(f => f.kind === 'breakout')!, hist)).toBe(7);
    expect(sessionsSince(fs.find(f => f.id === 'X|long|pullback|2026-01-15')!, hist)).toBe(2);
  });

  it('takes a settled flag off Today after five, acknowledged or not; a condition never expires, it ends', () => {
    const fs = flagsOf(rowOf(P, PATH, { atr: 50 }));
    expect(expired(fs.find(f => f.kind === 'breakout')!, hist)).toBe(true);
    expect(expired(fs.find(f => f.kind === 'reentry')!, hist)).toBe(false);
    expect(expired(fs.find(f => f.kind === 'near-stop')!, hist)).toBe(false);
  });

  it('also ends a flag on a symbol that has stopped trading, after two weeks of weekdays on the board (WBS)', () => {
    const stopped = flagsOf(rowOf(LONG, B1)).find(f => f.kind === 'breakout')!;     // X's last bar is 01-09
    const others = series([['2026-01-21', 1, 2, 1.5], ['2026-01-22', 1, 2, 1.5]]).hist;
    const mk = (last: string) => ({ X: series(B1).hist, Y: { ...others, settled: [...others.settled, [last, 1.5] as [string, number]] } });
    expect(sessionsSince(stopped, mk('2026-01-22'))).toBe(1);
    expect(expired(stopped, mk('2026-01-21'))).toBe(false);   // 9 weekdays after 01-08
    expect(expired(stopped, mk('2026-01-22'))).toBe(true);    // 10
    expect(weekdaysBetween('2026-01-08', '2026-01-12')).toBe(2);   // Fri and Mon
  });
});

describe('the Today badge', () => {
  it('counts unacknowledged Act and Watch flags shown on Today, and no others', () => {
    const r = rowOf(P, PATH, { atr: 50 }, { price: 93, date: '2026-01-20' });
    const fs = flagsOf(r);
    const hist = { X: series(PATH).hist };
    // On Today and not expired: exit, re-entry, pullback 2, live-stop, near-stop. The breakout, boundary and pullback 1
    // are five or more sessions old.
    const counted = fs.filter(f => (f.tier === 'act' || f.tier === 'watch') && f.surfaces.includes('today') && !expired(f, hist)).map(f => f.kind).sort();
    expect(counted).toEqual(['exit', 'live-stop', 'near-stop', 'pullback', 'reentry']);
    expect(badgeCount(fs, {}, hist)).toBe(5);
    expect(badgeCount(fs, { 'X|long|exit|2026-01-16': 1, 'X|long|reentry|2026-01-19': 2 }, hist)).toBe(3);
    // A live flag cannot be acknowledged away: it is a condition.
    expect(badgeCount(fs, { 'X|long|live-stop|live': 3 }, hist)).toBe(5);
  });

  it('ignores Info flags', () => {
    const fs = dataFlags({ symbols: ['Q'], hist: {}, bars: {}, events: {}, snapshotAt: null, liveStatus: 'failed' }, CTX);
    expect(badgeCount(fs, {}, {})).toBe(0);
  });
});

describe('who the rules apply to', () => {
  it('in trade means confirmed, back in, or past the target; not waiting, stopped out, failed or removed', () => {
    expect(inTrade(rowOf(LONG, B1))).toBe(true);
    expect(inTrade(rowOf(P, PATH))).toBe(true);
    expect(inTrade(rowOf(LONG, [...B1, ['2026-01-12', 110, 121, 120]]))).toBe(true);
    expect(inTrade(rowOf(LONG, WAIT))).toBe(false);
    expect(inTrade(rowOf(P, PATH.slice(0, -1)))).toBe(false);
    expect(inTrade(rowOf(LONG, [...B1, ['2026-01-12', 89, 99, 95]]))).toBe(false);
  });
});
