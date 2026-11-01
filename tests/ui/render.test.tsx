import { describe, expect, it } from 'vitest';
import { render } from 'preact-render-to-string';
import { BoardCards, BoardTable } from '../../src/ui/board';
import { DEFAULT_SORT } from '../../src/ui/columns';
import { SetupDrawer } from '../../src/ui/drawer';
import { EditLevels } from '../../src/ui/forms';
import { emptyOverlay } from '../../src/data/overlay';
import { SECTIONS } from '../../src/engine/types';
import { frozenBoard, rowOf, TODAY } from './frozen';

/* The components are plain functions of their props, so a section can be rendered to a string and read. These
   check what the board puts on the screen, not how it looks. */

const noop = () => {};
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

describe('the table', () => {
  it('has a header per kept column, and a row per setup in the section', () => {
    for (const s of SECTIONS) {
      const rows = frozenBoard().bySection[s];
      const html = render(<BoardTable rows={rows} section={s} sort={DEFAULT_SORT[s]} onSort={noop} onOpen={noop} today={TODAY} panelId="p" />);
      expect((html.match(/<tr class="row"/g) || []).length, s).toBe(rows.length);
      expect((html.match(/<th /g) || []).length, s).toBe(2 + (s === 'watch' ? 4 : s === 'breakout' ? 5 : s === 'reentered' ? 4 : s === 'stopped' ? 3 : s === 'target' ? 4 : s === 'failed' ? 4 : 2));
    }
  });

  it('marks the sorted column for assistive tech', () => {
    const html = render(<BoardTable rows={frozenBoard().bySection.breakout} section="breakout" sort={['lfd', true]} onSort={noop} onOpen={noop} today={TODAY} panelId="p" />);
    expect(html).toContain('aria-sort="ascending"');
    expect((html.match(/aria-sort=/g) || []).length).toBe(1);
  });

  it('reads like the screen: a confirmed row says what it says in the browser', () => {
    const rows = [rowOf('TVE.TO')];
    const t = text(render(<BoardTable rows={rows} section="breakout" sort={DEFAULT_SORT.breakout} onSort={noop} onOpen={noop} today={TODAY} panelId="p" />));
    expect(t).toContain('TVE.TO long');
    expect(t).toContain('Tamarack Valley Energy Ltd.');
    expect(t).toContain('14.09 CAD −1.7%');
    expect(t).toContain('14.45 2.5% back under · 4.4 : 1 now');
    expect(t).toContain('16.1 +14.3% to go');
    expect(t).toContain('B2 potential · 2 pullbacks');
    expect(t).toContain('13.63 −3.3% · from report');
    expect(t).toContain('12.81 −9.1% away');
  });

  it('opens a row from its symbol, which has a name for assistive tech, and the chart link opens elsewhere', () => {
    const html = render(<BoardTable rows={[rowOf('TVE.TO')]} section="breakout" sort={DEFAULT_SORT.breakout} onSort={noop} onOpen={noop} today={TODAY} panelId="p" />);
    expect(html).toContain('aria-label="TVE.TO long: open details"');
    expect(html).toContain('href="https://finance.yahoo.com/quote/TVE.TO/chart"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });
});

describe('the cards', () => {
  it('one card per setup, with the same columns the table keeps, and a button that opens it', () => {
    for (const s of SECTIONS) {
      const rows = frozenBoard().bySection[s];
      const html = render(<BoardCards rows={rows} section={s} onOpen={noop} today={TODAY} panelId="p" />);
      expect((html.match(/<li class="card"/g) || []).length, s).toBe(rows.length);
      expect((html.match(/class="cardhit"/g) || []).length, s).toBe(rows.length);
    }
    const t = text(render(<BoardCards rows={[rowOf('TVE.TO')]} section="breakout" onOpen={noop} today={TODAY} panelId="p" />));
    for (const label of ['Trigger', 'Target', 'Type', 'Tight stop', 'Negation']) expect(t).toContain(label);
  });

  it('a long line takes the whole row', () => {
    const html = render(<BoardCards rows={[rowOf('FBIZ')]} section="watch" onOpen={noop} today={TODAY} panelId="p" />);
    expect(html).toContain('class="metric full"');      // the tight stop's "past boundary 29-10-26 · not confirmed"
    expect(html).toContain('class="metric"');
  });
});

describe('the drawer', () => {
  const draw = (sym: string, dir: 'long' | 'short' = 'long', over: Partial<Parameters<typeof SetupDrawer>[0]> = {}) => {
    const r = rowOf(sym, dir);
    return text(render(
      <SetupDrawer r={r} sharedRow={r.p} overlay={emptyOverlay()} showExDiv today={TODAY} canAct onEdit={noop} onResetField={noop} onAction={noop} {...over} />,
    ));
  };

  it('explains every level in words, not only a tooltip', () => {
    const t = draw('TVE.TO');
    expect(t).toContain('Last settled close 14.09 on 30-10-26, prior 14.33 (−1.7% on the day). The rules read settled closes only.');
    expect(t).toContain('A settled close above it confirms the breakout.');
    expect(t).toContain('The pattern level. The tight stop is recorded on the first close past it.');
    expect(t).toContain('A touch (the low) after the breakout fails the trade. Failed is final.');
    expect(t).toContain("Entered from the report. Anchored to the confirming close instead (16-10-26, Tech Charts' wording) it would be 13.84, the low of 15-10-26.");
  });

  it('lists the setup\'s own events, newest first, with the board\'s dates', () => {
    const t = draw('TVE.TO');
    const at = (s: string) => t.indexOf(s);
    expect(at('29-10-26 pullback 2')).toBeGreaterThan(0);
    expect(at('29-10-26 pullback 2')).toBeLessThan(at('19-10-26 pullback 1'));
    expect(at('19-10-26 pullback 1')).toBeLessThan(at('16-10-26 BREAKOUT CONFIRMED'));
    expect(at('16-10-26 BREAKOUT CONFIRMED')).toBeLessThan(at('13-10-26 closed above its pattern boundary'));
  });

  it('offers the actions that make sense for the section, and nothing else', () => {
    expect(draw('FBIZ')).toMatch(/Mark as breakout.*Remove/);
    expect(draw('FBIZ')).not.toContain('Mark as failed');
    expect(draw('TVE.TO')).toContain('Mark as failed');
    expect(draw('TVE.TO')).not.toContain('Delete');
    expect(draw('AME')).toContain('Mark as failed');                // a re-entered setup can be failed by hand too
    expect(draw('DAKT', 'short')).not.toContain('Actions');         // a failure by the rules cannot be undone by a click
    expect(draw('ICLR')).toContain('Restore');                      // dropped by the source: Restore writes an explicit "not removed"
  });

  it('can be read without being able to act on it', () => {
    const t = draw('TVE.TO', 'long', { canAct: false });
    expect(t).not.toContain('Edit levels');
    expect(t).not.toContain('Actions');
  });

  it('a setup added in this browser says so, and can be deleted', () => {
    const r = rowOf('TVE.TO');
    const mine = { ...r, p: { ...r.p, shared: false } };
    const t = text(render(<SetupDrawer r={mine} sharedRow={null} overlay={emptyOverlay()} showExDiv today={TODAY} canAct onEdit={noop} onResetField={noop} onAction={noop} />));
    expect(t).toContain('Only in this browser');
    expect(t).toContain('Delete');
  });

  it('shows what this browser has overridden, with the shared value', () => {
    const r = rowOf('TVE.TO');
    const ov = { added: [], over: { 'TVE.TO|long': { target: 17 } } };
    const t = text(render(<SetupDrawer r={{ ...r, p: { ...r.p, target: 17 } }} sharedRow={r.p} overlay={ov} showExDiv today={TODAY} canAct onEdit={noop} onResetField={noop} onAction={noop} />));
    expect(t).toContain('Edited in this browser · shared value 16.1');
  });
});

describe('the level editor', () => {
  it('starts from the current levels, offers the derived stop as the hint, and only asks for the ex-dividend date on the watchlist', () => {
    const r = rowOf('UNM');
    const withDiv = render(<EditLevels r={r} showExDiv onSave={noop} onCancel={noop} />);
    expect(withDiv).toContain('value="82.77"');
    expect(withDiv).toContain('Ex-dividend date');
    expect(render(<EditLevels r={r} showExDiv={false} onSave={noop} onCancel={noop} />)).not.toContain('Ex-dividend date');
    expect(withDiv).toContain('Blank derives it from the bars.');
  });
});
