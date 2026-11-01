import { typeOf } from './btype';
import { dayPctOf, gapTo, riskOf, upsideOf } from './derived';
import { lfdOf } from './lfd';
import { replay } from './replay';
import { sectionOf } from './sections';
import { SECTIONS } from './types';
import type { Bars, BreakoutType, History, Lfd, ReplayState, Section, Setup, SymbolEvents } from './types';

/** Everything the board knows about one setup on one load. */
export interface Row {
  p: Setup;
  st: ReplayState;
  section: Section;
  live: number | null;
  liveDate: string;
  prevClose: number | null;
  prevDate: string;
  prevClose2: number | null;
  prevDate2: string;
  /** What the last completed session did, close over close, in %. */
  prevChg: number | null;
  currency: string;
  dayPct: number | null;
  /** Signed distance to the trigger in % (shorts read negative), waiting rows only. */
  gap: number | null;
  /** The same distance in money, positive while short of the trigger. */
  gapAbs: number | null;
  upside: number | null;
  risk: number | null;
  lfd: Lfd | null;
  btype: BreakoutType | null;
  ev: SymbolEvents;
  earnings: string | null;
  exdiv: string | null;
  earningsSoon: boolean;
  /** The date of the row's last outcome: failed, else target, else breakout. */
  when: string;
  /** True when the live tick is from a session still running. */
  isLive: boolean;
}

/** Today's date as the engine sees it: ISO, UTC, the same rule the old page used. */
export const isoToday = (now: Date = new Date()): string => now.toISOString().slice(0, 10);

export function evaluate(p: Setup, hist: History | null | undefined, bars: Bars | null | undefined,
                         ev: SymbolEvents | null | undefined, today: string = isoToday()): Row {
  const st = replay(p, hist, bars);
  const lfd = lfdOf(p, st, hist, bars);
  const btype = typeOf(p, st, lfd, hist, bars);
  const section = sectionOf(p, st, btype);
  const s = hist ? hist.settled : [];
  const prev = s.length ? s[s.length - 1] : null;
  const prev2 = s.length > 1 ? s[s.length - 2] : null;
  const live = hist ? hist.live : null;
  const waiting = st.state === 'watch';
  const gap = gapTo(p, prev ? prev[1] : null, waiting);
  const e = ev || {};
  const prevChg = (prev && prev2 && prev2[1])
    ? Math.round((prev[1] / prev2[1] - 1) * 1000) / 10 : null;
  return {
    p, st, section, live,
    liveDate: hist ? hist.liveDate : '',
    prevClose: prev ? prev[1] : null,
    prevDate: prev ? prev[0] : '',
    prevClose2: prev2 ? prev2[1] : null,
    prevDate2: prev2 ? prev2[0] : '',
    prevChg,
    currency: hist ? hist.currency : '',
    dayPct: dayPctOf(hist),
    gap: gap.pct,
    gapAbs: gap.abs,
    upside: upsideOf(p, live, waiting),
    risk: riskOf(p, live, waiting),
    lfd, btype, ev: e,
    earnings: e.earnings || null,
    // A manually set ex-div outranks the feed and is shown as-is.
    exdiv: p.ex_div ? p.ex_div : ((e.ex_div && e.ex_div >= today) ? e.ex_div : null),
    earningsSoon: !!(e.earnings && e.earnings >= today &&
      (Date.parse(e.earnings) - Date.parse(today)) / 864e5 <= 7),
    when: st.failed ? st.failed.when : st.targetHit ? st.targetHit.when : st.breakout ? st.breakout.when : '',
    isLive: !!hist && hist.live != null && hist.liveDate !== (prev ? prev[0] : ''),
  };
}

export interface Board {
  rows: Row[];
  bySection: Record<Section, Row[]>;
  counts: Record<Section, number>;
}

/** The whole list, evaluated. Rows keep the list's order; sections are filled in that order too. */
export function board(list: Setup[], hist: Record<string, History | undefined>, bars: Record<string, Bars | undefined>,
                      events: Record<string, SymbolEvents | undefined>, today: string = isoToday()): Board {
  const rows = list.map(p => evaluate(p, hist[p.sym], bars[p.sym], events[p.sym], today));
  const bySection = Object.fromEntries(SECTIONS.map(s => [s, [] as Row[]])) as Record<Section, Row[]>;
  for (const r of rows) bySection[r.section].push(r);
  const counts = Object.fromEntries(SECTIONS.map(s => [s, bySection[s].length])) as Record<Section, number>;
  return { rows, bySection, counts };
}
