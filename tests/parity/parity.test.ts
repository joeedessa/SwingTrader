import { describe, expect, it } from 'vitest';
import { evaluate } from '../../src/engine/row';
import type { Bars, BreakoutType, History, Lfd, ReplayState, Section, Setup } from '../../src/engine/types';
import dump from './old-page-2026-11-01.json';
import watchlist from './watchlist-2026-11-01.json';

/* D3 parity: the old page's own outcome for every setup, dumped with the
   inputs it ran on (window.__parity(), 2026-11-01 17:49Z, every market shut,
   no browser overlay). The new engine, run on those frozen inputs, must
   reproduce every field. Differences are adjudicated in docs/PARITY.md. */

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

// workingList() on the old page: shared rows, no overlay, `removed` landing in Removed.
const setups = new Map<string, Setup>();
for (const raw of watchlist as unknown as Array<Record<string, unknown>>) {
  const p = { ...raw, manualState: raw.removed ? 'removed' : null } as unknown as Setup;
  setups.set(p.sym + '|' + p.dir, p);
}

const strip = <T,>(x: T): T => JSON.parse(JSON.stringify(x === undefined ? null : x));

describe('parity with the old page on frozen inputs', () => {
  it('covers every row the old page had', () => {
    expect(old.rows).toHaveLength(148);
    for (const r of old.rows) expect(setups.has(r.sym + '|' + r.dir), r.sym + '|' + r.dir).toBe(true);
  });

  for (const r of old.rows) {
    it(`${r.sym} ${r.dir} → ${r.section}`, () => {
      const p = setups.get(r.sym + '|' + r.dir)!;
      const row = evaluate(p, old.HIST[r.sym], old.BARS[r.sym], {}, '2026-11-01');
      const ours = strip({ section: row.section, btype: row.btype, lfd: row.lfd,
        breakout: row.st.breakout, targetHit: row.st.targetHit, failed: row.st.failed });
      const theirs = strip({ section: r.section, btype: r.btype, lfd: r.lfd,
        breakout: r.breakout, targetHit: r.targetHit, failed: r.failed });
      expect(ours).toEqual(theirs);
    });
  }

  it('reproduces the section counts the old page showed', () => {
    const counts: Record<string, number> = {};
    for (const r of old.rows) {
      const p = setups.get(r.sym + '|' + r.dir)!;
      const s = evaluate(p, old.HIST[r.sym], old.BARS[r.sym], {}, '2026-11-01').section;
      counts[s] = (counts[s] || 0) + 1;
    }
    expect(counts).toEqual({ watch: 31, breakout: 18, reentered: 11, stopped: 6, target: 15, failed: 30, removed: 37 });
  });
});
