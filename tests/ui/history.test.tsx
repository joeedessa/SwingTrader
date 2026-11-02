import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { render } from 'preact-render-to-string';
import { app } from '../../src/data/app';
import { boardView } from '../../src/data/selectors';
import { emptyLog, logRows } from '../../src/data/tradelog';
import type { LogOverlay } from '../../src/data/tradelog';
import { MINUS } from '../../src/engine/format';
import { journalStats, pairFills, statsLine } from '../../src/engine/journal';
import type { Fill } from '../../src/engine/journal';
import { outcomesOf } from '../../src/engine/outcomes';
import type { Outcomes } from '../../src/engine/outcomes';
import { HistoryPage, outcomeTiles, tileNote } from '../../src/ui/history';
import { FillDialog, JournalPanel, journalUi, openFillForm, priceStartsByHand } from '../../src/ui/journal';
import golden from '../fixtures/journal-old-page.json';
import { frozenInputs } from './frozen';

/* The History page and the journal, rendered to a string and read. Counts are read back from the engine's own view of the
   same data; the journal's fixture is the one the old page's pairing was checked against. */

const NOW = Date.parse('2026-11-01T18:00:00Z');
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

const shared = golden.shared as Fill[];
const overlay = golden.overlay as unknown as LogOverlay;

beforeAll(() => {
  const { shared: list, bars, hist } = frozenInputs();
  app.set({
    phase: 'ready', shared: { watchlist: list, benchmarks: [] }, hist, now: NOW, liveStatus: 'ok', events: {},
    barsFile: { generated_at: '2026-11-01T17:00:00Z', ccy: {}, bars },
    snapshot: { generated_at: '2026-11-01T17:30:00Z', sessions: [], latest: {} },
    tradelog: [], log: emptyLog(),
  });
});
afterAll(() => { app.set({ tradelog: [], log: emptyLog() }); journalUi.set({ form: null, deleting: null }); });

const outcomes = (): Outcomes => outcomesOf(boardView(app.get(), 'watchlist').bd.rows);

describe('the outcome tiles', () => {
  const o: Outcomes = {
    reached: 15, failed: 30, resolved: 45, hitRate: 33, open: 36, untyped: 0, byHand: 0, medianToTarget: 55, medianToFailure: 55,
    byType: [
      { tag: 'B1', count: 2, medianDays: 46 }, { tag: 'B2', count: 8, medianDays: 55.5 },
      { tag: 'B3', count: 5, medianDays: 82 }, { tag: 'B4', count: 30, medianDays: 55 },
    ],
  };

  it('lead with the hit rate and what it is out of, then one tile for each type', () => {
    const t = outcomeTiles(o);
    expect(t.map(x => x.label)).toEqual(['Hit rate', 'B1 · no pullback', 'B2 · pulled back', 'B3 · took the stop', 'B4 · failed']);
    expect(t[0]).toMatchObject({ value: '33%', sub: '15 of 45 resolved reached the target · 36 still open' });
    expect(t.slice(1).map(x => x.value)).toEqual(['2', '8', '5', '30']);
  });

  it('say the median days in whole days, to the target for B1 to B3 and to the failure for B4', () => {
    const t = outcomeTiles(o);
    expect(t[1].sub).toBe('median 46 days to target');
    expect(t[2].sub).toBe('median 56 days to target');
    expect(t[4].sub).toBe('median 55 days to failure');
    expect(outcomeTiles({ ...o, byType: [{ tag: 'B1', count: 1, medianDays: 1 }, ...o.byType.slice(1)] })[1].sub).toBe('median 1 day to target');
  });

  it('say there is nothing yet, rather than a rate, when nothing has resolved', () => {
    const none: Outcomes = { ...o, reached: 0, failed: 0, resolved: 0, hitRate: null, byType: o.byType.map(t => ({ ...t, count: 0, medianDays: null })), medianToTarget: null, medianToFailure: null };
    const t = outcomeTiles(none);
    expect(t[0]).toMatchObject({ value: '–', sub: 'nothing has resolved yet · 36 still open' });
    expect(t.slice(1).every(x => x.value === '0' && x.sub === 'none yet')).toBe(true);
  });

  it('are explained in the day\'s own numbers: what is left out, and why to read it as a record', () => {
    expect(tileNote(o)).toContain('The 36 still in play are not in these numbers.');
    expect(tileNote({ ...o, byHand: 2 })).toContain('nor are the 2 you moved to Failed by hand');
    expect(tileNote({ ...o, open: 0, byHand: 2 })).toContain('The 2 you moved to Failed by hand are not in these numbers.');
    expect(tileNote({ ...o, untyped: 3 })).toContain('3 that reached the target without daily bars have no type');
    expect(tileNote({ ...o, open: 0 })).not.toContain('still in play');
    expect(tileNote(o)).toContain('a record, not a forecast');
  });
});

