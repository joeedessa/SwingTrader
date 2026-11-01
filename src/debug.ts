import type { Board } from './engine/row';
import type { Section } from './engine/types';

/* `window.__board` is the page's own account of itself, so a check in the console is one expression:
   what it counts in each section, what each row resolved to, and what went wrong loading. */

export interface BoardDebug {
  set: string;
  counts: Record<Section, number>;
  /** Counts after the search and the filters, which is what the segments show. */
  shown: Record<Section, number>;
  rows: { sym: string; dir: string; section: Section; tag: string | null; lfd: number | null; lfdSrc: string | null; pullbacks: number; breaches: number; reentries: number; broke: string | null; target: string | null; failed: string | null; stopHit: string | null }[];
  errors: string[];
  data: { snapshot: string | null; bars: string | null; live: string; symbols: number; withoutBars: string[] };
}

declare global {
  interface Window {
    __board?: BoardDebug;
  }
}

export function publish(set: string, bd: Board, shown: Record<Section, number>, errors: string[], data: BoardDebug['data']): void {
  window.__board = {
    set,
    counts: bd.counts,
    shown,
    rows: bd.rows.map(r => ({
      sym: r.p.sym, dir: r.p.dir, section: r.section, tag: r.btype ? r.btype.tag : null,
      lfd: r.lfd ? r.lfd.at : null, lfdSrc: r.lfd ? r.lfd.src : null,
      pullbacks: r.btype?.pullbacks?.length ?? 0, breaches: r.btype?.breaches?.length ?? 0, reentries: r.btype?.reentries?.length ?? 0,
      broke: r.st.breakout ? r.st.breakout.when : null, target: r.st.targetHit ? r.st.targetHit.when : null, failed: r.st.failed ? r.st.failed.when : null, stopHit: r.lfd && r.lfd.hit ? r.lfd.hit.when : null,
    })),
    errors,
    data,
  };
}
