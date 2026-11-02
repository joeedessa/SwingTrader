import { describe, expect, it } from 'vitest';
import { render } from 'preact-render-to-string';
import type { Acks, Flag } from '../../src/engine/flags';
import { boardFlags, expired } from '../../src/engine/flags';
import { openByRow, rowKeyOf, timelineOf } from '../../src/engine/chips';
import { earningsView } from '../../src/engine/earnings';
import type { SymbolEvents } from '../../src/engine/types';
import { emptyOverlay } from '../../src/data/overlay';
import { SetupDrawer } from '../../src/ui/drawer';
import { drawerDataOf } from '../../src/ui/drawerdata';
import { AveragesSection, EarningsSection, FlagsSection } from '../../src/ui/drawersections';
import { averageLine, averagesOf } from '../../src/ui/mareads';
import { frozenBoard, frozenHist, rowOf, TODAY } from './frozen';
import { buttons } from './vnode';

/* The parts of the setup drawer that read from the flag engine, the moving averages and the earnings feed. The data comes
   from the frozen board; what a test expects is read back from the engine, never typed in as a count. */

const noop = () => {};
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const ctx = { today: TODAY, nowMs: Date.parse(TODAY + 'T12:00:00Z'), page: 'setups' as const };
const allFlags = () => boardFlags(frozenBoard().rows, ctx);
const mine = (sym: string, dir: 'long' | 'short' = 'long') => allFlags().filter(f => f.sym === sym && f.dir === dir);
const timeline = (sym: string, acks: Acks = {}, dir: 'long' | 'short' = 'long') => timelineOf(mine(sym, dir), acks, frozenHist());

/** A setup of the frozen board that has at least `n` flags open that can be acknowledged. */
function withOpen(n: number): { sym: string; dir: 'long' | 'short' } {
  for (const r of frozenBoard().rows) {
    const open = timeline(r.p.sym, {}, r.p.dir).filter(t => t.state === 'open' && t.flag.when !== 'live');
    if (open.length >= n) return { sym: r.p.sym, dir: r.p.dir };
  }
  throw new Error('no setup on the frozen board has ' + n + ' open flags');
}

