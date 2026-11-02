import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { render } from 'preact-render-to-string';
import { app } from '../../src/data/app';
import { boardView } from '../../src/data/selectors';
import { emptyLog } from '../../src/data/tradelog';
import { TIERS, TIMEFRAMES } from '../../src/engine/ma';
import type { Timeframe } from '../../src/engine/ma';
import type { Row } from '../../src/engine/row';
import { closeSource, isLive, ladderOf, relatives, scanOf, scanRows, structureEvents } from '../../src/engine/signals';
import type { Relative, Scan, SeriesEntry, SeriesFile, StructureEvent } from '../../src/engine/signals';
import { AveragesPanel, ChangesPanel, ScanPanel, SignalsPage } from '../../src/ui/signals';
import { scanNote } from '../../src/ui/signalcells';
import { frozenInputs } from './frozen';

/* The Signals page, rendered to a string and read. Every count is read back from the engine's own view of the same data;
   the weekly and monthly closes are made up here (a smooth wave per symbol), since what is under test is the page. */

const NOW = Date.parse('2026-11-01T18:00:00Z');
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

function syntheticSeries(syms: string[]): SeriesFile {
  const weekly: Record<string, SeriesEntry> = {}, monthly: Record<string, SeriesEntry> = {};
  syms.forEach((sym, k) => {
    const wave = (n: number) => Array.from({ length: n }, (_, i) => 100 + 12 * Math.sin(i / 9 + k) + i * 0.08);
    weekly[sym] = { ccy: 'USD', t: Array.from({ length: 262 }, (_, i) => Date.UTC(2021, 10, 1 + 7 * i, 4) / 1000), c: wave(262) };
    monthly[sym] = { ccy: 'USD', t: Array.from({ length: 240 }, (_, i) => Date.UTC(2006 + Math.floor(i / 12), i % 12, 1, 4) / 1000), c: wave(240) };
  });
  return { generated_at: '2026-11-01T17:03:51Z', weekly, monthly };
}

const state = () => {
  const s = app.get();
  const { bd } = boardView(s, 'watchlist');
  const vals = closeSource(s.hist, s.series);
  return { s, bd, vals, live: bd.rows.filter(isLive) };
};

beforeAll(() => {
  const { shared, bars, hist } = frozenInputs();
  app.set({
    phase: 'ready', shared: { watchlist: shared, benchmarks: [] }, hist, now: NOW, liveStatus: 'ok', events: {}, eventsAt: null,
    barsFile: { generated_at: '2026-11-01T17:00:00Z', ccy: {}, bars },
    snapshot: { generated_at: '2026-11-01T17:30:00Z', sessions: [], latest: {} },
    tradelog: [], log: emptyLog(), live: null, problems: [],
    series: syntheticSeries(Object.keys(hist)), seriesStatus: 'ok',
  });
});
afterAll(() => { app.set({ series: null, seriesStatus: 'idle' }); });
afterEach(() => { vi.unstubAllGlobals(); });

/** The browser's storage, for the choices a page remembers. */
const remember = (o: Record<string, string>) => {
  vi.stubGlobal('localStorage', { getItem: (k: string) => (k in o ? o[k] : null), setItem: () => {} });
};

