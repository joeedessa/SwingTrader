import { describe, expect, it } from 'vitest';
import { badgeCount, boardFlags, flagId, RULES } from '../../src/engine/flags';
import type { Acks, Flag, FlagKind } from '../../src/engine/flags';
import { GROUPS, todayView } from '../../src/engine/today';
import type { TodayInput } from '../../src/engine/today';
import { series } from './helpers';
import type { Day } from './helpers';
import { frozenBoard, frozenHist, TODAY } from '../ui/frozen';

/* The view-model behind the Today page. Nothing here knows how many flags there are: every count is read back from
   the inputs, so the weekly additions and removals cannot break a test. */

const DAY_START = Date.parse('2026-01-20T00:00:00Z');
const NOON = Date.parse('2026-01-20T12:00:00Z');

let seq = 0;
const mk = (kind: FlagKind, over: Partial<Flag> = {}): Flag => {
  const rule = RULES[kind];
  const sym = over.sym ?? 'X' + seq++;
  const when = over.when ?? (rule.live ? 'live' : '2026-01-20');
  return {
    id: flagId(sym, 'long', kind, when), tier: rule.tier, kind, sym, dir: 'long', when, text: kind + ' ' + sym,
    route: '#/setups/' + sym + '/long', clears: rule.clears, surfaces: rule.surfaces, ...over,
  };
};

const view = (flags: Flag[], over: Partial<TodayInput> = {}) =>
  todayView({ flags, acks: {}, hist: {}, seen: null, dayStart: DAY_START, ...over });
const ids = (fs: Flag[]) => fs.map(f => f.id);
const everyId = (v: ReturnType<typeof view>) => [...ids(v.live), ...v.act.groups.flatMap(g => ids(g.flags)), ...v.watch.groups.flatMap(g => ids(g.flags))];

describe('what reaches Today', () => {
  it('splits the flags into live, Act, Watch, acknowledged and data, each in exactly one place', () => {
    const flags = [
      mk('breakout'), mk('exit'), mk('live-stop'), mk('live-trigger'), mk('pullback'), mk('near-stop'),
      mk('late-entry'), mk('source-kept'), mk('removed'),
      mk('data', { sym: '*', dir: null, id: '*|*|data.snapshot|2026-01-20', topic: 'snapshot' }),
    ];
    const v = view(flags);
    expect(v.live.map(f => f.kind)).toEqual(['live-stop', 'live-trigger']);               // Act before Watch
    expect(v.act.groups.map(g => g.kind)).toEqual(['exit', 'breakout']);
    expect(v.watch.groups.map(g => g.kind)).toEqual(['near-stop', 'pullback']);
    expect(v.data.map(f => f.kind)).toEqual(['data']);
    expect(v.acked).toEqual([]);
    // late-entry is for the Setups board, source-kept for History, removed for both: none is Today's.
    expect(new Set(everyId(v)).size).toBe(everyId(v).length);
    expect(everyId(v).sort()).toEqual(ids(flags.filter(f => ['breakout', 'exit', 'live-stop', 'live-trigger', 'pullback', 'near-stop'].includes(f.kind))).sort());
  });

  it('every kind that can reach Today as Act or Watch has a place, in its own tier, once', () => {
    const reach = (Object.keys(RULES) as FlagKind[]).filter(k => RULES[k].surfaces.includes('today') && !RULES[k].live && RULES[k].tier !== 'info');
    const listed = [...GROUPS.act, ...GROUPS.watch];
    expect(listed.slice().sort()).toEqual(reach.slice().sort());
    expect(new Set(listed).size).toBe(listed.length);
    for (const k of GROUPS.act) expect(RULES[k].tier, k).toBe('act');
    for (const k of GROUPS.watch) expect(RULES[k].tier, k).toBe('watch');
  });

  it('a kind nobody listed still shows, after the listed ones, rather than going missing', () => {
    const odd = mk('late-entry', { surfaces: ['today'] });
    const v = view([odd, mk('pullback')]);
    expect(v.watch.groups.map(g => g.kind)).toEqual(['pullback', 'late-entry']);
    expect(v.badge).toBe(2);
  });

  it('puts the groups in the tier\'s order and leaves out the kinds that have nothing', () => {
    const flags = [mk('breakout'), mk('reentry'), mk('target'), mk('failed'), mk('exit'), mk('exdiv-2d')];
    expect(view(flags).act.groups.map(g => g.kind)).toEqual(['exit', 'failed', 'exdiv-2d', 'target', 'reentry', 'breakout']);
    expect(view([mk('target')]).act.groups.map(g => g.kind)).toEqual(['target']);
    const w = view([mk('exdiv-7d'), mk('earnings-7d'), mk('boundary'), mk('pullback'), mk('near-trigger'), mk('near-stop')]);
    expect(w.watch.groups.map(g => g.kind)).toEqual(['near-stop', 'near-trigger', 'pullback', 'boundary', 'earnings-7d', 'exdiv-7d']);
  });

  it('has nothing to say when there are no flags', () => {
    const v = view([]);
    expect(v).toMatchObject({ live: [], acked: [], data: [], badge: 0, fresh: 0, newIds: [], ids: [] });
    expect(v.act).toMatchObject({ count: 0, fresh: 0, groups: [] });
    expect(v.watch).toMatchObject({ count: 0, fresh: 0, groups: [] });
  });
});