describe('the page', () => {
  const html = () => render(<HistoryPage />);

  it('opens with what has resolved and what is still open, in the engine\'s numbers', () => {
    const o = outcomes();
    const t = text(html());
    expect(t).toContain('History');
    expect(t).toContain(`${o.resolved} resolved · ${o.open} still open`);
    expect(t).toContain(`${o.reached} of ${o.resolved} resolved reached the target`);
  });

  it('has the four tabs, each with its count', () => {
    const { bd } = boardView(app.get(), 'watchlist');
    const seg = [...html().matchAll(/data-id="(target|failed|removed|journal)"[^>]*>.*?<span class="n">(\d+)<\/span>/g)].map(m => [m[1], +m[2]]);
    expect(seg).toEqual([['target', bd.counts.target], ['failed', bd.counts.failed], ['removed', bd.counts.removed], ['journal', 0]]);
  });

  it('opens on the setups that reached their target: the board\'s own table, with a row for each', () => {
    const { bd } = boardView(app.get(), 'watchlist');
    const h = html();
    expect((h.match(/<tr class="row"/g) || []).length).toBe(bd.bySection.target.length);
    for (const label of ['Reached', 'Type', 'Target', 'Since target']) expect(h).toContain('>' + label);
  });

  it('counts the journal\'s fills on its tab', () => {
    app.set({ tradelog: shared, log: overlay });
    const n = logRows(shared, overlay).length;
    expect(html()).toMatch(new RegExp(`data-id="journal"[^>]*>.*?<span class="n">${n}</span>`));
    app.set({ tradelog: [], log: emptyLog() });
  });
});

describe('the journal', () => {
  const rows = logRows(shared, overlay);
  const { opens, closed } = pairFills(rows);

  it('says nothing is logged, and how it works, with a way to log the first fill', () => {
    const t = text(render(<JournalPanel narrow={false} />));
    expect(t).toContain('Nothing logged yet.');
    expect(t).toContain('Nothing is logged yet.');
    expect(t).toContain('Log your first fill');
    expect(t).toContain('kept apart from the setups');
  });

  describe('with fills', () => {
    beforeAll(() => { app.set({ tradelog: shared, log: overlay }); });
    afterAll(() => { app.set({ tradelog: [], log: emptyLog() }); });

    it('opens with the summary line the engine writes', () => {
      expect(text(render(<JournalPanel narrow={false} />))).toContain(statsLine(journalStats(rows, opens, closed)));
    });

    it('draws the three tables, each with a row for each of what it lists, and a heading with the count', () => {
      const h = render(<JournalPanel narrow={false} />);
      for (const [id, n] of [['journal-open', opens.length], ['journal-closed', closed.length], ['journal-fills', rows.length]] as const) {
        const block = h.split('id="' + id + '"')[1].split('</table>')[0];
        expect((block.match(/<tr>/g) || []).length - 1, id).toBe(n);       // less the header row
      }
      const t = text(h);
      expect(t).toContain(`Open positions ${opens.length}`);
      expect(t).toContain(`Closed trades ${closed.length}`);
      expect(t).toContain(`Every fill ${rows.length}`);
    });

    it('lists closed trades and fills newest first, as the old page did', () => {
      const h = render(<JournalPanel narrow={false} />);
      const closedBlock = h.split('id="journal-closed"')[1].split('</table>')[0];
      // Each trade shows the day in and then the day out; the exits are every second date.
      const dates = [...closedBlock.matchAll(/class="v">(\d\d-\d\d-\d\d)<\/div>/g)].map(m => m[1]);
      const exits = dates.filter((_, i) => i % 2 === 1);
      expect(exits.length).toBe(closed.length);
      const iso = (d: string) => '20' + d.slice(6, 8) + '-' + d.slice(3, 5) + '-' + d.slice(0, 2);
      expect(exits.map(iso)).toEqual(closed.slice().reverse().map(c => c.exit.date));
    });

    it('colours the P&L, writes a loss with a real minus, and says P&L is in the instrument\'s own units', () => {
      const t = text(render(<JournalPanel narrow={false} />));
      expect(t).toContain(MINUS + '2.0%');
      expect(t).toContain('+15.0%');
      expect(t).toContain("P&L in each instrument's own currency");
    });

    it('offers Edit and Delete on every fill, each named for the fill it acts on', () => {
      const h = render(<JournalPanel narrow={false} />);
      const fills = h.split('id="journal-fills"')[1].split('</table>')[0];
      expect((fills.match(/>Edit</g) || []).length).toBe(rows.length);
      expect((fills.match(/>Delete</g) || []).length).toBe(rows.length);
      expect(fills).toContain('Edit<span class="sr"> the buy of AME on 01-09-26</span>');
    });

    it('is cards on a phone, led by the symbol, with the same figures', () => {
      const h = render(<JournalPanel narrow />);
      expect(h).toContain('class="cards jcards"');
      expect(h).not.toContain('<table');
      expect((h.split('id="journal-fills"')[1].match(/<li class="card"/g) || []).length).toBe(rows.length);
    });

    it('marks a price typed by hand, and says what the others are', () => {
      const h = render(<JournalPanel narrow={false} />);
      expect(h).toContain('title="Price entered by hand: the date no longer sets it"');
      expect(h).toContain('title="Settled close of 01-09-26"');
    });
  });
});

