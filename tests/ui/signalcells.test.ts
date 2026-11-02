import { describe, expect, it } from 'vitest';
import { MINUS } from '../../src/engine/format';
import { TF_WORDS } from '../../src/engine/ma';
import type { Timeframe } from '../../src/engine/ma';
import type { Row } from '../../src/engine/row';
import { ladderOf, MIN_SECTOR_PEERS } from '../../src/engine/signals';
import type { MaColumn, Relative, Scan, ScanHit, StructureEvent } from '../../src/engine/signals';
import {
  agoWords, averageColumns, averageSort, changeText, crossAgo, forSetup, maCell, scanEmpty, scanNote, signalTiles, vsIndexCell, vsSectorCell,
} from '../../src/ui/signalcells';

/* What the Signals page says in each figure, read as data. The arithmetic is the engine's and is checked against the old
   site's code elsewhere; here it is the wording, the tones and the columns. */

const flat = (n: number) => Array<number>(n).fill(100);
/** Ends above its 50 after sitting just under it: reclaimed. */
const reclaimed = [...flat(205), ...Array<number>(10).fill(102), 100.2, 101.8, 101.9, 102, 102.1];
/** A steady climb, far above every average. */
const climbing = Array.from({ length: 260 }, (_, i) => 100 + i);
/** A steady fall, far below every average. */
const falling = Array.from({ length: 260 }, (_, i) => 400 - i);

const column = (vals: number[], tf: Timeframe, period: number): MaColumn => ladderOf(vals, tf).find(c => c.period === period) as MaColumn;

describe('an average\'s cell', () => {
  it('says which side the close is on and how far, in green above and red below, with a real minus', () => {
    const up = maCell(column(climbing, 'daily', 21), 'daily');
    expect(up.value).toMatch(/^▲ \+\d+\.\d%$/);
    expect(up.tone).toBe('good');
    const down = maCell(column(falling, 'daily', 21), 'daily');
    expect(down.value).toMatch(new RegExp('^▼ ' + MINUS + '\\d+\\.\\d%$'));
    expect(down.tone).toBe('bad');
  });

  it('adds the way the average is heading on the lines that carry it, and nothing on the others', () => {
    expect(maCell(column(climbing, 'daily', 150), 'daily').sub).toBe('↑');
    expect(maCell(column(falling, 'daily', 150), 'daily').sub).toBe('↓');
    const plain = maCell(column(climbing, 'daily', 21), 'daily');
    expect(plain.sub).toBeUndefined();
    expect(plain.subTone).toBeUndefined();
  });

  it('leaves the level test unsaid on a line that does not carry it, even when the close has just come back to it', () => {
    // A 50 is not a tagged line on the daily timeframe: the read has a state, the cell does not say it.
    const c = column(reclaimed, 'daily', 50);
    expect(c.read && c.read.state).toBe('reclaimed');
    expect(maCell(c, 'daily').sub).toBeUndefined();
    // The same read on a tagged line is said.
    expect(maCell({ ...c, tagged: true }, 'daily').sub).toBe('reclaimed');
  });

  it('does not say in the tooltip a level test the cell does not show: only the lines that carry it', () => {
    const c = column(reclaimed, 'daily', 50);
    expect(c.read && c.read.state).toBe('reclaimed');
    expect(maCell(c, 'daily').title).not.toContain('Tested lately');
    expect(maCell({ ...c, tagged: true }, 'daily').title).toContain('Tested lately: reclaimed.');
    // Which side the close is on, and when it last changed sides, are still there.
    expect(maCell(c, 'daily').title).toMatch(/^Above the 50-day average/);
    expect(maCell(c, 'daily').title).toContain('Last changed sides');
  });

  it('colours the level test: held and reclaimed green, rejected and lost red', () => {
    const mk = (state: 'held' | 'rejected' | 'reclaimed' | 'lost'): MaColumn => ({
      period: 200, tagged: true, slope: null,
      read: { ma: 100, dist: 1, state, crossedAgo: null, above: state === 'held' || state === 'reclaimed', tol: 0.01 },
    });
    expect(maCell(mk('held'), 'daily')).toMatchObject({ sub: 'held', subTone: 'good' });
    expect(maCell(mk('reclaimed'), 'daily')).toMatchObject({ sub: 'reclaimed', subTone: 'good' });
    expect(maCell(mk('rejected'), 'daily')).toMatchObject({ sub: 'rejected', subTone: 'bad' });
    expect(maCell(mk('lost'), 'daily')).toMatchObject({ sub: 'lost', subTone: 'bad' });
  });

  it('writes the sentence in the timeframe\'s own words, with the average\'s level and the way it is heading', () => {
    const t = maCell(column(climbing, 'weekly', 30), 'weekly').title as string;
    expect(t).toMatch(/^Above the 30-week average, which sits at /);
    expect(t).toContain('is rising');
    const m = maCell(column(falling, 'monthly', 10), 'monthly').title as string;
    expect(m).toMatch(/^Below the 10-month average/);
  });

  it('is a dash, with the reason, where there are too few closes for the average', () => {
    const c = column(climbing.slice(0, 30), 'daily', 150);
    expect(maCell(c, 'daily')).toEqual({ value: '–', title: 'Not enough closes yet for a 150-day average.' });
    expect(maCell(ladderOf(null, 'weekly')[1], 'weekly').title).toBe('Not enough closes yet for a 30-week average.');
  });
});