describe('the order inside a group', () => {
  it('events: what you have not seen first, then the newest', () => {
    const a = mk('breakout', { sym: 'A', when: '2026-01-19' });
    const b = mk('breakout', { sym: 'B', when: '2026-01-16' });
    const c = mk('breakout', { sym: 'C', when: '2026-01-20' });
    const v = view([a, b, c], { seen: new Set([a.id, c.id]) });
    expect(ids(v.act.groups[0].flags)).toEqual([b.id, c.id, a.id]);
    expect(view([a, b, c]).act.groups[0].flags.map(f => f.sym)).toEqual(['C', 'A', 'B']);      // before a first look: by date
  });

  it('calendar flags: the soonest first, whatever is new', () => {
    const a = mk('earnings-7d', { sym: 'A', when: '2026-01-25' });
    const b = mk('earnings-7d', { sym: 'B', when: '2026-01-21' });
    const c = mk('earnings-7d', { sym: 'C', when: '2026-01-23' });
    expect(view([a, b, c], { seen: new Set([b.id]) }).watch.groups[0].flags.map(f => f.sym)).toEqual(['B', 'C', 'A']);
  });

  it('proximity flags: the closest to its level first, and one with no distance last', () => {
    const fig = (atrs?: number) => ({ read: 'last close' as const, price: 1, vs: 'trigger' as const, level: 2, ccy: 'USD', ...(atrs != null ? { atrs } : {}) });
    const a = mk('near-trigger', { sym: 'A', figure: fig(0.9) });
    const b = mk('near-trigger', { sym: 'B', figure: fig(0.2) });
    const c = mk('near-trigger', { sym: 'C' });
    expect(view([c, a, b]).watch.groups[0].flags.map(f => f.sym)).toEqual(['B', 'A', 'C']);
  });
});

describe('new since the last visit', () => {
  const flags = [mk('breakout'), mk('exit'), mk('pullback'), mk('live-stop'), mk('near-stop')];

  it('before a first look nothing is new: there is nothing to compare with', () => {
    const v = view(flags, { seen: null });
    expect(v.fresh).toBe(0);
    expect(v.newIds).toEqual([]);
    expect(v.act.fresh + v.watch.fresh).toBe(0);
  });

  it('is what was not on screen at the last visit, counted per group, per tier and in all', () => {
    const seen = new Set([flags[0].id, flags[2].id]);
    const v = view(flags, { seen });
    expect(v.act.fresh).toBe(1);                                    // the exit
    expect(v.act.groups.map(g => [g.kind, g.fresh])).toEqual([['exit', 1], ['breakout', 0]]);
    expect(v.watch.fresh).toBe(1);                                  // near-stop
    expect(v.fresh).toBe(3);                                        // + the live stop
    expect(v.newIds.slice().sort()).toEqual([flags[1].id, flags[3].id, flags[4].id].sort());
    expect(view(flags, { seen: new Set() }).fresh).toBe(v.badge);   // a visit that saw nothing: everything is new
  });
});