describe('the page', () => {
  it('opens on the fresh changes of sides, with a figure for each of them and the crosses on each timeframe', () => {
    const { live, bd, vals } = state();
    const events = structureEvents(bd.rows, vals);
    const t = text(render(<SignalsPage />));
    expect(t).toContain('Signals');
    expect(t).toContain(`${live.length} in play`);
    for (const label of ['Level changes', 'Crosses, daily', 'Crosses, weekly', 'Crosses, monthly']) expect(t).toContain(label);
    expect(t).toMatch(new RegExp(`Level changes ${events.length}\\b`));
    expect(t).toContain('Cross scan');
    expect(t).toMatch(new RegExp(`Averages ${live.length}\\b`));
  });

  it('lists every setup in play on the averages view, and none that has failed or been removed', () => {
    remember({ 'mc-seg-signals': 'averages' });
    const { live, bd } = state();
    const html = render(<SignalsPage />);
    expect((html.match(/<tr class="row"/g) || []).length).toBe(live.length);
    expect(live.length).toBeLessThan(bd.rows.length);
  });

  it('lists a row for each fresh change on the changes view', () => {
    const { bd, vals } = state();
    const events = structureEvents(bd.rows, vals);
    const html = render(<SignalsPage />);
    if (events.length) expect((html.match(/<tr>/g) || []).length - 1).toBe(events.length);
    else expect(text(html)).toContain('Nothing has changed sides on a 150 or 200 lately.');
  });

  it('says where the weekly and monthly bars are from, and that they are refreshed about daily', () => {
    expect(text(render(<SignalsPage />))).toMatch(/Weekly and monthly bars from .*refreshed about daily/);
  });

  it('gives each tile the number the engine finds on the same closes', () => {
    const { bd, vals, s } = state();
    const all = scanRows(bd.rows, 'all', s.hist);
    const html = render(<SignalsPage />);
    for (const tf of TIMEFRAMES) {
      const n = scanOf(all, tf, vals).hits.length;
      expect(html, tf).toContain(`<dt>Crosses, ${tf}</dt><dd><button type="button" class="tv" aria-label="Crosses, ${tf}: open the scan">${n}</button>`);
    }
  });

  it('opens on the view and timeframe this browser last used', () => {
    remember({ 'mc-seg-signals': 'scan', 'mc-seg-signals-tf': 'weekly', 'mc-seg-signals-scope': 'all' });
    const { bd, vals, s } = state();
    const scan = scanOf(scanRows(bd.rows, 'all', s.hist), 'weekly', vals);
    const t = text(render(<SignalsPage />));
    expect(t).toContain(scanNote(scan));
    expect(t).toMatch(/All in play \(\d+\)/);
  });

  it('falls back to the first view and the daily timeframe when what was remembered is not one', () => {
    remember({ 'mc-seg-signals': 'nonsense', 'mc-seg-signals-tf': 'hourly', 'mc-seg-signals-scope': 'x' });
    const html = render(<SignalsPage />);
    expect(html).toMatch(/data-id="changes"[^>]*aria-selected="true"/);
  });

  it('says the weekly and monthly bars are still loading, and keeps the daily timeframe going', () => {
    app.set({ series: null, seriesStatus: 'loading' });
    try {
      remember({ 'mc-seg-signals': 'averages', 'mc-seg-signals-tf': 'weekly' });
      expect(text(render(<SignalsPage />))).toContain('Loading the weekly and monthly bars…');
      remember({ 'mc-seg-signals': 'averages', 'mc-seg-signals-tf': 'daily' });
      const t = text(render(<SignalsPage />));
      expect(t).not.toContain('Loading the weekly and monthly bars…');
      expect(t).toContain('A simple average of closes.');
    } finally { app.set({ series: syntheticSeries(Object.keys(frozenInputs().hist)), seriesStatus: 'ok' }); }
  });

  it('says the weekly and monthly bars did not load, offers another try, and shows the daily timeframe anyway', () => {
    app.set({ series: null, seriesStatus: 'failed' });
    try {
      remember({ 'mc-seg-signals': 'scan', 'mc-seg-signals-tf': 'monthly' });
      const html = render(<SignalsPage />);
      const t = text(html);
      expect(t).toContain('The weekly and monthly bars did not load, so only the daily timeframe is shown.');
      expect(t).toContain('Try again');
    } finally { app.set({ series: syntheticSeries(Object.keys(frozenInputs().hist)), seriesStatus: 'ok' }); }
  });

  it('is the loading message before anything has loaded', () => {
    const before = app.get().phase;
    app.set({ phase: 'loading' });
    try { expect(text(render(<SignalsPage />))).toContain('Loading signals…'); } finally { app.set({ phase: before }); }
  });
});