describe('the day against the index and the sector', () => {
  const rel = (o: Partial<Relative>): Relative => ({ day: 1.2, index: '^GSPC', indexDay: 0.2, vsIndex: 1, peers: 5, sectorDay: 0.3, vsSector: 0.9, ...o });

  it('is points ahead or behind, with a real minus, named for the index and the sector it was read against', () => {
    expect(vsIndexCell(rel({}), 'US')).toMatchObject({ value: '+1pp', sub: '^GSPC' });
    expect(vsIndexCell(rel({ vsIndex: -0.8 }), 'US').value).toBe(MINUS + '0.8pp');
    expect(vsSectorCell(rel({}), 'Tech')).toMatchObject({ value: '+0.9pp', sub: 'Tech' });
  });

  it('is coloured only when it is a point and a half ahead or behind', () => {
    expect(vsIndexCell(rel({ vsIndex: 1.5 }), 'US').tone).toBe('good');
    expect(vsIndexCell(rel({ vsIndex: -1.5 }), 'US').tone).toBe('bad');
    expect(vsIndexCell(rel({ vsIndex: 1.4 }), 'US').tone).toBeUndefined();
    expect(vsSectorCell(rel({ vsSector: -2 }), 'Tech').tone).toBe('bad');
  });

  it('explains the figure in the moves it comes from, in the tooltip', () => {
    expect(vsIndexCell(rel({}), 'US').title).toBe('+1.2% on the day, against +0.2% for ^GSPC, in percentage points.');
    expect(vsSectorCell(rel({}), 'Tech').title).toBe('+1.2% on the day, against a median of +0.3% across the 5 setups in Tech on the list, in percentage points.');
  });

  it('is a dash that says why: no index for the country, no day move, too few names in the sector', () => {
    expect(vsIndexCell(rel({ vsIndex: null, index: null }), 'UAE').title).toBe('No index is read for UAE.');
    expect(vsIndexCell(rel({ vsIndex: null, index: null }), undefined).title).toBe('No country on file for this setup.');
    expect(vsIndexCell(rel({ vsIndex: null, day: null }), 'US').title).toBe('No day move for this name yet.');
    expect(vsIndexCell(rel({ vsIndex: null, indexDay: null }), 'US').title).toBe('No day move for ^GSPC yet.');
    expect(vsSectorCell(rel({ vsSector: null, peers: 2 }), 'Tech').title).toBe(`Only 2 setups have a day move in Tech; a median needs ${MIN_SECTOR_PEERS}.`);
    expect(vsSectorCell(rel({ vsSector: null, peers: 1 }), 'Tech').title).toContain('Only 1 setup has a day move');
    expect(vsSectorCell(rel({ vsSector: null }), null).title).toBe('No sector on file for this setup.');
    expect(vsSectorCell(rel({ vsSector: null, day: null }), 'Tech').title).toBe('No day move for this name yet.');
    for (const c of [vsIndexCell(rel({ vsIndex: null }), 'US'), vsSectorCell(rel({ vsSector: null }), 'Tech')]) expect(c.value).toBe('–');
  });
});

