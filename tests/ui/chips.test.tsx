import { describe, expect, it } from 'vitest';
import { render } from 'preact-render-to-string';
import { chipsOf, openByRow, rowKeyOf } from '../../src/engine/chips';
import type { Chip } from '../../src/engine/chips';
import { boardFlags, RULES } from '../../src/engine/flags';
import type { Flag, FlagKind } from '../../src/engine/flags';
import type { Row } from '../../src/engine/row';
import { SECTIONS } from '../../src/engine/types';
import { BoardCards, BoardTable } from '../../src/ui/board';
import { Chips } from '../../src/ui/chips';
import { COLUMNS, isChips } from '../../src/ui/columns';
import { chipText, kindLabel } from '../../src/ui/flagview';
import { frozenBoard, frozenHist, TODAY } from './frozen';

const noop = () => {};
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

const flag = (kind: FlagKind, when: string, over: Partial<Flag> = {}): Flag => ({
  id: `AME|long|${kind}|${when}`, tier: RULES[kind].tier, kind, sym: 'AME', dir: 'long', when,
  text: `AME long — ${kind} sentence`, route: '#/setups/AME/long', clears: RULES[kind].clears, surfaces: RULES[kind].surfaces, ...over,
});

describe('what a chip says', () => {
  it('a tier chip leads with the flag\'s own name, and how many more stand behind it', () => {
    const c: Chip = { kind: 'act', flag: flag('exit', '2026-10-30', { n: 2 }), more: 1 };
    expect(chipText(c, TODAY).text).toBe('Exit 2 +1');
    expect(chipText({ kind: 'watch', flag: flag('late-entry', '2026-10-30'), more: 0 }, TODAY).text).toBe('Late entry');
  });

  it('a calendar chip says what and when', () => {
    expect(chipText({ kind: 'calendar', flag: flag('earnings-7d', '2026-11-04'), more: 0 }, TODAY).text).toBe('Earnings in 3 days');
    expect(chipText({ kind: 'calendar', flag: flag('exdiv-2d', '2026-11-02'), more: 1 }, TODAY).text).toBe('Ex-dividend tomorrow +1');
  });

  it('the tooltip is the engine\'s sentence, without the symbol the row already shows, so the chip never says less than Today does', () => {
    const c: Chip = { kind: 'watch', flag: flag('near-stop', '2026-10-30'), more: 2 };
    expect(chipText(c, TODAY).title).toBe('near-stop sentence (and 2 more)');
  });

  it('late-entry has a singular name for a chip, not the plural its group title has', () => {
    expect(kindLabel(flag('late-entry', '2026-10-30'))).toBe('Late entry');
  });
});

describe('the chips markup', () => {
  const chips: Chip[] = [
    { kind: 'act', flag: flag('breakout', '2026-10-30'), more: 0 },
    { kind: 'watch', flag: flag('near-stop', '2026-10-30'), more: 0 },
    { kind: 'calendar', flag: flag('earnings-7d', '2026-11-04'), more: 0 },
  ];

  it('names every dot and the glyph for assistive technology, so colour is never the only answer', () => {
    const html = render(<Chips chips={chips} today={TODAY} />);
    expect(html).toContain('aria-label="Needs a decision"');
    expect(html).toContain('aria-label="Worth a look"');
    expect(html).toContain('aria-label="Coming up"');
    expect(text(html)).toContain('Breakout');
    expect(text(html)).toContain('Near stop');
    expect(text(html)).toContain('Earnings in 3 days');
  });

  it('draws nothing for a row with no chips', () => {
    expect(render(<Chips chips={[]} today={TODAY} />)).toBe('');
  });
});

describe('the Flags column on the board', () => {
  const bd = frozenBoard();
  const flags = boardFlags(bd.rows, { today: TODAY, nowMs: Date.parse(TODAY + 'T12:00:00Z'), page: 'setups' });
  const open = openByRow(flags, {}, frozenHist());
  const chipsFor = (r: Row) => chipsOf(open.get(rowKeyOf(r.p.sym, r.p.dir)) ?? []);
  const chipCount = (rows: Row[]) => rows.reduce((n, r) => n + chipsFor(r).length, 0);
  const sectionsWith = SECTIONS.filter(s => COLUMNS[s].some(isChips));

  it('is headed Flags in the sections that carry it, and draws exactly the chips the rows have', () => {
    for (const s of sectionsWith) {
      const rows = bd.bySection[s];
      const html = render(<BoardTable rows={rows} section={s} sort={['sym', true]} onSort={noop} onOpen={noop} today={TODAY} panelId="p" chipsFor={chipsFor} />);
      expect(html, s).toContain('>Flags');
      expect((html.match(/class="fchip /g) || []).length, s).toBe(chipCount(rows));
    }
    // The frozen board has something to show in at least one of them, or this proves nothing.
    expect(sectionsWith.reduce((n, s) => n + chipCount(bd.bySection[s]), 0)).toBeGreaterThan(0);
  });

  it('is absent from the sections that do not carry it, even when the page offers chips', () => {
    for (const s of SECTIONS.filter(x => !sectionsWith.includes(x))) {
      const html = render(<BoardTable rows={bd.bySection[s]} section={s} sort={['sym', true]} onSort={noop} onOpen={noop} today={TODAY} panelId="p" chipsFor={chipsFor} />);
      expect(html, s).not.toContain('>Flags');
      expect(html, s).not.toContain('fchip');
    }
  });

  it('draws a row with no flags as an empty cell, not a dash', () => {
    const quiet = bd.bySection.breakout.find(r => chipsFor(r).length === 0);
    expect(quiet, 'the frozen board has a confirmed row with nothing to flag').toBeTruthy();
    const html = render(<BoardTable rows={[quiet!]} section="breakout" sort={['sym', true]} onSort={noop} onOpen={noop} today={TODAY} panelId="p" chipsFor={chipsFor} />);
    expect(html).not.toContain('fchip');
  });

  it('a phone card shows its chips under the symbol, once, and has no Flags line among its numbers', () => {
    for (const s of sectionsWith) {
      const rows = bd.bySection[s];
      const html = render(<BoardCards rows={rows} section={s} onOpen={noop} today={TODAY} panelId="p" chipsFor={chipsFor} />);
      expect((html.match(/class="fchip /g) || []).length, s).toBe(chipCount(rows));
      expect((html.match(/class="cardchips"/g) || []).length, s).toBe(rows.filter(r => chipsFor(r).length).length);
      expect(html, s).not.toContain('<dt>Flags</dt>');
    }
  });

  it('a held pill sits next to the direction when the page says the journal has the position open', () => {
    const r = bd.bySection.breakout[0];
    const html = render(<BoardTable rows={[r]} section="breakout" sort={['sym', true]} onSort={noop} onOpen={noop} today={TODAY} panelId="p" heldFor={() => 'bought 28-10-26 @ 13'} />);
    expect(html).toContain('class="heldpill" title="bought 28-10-26 @ 13"');
    expect(render(<BoardTable rows={[r]} section="breakout" sort={['sym', true]} onSort={noop} onOpen={noop} today={TODAY} panelId="p" />)).not.toContain('heldpill');
  });
});
