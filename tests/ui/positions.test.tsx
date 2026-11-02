import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { render } from 'preact-render-to-string';
import { ackStore } from '../../src/data/acks';
import { app } from '../../src/data/app';
import { boardView, flagsOf } from '../../src/data/selectors';
import { emptyLog } from '../../src/data/tradelog';
import { chipsOf, openByRow } from '../../src/engine/chips';
import { positionOf, positionsView } from '../../src/engine/positions';
import type { Position } from '../../src/engine/positions';
import { MINUS } from '../../src/engine/format';
import type { Fill } from '../../src/engine/journal';
import { DEFAULT_SORT, sortRows } from '../../src/ui/columns';
import { daysCell, ladderColumns, ladderSort, rCell, stopCell } from '../../src/ui/positioncells';
import { nearestTile, PositionsPage } from '../../src/ui/positions';
import { frozenBoard, frozenHist, frozenInputs, TODAY } from './frozen';

/* The Positions page, rendered to a string and read. Every number a test expects is read back from the engine's view of
   the same data, so the weekly changes to the list cannot break one. */

const NOW = Date.parse('2026-11-01T18:00:00Z');
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

beforeAll(() => {
  const { shared, bars, hist } = frozenInputs();
  app.set({
    phase: 'ready', shared: { watchlist: shared, benchmarks: [] }, hist, now: NOW, liveStatus: 'ok', events: {},
    barsFile: { generated_at: '2026-11-01T17:00:00Z', ccy: {}, bars },
    snapshot: { generated_at: '2026-11-01T17:30:00Z', sessions: [], latest: {} },
    tradelog: [], log: emptyLog(),
  });
});
afterAll(() => { app.set({ log: emptyLog() }); });

const view = () => {
  const s = app.get();
  const { bd, today } = boardView(s, 'watchlist');
  return positionsView(bd, s.hist, flagsOf(s, 'watchlist'), today);
};