describe('the fresh changes of sides', () => {
  const rows = (): Row[] => state().live;
  const event = (row: Row, o: Partial<StructureEvent>): StructureEvent => ({ row, tf: 'weekly', period: 200, state: 'reclaimed', ago: 0, ma: 42.5, dist: 3.2, helps: true, ...o });

  it('is a row for each change, naming the setup, what happened, when, how far the close is from the average, and what it means', () => {
    const [a, b] = rows();
    const html = render(<ChangesPanel events={[event(a, {}), event(b, { tf: 'daily', period: 150, state: 'lost', ago: 2, dist: -1.5, helps: false })]} onOpen={() => {}} narrow={false} waiting={null} />);
    const t = text(html);
    expect(t).toContain('Level changes 2');
    expect(t).toContain('reclaimed its weekly 200');
    expect(t).toContain('on the latest week');
    expect(t).toContain('lost its daily 150');
    expect(t).toContain('2 sessions ago');
    expect(t).toContain("the setup's way");
    expect(t).toContain('against the setup');
    expect(t).toContain('▲ +3.2%');
    expect(t).toContain('▼ −1.5%');
    expect(t).toContain('the average is at 42.5' + (a.currency ? ' ' + a.currency : ''));
    expect((html.match(/<tr>/g) || []).length - 1).toBe(2);
    expect(html).toContain(`aria-label="${a.p.sym} ${a.p.dir}: open details"`);
  });

  it('puts the section the setup is in next to its symbol', () => {
    const r = rows().find(x => x.section === 'breakout') ?? rows()[0];
    expect(text(render(<ChangesPanel events={[event(r, {})]} onOpen={() => {}} narrow={false} waiting={null} />))).toContain(r.section === 'breakout' ? 'Confirmed' : r.section);
  });

  it('is cards on a phone, each led by the symbol', () => {
    const html = render(<ChangesPanel events={rows().slice(0, 3).map(r => event(r, {}))} onOpen={() => {}} narrow waiting={null} />);
    expect(html).toContain('class="cards jcards"');
    expect(html).not.toContain('<table');
    expect((html.match(/<li class="card"/g) || []).length).toBe(3);
  });

  it('says nothing has changed sides when nothing has', () => {
    expect(text(render(<ChangesPanel events={[]} onOpen={() => {}} narrow={false} waiting={null} />))).toContain('Nothing has changed sides on a 150 or 200 lately.');
  });

  it('says the slower timeframes are still to come, above what it has', () => {
    expect(text(render(<ChangesPanel events={[]} onOpen={() => {}} narrow={false} waiting="Loading the weekly and monthly bars…" />))).toContain('Loading the weekly and monthly bars…');
  });
});