describe('the averages table\'s columns', () => {
  const none = (): MaColumn[] => [];
  const noRel = (): Relative => ({ day: null, index: null, indexDay: null, vsIndex: null, peers: 0, sectorDay: null, vsSector: null });

  it('are the section, then each period the timeframe shows, then the day against the index and the sector', () => {
    const keys = (tf: Timeframe) => averageColumns(tf, none, noRel).map(c => c.key);
    expect(keys('daily')).toEqual(['section', 'ma5', 'ma21', 'ma50', 'ma150', 'ma200', 'vsindex', 'vssector']);
    expect(keys('weekly')).toEqual(['section', 'ma10', 'ma30', 'ma40', 'ma200', 'vsindex', 'vssector']);
    expect(keys('monthly')).toEqual(['section', 'ma10', 'ma12', 'ma20', 'vsindex', 'vssector']);
  });

  it('are headed with the period and its unit, and say what the sub-line is on the lines that have one', () => {
    const cols = (tf: Timeframe) => averageColumns(tf, none, noRel).filter(c => c.key.startsWith('ma'));
    expect(cols('daily').map(c => c.label)).toEqual(['5d', '21d', '50d', '150d', '200d']);
    expect(cols('weekly').map(c => c.label)).toEqual(['10w', '30w', '40w', '200w']);
    expect(cols('monthly').map(c => c.label)).toEqual(['10mo', '12mo', '20mo']);
    expect(cols('daily').filter(c => c.sub).map(c => c.key)).toEqual(['ma150', 'ma200']);
    expect(cols('weekly').filter(c => c.sub).map(c => c.key)).toEqual(['ma30', 'ma40', 'ma200']);
    expect(cols('monthly').filter(c => c.sub).map(c => c.key)).toEqual(['ma10', 'ma20']);
    expect(TF_WORDS.monthly.unit).toBe('mo');
  });

  it('sort by each of their own figures, and by the section in the board\'s order', () => {
    const sort = averageSort('daily', r => ladderOf((r as unknown as { closes: number[] }).closes, 'daily'), r => (r as unknown as { rel: Relative }).rel);
    const row = (closes: number[], section: string, rel: Partial<Relative> = {}) => ({ closes, section, rel: { ...noRel(), ...rel } }) as unknown as Row;
    const up = row(climbing, 'breakout', { vsIndex: 2, vsSector: -1 });
    expect(sort(up, 'ma200')).toBeGreaterThan(0);
    expect(sort(row(falling, 'watch'), 'ma200')).toBeLessThan(0);
    expect(sort(up, 'vsindex')).toBe(2);
    expect(sort(up, 'vssector')).toBe(-1);
    expect(sort(row(climbing, 'watch'), 'section')).toBeLessThan(sort(up, 'section') as number);
    expect(sort(up, 'nothing')).toBeUndefined();
    expect(sort(row(climbing.slice(0, 20), 'watch'), 'ma200')).toBeNull();
  });
});