describe('the cells', () => {
  const pos = (over: Partial<Position>): Position => {
    const row = frozenBoard().bySection.breakout[0];
    return { ...positionOf(row, frozenHist()[row.p.sym], TODAY), ...over };
  };

  it('the stop says the level, how far the price is from it, in per cent and in ATRs', () => {
    const c = stopCell(pos({ stop: { level: 236, kind: 'last full day' }, gapPct: 4.4, atrs: 3.4 }));
    expect(c.value).toBe('236');
    expect(c.sub).toBe(MINUS + '4.4% · 3.4 ATR');
    expect(c.subTone).toBeUndefined();
    expect(c.title).toContain('The last full day');
    expect(c.title).toContain('4.4% above it (3.4 ATR)');
  });

  it('a stop within an ATR is amber, and one the price is past is red', () => {
    expect(stopCell(pos({ gapPct: 2, atrs: 0.8 })).subTone).toBe('warn');
    const past = stopCell(pos({ gapPct: -1.2, atrs: -0.4 }));
    expect(past.subTone).toBe('bad');
    expect(past.sub).toBe('past it');
  });

  it('says it is the negation when there is no tight stop, and that there is no stop when there is none', () => {
    const neg = stopCell(pos({ stop: { level: 90, kind: 'negation' }, gapPct: 12, atrs: 4 }));
    expect(neg.sub).toContain('negation');
    expect(neg.title).toContain('No tight stop is on file');
    const none = stopCell(pos({ stop: null, gapPct: null, atrs: null }));
    expect(none).toMatchObject({ value: '–', sub: 'no stop on file' });
  });

  it('R says how many multiples of the risk the trade has made, signed, with what it is measured from', () => {
    const e = { when: '2026-10-29', price: 251.78, kind: 'reentry' as const };
    const c = rCell(pos({ r: 0.84, entry: e, stop: { level: 236, kind: 'last full day' } }));
    expect(c).toMatchObject({ value: '+0.8R', tone: 'good', sub: 're-entered 251.8' });
    expect(c.title).toContain('29-10-26');
    expect(rCell(pos({ r: -0.66, entry: e, stop: { level: 236, kind: 'last full day' } }))).toMatchObject({ value: MINUS + '0.7R', tone: 'bad' });
    expect(rCell(pos({ r: 0, entry: e, stop: { level: 236, kind: 'last full day' } })).tone).toBeUndefined();
  });

  it('R says why it is unknown', () => {
    expect(rCell(pos({ r: null, entry: { when: '2026-10-29', price: null, kind: 'confirmation' } })).sub).toBe('no entry close');
    expect(rCell(pos({ r: null, entry: { when: '2026-10-29', price: 100, kind: 'confirmation' }, stop: null })).sub).toBe('no stop');
  });

  it('the days say how long, and since when', () => {
    expect(daysCell(pos({ days: 17, entry: { when: '2026-10-16', price: 1, kind: 'confirmation' } }))).toMatchObject({ value: '17d', sub: 'since 16-10-26' });
    expect(daysCell(pos({ days: 4, entry: { when: '2026-10-29', price: 1, kind: 'reentry' } })).sub).toBe('re-entry 29-10-26');
    expect(daysCell(pos({ days: null, entry: null })).value).toBe('–');
  });

  it('the ladder\'s columns end with the Flags column, and its headers sort by the ladder\'s own values', () => {
    const v = view();
    const by = new Map(v.ladder.map(p => [p.row, p] as const));
    const posOf = (r: Parameters<typeof ladderSort>[0] extends (r: infer R) => unknown ? R : never) => by.get(r)!;
    const cols = ladderColumns(posOf, TODAY);
    expect(cols.map(c => c.label)).toEqual(['Stop', 'Trailing stop', 'R so far', 'In trade', 'Flags']);
    expect(cols[cols.length - 1].key).toBe('flags');
    const rows = v.ladder.map(p => p.row);
    const byStop = sortRows(rows, cols, ['stop', true], { extra: ladderSort(posOf) });
    expect(byStop.map(r => posOf(r).gapPct).filter(g => g != null)).toEqual(v.ladder.map(p => p.gapPct).filter(g => g != null));
    const byR = sortRows(rows, cols, ['r', false], { extra: ladderSort(posOf) }).map(r => posOf(r).r).filter((x): x is number => x != null);
    expect(byR).toEqual([...byR].sort((a, b) => b - a));
    const byDays = sortRows(rows, cols, ['days', false], { extra: ladderSort(posOf) }).map(r => posOf(r).days).filter((x): x is number => x != null);
    expect(byDays).toEqual([...byDays].sort((a, b) => b - a));
  });
});

describe('the nearest-stop tile', () => {
  it('names the symbol and says how near, and opens its setup', () => {
    const v = view();
    let opened = '';
    const t = nearestTile(v.tiles.nearest, r => { opened = r.p.sym; });
    expect(t.value).toBe(v.tiles.nearest!.row.p.sym);
    expect(t.sub).toMatch(/from the (last full day|negation)|past the/);
    t.onClick!();
    expect(opened).toBe(t.value);
  });

  it('says there is nothing to measure when there is no stop', () => {
    expect(nearestTile(null, () => {})).toEqual({ label: 'Nearest stop', value: '–', sub: 'no stop to measure yet' });
  });
});