describe('flags and events', () => {
  const html = (sym: string, acks: Acks = {}, onAck = noop, onUndo = noop) => render(<FlagsSection timeline={timeline(sym, acks)} onAck={onAck} onUndo={onUndo} />);

  it('lists everything the setup has raised, newest first, in the engine\'s own words, with the board\'s dates', () => {
    const items = timeline('TVE.TO');
    expect(items.length).toBeGreaterThan(2);
    const t = text(html('TVE.TO'));
    let last = -1;
    for (const { flag } of items) {
      const at = t.indexOf((flag.when === 'live' ? 'Live' : flag.when.slice(8, 10) + '-' + flag.when.slice(5, 7) + '-' + flag.when.slice(2, 4)) + ' ' + flag.text.slice(flag.text.indexOf(' — ') + 3, flag.text.indexOf(' — ') + 15));
      expect(at, flag.id).toBeGreaterThan(-1);
      expect(at, flag.id).toBeGreaterThan(last);
      last = at;
    }
  });

  it('offers to acknowledge what is open, one flag at a time, with a name for each, and all at once when there are several', () => {
    const { sym, dir } = withOpen(2);
    const items = timeline(sym, {}, dir);
    const open = items.filter(t => t.state === 'open' && t.flag.when !== 'live');
    const h = render(<FlagsSection timeline={items} onAck={noop} onUndo={noop} />);
    expect((h.match(/>Acknowledge</g) || []).length).toBe(open.length);
    expect((h.match(/aria-label="Acknowledge /g) || []).length).toBe(open.length);
    expect(text(h)).toContain(`Acknowledge all ${open.length}`);
  });

  it('does not offer "all" when only one flag is open', () => {
    const { sym, dir } = withOpen(1);
    const items = timeline(sym, {}, dir);
    const first = items.find(t => t.state === 'open' && t.flag.when !== 'live')!;
    const justOne = items.filter(t => t === first || t.state !== 'open');
    const h = render(<FlagsSection timeline={justOne} onAck={noop} onUndo={noop} />);
    expect((h.match(/>Acknowledge</g) || []).length).toBe(1);
    expect(text(h)).not.toContain('Acknowledge all');
  });

  it('shows an acknowledged one as such, with Undo, and takes it out of "all"', () => {
    const { sym, dir } = withOpen(2);
    const open = timeline(sym, {}, dir).filter(t => t.state === 'open' && t.flag.when !== 'live');
    const acks: Acks = { [open[0].flag.id]: 1 };
    const items = timeline(sym, acks, dir);
    const h = render(<FlagsSection timeline={items} onAck={noop} onUndo={noop} />);
    expect(h).toContain('acknowledged');
    expect(h).toContain('>Undo<');
    expect(items.find(t => t.flag.id === open[0].flag.id)!.state).toBe('acked');
    const stillOpen = items.filter(t => t.state === 'open' && t.flag.when !== 'live').length;
    expect((h.match(/>Acknowledge</g) || []).length).toBe(stillOpen);
    if (stillOpen > 1) expect(text(h)).toContain(`Acknowledge all ${stillOpen}`);
    else expect(text(h)).not.toContain('Acknowledge all');
  });

  it('keeps a flag that has aged out, as a plain line with nothing to press: the record stays', () => {
    const past = timeline('AME').filter(t => t.state === 'past');
    expect(past.length).toBeGreaterThan(0);
    const h = html('AME');
    expect((h.match(/class="ev [^"]*past"/g) || []).length).toBe(past.length);
  });

  it('says so, and that nothing has happened, for a setup with no flags', () => {
    expect(text(render(<FlagsSection timeline={[]} onAck={noop} onUndo={noop} />))).toContain('Nothing has happened to this setup yet.');
  });

  it('hands the flag back to the host when its button is pressed, and all of them when "all" is', () => {
    const { sym, dir } = withOpen(2);
    const open = timeline(sym, {}, dir).filter(t => t.state === 'open' && t.flag.when !== 'live').map(t => t.flag);
    const got: Flag[][] = [];
    const tree = FlagsSection({ timeline: timeline(sym, {}, dir), onAck: f => got.push(f), onUndo: noop });
    const each = buttons(tree, 'Acknowledge ').filter(b => b.props.class !== 'linkbtn');
    expect(each).toHaveLength(open.length);
    (each[0].props.onClick as () => void)();
    expect(got[0]).toHaveLength(1);
    expect(open.map(f => f.id)).toContain(got[0][0].id);
    const all = buttons(tree, 'Acknowledge all');
    expect(all).toHaveLength(1);
    (all[0].props.onClick as () => void)();
    expect(got[1].map(f => f.id).sort()).toEqual(open.map(f => f.id).sort());
  });

  it('hands the flag back to be undone when Undo is pressed', () => {
    const { sym, dir } = withOpen(1);
    const open = timeline(sym, {}, dir).find(t => t.state === 'open' && t.flag.when !== 'live')!;
    const acks: Acks = { [open.flag.id]: 1 };
    const undone: Flag[][] = [];
    const tree = FlagsSection({ timeline: timeline(sym, acks, dir), onAck: noop, onUndo: f => undone.push(f) });
    const undo = buttons(tree, 'Undo the acknowledgement');
    expect(undo).toHaveLength(1);
    (undo[0].props.onClick as () => void)();
    expect(undone[0].map(f => f.id)).toEqual([open.flag.id]);
  });
});

describe('the timeline', () => {
  it('puts live flags first, then newest first, Act before Watch within a day', () => {
    const items = timeline('AME');
    const whens = items.map(t => t.flag.when);
    const live = whens.filter(w => w === 'live').length;
    expect(whens.slice(0, live).every(w => w === 'live')).toBe(true);
    const dated = whens.slice(live);
    expect(dated).toEqual([...dated].sort().reverse());
  });

  it('marks as open exactly what the board\'s chips show for the row, and as past what is Info or has aged out', () => {
    const flags = allFlags();
    const hist = frozenHist();
    const open = openByRow(flags, {}, hist);
    for (const r of frozenBoard().rows) {
      const key = rowKeyOf(r.p.sym, r.p.dir);
      const items = timelineOf(flags.filter(f => f.sym === r.p.sym && f.dir === r.p.dir), {}, hist);
      expect(items.filter(t => t.state === 'open').map(t => t.flag.id).sort(), key).toEqual((open.get(key) ?? []).map(f => f.id).sort());
      for (const t of items.filter(x => x.state === 'past')) expect(t.flag.tier === 'info' || expired(t.flag, hist), t.flag.id).toBe(true);
    }
  });

  it('cannot acknowledge a live flag away: it is a condition, and stays open', () => {
    const base = mine('AME')[0];
    const live = { ...base, id: 'X|long|live-stop|live', when: 'live', tier: 'act' as const, kind: 'live-stop' as const, clears: 'itself' as const };
    expect(timelineOf([live], { [live.id]: 9 }, frozenHist())[0].state).toBe('open');
  });
});

describe('moving averages', () => {
  const closes = (sym: string) => frozenHist()[sym].settled.map(x => x[1]);

  it('say where the last close sits against the 150 and the 200, with the sentence written out', () => {
    const lines = averagesOf(closes('AME')).map(averageLine);
    expect(lines.map(l => l.label)).toEqual(['150-day', '200-day']);
    for (const l of lines) {
      expect(l.value).toMatch(/^[▲▼] [+−]?\d+\.\d%$/);
      expect(l.text).toMatch(/^(Above|Below) the (150|200)-day average, which sits at /);
    }
  });

  it('are drawn as a section, with what each says and the caution that they are simple averages of settled closes', () => {
    const t = text(render(<AveragesSection lines={averagesOf(closes('AME')).map(averageLine)} />));
    expect(t).toContain('Moving averages (daily)');
    expect(t).toContain('150-day');
    expect(t).toContain('200-day');
    expect(t).toContain('Simple averages of settled closes');
  });

  it('say there is not enough history, rather than a number, for a short series', () => {
    const l = averageLine(averagesOf([1, 2, 3])[0]);
    expect(l).toMatchObject({ value: '–', above: null, state: null, slope: null });
    expect(l.text).toBe('Not enough closes yet for a 150-day average.');
  });
});

describe('earnings and news', () => {
  const EV: SymbolEvents = {
    sector: 'Industrials', earnings: '2026-11-03', earnings_when: 'before open',
    last_eps: { reported: '2026-08-04', when: 'before open', actual: 2.09, estimate: 1.993, surprise_pct: 4.9, revenue: 2_040_000_000, revenue_est: 1_950_000_000, revenue_surprise_pct: 4.6, eps_yoy: 14.3 },
    next_est: { eps: 2.108, revenue: 2_120_000_000 },
    target_avg: 285.9, ratings: { buy: 10, over: 5, hold: 7, under: 0, sell: 1, total: 23 },
    wire: { cues: ['beat'], heads: [{ t: 'Sets November 3 earnings report', u: 'https://example.com/a', d: '2026-10-24', s: 'Wire' }] },
  };
  const card = (over: Partial<SymbolEvents> = {}) => earningsView({ ...EV, ...over }, { live: 245.6, target: 278, next: '2026-11-03', hist: frozenHist().AME });
  const html = (v = card()) => render(<EarningsSection v={v} ccy="USD" today={TODAY} sym="AME" name="AMETEK Inc." live={245.6} />);

  it('says what the last report delivered against what was expected, in the listing currency, and the verdict', () => {
    const t = text(html());
    expect(t).toContain('Last reported · 04-08-26, before open');
    expect(t).toContain('EPS 2.09 vs 1.993 est +4.9%');
    expect(t).toContain('Revenue 2.04bn USD vs 1.95bn est +4.6%');
    expect(t).toContain('EPS year on year +14.3%');
  });

  it('says how the market took it, in the sign it moved', () => {
    expect(text(html(card({ last_eps: { ...EV.last_eps, reported: '2026-08-04' } })))).toMatch(/Market reaction [+−]\d/);
  });

  it('classifies the headlines\' language and links each as published, to open elsewhere', () => {
    const h = html();
    expect(h).toContain('class="cue good"');
    expect(h).toContain('href="https://example.com/a" target="_blank" rel="noopener noreferrer"');
    expect(text(h)).toContain('The tags classify the language of the headlines only');
  });

  it('says what the street expects next, and how far off the date is', () => {
    const t = text(html());
    expect(t).toContain('Next report · 03-11-26, before open in 2 days');
    expect(t).toContain('Consensus 2.108 EPS · 2.12bn USD revenue');
  });

  it('puts the street\'s target against the live price and against yours, and counts the analysts', () => {
    const t = text(html());
    expect(t).toContain('Consensus target 285.9 USD · +16.4% vs live');
    expect(t).toContain('Your target 278 USD · the street is above yours');
    expect(t).toContain('Analysts 23 covering · 15 bullish · 7 hold · 1 bearish');
    expect(t).toContain('not company guidance');
  });

  it('says what the feed lacks, without inventing it', () => {
    const t = text(html(card({ last_eps: null, next_est: null, wire: null, target_avg: null, ratings: null })));
    expect(t).toContain('No reported result in the feed.');
    expect(t).toContain('No consensus estimates on file for the coming quarter.');
    expect(t).not.toContain('On the wire');
    expect(t).not.toContain('Street view');
    expect(text(html(card({ last_eps: { reported: '2026-08-04', actual: 1.2 } })))).toContain('(no consensus on file)');
  });

  it('links to the news and the chart, which are only hrefs', () => {
    const h = html();
    expect(h).toContain('href="https://finance.yahoo.com/quote/AME/news"');
    expect(h).toContain('href="https://news.google.com/search?q=AMETEK%20Inc.%20stock"');
    expect(h).toContain('href="https://finance.yahoo.com/quote/AME/chart"');
  });
});

describe('the drawer', () => {
  const draw = (sym: string, over: Partial<Parameters<typeof SetupDrawer>[0]> = {}, dir: 'long' | 'short' = 'long') => {
    const r = rowOf(sym, dir);
    return render(<SetupDrawer r={r} sharedRow={r.p} overlay={emptyOverlay()} showExDiv today={TODAY} canAct canLog data={drawerDataOf(r, frozenHist(), allFlags(), {})}
      onAck={noop} onUndo={noop} onLog={noop} onEdit={noop} onResetField={noop} onAction={noop} {...over} />);
  };

  it('has every section the plan gives it, in order: levels, type, flags, averages, earnings, calendar, facts, actions', () => {
    const h = draw('TVE.TO');
    const order = ['>Price<', '>Levels<', '>Type<', '>Flags and events<', '>Moving averages (daily)<', '>Calendar<', '>About this setup<', '>Actions<'].map(s => h.indexOf(s));
    expect(order.every(i => i > -1)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('offers Log fill next to Chart on a list with a journal, and not on one without', () => {
    expect(text(draw('TVE.TO'))).toContain('Log fill');
    expect(text(draw('TVE.TO', { canLog: false }))).not.toContain('Log fill');
    expect(draw('TVE.TO')).toContain('href="https://finance.yahoo.com/quote/TVE.TO/chart"');
  });

  it('shows the earnings card only where the feed has something to say', () => {
    const r = rowOf('TVE.TO');
    const withCard = { ...drawerDataOf(r, frozenHist(), allFlags(), {}), earnings: earningsView(
      { last_eps: { reported: '2026-08-04', actual: 1 } }, { live: 1, target: 1, next: null, hist: null }) };
    expect(text(draw('TVE.TO', { data: withCard }))).toContain('Earnings and news');
    expect(text(draw('TVE.TO', { data: { ...withCard, earnings: null } }))).not.toContain('Earnings and news');
  });
});

describe('what the host hands the drawer', () => {
  it('is the row\'s own flags and nobody else\'s', () => {
    const r = rowOf('TVE.TO');
    const data = drawerDataOf(r, frozenHist(), allFlags(), {});
    const want = allFlags().filter(f => f.sym === 'TVE.TO' && f.dir === 'long').map(f => f.id).sort();
    expect(data.timeline.map(t => t.flag.id).sort()).toEqual(want);
    expect(want.length).toBeGreaterThan(0);
  });

  it('keeps a long and a short of one symbol apart', () => {
    const flags: Flag[] = allFlags();
    const sym = [...new Set(flags.filter(f => f.sym).map(f => f.sym))].find(s => frozenBoard().rows.filter(r => r.p.sym === s).length > 1);
    expect(sym, 'the frozen board has a symbol listed both ways').toBeTruthy();
    const r = frozenBoard().rows.find(x => x.p.sym === sym)!;
    const data = drawerDataOf(r, frozenHist(), flags, {});
    expect(data.timeline.every(t => t.flag.dir === r.p.dir)).toBe(true);
  });

  it('has the two daily averages, and no card for a name the feed knows nothing about', () => {
    const r = rowOf('TVE.TO');
    const data = drawerDataOf(r, frozenHist(), allFlags(), {});
    expect(data.averages.map(a => a.label)).toEqual(['150-day', '200-day']);
    expect(data.earnings).toBeNull();            // the frozen capture has no events feed
  });
});