describe('a change of sides, in words', () => {
  const ev = (o: Partial<StructureEvent>): StructureEvent => ({ row: {} as Row, tf: 'monthly', period: 200, state: 'reclaimed', ago: 0, ma: 10, dist: 1, helps: true, ...o });

  it('names what happened: reclaimed or lost, on which timeframe, which average', () => {
    expect(changeText(ev({}))).toBe('reclaimed its monthly 200');
    expect(changeText(ev({ tf: 'daily', period: 150, state: 'lost' }))).toBe('lost its daily 150');
  });

  it('says when, in the timeframe\'s own unit', () => {
    expect(agoWords(0, 'daily')).toBe('on the latest close');
    expect(agoWords(0, 'weekly')).toBe('on the latest week');
    expect(agoWords(0, 'monthly')).toBe('on the latest month');
    expect(agoWords(1, 'daily')).toBe('1 session ago');
    expect(agoWords(2, 'daily')).toBe('2 sessions ago');
    expect(agoWords(1, 'weekly')).toBe('1 week ago');
    expect(agoWords(1, 'monthly')).toBe('1 month ago');
  });

  it('says whether it is the setup\'s way, in the colour that means it', () => {
    expect(forSetup(ev({ helps: true }))).toEqual({ text: "the setup's way", tone: 'good' });
    expect(forSetup(ev({ helps: false }))).toEqual({ text: 'against the setup', tone: 'bad' });
  });
});

describe('the cross scan, in words', () => {
  const scan = (o: Partial<Scan>): Scan => ({ tf: 'daily', lookback: 10, covered: 8, total: 10, hits: [], ...o });
  const hit = (o: Partial<ScanHit>): ScanHit => ({ key: 'px50', label: 'price × 50', bullish: true, ago: 0, whip: false, row: {} as Row, ...o });

  it('says how long ago a cross was, in the timeframe\'s short unit', () => {
    expect(crossAgo(hit({ ago: 0 }), 'daily')).toBe('latest close');
    expect(crossAgo(hit({ ago: 3 }), 'daily')).toBe('3d ago');
    expect(crossAgo(hit({ ago: 2 }), 'weekly')).toBe('2w ago');
    expect(crossAgo(hit({ ago: 5 }), 'monthly')).toBe('5mo ago');
  });

  it('says how far back it looked and how many names had the history for it, and nothing for an empty group, which says so itself', () => {
    expect(scanNote(scan({}))).toBe('Crosses in the last 10 sessions · 8 of 10 with enough history');
    expect(scanNote(scan({ tf: 'weekly', lookback: 13, covered: 0 }))).toBe('Crosses in the last 13 weeks · 0 of 10 with enough history');
    expect(scanNote(scan({ total: 0, covered: 0 }))).toBeNull();
  });

  it('says what it is not showing, and why: nothing to scan, none with the 220 bars, no crosses', () => {
    expect(scanEmpty(scan({ total: 0, covered: 0 }))).toBe('Nothing in this group to scan.');
    expect(scanEmpty(scan({ tf: 'monthly', lookback: 12, covered: 0 }))).toBe('None of these carry the 220 months a 200-period average needs.');
    expect(scanEmpty(scan({ tf: 'weekly', lookback: 13 }))).toBe('No crosses in the last 13 weeks.');
    expect(scanEmpty(scan({ hits: [hit({})] }))).toBeNull();
  });
});

