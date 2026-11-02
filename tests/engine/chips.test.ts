import { describe, expect, it } from 'vitest';
import { CALENDAR_KINDS, chipsOf, flagRank, LEAD_ORDER, openByRow, rowKeyOf } from '../../src/engine/chips';
import { boardFlags, RULES } from '../../src/engine/flags';
import type { Flag, FlagKind } from '../../src/engine/flags';
import { frozenBoard, frozenHist, TODAY } from '../ui/frozen';

/* A row's chips, from the flags it has open. The rules are tested on flags written by hand; the last block holds the chips
   to Today's own lists on the frozen board, so the two can only agree. */

const f = (kind: FlagKind, when = '2026-10-30', over: Partial<Flag> = {}): Flag => ({
  id: `X|long|${kind}|${when}`, tier: RULES[kind].tier, kind, sym: 'X', dir: 'long', when, text: `X long — ${kind}`,
  route: '#/setups/X/long', clears: RULES[kind].clears, surfaces: RULES[kind].surfaces, ...over,
});

const HIST = { X: { settled: [['2026-10-29', 1], ['2026-10-30', 1], ['2026-11-02', 1]] as [string, number][], live: 1, liveDate: '2026-11-02', currency: 'USD' } };

describe('which kinds a chip can lead with', () => {
  it('every Act and Watch kind is in exactly one of the lead lists or the calendar, so none can go missing', () => {
    const placed = [...LEAD_ORDER.act, ...LEAD_ORDER.watch, ...CALENDAR_KINDS];
    expect(new Set(placed).size).toBe(placed.length);
    const wanted = (Object.keys(RULES) as FlagKind[]).filter(k => RULES[k].tier !== 'info');
    expect([...placed].sort()).toEqual([...wanted].sort());
  });

  it('each list holds the kinds of its own tier', () => {
    for (const k of LEAD_ORDER.act) expect(RULES[k].tier, k).toBe('act');
    for (const k of LEAD_ORDER.watch) expect(RULES[k].tier, k).toBe('watch');
  });
});

describe('the chips of one row', () => {
  it('are at most three: what needs a decision, what is worth a look, what is coming', () => {
    const chips = chipsOf([f('breakout'), f('near-stop'), f('earnings-7d', '2026-11-04'), f('pullback')]);
    expect(chips.map(c => c.kind)).toEqual(['act', 'watch', 'calendar']);
    expect(chips.length).toBeLessThanOrEqual(3);
  });

  it('are absent for a row with nothing open', () => {
    expect(chipsOf([])).toEqual([]);
  });

  it('say how many more stand behind the lead of each', () => {
    const chips = chipsOf([f('exit', '2026-10-29'), f('breakout', '2026-10-20'), f('pullback'), f('near-stop'), f('boundary')]);
    expect(chips.find(c => c.kind === 'act')).toMatchObject({ more: 1 });
    expect(chips.find(c => c.kind === 'watch')).toMatchObject({ more: 2 });
  });

  it('lead with the most pressing: a live stop over an exit over a breakout', () => {
    expect(chipsOf([f('breakout'), f('exit'), f('live-stop', 'live')])[0].flag.kind).toBe('live-stop');
    expect(chipsOf([f('breakout'), f('exit')])[0].flag.kind).toBe('exit');
    expect(chipsOf([f('reentry'), f('breakout')])[0].flag.kind).toBe('reentry');
  });

  it('lead the Watch chip with the stop before the trigger before a pullback', () => {
    expect(chipsOf([f('pullback'), f('near-trigger'), f('near-stop')])[0].flag.kind).toBe('near-stop');
    expect(chipsOf([f('pullback'), f('near-trigger')])[0].flag.kind).toBe('near-trigger');
    expect(chipsOf([f('late-entry'), f('pullback')])[0].flag.kind).toBe('pullback');
  });

  it('give late-entry, which has no other surface, a chip of its own', () => {
    expect(chipsOf([f('late-entry')])).toEqual([{ kind: 'watch', flag: expect.objectContaining({ kind: 'late-entry' }), more: 0 }]);
  });

  it('put the nearest dated flag on the calendar chip, an ex-dividend as much as an earnings report', () => {
    const chips = chipsOf([f('earnings-7d', '2026-11-06'), f('exdiv-2d', '2026-11-03'), f('exdiv-7d', '2026-11-08')]);
    expect(chips).toEqual([{ kind: 'calendar', flag: expect.objectContaining({ kind: 'exdiv-2d' }), more: 2 }]);
  });

  it('keep an Act ex-dividend out of the red dot: it is a date, and reads as one', () => {
    expect(chipsOf([f('exdiv-2d', '2026-11-03')]).map(c => c.kind)).toEqual(['calendar']);
  });

  it('prefer the newest of two of a kind, and a live one over a dated one', () => {
    expect(chipsOf([f('exit', '2026-10-20', { n: 1 }), f('exit', '2026-10-29', { n: 2 })])[0].flag.n).toBe(2);
    expect(chipsOf([f('breakout', '2026-10-29'), f('live-negation', 'live')])[0].flag.kind).toBe('live-negation');
  });
});