describe('the fill dialog', () => {
  const dialog = () => render(<FillDialog />);
  afterAll(() => journalUi.set({ form: null, deleting: null }));

  it('is closed until something asks for it', () => {
    journalUi.set({ form: null, deleting: null });
    expect(dialog()).toBe('');
  });

  it('opens as a form to log a fill: the symbol, the side, the day, the price, and the rest of the record', () => {
    openFillForm();
    const h = dialog();
    expect(text(h)).toContain('Log a fill');
    for (const id of ['fill-sym', 'fill-side', 'fill-date', 'fill-price', 'fill-pattern', 'fill-dur', 'fill-market', 'fill-note']) expect(h).toContain(`id="${id}"`);
    expect(h).toContain('>Log it<');
    expect(h).toContain('Buy');
    expect(h).toContain('Sell');
    expect(text(h)).toContain('kept apart from the setups');
  });

  it('starts from the setup the drawer was on: its symbol, and the side its direction suggests', () => {
    openFillForm({ sym: 'AME', side: 'buy' });
    expect(dialog()).toContain('value="AME"');
    openFillForm({ sym: 'DAKT', side: 'sell' });
    expect(dialog()).toMatch(/<option selected value="sell"/);
  });

  it('offers the patterns and markets the list already uses, so a name is typed the same way each time', () => {
    openFillForm();
    const h = dialog();
    expect(h).toContain('<datalist id="fill-patterns">');
    expect(h).toContain('<datalist id="fill-markets">');
    expect((h.match(/<option value="[^"]+"\/?>/g) || []).length).toBeGreaterThan(2);
  });

  it('edits an existing fill: its own values, a note saying so, and a button that saves rather than logs', () => {
    const f: Fill = { id: 'f12', sym: 'GDX', side: 'sell', date: '2026-10-20', price: 63, priceManual: true, pattern: 'Flag', duration_m: 2, market: 'US', note: 'edited', logged_at: '2026-10-20T14:00:00.000Z' };
    openFillForm({ editing: f });
    const h = dialog();
    const t = text(h);
    expect(t).toContain('Edit fill');
    expect(t).toContain('Editing the sell of GDX on 20-10-26: saving replaces it.');
    expect(h).toContain('>Save fill<');
    for (const v of ['value="GDX"', 'value="2026-10-20"', 'value="63"', 'value="Flag"', 'value="2"', 'value="US"', 'value="edited"']) expect(h).toContain(v);
  });

  it('asks before deleting, naming the fill, and says a shared one is only hidden here', () => {
    const f = shared[0];
    app.set({ tradelog: shared });
    journalUi.set({ form: null, deleting: f });
    expect(text(dialog())).toContain(`Delete this ${f.side} of ${f.sym} on 01-09-26? It is in the shared journal, so it is hidden in this browser only.`);
    journalUi.set({ form: null, deleting: { ...f, id: 'local' } });
    expect(text(dialog())).toContain('Delete this buy of AME on 01-09-26?');
    expect(text(dialog())).not.toContain('shared journal');
    app.set({ tradelog: [] });
  });
});

describe('a fill\'s price and its date', () => {
  const base: Fill = { id: 'f', sym: 'AME', side: 'buy', date: '2026-10-01', price: 100 };

  it('follows the date for a new fill, and for one whose price came from a close', () => {
    expect(priceStartsByHand(null)).toBe(false);
    expect(priceStartsByHand(undefined)).toBe(false);
    expect(priceStartsByHand({ ...base, priceManual: false })).toBe(false);
    expect(priceStartsByHand(base)).toBe(false);
  });

  it('stays where it is for a fill whose price was typed by hand: editing the date must not set it again', () => {
    expect(priceStartsByHand({ ...base, priceManual: true })).toBe(true);
  });
});
