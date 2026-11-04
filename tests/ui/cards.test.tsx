import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { render } from 'preact-render-to-string';
import { app } from '../../src/data/app';
import { emptyLog } from '../../src/data/tradelog';
import { route } from '../../src/router';
import { HistoryPage } from '../../src/ui/history';
import { CARDS_QUERY, NARROW_QUERY } from '../../src/ui/hooks';
import { ModelPage } from '../../src/ui/model';
import { TopNav } from '../../src/ui/nav';
import { BoardPage } from '../../src/ui/page';
import { PositionsPage } from '../../src/ui/positions';
import { frozenInputs } from './frozen';

/* Between a phone and a desktop (701 to 1,000 px) the widest tables would scroll sideways, so every list is a stack of
   cards there while the page keeps its desktop chrome. The style sheet's two queries are stubbed one at a time. */

const NOW = Date.parse('2026-11-01T18:00:00Z');

/** matchMedia answering true for the queries given and false for the rest. */
const screen = (...matching: string[]) => vi.stubGlobal('matchMedia', (q: string) => ({ matches: matching.includes(q), addEventListener() {}, removeEventListener() {} }));

beforeAll(() => {
  const { shared, bars, hist } = frozenInputs();
  app.set({
    phase: 'ready', shared: { watchlist: shared, benchmarks: [] }, hist, now: NOW, liveStatus: 'ok', events: {}, eventsAt: null,
    barsFile: { generated_at: '2026-11-01T17:00:00Z', ccy: {}, bars },
    snapshot: { generated_at: '2026-11-01T17:30:00Z', sessions: [], latest: {} },
    tradelog: [], log: emptyLog(), live: null, problems: [],
  });
  route.set({ page: 'model', row: null, query: undefined });
});
afterAll(() => { route.set({ page: 'today', row: null }); });
afterEach(() => { vi.unstubAllGlobals(); });

// The Model page keeps its small tables (by type, the ratios, the grid) at every width; its trade list is the one that turns.
const pages = [
  ['Setups', () => <BoardPage set="watchlist" />, /<table class="board"/],
  ['Positions', () => <PositionsPage />, /<table class="board"/],
  ['History', () => <HistoryPage />, /<table class="board"/],
  ['Model', () => <ModelPage />, /<table class="board jtable"/],
] as const;

describe('the lists between a phone and a desktop', () => {
  for (const [name, Page, table] of pages) {
    it(`${name}: a table on a desktop, cards below 1,000 px, cards on a phone`, () => {
      screen();
      const wide = render(<Page />);
      expect(wide).toMatch(table);
      expect(wide).not.toMatch(/class="cards/);
      screen(CARDS_QUERY);
      const mid = render(<Page />);
      expect(mid).toMatch(/class="cards/);
      expect(mid).not.toMatch(table);
      screen(CARDS_QUERY, NARROW_QUERY);
      const phone = render(<Page />);
      expect(phone).toMatch(/class="cards/);
      expect(phone).not.toMatch(table);
    });
  }

  it('keeps the desktop chrome below 1,000 px: the top bar stays, the hero keeps its full buttons', () => {
    screen(CARDS_QUERY);
    expect(render(<TopNav page="setups" />)).toContain('class="brand"');
    const html = render(<BoardPage set="watchlist" />);
    expect(html).toContain('>Add setup<');
    expect(html).toContain('>Export<');
  });

  it('the board carries both labels for its segments, so the style sheet can pick the short ones in between', () => {
    screen(CARDS_QUERY);
    const html = render(<BoardPage set="watchlist" />);
    expect(html).toContain('<span class="lfull">Confirmed</span><span class="lshort">Confirmed</span>');
    expect(html).toContain('<span class="lfull">Re-entered</span><span class="lshort">Re-in</span>');
  });
});