describe('the cross scan', () => {
  const noop = () => {};
  const view = (tf: Timeframe, scope: 'watch' | 'trade' | 'all') => {
    const { bd, s, vals } = state();
    const scan = scanOf(scanRows(bd.rows, scope, s.hist), tf, vals);
    const counts = { watch: scanRows(bd.rows, 'watch', s.hist).length, trade: scanRows(bd.rows, 'trade', s.hist).length, all: scanRows(bd.rows, 'all', s.hist).length };
    return { scan, counts, html: render(<ScanPanel scan={scan} tf={tf} setTf={noop} scope={scope} setScope={noop} counts={counts} onOpen={noop} waiting={null} />) };
  };

  it('has a switch for the timeframe and for which setups, the second with how many are in each', () => {
    const { html, counts } = view('daily', 'all');
    expect(html).toContain('>Daily<');
    expect(html).toContain('>Weekly<');
    expect(html).toContain('>Monthly<');
    expect(html).toContain(`Watching (${counts.watch})`);
    expect(html).toContain(`In trade (${counts.trade})`);
    expect(html).toContain(`All in play (${counts.all})`);
    expect(html).toMatch(/aria-pressed="true"[^>]*>Daily</);
  });

  it('says how far back it looked and how many names had the history for it', () => {
    const { html, scan } = view('weekly', 'all');
    expect(text(html)).toContain(scanNote(scan));
  });

  it('lists a bullish and a bearish block, each with the five tiers in order, quickest first', () => {
    const { html, scan } = view('daily', 'all');
    expect(scan.hits.length).toBeGreaterThan(0);
    for (const label of ['Bullish crosses', 'Bearish crosses']) expect(html).toContain(`aria-label="${label}"`);
    for (const block of html.split('<section').slice(1)) {
      const heads = [...block.matchAll(/class="tierhead">([^<]+)</g)].map(m => m[1]);
      expect(heads).toEqual(TIERS.map(t => t.label));
    }
    expect(text(html)).toContain('EMA timing trigger');
    expect(text(html)).toContain('golden / death');
  });

  it('lists each cross once, under its tier, with how long ago it was and a mark where it was given back', () => {
    const { html, scan } = view('daily', 'all');
    const items = (html.match(/class="sigitem"/g) || []).length;
    expect(items).toBe(scan.hits.length);
    expect((html.match(/whipsawed<\/span>/g) || []).length).toBe(scan.hits.filter(h => h.whip).length);
    expect(text(html)).toMatch(/latest close|\dd ago/);
  });

  it('lists the newest cross first within each tier', () => {
    const { html } = view('daily', 'all');
    const cols = html.split('class="sigcol"').slice(1);
    let checked = 0;
    for (const col of cols) {
      const ages = [...col.matchAll(/class="sighint">[^<]*?(latest close|(\d+)d ago)</g)].map(m => (m[2] ? +m[2] : 0));
      expect(ages).toEqual([...ages].sort((a, b) => a - b));
      if (ages.length > 1) checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('says "none" for a tier with nothing in it, and gives each name a button that opens it', () => {
    const { html, scan } = view('daily', 'watch');
    const empty = TIERS.length * 2 - new Set(scan.hits.map(h => h.key + h.bullish)).size;
    expect((html.match(/class="signone">none</g) || []).length).toBe(empty);
    for (const h of scan.hits.slice(0, 3)) expect(html).toContain(`aria-label="${h.row.p.sym}: open details"`);
  });

  it('says why there is nothing to list: nobody has the bars, or no crosses in the window', () => {
    const none: Scan = { tf: 'monthly', lookback: 12, covered: 0, total: 5, hits: [] };
    const t = text(render(<ScanPanel scan={none} tf="monthly" setTf={noop} scope="all" setScope={noop} counts={{ watch: 1, trade: 1, all: 5 }} onOpen={noop} waiting={null} />));
    expect(t).toContain('None of these carry the 220 months a 200-period average needs.');
    const quiet: Scan = { tf: 'weekly', lookback: 13, covered: 5, total: 5, hits: [] };
    expect(text(render(<ScanPanel scan={quiet} tf="weekly" setTf={noop} scope="all" setScope={noop} counts={{ watch: 1, trade: 1, all: 5 }} onOpen={noop} waiting={null} />))).toContain('No crosses in the last 13 weeks.');
  });

  it('waits for the slower timeframes, in words, instead of saying nothing was found', () => {
    const none: Scan = { tf: 'weekly', lookback: 13, covered: 0, total: 5, hits: [] };
    const t = text(render(<ScanPanel scan={none} tf="weekly" setTf={noop} scope="all" setScope={noop} counts={{ watch: 1, trade: 1, all: 5 }} onOpen={noop} waiting="Loading the weekly and monthly bars…" />));
    expect(t).toContain('Loading the weekly and monthly bars…');
    expect(t).not.toContain('None of these carry');
  });
});

describe('the averages', () => {
  const noop = () => {};
  const setup = (tf: Timeframe) => {
    const { bd, vals, live, s } = state();
    const ladders = new Map(live.map(r => [r, ladderOf(vals(r.p.sym, tf), tf)] as const));
    const rels = relatives(bd.rows, s.hist);
    return { live, ladder: (r: Row) => ladders.get(r)!, rel: (r: Row) => rels.get(r) as Relative, today: boardView(s, 'watchlist').today };
  };
  const panel = (tf: Timeframe, narrow: boolean, waiting: string | null = null) => {
    const { live, ladder, rel, today } = setup(tf);
    return { live, html: render(<AveragesPanel rows={live} tf={tf} setTf={noop} ladder={ladder} rel={rel} narrow={narrow} onOpen={noop} today={today} waiting={waiting} />) };
  };

  it('is a row for every setup in play, none for one that has failed or been removed', () => {
    const { live, html } = panel('daily', false);
    expect(live.length).toBeGreaterThan(0);
    expect((html.match(/<tr class="row"/g) || []).length).toBe(live.length);
    const { bd } = state();
    expect(live.length).toBeLessThan(bd.rows.length);
    const out = bd.rows.find(r => r.section === 'failed' || r.section === 'removed');
    expect(out).toBeDefined();
    expect(html).not.toContain(`aria-label="${out!.p.sym} ${out!.p.dir}: open details"><`);
  });

  it('has a column for each period of the timeframe, then the day against the index and the sector', () => {
    const daily = text(panel('daily', false).html);
    for (const h of ['5d', '21d', '50d', '150d', '200d', 'vs index', 'vs sector', 'Section']) expect(daily).toContain(h);
    const weekly = text(panel('weekly', false).html);
    for (const h of ['10w', '30w', '40w', '200w']) expect(weekly).toContain(h);
    expect(weekly).not.toContain('150d');
    const monthly = text(panel('monthly', false).html);
    for (const h of ['10mo', '12mo', '20mo']) expect(monthly).toContain(h);
  });

  it('writes each average as a side and a distance, and says which way the 150 and 200 are heading', () => {
    const t = text(panel('daily', false).html);
    expect(t).toMatch(/▲ \+\d+\.\d%/);
    expect(t).toMatch(/▼ −\d+\.\d%/);
    expect(t).toMatch(/[↑↓→⤴⤵]/);
  });

  it('is sorted by the symbol to begin with, and each header can sort', () => {
    const { live, html } = panel('daily', false);
    const syms = [...html.matchAll(/aria-label="([^"]+) (?:long|short): open details">/g)].map(m => m[1]);
    const first = [...new Set(syms)];
    expect(first.length).toBeGreaterThan(1);
    expect(first).toEqual([...first].sort((a, b) => a.localeCompare(b)));
    expect(live.length).toBeGreaterThan(0);
    expect(html).toContain('aria-sort="ascending"');
    expect((html.match(/class="thbtn"/g) || []).length).toBeGreaterThan(5);
  });

  it('is cards on a phone: the symbol, the price, and each average with its label', () => {
    const { live, html } = panel('weekly', true);
    expect((html.match(/<li class="card"/g) || []).length).toBe(live.length);
    expect(html).not.toContain('<table');
    expect(text(html)).toContain('30w');
  });

  it('says what the numbers mean, or that the slower bars are loading', () => {
    expect(text(panel('daily', false).html)).toContain('▲ means the close is above it and ▼ below');
    expect(text(panel('weekly', false, 'Loading the weekly and monthly bars…').html)).toContain('Loading the weekly and monthly bars…');
  });

  it('says so when nothing is in play', () => {
    const html = render(<AveragesPanel rows={[]} tf="daily" setTf={noop} ladder={() => []} rel={() => ({}) as Relative} narrow={false} onOpen={noop} today="2026-11-01" waiting={null} />);
    expect(text(html)).toContain('No setup is in play.');
  });
});
