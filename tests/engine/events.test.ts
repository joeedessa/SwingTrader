import { describe, expect, it } from 'vitest';
import { fmt, setupEvents, weekLog, weekWindow } from '../../src/engine/events';
import { evaluate } from '../../src/engine/row';
import { LONG, series } from './helpers';
import type { Day } from './helpers';

// Boundary close 01-06 (stop 94 from the 01-05 bar), confirmed 01-08, pullback 01-12, exit 01-16, re-entry 01-19.
const DAYS: Day[] = [
  ['2026-01-05', 94, 96, 95],
  ['2026-01-06', 95, 98, 97.5],
  ['2026-01-07', 96, 99, 98],
  ['2026-01-08', 97.5, 101, 100.5],
  ['2026-01-09', 101, 105, 104],
  ['2026-01-12', 99.5, 103, 102],
  ['2026-01-16', 93, 99, 97],
  ['2026-01-19', 95, 102, 101],
];

describe('setup events', () => {
  it('rebuild every settled event of a B3 path, dated, with the old page\'s wording', () => {
    const { bars, hist } = series(DAYS);
    const items = setupEvents(evaluate(LONG, hist, bars, null, '2026-01-20'));
    expect(items.map(i => [i.kind, i.when, i.cls])).toEqual([
      ['breakout', '2026-01-08', 'new'],
      ['boundary', '2026-01-06', 'warn'],
      ['pullback', '2026-01-12', 'warn'],
      ['exit', '2026-01-16', 'bad'],
      ['reentry', '2026-01-19', 'new'],
    ]);
    expect(items[0].text).toBe('X long — BREAKOUT CONFIRMED: closed above the trigger at 100.5 (trigger 100)');
    expect(items[1].text).toBe('X long — closed above its pattern boundary (97); last full day low 94 recorded');
    expect(items[2].text).toBe('X long — pullback 1 through the trigger (100, low 99.5): B2 while the last full day 94 holds');
    expect(items[3].text).toBe('X long — exit 1: took out its last full day low 94 (93). B3 — the pattern stands until the negation 90; a close above 100 re-enters');
    expect(items[4].text).toBe('X long — re-entry 1: closed 101 above the trigger 100. Stop back at the last full day 94');
    expect(items[3].n).toBe(1);
  });

  it('a failure by touch and a target are dated events; a source-counted target is not', () => {
    const { bars, hist } = series([
      ['2026-01-08', 97.5, 101, 100.5],
      ['2026-01-09', 110, 121, 120],
      ['2026-01-12', 89, 118, 100],
    ]);
    const items = setupEvents(evaluate({ ...LONG, boundary: null }, hist, bars, null, '2026-01-20'));
    expect(items.map(i => i.kind)).toEqual(['breakout', 'target', 'failed']);
    expect(items[2].text).toBe('X long — negated after reaching target: touched 89 vs negation 90 (B4)');
    const reached = series([['2026-01-08', 97.5, 101, 100.5], ['2026-01-09', 110, 119, 118]]);
    const r = evaluate({ ...LONG, boundary: null, reached: '2026-01-09' }, reached.hist, reached.bars, null, '2026-01-20');
    expect(setupEvents(r).map(i => i.kind)).toEqual(['breakout']);
  });

  it('raises live flags only while the tick is from a session still running', () => {
    const live = series(DAYS.slice(0, 3), { price: 101, date: '2026-01-08' });
    const r = evaluate(LONG, live.hist, live.bars, null, '2026-01-08');
    expect(setupEvents(r).filter(i => i.when === 'live').map(i => i.kind)).toEqual(['live-trigger']);
    const open = series(DAYS.slice(0, 5), { price: 89, date: '2026-01-12' });
    const kinds = setupEvents(evaluate(LONG, open.hist, open.bars, null, '2026-01-12')).filter(i => i.when === 'live').map(i => i.kind);
    expect(kinds).toEqual(['live-stop', 'live-negation']);
    const shut = series(DAYS.slice(0, 5));
    expect(setupEvents(evaluate(LONG, shut.hist, shut.bars, null, '2026-01-12')).some(i => i.when === 'live')).toBe(false);
  });

  it('removed rows raise nothing', () => {
    const { bars, hist } = series(DAYS);
    expect(setupEvents(evaluate({ ...LONG, manualState: 'removed' }, hist, bars, null, '2026-01-20'))).toEqual([]);
  });

  it('formats numbers the way the board prints them', () => {
    expect(fmt(1234.567)).toBe('1,234.6');
    expect(fmt(12.345)).toBe('12.35');
    expect(fmt(null)).toBe('–');
  });
});

describe('the weekly log', () => {
  const wed = new Date(2026, 10, 4, 12);     // Wednesday 4 Nov 2026, local time

  it('runs Monday to Sunday, local time', () => {
    expect(weekWindow('this', wed)).toEqual({ from: '2026-11-02', to: '9999-12-31' });
    expect(weekWindow('last', wed)).toEqual({ from: '2026-10-26', to: '2026-11-01' });
    expect(weekWindow('this', new Date(2026, 10, 1, 12))).toEqual({ from: '2026-10-26', to: '9999-12-31' });  // a Sunday
  });

  it('shows live flags first, then newest first, bad before new before warn; last week has no live flags', () => {
    const mk = (kind: string, when: string, cls: 'new' | 'bad' | 'warn') =>
      ({ kind: kind as 'breakout', cls, when, sym: 'X', dir: 'long' as const, text: kind + ' ' + when });
    const items = [
      mk('pullback', '2026-11-03', 'warn'), mk('breakout', '2026-11-03', 'new'), mk('exit', '2026-11-03', 'bad'),
      mk('breakout', '2026-11-02', 'new'), mk('live-trigger', 'live', 'warn'), mk('failed', '2026-10-30', 'bad'),
    ];
    expect(weekLog(items, 'this', wed).map(i => i.text)).toEqual([
      'live-trigger live', 'exit 2026-11-03', 'breakout 2026-11-03', 'pullback 2026-11-03', 'breakout 2026-11-02']);
    expect(weekLog(items, 'last', wed).map(i => i.text)).toEqual(['failed 2026-10-30']);
  });
});
