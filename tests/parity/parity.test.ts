import { describe, expect, it } from 'vitest';
import { evaluate } from '../../src/engine/row';
import type { Bars, BreakoutType, History, Lfd, ReplayState, Section, Setup } from '../../src/engine/types';
import dump from './old-page-2026-11-01.json';
import watchlist from './watchlist-2026-11-01.json';
import adjudicated from './adjudicated-2026-11-01.json';

/* D2 parity: the old page's own outcome for every setup, dumped with the
   inputs it ran on (window.__parity(), 2026-11-01 17:49Z, every market shut,
   no browser overlay). The new engine, run on those frozen inputs, must
   reproduce every field, except on the rows the 7-significant-digit rounding
   decision changed (revision 3 of the plan). Those are held to the values in
   adjudicated-2026-11-01.json instead, each with its reason, and none of them
   may change a section or a type. Write-up: docs/PARITY.md. */

interface OldRow {
  sym: string;
  dir: string;
  section: Section;
  btype: BreakoutType | null;
  lfd: Lfd | null;
  breakout: ReplayState['breakout'];
  targetHit: ReplayState['targetHit'];
  failed: ReplayState['failed'];
}

const old = dump as unknown as { BARS: Record<string, Bars>; HIST: Record<string, History>; rows: OldRow[] };
const ruled = (adjudicated as unknown as { rows: Record<string, { reason: string; expect: Record<string, unknown> }> }).rows;

// workingList() on the old page: shared rows, no overlay, `removed` landing in Removed.
const setups = new Map<string, Setup>();
for (const raw of watchlist as unknown as Array<Record<string, unknown>>) {
  const p = { ...raw, manualState: raw.removed ? 'removed' : null } as unknown as Setup;
  setups.set(p.sym + '|' + p.dir, p);
}

const strip = <T,>(x: T): T => JSON.parse(JSON.stringify(x === undefined ? null : x));

const ours = (r: OldRow) => {
  const row = evaluate(setups.get(r.sym + '|' + r.dir)!, old.HIST[r.sym], old.BARS[r.sym], {}, '2026-11-01');
  return strip({ section: row.section, btype: row.btype, lfd: row.lfd, breakout: row.st.breakout, targetHit: row.st.targetHit, failed: row.st.failed });
};
const theirs = (r: OldRow) => strip({ section: r.section, btype: r.btype, lfd: r.lfd, breakout: r.breakout, targetHit: r.targetHit, failed: r.failed });

describe('parity with the old page on frozen inputs', () => {
  it('covers every row the old page had and nothing else, and every adjudicated row is one of them', () => {
    const dumped = old.rows.map(r => r.sym + '|' + r.dir).sort();
    expect(dumped.length).toBeGreaterThan(0);
    expect([...setups.keys()].sort()).toEqual(dumped);
    for (const id of Object.keys(ruled)) expect(dumped, id).toContain(id);
  });

  for (const r of old.rows) {
    const id = r.sym + '|' + r.dir;
    if (ruled[id]) {
      it(`${r.sym} ${r.dir} → ${r.section} (adjudicated: ${ruled[id].reason})`, () => {
        const mine = ours(r) as Record<string, unknown> & { section: string; btype: { tag: string | null } | null };
        expect(mine).toEqual(ruled[id].expect);
        // The rounding moved a date, a count or a stop; it must not move a row to another section or type.
        expect(mine.section).toBe(r.section);
        expect(mine.btype ? mine.btype.tag : null).toBe(r.btype ? r.btype.tag : null);
      });
    } else {
      it(`${r.sym} ${r.dir} → ${r.section}`, () => {
        expect(ours(r)).toEqual(theirs(r));
      });
    }
  }

  it('reproduces the section counts the old page showed', () => {
    const tally = (sections: string[]) => {
      const counts: Record<string, number> = {};
      for (const s of sections) counts[s] = (counts[s] || 0) + 1;
      return counts;
    };
    expect(tally(old.rows.map(r => (ours(r) as { section: string }).section))).toEqual(tally(old.rows.map(r => r.section)));
  });
});
