import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { render } from 'preact-render-to-string';
import { app } from '../../src/data/app';
import { boardView } from '../../src/data/selectors';
import { emptyLog } from '../../src/data/tradelog';
import { runModel } from '../../src/engine/backtest/model';
import { DEFAULT_SETTINGS, LIST_BEGAN, SIZINGS, STRATEGY_IDS } from '../../src/engine/backtest/settings';
import { route } from '../../src/router';
import { ModelPage } from '../../src/ui/model';
import { moneyStatsOf } from '../../src/engine/backtest/stats';
import { legsInScope, modelTiles, SCOPE_NOTE, STRATEGY_LABEL } from '../../src/ui/modelcells';
import type { StrategyRun } from '../../src/engine/backtest/model';
import type { SizingId } from '../../src/engine/backtest/settings';
import { engineSettings, modelQuery, parseModelQuery } from '../../src/ui/modelurl';
import { frozenInputs } from './frozen';

/* The Model page, rendered to a string on the frozen board and read back against the engine's own result. The address
   is the page's state: the same link must print the same numbers, twice over. */

const NOW = Date.parse('2026-11-01T18:00:00Z');
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

// The store patches, so a query from the test before has to be cleared, not left out.
const at = (query: string) => { route.set({ page: 'model', row: null, query: query || undefined }); return render(<ModelPage />); };
const tilesOf = (run: StrategyRun, sizing: SizingId, label: string) => {
  const closed = legsInScope(run, sizing, 'closed');
  return modelTiles(run, sizing, label, { all: run.money[sizing], closed: moneyStatsOf(closed.legs, closed.sizes) });
};
const resultFor = (query: string) => {
  const s = app.get();
  const { bd } = boardView(s, 'watchlist');
  return runModel({ rows: bd.rows, hist: s.hist, bars: s.barsFile!.bars }, engineSettings(parseModelQuery(query), LIST_BEGAN));
};

