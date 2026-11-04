import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { render } from 'preact-render-to-string';
import { app } from '../../src/data/app';
import type { AppState } from '../../src/data/app';
import { emptyLog } from '../../src/data/tradelog';
import { DEFAULT_SETTINGS, LIST_BEGAN, PAYOFF_SCALE, TRAIL } from '../../src/engine/backtest/settings';
import { RULES, THRESHOLDS } from '../../src/engine/flags';
import { fmtD } from '../../src/engine/format';
import type { FlagKind } from '../../src/engine/flags';
import { LFD_LOOKBACK } from '../../src/engine/lfd';
import { MA_RULES, MIN_BARS, TF_WORDS, TIERS } from '../../src/engine/ma';
import { FRESH_WITHIN, MIN_SECTOR_PEERS } from '../../src/engine/signals';
import { DataTable } from '../../src/ui/datatable';
import { GROUP_TITLE } from '../../src/ui/flagview';
import { Hero } from '../../src/ui/hero';
import { FlagTable, MethodPage } from '../../src/ui/method';
import { dataRows } from '../../src/ui/methoddata';
import { MorePage } from '../../src/ui/more';
import { Tiles } from '../../src/ui/tiles';
import { TodayPage } from '../../src/ui/today';
import { frozenInputs } from './frozen';
import { buttons } from './vnode';

/* The pages that are mostly words and counts: Method, More, the tiles and the plain list, and the link from Today's data
   lines to Method. The numbers are read back from the data the page was given. */

const NOW = Date.parse('2026-11-01T18:00:00Z');
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

beforeAll(() => {
  const { shared, bars, hist } = frozenInputs();
  app.set({
    phase: 'ready', shared: { watchlist: shared, benchmarks: [] }, hist, now: NOW, liveStatus: 'ok', events: {}, eventsAt: '2026-11-01T09:00:00Z',
    barsFile: { generated_at: '2026-11-01T17:00:00Z', ccy: {}, bars },
    snapshot: { generated_at: '2026-11-01T17:30:00Z', sessions: [], latest: { AME: { c: 1, t: 1 } } },
    tradelog: [], log: emptyLog(), live: null, problems: [],
  });
});
afterAll(() => { app.set({ events: {}, eventsAt: null }); });