describe('the page', () => {
  const html = () => render(<PositionsPage />);

  it('opens with the counts of what is in trade and what is stopped out, from the engine', () => {
    const v = view();
    const t = text(html());
    expect(t).toContain('Positions');
    expect(t).toContain(`${v.tiles.inTrade} in trade · ${v.tiles.stopped} stopped out`);
    for (const label of ['In trade', 'Stopped out', 'Nearest stop', 'Next 7 days']) expect(t).toContain(label);
  });

  it('draws one row for each rung of the ladder, nearest stop first, and one for each stopped-out setup', () => {
    const v = view();
    const h = html();
    const ladder = h.split('id="ladder-panel"')[1].split('id="stopped-panel"')[0];
    const syms = [...ladder.matchAll(/class="symbtn"[^>]*>([^<]+)</g)].map(m => m[1]);
    expect(syms).toEqual(v.ladder.map(p => p.row.p.sym));
    const stopped = h.split('id="stopped-panel"')[1];
    expect([...stopped.matchAll(/class="symbtn"[^>]*>([^<]+)</g)].map(m => m[1]).sort()).toEqual(v.stopped.map(r => r.p.sym).sort());
  });

  it('has the ladder\'s headers, and the stopped-out list is the board\'s own table for that section', () => {
    const h = html();
    for (const label of ['Stop', 'Trailing stop', 'R so far', 'In trade', 'Flags']) expect(h).toContain('>' + label);
    const stopped = h.split('id="stopped-panel"')[1];
    for (const label of ['Trigger', 'Breaches', 'Negation']) expect(stopped).toContain('>' + label);
    expect(stopped).toContain('>Flags');
  });

  it('marks a row held when the journal has a position open on it, and only then', () => {
    const v = view();
    const first = v.ladder[0].row.p;
    expect(html()).not.toContain('class="heldpill"');
    const fill: Fill = { id: 'f1', sym: first.sym, side: first.dir === 'long' ? 'buy' : 'sell', date: '2026-10-28', price: 10, logged_at: '2026-10-28T10:00:00Z' };
    app.set({ log: { ...emptyLog(), added: [fill] } });
    const h = html();
    expect((h.match(/class="heldpill"/g) || []).length).toBe(1);
    expect(h).toContain('title="Open in your journal: ' + (fill.side === 'buy' ? 'bought' : 'sold') + ' 28-10-26 @ 10"');
    // The other direction's fill is another position: it does not mark this one.
    app.set({ log: { ...emptyLog(), added: [{ ...fill, side: fill.side === 'buy' ? 'sell' : 'buy' }] } });
    expect(html()).not.toContain('class="heldpill"');
    app.set({ log: emptyLog() });
  });

  it('says what it is when nothing is in trade, rather than drawing an empty table', () => {
    const { bd } = boardView(app.get(), 'watchlist');
    const empty = positionsView({ ...bd, bySection: { ...bd.bySection, breakout: [], reentered: [] } }, app.get().hist, [], TODAY);
    expect(empty.ladder).toEqual([]);
    expect(empty.tiles).toMatchObject({ inTrade: 0, nearest: null, events: 0 });
  });

  it('agrees with the Confirmed section about who is nearest its stop', () => {
    const { bd } = boardView(app.get(), 'watchlist');
    const section = sortRows(bd.bySection.breakout, 'breakout', DEFAULT_SORT.breakout);
    const hasStop = (p: Position) => p.row.section === 'breakout' && p.row.lfd && p.row.lfd.at != null && !p.row.lfd.looser && p.row.live;
    const ladderFirst = view().ladder.find(hasStop);
    const sectionFirst = section.find(r => r.lfd && r.lfd.at != null && !r.lfd.looser && r.live);
    expect(ladderFirst && ladderFirst.row).toBe(sectionFirst);
  });
});

describe('the flags behind the ladder', () => {
  it('a rung\'s chips are the same open flags Today and the board draw: as many chips as the rows have', () => {
    const s = app.get();
    const open = openByRow(flagsOf(s, 'watchlist'), ackStore.get().acks.watchlist, s.hist);
    const v = view();
    const want = v.ladder.reduce((n, p) => n + chipsOf(open.get(p.key) ?? []).length, 0);
    const h = render(<PositionsPage />);
    const ladder = h.split('id="ladder-panel"')[1].split('id="stopped-panel"')[0];
    expect((ladder.match(/class="fchip /g) || []).length).toBe(want);
    expect(want).toBeGreaterThan(0);
  });
});