describe('acknowledgement', () => {
  it('moves a flag out of its tier and into today\'s acknowledged group, latest first', () => {
    const a = mk('breakout'), b = mk('exit'), c = mk('pullback');
    const v = view([a, b, c], { acks: { [a.id]: NOON, [c.id]: NOON + 5000 } });
    expect(ids(v.acked)).toEqual([c.id, a.id]);
    expect(everyId(v)).toEqual([b.id]);
    expect(v.badge).toBe(1);
    expect(v.ids.sort()).toEqual([a.id, b.id, c.id].sort());          // all three are on screen, one of them in the acknowledged group
  });

  it('leaves Today the day after: an acknowledgement from yesterday shows in neither place', () => {
    const a = mk('breakout');
    const v = view([a], { acks: { [a.id]: DAY_START - 1 } });
    expect(v.acked).toEqual([]);
    expect(everyId(v)).toEqual([]);
    expect(v.badge).toBe(0);
  });

  it('cannot silence a live flag: a condition is not an event', () => {
    const l = mk('live-negation');
    const v = view([l], { acks: { [l.id]: NOON } });
    expect(ids(v.live)).toEqual([l.id]);
    expect(v.acked).toEqual([]);
    expect(v.badge).toBe(1);
  });

  it('ignores an acknowledgement for a flag that is no longer raised', () => {
    const v = view([mk('breakout')], { acks: { 'GONE|long|breakout|2025-12-01': NOON } });
    expect(v.acked).toEqual([]);
    expect(v.badge).toBe(1);
  });
});

describe('expiry', () => {
  const days: Day[] = ['2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08', '2026-01-09', '2026-01-12', '2026-01-13', '2026-01-14', '2026-01-15', '2026-01-16']
    .map(d => [d, 1, 2, 1.5] as Day);
  const hist = { X: series(days).hist };

  it('takes a settled flag off Today after five sessions of its symbol, and keeps a newer one', () => {
    const old = mk('breakout', { sym: 'X', when: '2026-01-08' });
    const recent = mk('breakout', { sym: 'X', when: '2026-01-14' });
    const v = view([old, recent], { hist });
    expect(everyId(v)).toEqual([recent.id]);
    expect(v.badge).toBe(1);
  });

  it('never expires a condition: it ends when it stops being true', () => {
    expect(view([mk('near-stop', { sym: 'X', when: '2026-01-05' })], { hist }).watch.count).toBe(1);
  });

  it('an expired flag acknowledged today is still listed as acknowledged until midnight', () => {
    const old = mk('breakout', { sym: 'X', when: '2026-01-08' });
    const v = view([old], { hist, acks: { [old.id]: NOON } });
    expect(ids(v.acked)).toEqual([old.id]);
    expect(v.badge).toBe(0);
  });
});

describe('on the whole board', () => {
  const ctx = { today: TODAY, nowMs: Date.parse('2026-11-01T18:00:00Z'), page: 'setups' as const };
  const flags = boardFlags(frozenBoard().rows, ctx);
  const hist = frozenHist();
  const dayStart = Date.parse('2026-11-01T00:00:00Z');

  it('the badge is the number of unacknowledged Act and Watch flags, the way the engine counts them', () => {
    const v = todayView({ flags, acks: {}, hist, seen: null, dayStart });
    expect(v.badge).toBe(badgeCount(flags, {}, hist));
    expect(v.badge).toBe(v.live.length + v.act.count + v.watch.count);
    expect(v.badge).toBe(everyId(v).length);
    expect(v.ids.slice().sort()).toEqual([...everyId(v), ...ids(v.acked)].sort());
  });

  it('keeps agreeing as flags are acknowledged', () => {
    const open = todayView({ flags, acks: {}, hist, seen: null, dayStart });
    const settled = [...open.act.groups, ...open.watch.groups].flatMap(g => g.flags);
    const acks: Acks = {};
    settled.forEach((f, i) => { if (i % 2 === 0) acks[f.id] = dayStart + 1000; });
    const v = todayView({ flags, acks, hist, seen: null, dayStart });
    expect(v.badge).toBe(badgeCount(flags, acks, hist));
    expect(v.acked.length).toBe(Object.keys(acks).length);
    expect(v.badge + v.acked.length).toBe(open.badge);
  });

  it('every group lists only its own kind, and the tier counts are the sum of the groups', () => {
    const v = todayView({ flags, acks: {}, hist, seen: new Set(), dayStart });
    for (const t of [v.act, v.watch]) {
      for (const g of t.groups) for (const f of g.flags) { expect(f.kind).toBe(g.kind); expect(f.tier).toBe(t.tier); expect(f.when).not.toBe('live'); }
      expect(t.count).toBe(t.groups.reduce((n, g) => n + g.flags.length, 0));
    }
    expect(v.fresh).toBe(v.badge);          // seen nothing: everything is new
    expect(v.newIds.length).toBe(v.fresh);
  });
});