describe('every flag rule, as a table', () => {
  const kinds = Object.keys(RULES) as FlagKind[];
  const html = render(<FlagTable />);

  it('has a row for each rule the engine has, with its name and its code name', () => {
    expect((html.match(/class="rulerow"/g) || []).length).toBe(kinds.length);
    for (const k of kinds) {
      expect(html).toContain(GROUP_TITLE[k]);
      expect(html).toContain(`<code>${k}</code>`);
    }
  });

  it('says each rule\'s tier, whether it is live, where it shows and how it clears, in the engine\'s own words', () => {
    const t = text(html);
    for (const k of kinds) {
      const r = RULES[k];
      expect(t).toContain(r.rule.replace(/`/g, ''));
    }
    expect((html.match(/class="rtier act"/g) || []).length).toBe(kinds.filter(k => RULES[k].tier === 'act').length);
    expect((html.match(/class="rtier watch"/g) || []).length).toBe(kinds.filter(k => RULES[k].tier === 'watch').length);
    expect(t).toContain('when acknowledged');
    expect(t).toContain('by itself');
    expect(t).toContain('Setups');
  });

  it('is a table to assistive technology, with a header row', () => {
    expect(html).toContain('role="table"');
    expect(html).toContain('role="columnheader"');
  });
});

describe('the Method page', () => {
  const page = () => text(render(<MethodPage />));

  it('prints the engine\'s own numbers, so the page cannot say one thing while the engine does another', () => {
    const t = page();
    expect(t).toContain(`within ${LFD_LOOKBACK} sessions`);
    expect(t).toContain(`last close within ${THRESHOLDS.nearAtr} ATR`);
    expect(t).toContain(`used ${THRESHOLDS.lateUsed * 100}% of the move`);
    expect(t).toContain(`${THRESHOLDS.expirySessions} sessions of its symbol`);
    expect(t).toContain(`${THRESHOLDS.expiryWeekdays} weekdays`);
    expect(t).toContain(`stale after ${THRESHOLDS.staleTipHours} hours`);
  });

  it('states the rules: the breakout, the negation, the target, the last full day, the four types, the sections', () => {
    const t = page();
    for (const s of ['strictly past the trigger', 'Failed is final', 'last full day', 'B1:', 'B2:', 'B3:', 'B4:', 'Watching; Confirmed', '7 significant digits']) expect(t).toContain(s);
  });

  it('explains Signals in the engine\'s own numbers: the level test, the freshness windows, the scan, the sector', () => {
    const t = page();
    expect(t).toContain('Signals reads every setup still in play');
    expect(t).toContain(`within ${MA_RULES.tolShare * 100}% of the instrument's typical bar-to-bar move`);
    expect(t).toContain(`never under ${MA_RULES.tolFloor * 100}% or over ${MA_RULES.tolCap * 100}%`);
    expect(t).toContain(`in the last ${MA_RULES.testBars} bars`);
    expect(t).toContain(`within ${MA_RULES.stillNear} times that distance`);
    expect(t).toContain(`between ${MA_RULES.slopeFloor} and ${MA_RULES.slopeCap} bars`);
    expect(FRESH_WITHIN.map(f => [f.tf, f.bars])).toEqual([['monthly', 1], ['weekly', 1], ['daily', 2]]);
    expect(t).toContain('within the latest bar on a monthly or weekly chart, or the latest 2 bars on a daily chart, and that the level test calls reclaimed or lost');
    expect(t).toContain('A decisive cross, from far under to far over, is not a level change, but the scan below has it.');
    expect(t).toContain(`${TF_WORDS.daily.lookback} sessions, ${TF_WORDS.weekly.lookback} weeks or ${TF_WORDS.monthly.lookback} months`);
    for (const tier of TIERS) expect(t).toContain(tier.label);
    expect(t).toContain(`needs ${MIN_BARS} bars on a timeframe`);
    expect(t).toContain(`a sector needs ${MIN_SECTOR_PEERS} names (a name listed both long and short counts once)`);
    for (const word of ['held', 'rejected', 'reclaimed', 'lost', 'whipsawed']) expect(t).toContain(word);
    expect(t).toContain('Yahoo pads every weekly and monthly series');
  });

  it('explains the Model in the engine\'s own numbers: the strategies, the fills, the costs, the bootstrap, the day the list began', () => {
    const t = page();
    expect(t).toContain('The Model');
    for (const s of ['S1 plays B1 and B2 only', 'S2 re-enters', 'S3 holds through breaches', 'S4 trails', 'Fills.', 'Nobody buys a breakout whose confirming close is already at the target']) expect(t).toContain(s);
    expect(t).toContain(`${DEFAULT_SETTINGS.commissionPct}% commission and ${DEFAULT_SETTINGS.slippagePct}% slippage a side`);
    expect(t).toContain(`bootstrap of ${DEFAULT_SETTINGS.resamples.toLocaleString('en-US')} resamples`);
    expect(t).toContain(`${TRAIL.atrs} ATRs (Wilder's ${TRAIL.period}-day)`);
    expect(t).toContain(`between ${PAYOFF_SCALE.min}× and ${PAYOFF_SCALE.max}×`);
    expect(t).toContain(`The list began on ${fmtD(LIST_BEGAN)}`);
    expect(t).toContain('enters from the report that listed it');
  });

  it('has a freshness table counted from what is loaded, with the lists\' counts and when each file was written', () => {
    const s = app.get();
    const t = page();
    expect(t).toContain('Data and freshness');
    for (const row of dataRows(s, s.now)) {
      expect(t).toContain(row.name);
      expect(t).toContain(row.detail);
    }
    expect(t).toContain(`${s.shared.watchlist.length} setups`);
  });

  it('says what is missing, as Gaps, when the calendar has holes, and that there are none when there are none', () => {
    // With no events feed loaded every symbol lacks a calendar entry.
    expect(page()).toContain('Gaps today');
    expect(page()).toContain('No earnings or dividend dates for');
    const everyone = Object.fromEntries(app.get().shared.watchlist.map(p => [p.sym, { earnings: '2026-12-01' }]));
    app.set({ events: everyone });
    expect(page()).not.toContain('No earnings or dividend dates for');
    app.set({ events: {} });
  });

  it('says so while it loads, and does not claim a freshness it does not know', () => {
    app.set({ phase: 'loading' });
    const t = page();
    expect(t).toContain('Loading…');
    expect(t).not.toContain('Gaps today');
    app.set({ phase: 'ready' });
  });

  it('follows the list: add rows and the page counts them, because nothing on it types a count in', () => {
    const s = app.get();
    const extra = [1, 2, 3].map(i => ({ sym: 'ZZ' + i, dir: 'long' as const, breakthrough: 10, target: 12, negation: 9 }));
    app.set({ shared: { ...s.shared, watchlist: [...s.shared.watchlist, ...extra] } });
    expect(page()).toContain(`${s.shared.watchlist.length + 3} setups`);
    app.set({ shared: s.shared });
    expect(page()).toContain(`${s.shared.watchlist.length} setups`);
  });
});

describe('the freshness rows', () => {
  const base = (): AppState => app.get();

  it('say how old each file is and what is in it, and are all good when they are fresh', () => {
    const rows = dataRows({ ...base(), snapshot: { generated_at: '2026-11-01T17:30:00Z', sessions: [], latest: { A: { c: 1, t: 1 }, B: { c: 1, t: 1 } } } }, NOW);
    const by = Object.fromEntries(rows.map(r => [r.name, r]));
    expect(by['Latest prices']).toMatchObject({ age: '30 minutes ago', detail: '2 symbols.', tone: 'good' });
    expect(by['Daily bars'].age).toBe('1 hour ago');
    expect(by['Daily bars'].detail).toMatch(/^\d+ symbols, the newest day /);
    expect(by.Journal.detail).toBe('0 fills.');
  });

  it('say whether the weekly and monthly bars are here: when they were written and how many symbols, or why not', () => {
    const series = { generated_at: '2026-11-01T17:03:51Z', weekly: { A: { ccy: null, t: [], c: [] }, B: { ccy: null, t: [], c: [] } }, monthly: { A: { ccy: null, t: [], c: [] } } };
    const row = (o: Partial<AppState>, now = NOW) => dataRows({ ...base(), ...o }, now).find(r => r.name === 'Weekly and monthly bars')!;
    expect(row({ series, seriesStatus: 'ok' })).toMatchObject({ age: '56 minutes ago', detail: '2 symbols weekly, 1 symbol monthly.', tone: 'good' });
    expect(row({ series: null, seriesStatus: 'idle' })).toMatchObject({ detail: 'Fetched when Signals opens.', tone: 'good', at: null });
    expect(row({ series: null, seriesStatus: 'loading' }).detail).toBe('Loading.');
    expect(row({ series: null, seriesStatus: 'failed' })).toMatchObject({ detail: 'Did not load.', tone: 'bad' });
    const old = Date.parse('2026-11-01T17:03:51Z') + 49 * 3_600_000;
    expect(row({ series, seriesStatus: 'ok' }, old)).toMatchObject({ tone: 'warn' });
    expect(row({ series, seriesStatus: 'ok' }, old).detail).toContain('older than 48 hours');
  });

  it('warn that the latest prices are stale once they are older than the engine\'s threshold, and say so in the detail', () => {
    const stale = Date.parse('2026-11-01T17:30:00Z') + (THRESHOLDS.staleTipHours + 1) * 3_600_000;
    const row = dataRows(base(), stale).find(r => r.name === 'Latest prices')!;
    expect(row.tone).toBe('warn');
    expect(row.detail).toContain(`older than ${THRESHOLDS.staleTipHours} hours`);
  });

  it('call a file that has not loaded bad, not fresh', () => {
    const rows = dataRows({ ...base(), snapshot: null, barsFile: null }, NOW);
    expect(rows.find(r => r.name === 'Latest prices')).toMatchObject({ tone: 'bad', detail: 'Not loaded.' });
    expect(rows.find(r => r.name === 'Daily bars')).toMatchObject({ tone: 'bad', detail: 'Not loaded.' });
  });

  it('say what the live quotes did: answered, asking, did not answer, not asked', () => {
    const detail = (liveStatus: AppState['liveStatus']) => dataRows({ ...base(), liveStatus }, NOW).find(r => r.name === 'Live quotes')!;
    expect(detail('ok').detail).toBe('Answered through the Worker.');
    expect(detail('loading').detail).toBe('Asking now.');
    expect(detail('failed')).toMatchObject({ tone: 'warn' });
    expect(detail('failed').detail).toContain('Did not answer');
    expect(detail('idle').detail).toBe('Not asked yet.');
  });

  it('count the lists, and the setups added in this browser, from what is loaded', () => {
    const s = base();
    const added = { sym: 'ZZZ', dir: 'long' as const, breakthrough: 1, target: 2, negation: 0.5 };
    const row = dataRows({ ...s, overlays: { ...s.overlays, watchlist: { added: [added], over: {} } } }, NOW).find(r => r.name === 'Setups')!;
    expect(row.detail).toBe(`${s.shared.watchlist.length + 1} setups and 0 benchmarks, 1 of them added in this browser.`);
  });
});

describe('the More page', () => {
  it('lists the pages that live under it, each a link with a line on what it is', () => {
    const html = render(<MorePage />);
    expect(html).toContain('href="#/model"');
    expect(text(html)).toContain('What to play and how much');
    expect(html).toContain('href="#/signals"');
    expect(html).toContain('href="#/benchmarks"');
    expect(html).toContain('href="#/method"');
    expect(text(html)).toContain('Moving averages, crosses of them, and the day against the index and sector.');
    expect(text(html)).toContain('The same board for the benchmark list.');
    expect(text(html)).toContain('The rules, where the data comes from, and how fresh it is.');
  });
});

describe('the head of a page', () => {
  it('has the title, the line under it, and the refresh button, with whatever else the page adds', () => {
    const html = render(<Hero title="Positions" stamp="3 in trade" actions={<button type="button">Log a fill</button>}><p class="dataline">closes through Fri</p></Hero>);
    expect(html).toContain('<h1>Positions</h1>');
    expect(text(html)).toContain('3 in trade');
    expect(text(html)).toContain('closes through Fri');
    expect(html).toContain('aria-label="Refresh prices"');
    expect(html.indexOf('Log a fill')).toBeLessThan(html.indexOf('Refresh prices'));
  });
});

describe('tiles', () => {
  it('show a label, a number and what it counts', () => {
    const t = text(render(<Tiles label="At a glance" tiles={[{ label: 'In trade', value: '30', sub: '19 confirmed' }, { label: 'Nearest stop', value: 'AME', sub: 'close', tone: 'bad' }]} />));
    expect(t).toBe('In trade 30 19 confirmed Nearest stop AME close');
  });

  it('make a tile a button when it can do something, named for what it does', () => {
    let pressed = 0;
    const tree = Tiles({ label: 'x', tiles: [{ label: 'Nearest stop', value: 'AME', onClick: () => { pressed++; }, action: 'AME long: nearest stop, open details' }, { label: 'Plain', value: '1' }] });
    const b = buttons(tree, 'AME long');
    expect(b).toHaveLength(1);
    (b[0].props.onClick as () => void)();
    expect(pressed).toBe(1);
    expect(render(<Tiles label="x" tiles={[{ label: 'Plain', value: '1' }]} />)).not.toContain('<button');
  });
});

describe('the plain list', () => {
  const rows = [{ id: 'a', sym: 'AME', n: 1 }, { id: 'b', sym: 'NUTX', n: 2 }];
  const cols = [{ key: 'sym', label: 'Symbol', cell: (r: (typeof rows)[number]) => r.sym }, { key: 'n', label: 'Count', cell: (r: (typeof rows)[number]) => String(r.n) }];

  it('is a table on a desktop, with a header and a row for each', () => {
    const h = render(<DataTable rows={rows} cols={cols} label="Things" id="t" narrow={false} rowKey={r => r.id} />);
    expect(h).toContain('<table class="board jtable" id="t" aria-label="Things">');
    expect((h.match(/<th /g) || []).length).toBe(2);
    expect((h.match(/<tr>/g) || []).length).toBe(1 + rows.length);
  });

  it('leaves a figure with nothing to say off a card, and out of its table cell', () => {
    const blank = [{ id: 'a', sym: 'AME', n: 0 }];
    const withNull = [cols[0], { key: 'n', label: 'Count', cell: () => null }];
    const card = render(<DataTable rows={blank} cols={withNull} label="Things" id="t" narrow rowKey={r => r.id} />);
    expect(card).not.toContain('<dt>Count</dt>');
    expect(render(<DataTable rows={blank} cols={withNull} label="Things" id="t" narrow={false} rowKey={r => r.id} />)).toContain('<td></td>');
  });

  it('is cards on a phone, led by the first column, the rest as labelled figures', () => {
    const h = render(<DataTable rows={rows} cols={cols} label="Things" id="t" narrow rowKey={r => r.id} />);
    expect(h).not.toContain('<table');
    expect((h.match(/<li class="card"/g) || []).length).toBe(2);
    expect(h).toContain('<dt>Count</dt>');
    expect(h).not.toContain('<dt>Symbol</dt>');
  });
});

describe('a data gap on Today', () => {
  it('links to the Method page, where it is explained', () => {
    app.set({ events: {} });
    const html = render(<TodayPage />);
    expect(html).toContain('class="dataline warn"');
    expect(html).toContain('class="datalink" href="#/method"');
  });
});