beforeAll(() => {
  const { shared, bars, hist } = frozenInputs();
  app.set({
    phase: 'ready', shared: { watchlist: shared, benchmarks: [] }, hist, now: NOW, liveStatus: 'ok', events: {}, eventsAt: null,
    barsFile: { generated_at: '2026-11-01T17:00:00Z', ccy: {}, bars },
    snapshot: { generated_at: '2026-11-01T17:30:00Z', sessions: [], latest: {} },
    tradelog: [], log: emptyLog(), live: null, problems: [],
  });
});
afterAll(() => { route.set({ page: 'today', row: null }); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('the Model page', () => {
  it('prints the universe the engine counts, and opens on S2 unlimited under flat sizing with every leg', () => {
    const r = resultFor('');
    const html = at('');
    const t = text(html);
    expect(t).toContain(`${r.universe.breakouts} breakouts · ${r.universe.candidates.length} setups in the trade list · ${STRATEGY_LABEL['S2-u']}`);
    const tiles = tilesOf(r.runs['S2-u'], 'flat', 'units');
    for (const tile of tiles) { expect(t).toContain(tile.label); for (const c of tile.cols!) { expect(t).toContain(c.head); expect(t).toContain(c.value); } }
    expect((html.match(/class="tile pair"/g) || []).length).toBe(tiles.length);
    expect(t).toContain('every leg beside the closed trades alone');
    expect(t).toContain(SCOPE_NOTE);
    expect(t).toContain('count every leg, the open ones marked at the latest settled close');
    expect((html.match(/class="symbtn"/g) || []).length).toBe(r.runs['S2-u'].legs.length);
  });

  it('follows the link: another strategy, sizing, count and currency label change what it prints', () => {
    const q = 's=S1&sz=risk&scope=closed&cur=USD';
    const r = resultFor(q);
    const t = text(at(q));
    expect(t).toContain(STRATEGY_LABEL.S1);
    // Closed only: the lines and the list are over the closed legs alone; the tiles show both columns whatever the count.
    const closed = legsInScope(r.runs.S1, 'risk', 'closed');
    expect(closed.legs.length).toBeLessThan(r.runs.S1.legs.length);
    const tiles = tilesOf(r.runs.S1, 'risk', 'USD');
    for (const tile of tiles) for (const c of tile.cols!) expect(t).toContain(c.value);
    expect(t).toContain('count closed trades only');
    expect(t).toContain(' USD');
    expect(t).not.toContain(' units');
    expect((at(q).match(/class="symbtn"/g) || []).length).toBe(closed.legs.length);
  });

  it('runs the engine on the dials in the link: the target, the stop, the removal, the day the list began, the costs', () => {
    const q = 'tgt=touch&re=new&rm=exclude&from=list&c=0&sl=0&n=5000&r=250&max=7000';
    const r = resultFor(q);
    expect(r.settings).toEqual({ ...DEFAULT_SETTINGS, targetOn: 'touch', reentryStop: 'new', removed: 'exclude', from: LIST_BEGAN, commissionPct: 0, slippagePct: 0, size: 5000, riskUnits: 250, maxSize: 7000 });
    const t = text(at(q));
    expect(t).toContain(`Only breakouts from ${LIST_BEGAN.slice(8, 10)}-${LIST_BEGAN.slice(5, 7)}-${LIST_BEGAN.slice(2, 4)} on`);
    expect(t).toContain('0.00% a round trip');
    expect(t).toContain(String(r.runs['S2-u'].legs.length));
  });

  it('has no entry dials: the fill is one rule, said in words, and an old link that carried an entry opens on the defaults', () => {
    const html = at('');
    const t = text(html);
    for (const gone of ['Confirming close', 'Next open', 'From the report', 'At the trigger']) expect(t, gone).not.toContain(gone);
    expect(html).not.toContain('aria-label="Entry"');
    expect(html).not.toContain('aria-label="Imported"');
    // The words that stand where the dials were: the footer, and the caveats.
    expect(t).toContain('A setup enters at the next session\'s open after a settled close strictly past its trigger.');
    expect(t).toContain('Intraday prices are read only for exits');
    expect(t).toContain('Where that bar has no open on file the close stands in');
    expect(t).toContain('enters from the report that listed it, at the open of the first session after the report\'s date');
    // The links of the entries that were removed: read as the defaults, and not written back.
    for (const old of ['entry=trigger&s=S1', 'entry=close&imp=close&s=S1']) {
      expect(modelQuery(parseModelQuery(old)), old).toBe('s=S1');
      const oldHtml = at(old);
      expect(text(oldHtml), old).toContain(STRATEGY_LABEL.S1);
      expect(oldHtml, old).toBe(at('s=S1'));
    }
  });

  it('prints the same numbers for the same link, twice', () => {
    const q = 's=S2-2&sz=payoff&cur=EUR';
    expect(at(q)).toBe(at(q));
    expect(at('')).toBe(at(''));
  });

  it('puts a unit on every number in the tiles: a count, a per cent, an R, or the currency label', () => {
    for (const strategy of STRATEGY_IDS) {
      for (const sizing of SIZINGS) {
        const r = resultFor(`s=${strategy}&sz=${sizing}`);
        for (const tile of tilesOf(r.runs[strategy], sizing, 'units')) {
          for (const c of tile.cols!) expect(c.value, `${strategy} ${sizing} ${tile.label} ${c.head}`).toMatch(/^(–|\d+|\d+\.\d|[+−]?\d+\.\d%|[+−]?\d+\.\d\d R|\d+%|\d+\.\d\d|−?[\d,]+ units)$/);
        }
      }
    }
  });

  it('draws the equity line and the drawdown, the trade list, the types, the ratio question, the grid of every strategy by every sizing, the caveats and what is left out', () => {
    const r = resultFor('');
    const html = at('');
    expect((html.match(/<figure class="chart equity"/g) || []).length).toBe(1);
    expect((html.match(/<figure class="chart drawdown"/g) || []).length).toBe(1);
    expect((html.match(/class="gcell"/g) || []).length).toBe(STRATEGY_IDS.length * SIZINGS.length);
    expect((html.match(/class="gcell" aria-pressed="true"/g) || []).length).toBe(1);
    const t = text(html);
    for (const s of ['Trades', 'By type', 'The ratio question', 'Sensitivity', 'Caveats', 'Left out, and why', 'Equity', 'Drawdown']) expect(t).toContain(s);
    expect(t).toContain(`${r.caveats.setups} setups of the ${r.universe.breakouts} breakouts`);
    for (const e of r.universe.excluded) expect(t).toContain(e.reason);
    expect(t).toContain('FX held constant');
  });

  it('is cards on a phone, with the dials and the grid still there', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
    const html = at('');
    expect(html).toContain('class="cards jcards"');
    expect(html).not.toContain('class="board jtable"');
    expect((html.match(/class="gcell"/g) || []).length).toBe(STRATEGY_IDS.length * SIZINGS.length);
    expect(text(html)).toContain('Strategy');
  });

  it('says so while it loads, and offers to try again on an error', () => {
    app.set({ phase: 'loading' });
    expect(text(at(''))).toContain('Loading the model');
    app.set({ phase: 'error', error: 'The watchlist didn\'t load.' });
    expect(text(at(''))).toContain('Try again');
    expect(text(at(''))).toContain('Not loaded.');
    expect(text(at(''))).not.toContain('Loading…');
    app.set({ phase: 'ready', error: null });
  });

  it('offers the defaults only once a dial has moved', () => {
    expect(text(at(''))).not.toContain('Defaults');
    expect(text(at('s=S1'))).toContain('Defaults');
  });
});
