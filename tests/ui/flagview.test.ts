import { describe, expect, it } from 'vitest';
import { boardFlags, flagId, RULES, setupFlags, THRESHOLDS } from '../../src/engine/flags';
import type { Flag, FlagKind } from '../../src/engine/flags';
import { todayView } from '../../src/engine/today';
import { detailOf, figureView, GROUP_RULE, GROUP_TITLE, kindLabel, previewOf, sinceLabel, summaryOf, TONE, whenOf } from '../../src/ui/flagview';
import { frozenBoard, frozenHist, rowOf, TODAY } from './frozen';

/* The frame around a flag's sentence. The sentence itself is the engine's and is tested there. */

const KINDS = Object.keys(RULES) as FlagKind[];
const ctx = { today: TODAY, nowMs: Date.parse('2026-11-01T18:00:00Z'), page: 'setups' as const };
const flag = (kind: FlagKind, over: Partial<Flag> = {}): Flag => ({
  id: flagId('AME', 'long', kind, '2026-10-30'), tier: RULES[kind].tier, kind, sym: 'AME', dir: 'long', when: '2026-10-30',
  text: 'AME long — something happened', route: '#/setups/AME/long', clears: RULES[kind].clears, surfaces: RULES[kind].surfaces, ...over,
});

describe('titles, rules and colours', () => {
  it('every kind has all three, so a new rule cannot reach the page without a name', () => {
    for (const k of KINDS) {
      expect(GROUP_TITLE[k], k).toBeTruthy();
      expect(GROUP_RULE[k], k).toBeTruthy();
      expect(['good', 'bad', 'warn', 'info']).toContain(TONE[k]);
    }
  });

  it('quote the engine\'s thresholds rather than a copy of them', () => {
    expect(GROUP_RULE['near-stop']).toContain(String(THRESHOLDS.nearAtr));
    expect(GROUP_TITLE['earnings-7d']).toContain(String(THRESHOLDS.earningsDays));
    expect(GROUP_TITLE['exdiv-7d']).toContain(String(THRESHOLDS.exdivWatchDays));
    expect(GROUP_TITLE['exdiv-2d']).toContain(String(THRESHOLDS.exdivActDays));
  });

  it('read in the weekly log\'s colours: green for what you act on, red for what hurts, amber for a heads-up', () => {
    expect(['breakout', 'reentry', 'target'].map(k => TONE[k as FlagKind])).toEqual(['good', 'good', 'good']);
    expect(['exit', 'failed', 'live-stop', 'live-negation'].map(k => TONE[k as FlagKind])).toEqual(['bad', 'bad', 'bad', 'bad']);
    expect(['pullback', 'boundary', 'near-stop', 'near-trigger'].map(k => TONE[k as FlagKind])).toEqual(['warn', 'warn', 'warn', 'warn']);
  });
});

describe('a row\'s labels', () => {
  it('numbers the pullbacks, exits and re-entries', () => {
    expect(kindLabel(flag('exit', { n: 2 }))).toBe('Exit 2');
    expect(kindLabel(flag('pullback', { n: 1 }))).toBe('Pullback 1');
    expect(kindLabel(flag('reentry', { n: 3 }))).toBe('Re-entry 3');
    expect(kindLabel(flag('exit'))).toBe('Exit');
    expect(kindLabel(flag('breakout'))).toBe('Breakout');
    expect(kindLabel(flag('exdiv-2d'))).toBe('Ex-dividend');
    expect(kindLabel(flag('late-entry'))).toBe('Late entry');          // a row is one of them, a group is several
  });

  it('drops the "AME long — " the sentence opens with, and nothing else', () => {
    expect(detailOf(flag('breakout', { text: 'AME long — BREAKOUT CONFIRMED: closed above' }))).toBe('BREAKOUT CONFIRMED: closed above');
    // The dividend sentence has a dash of its own further in and does not open with the pair.
    const div = 'AME goes ex-dividend in 3 days: 0.5 is 40% of one ATR — widen to 9 until it has passed';
    expect(detailOf(flag('exdiv-7d', { text: div }))).toBe(div);
    expect(detailOf(flag('breakout', { text: 'AME short — x', dir: 'long' }))).toBe('AME short — x');
  });

  it('on the whole board, no sentence keeps its opening pair', () => {
    for (const f of boardFlags(frozenBoard().rows, ctx).filter(x => x.sym)) {
      expect(detailOf(f).startsWith(f.sym + ' ' + f.dir + ' — '), f.id).toBe(false);
      expect(detailOf(f).length, f.id).toBeGreaterThan(0);
    }
  });
});