describe('the tiles', () => {
  const scans = (n: Record<Timeframe, [bull: number, bear: number]>): Record<Timeframe, Scan> => {
    const mk = (tf: Timeframe): Scan => ({
      tf, lookback: TF_WORDS[tf].lookback, covered: n[tf][0] + n[tf][1] ? 7 : 0, total: 9,
      hits: [...Array(n[tf][0]).fill(0).map(() => ({ bullish: true })), ...Array(n[tf][1]).fill(0).map(() => ({ bullish: false }))] as unknown as ScanHit[],
    });
    return { daily: mk('daily'), weekly: mk('weekly'), monthly: mk('monthly') };
  };
  const events = (tfs: Timeframe[]): StructureEvent[] => tfs.map(tf => ({ tf }) as unknown as StructureEvent);
  const nothing = { changes: () => {}, scan: () => {} };

  it('lead with the fresh changes, split by timeframe in the order that ranks them, then the crosses on each timeframe', () => {
    const t = signalTiles(events(['daily', 'monthly', 'daily', 'weekly']), scans({ daily: [3, 2], weekly: [1, 0], monthly: [0, 0] }), nothing);
    expect(t.map(x => x.label)).toEqual(['Level changes', 'Crosses, daily', 'Crosses, weekly', 'Crosses, monthly']);
    expect(t[0]).toMatchObject({ value: '4', sub: '1 monthly · 1 weekly · 2 daily' });
    expect(t[1]).toMatchObject({ value: '5', sub: '3 bullish · 2 bearish · 7 names scanned' });
    expect(t[3]).toMatchObject({ value: '0', sub: 'no name has the history yet' });
  });

  it('say, while the weekly and monthly bars are loading or did not load, that they are not counted, and count nothing for them', () => {
    const all = scans({ daily: [3, 2], weekly: [0, 0], monthly: [0, 0] });
    const loading = signalTiles(events(['daily', 'daily']), all, nothing, 'loading');
    expect(loading[0].sub).toBe('2 daily · weekly and monthly loading');
    expect(loading[1]).toMatchObject({ value: '5', sub: '3 bullish · 2 bearish · 7 names scanned' });
    expect(loading[2]).toMatchObject({ value: '–', sub: 'loading the bars…' });
    expect(loading[3]).toMatchObject({ value: '–', sub: 'loading the bars…' });
    const failed = signalTiles([], all, nothing, 'failed');
    expect(failed[0].sub).toBe('nothing fresh on a 150 or 200 · weekly and monthly not loaded');
    expect(failed[2]).toMatchObject({ value: '–', sub: 'the bars did not load' });
    expect(failed[1].value).toBe('5');
    // Once they are here the same tiles count.
    expect(signalTiles([], all, nothing, 'ready')[2]).toMatchObject({ value: '0', sub: 'no name has the history yet' });
  });

  it('name their figure in the button, so a screen reader hears the count and not only what the tile opens', () => {
    const t = signalTiles(events(['daily', 'monthly']), scans({ daily: [3, 2], weekly: [1, 0], monthly: [0, 0] }), nothing);
    expect(t.map(x => x.action)).toEqual([
      'Level changes, 2: open the list', 'Crosses, daily, 5: open the scan', 'Crosses, weekly, 1: open the scan', 'Crosses, monthly, 0: open the scan',
    ]);
    expect(signalTiles([], scans({ daily: [0, 0], weekly: [0, 0], monthly: [0, 0] }), nothing, 'failed')[2].action).toBe('Crosses, weekly, not loaded: open the scan');
  });

  it('say what a level change is: a change of sides that is still near the line, on the latest bar or the latest two sessions', () => {
    const title = signalTiles([], scans({ daily: [0, 0], weekly: [0, 0], monthly: [0, 0] }), nothing)[0].title as string;
    expect(title).toContain('still near it (reclaimed or lost)');
    expect(title).toContain('on the latest bar of a weekly or monthly chart');
    expect(title).toContain('within the latest two sessions of a daily one');
  });

  it('say so when nothing has changed sides', () => {
    expect(signalTiles([], scans({ daily: [0, 0], weekly: [0, 0], monthly: [0, 0] }), nothing)[0]).toMatchObject({ value: '0', sub: 'nothing fresh on a 150 or 200' });
  });

  it('each open what they count: the list, or the scan on that timeframe', () => {
    const opened: string[] = [];
    const t = signalTiles([], scans({ daily: [0, 0], weekly: [0, 0], monthly: [0, 0] }), { changes: () => opened.push('changes'), scan: tf => opened.push('scan ' + tf) });
    t.forEach(x => x.onClick!());
    expect(opened).toEqual(['changes', 'scan daily', 'scan weekly', 'scan monthly']);
    expect(t.every(x => !!x.action)).toBe(true);
  });
});