describe('which flags are open on a row', () => {
  const flags = [
    f('breakout', '2026-10-30'),
    f('pullback', '2026-10-29'),
    f('near-stop', '2026-11-02'),
    f('late-entry', '2026-10-30'),
    f('removed', '2026-10-01'),
    f('data', '2026-11-02', { sym: null, dir: null, id: '*|*|data.x|2026-11-02' }),
  ];

  it('keeps Act and Watch, drops Info and a flag with no setup behind it', () => {
    const open = openByRow(flags, {}, HIST).get(rowKeyOf('X', 'long'))!;
    expect(open.map(x => x.kind).sort()).toEqual(['breakout', 'late-entry', 'near-stop', 'pullback']);
  });

  it('drops what has been acknowledged, so a row goes quiet once it has been dealt with', () => {
    const open = openByRow(flags, { 'X|long|breakout|2026-10-30': 1 }, HIST).get(rowKeyOf('X', 'long'))!;
    expect(open.map(x => x.kind)).not.toContain('breakout');
    expect(open.map(x => x.kind)).toContain('pullback');
  });

  it('drops a settled flag nobody acknowledged once five sessions have passed, and keeps what clears itself', () => {
    const later = { X: { ...HIST.X, settled: [...HIST.X.settled, ['2026-11-03', 1], ['2026-11-04', 1], ['2026-11-05', 1], ['2026-11-06', 1], ['2026-11-09', 1]] as [string, number][] } };
    const open = openByRow(flags, {}, later).get(rowKeyOf('X', 'long'))!;
    expect(open.map(x => x.kind).sort()).toEqual(['late-entry', 'near-stop']);
  });

  it('keeps a live flag for as long as it is there: it cannot be acknowledged away', () => {
    const live = f('live-stop', 'live');
    const open = openByRow([live], { [live.id]: 5 }, HIST).get(rowKeyOf('X', 'long'))!;
    expect(open).toHaveLength(1);
  });

  it('keeps a long and a short of the same symbol apart', () => {
    const short = f('breakout', '2026-10-30', { dir: 'short', id: 'X|short|breakout|2026-10-30' });
    const m = openByRow([f('breakout'), short], {}, HIST);
    expect([...m.keys()].sort()).toEqual(['X|long', 'X|short']);
  });
});

describe('sorting the column', () => {
  it('ranks a decision above a look above a date, and a row with nothing last', () => {
    const decision = flagRank([f('breakout')]);
    const look = flagRank([f('pullback'), f('near-stop'), f('boundary')]);
    const date = flagRank([f('earnings-7d', '2026-11-04'), f('exdiv-7d', '2026-11-05')]);
    expect(decision).toBeGreaterThan(look);
    expect(look).toBeGreaterThan(date);
    expect(date).toBeGreaterThan(flagRank([]));
    expect(flagRank(undefined)).toBe(0);
  });

  it('counts more of the same tier as louder', () => {
    expect(flagRank([f('exit'), f('breakout')])).toBeGreaterThan(flagRank([f('exit')]));
  });
});

describe('on the frozen board', () => {
  const rows = frozenBoard().rows;
  const flags = boardFlags(rows, { today: TODAY, nowMs: Date.parse(TODAY + 'T12:00:00Z'), page: 'setups' });
  const open = openByRow(flags, {}, frozenHist());

  it('every row\'s chips are drawn from flags it really has', () => {
    for (const [key, list] of open) {
      for (const c of chipsOf(list)) expect(list.map(x => x.id), key).toContain(c.flag.id);
    }
  });

  it('the chips account for every open flag: one lead each, plus the ones behind it', () => {
    let behind = 0;
    for (const list of open.values()) behind += chipsOf(list).reduce((n, c) => n + 1 + c.more, 0);
    const total = [...open.values()].reduce((n, l) => n + l.length, 0);
    expect(behind).toBe(total);
    expect(total).toBeGreaterThan(0);
  });

  it('every Act and Watch flag that Today lists sits behind a chip on its own row', () => {
    const onToday = flags.filter(x => (x.tier === 'act' || x.tier === 'watch') && x.surfaces.includes('today') && x.sym && x.dir);
    expect(onToday.length).toBeGreaterThan(0);
    for (const x of onToday) {
      const list = open.get(rowKeyOf(x.sym as string, x.dir as string));
      // It may have aged out of the five sessions, in which case Today does not list it either.
      if (!list || !list.some(o => o.id === x.id)) continue;
      const bucket = CALENDAR_KINDS.includes(x.kind) ? 'calendar' : x.tier;
      expect(chipsOf(list).map(c => c.kind), x.id).toContain(bucket);
    }
  });

  it('no row shows more than three chips', () => {
    for (const list of open.values()) expect(chipsOf(list).length).toBeLessThanOrEqual(3);
  });
});