describe('the date a row carries', () => {
  it('is the day it happened, a live flag says so, and a calendar flag says how far off it is', () => {
    expect(whenOf(flag('breakout'), TODAY)).toEqual({ main: 'Fri 30 Oct' });
    expect(whenOf(flag('live-stop', { when: 'live' }), TODAY)).toEqual({ main: 'Live' });
    expect(whenOf(flag('earnings-7d', { when: '2026-11-04' }), TODAY)).toEqual({ main: 'Wed 4 Nov', sub: 'in 3 days' });
    expect(whenOf(flag('earnings-7d', { when: '2026-11-02' }), TODAY)).toEqual({ main: 'Mon 2 Nov', sub: 'tomorrow' });
    expect(whenOf(flag('exdiv-2d', { when: '2026-11-01' }), TODAY)).toEqual({ main: 'Sun 1 Nov', sub: 'today' });
  });
});

describe('the number a row leads with', () => {
  it('is the price with its currency, and says what it was read against', () => {
    expect(figureView({ read: 'close', price: 100.5, vs: 'trigger', level: 100, ccy: 'CAD' })).toEqual({ value: '100.5', ccy: 'CAD', sub: 'close vs trigger 100' });
    expect(figureView({ read: 'low', price: 93, vs: 'last full day', level: 94, ccy: 'USD' }).sub).toBe('low vs last full day 94');
  });

  it('adds the distance in ATRs for the proximity rules', () => {
    expect(figureView({ read: 'last close', price: 98, vs: 'trigger', level: 100, atrs: 0.8, ccy: 'USD' }).sub).toBe('last close vs trigger 100 · 0.8 ATR');
  });

  it('exists for every event flag on the board, in the row\'s own currency', () => {
    const r = rowOf('TVE.TO');
    const fs = setupFlags(r, ctx).filter(f => f.figure);
    expect(fs.length).toBeGreaterThan(0);
    for (const f of fs) expect(figureView(f.figure!).ccy).toBe(r.currency);
  });
});

describe('the lines around the lists', () => {
  it('previews the first names of a folded group', () => {
    const fs = ['A', 'B', 'C', 'D', 'E'].map(sym => flag('pullback', { sym }));
    expect(previewOf(fs)).toBe('A, B, C and 2 more');
    expect(previewOf(fs.slice(0, 3))).toBe('A, B, C');
    expect(previewOf([fs[0], fs[0]])).toBe('A');
    expect(previewOf([])).toBe('');
  });

  it('summarises what is waiting, and says so when nothing is', () => {
    const v = (live: number, act: number, watch: number) => ({
      live: Array(live).fill(flag('live-stop')), act: { count: act } as never, watch: { count: watch } as never,
    });
    expect(summaryOf(v(2, 9, 39))).toBe('2 live · 9 to decide · 39 to look at');
    expect(summaryOf(v(0, 0, 3))).toBe('3 to look at');
    expect(summaryOf(v(0, 0, 0))).toBe('Nothing is waiting for you');
  });

  it('on the board, the summary and the tier counts say the same thing', () => {
    const v = todayView({ flags: boardFlags(frozenBoard().rows, ctx), acks: {}, hist: frozenHist(), seen: null, dayStart: 0 });
    const s = summaryOf(v);
    if (v.act.count) expect(s).toContain(v.act.count + ' to decide');
    if (v.watch.count) expect(s).toContain(v.watch.count + ' to look at');
  });

  it('writes the last visit as a weekday, a date and a time, and nothing before there was one', () => {
    expect(sinceLabel(null)).toBeNull();
    expect(sinceLabel({ at: Date.parse('2026-10-31T21:14:00'), seen: [] })).toBe('Sat 31 Oct, 21:14');
  });
});
