import type { Row } from './row';
import type { Dir, Section } from './types';

/* How the setups that have run their course ended (plan A6): by the type they had at their first outcome, how often a
   breakout reached its target rather than its negation, and how long each took.

   Each setup counts once, by what happened to it first, on settled closes. The target reached before the negation was
   touched is a hit, and it stays one if the negation is touched later or the source drops the setup: the sections keep the
   latest state, so a hit can sit in Failed or Removed. The negation touched first is a miss. The ones still in play
   (Confirmed, Re-entered, Stopped out) have no outcome yet and are not counted: counting them as anything would make the
   rate say more than the data does. Nor is a setup moved to Failed by hand when nothing in the bars ended it, or one the
   source removed before either happened.

   A setup the source removed counts only for what happened up to the day it was dropped: the replay goes on reading its
   bars, and a breakout, target or touch after that day is not one of the source's setups any more.

   The type is the one the setup had at its first outcome. A hit was B1 (no pullback through the trigger), B2 (pulled back,
   the last full day held) or B3 (took out its last full day on the way); a miss is B4. */

export type OutcomeTag = 'B1' | 'B2' | 'B3' | 'B4';

export const OUTCOME_TAGS: readonly OutcomeTag[] = ['B1', 'B2', 'B3', 'B4'];

export interface TypeOutcome {
  tag: OutcomeTag;
  count: number;
  /** Calendar days from the breakout to the target (B1 to B3) or to the failure (B4), the middle one; null with none. */
  medianDays: number | null;
}

/** A hit that no longer sits At target. */
export interface MovedHit {
  sym: string;
  dir: Dir;
  /** Where it stands now: Failed, or Removed. */
  section: Section;
  /** The bars ended it after the target (the negation was touched); false for one moved to Failed by hand or removed. */
  negated: boolean;
  /** The day it reached the target. */
  when: string;
}

export interface Outcomes {
  /** Reached the target before the negation was touched, whatever became of it afterwards. */
  hits: number;
  /** The negation was touched before any target. */
  misses: number;
  /** `hits + misses`. */
  resolved: number;
  /** Hits as a share of resolved, whole per cent; null with nothing resolved. */
  hitRate: number | null;
  byType: TypeOutcome[];
  /** Broke out and still in play: Confirmed, Re-entered or Stopped out. */
  open: number;
  /** Hits without daily bars to say which of B1 to B3 they were. */
  untyped: number;
  /** Moved to Failed by hand: no bar ended them, so no outcome is counted. */
  byHand: number;
  /** Broke out, and were removed by the source before the target or the negation. */
  removedBeforeOutcome: number;
  /** Hits that are no longer At target, by the day they reached it. */
  moved: MovedHit[];
  medianToTarget: number | null;
  medianToFailure: number | null;
}

/** The middle value, or the mean of the two middle ones. */
export function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Whole calendar days from one ISO date to a later one. */
export const spanDays = (from: string, to: string): number => Math.round((Date.parse(to) - Date.parse(from)) / 864e5);

export function outcomesOf(rows: readonly Row[]): Outcomes {
  const days: Record<OutcomeTag, number[]> = { B1: [], B2: [], B3: [], B4: [] };
  const counts: Record<OutcomeTag, number> = { B1: 0, B2: 0, B3: 0, B4: 0 };
  const toTarget: number[] = [], toFailure: number[] = [];
  const moved: MovedHit[] = [];
  let hits = 0, misses = 0, open = 0, untyped = 0, byHand = 0, removedBeforeOutcome = 0;
  for (const r of rows) {
    const s = r.section;
    // A removal dates the end of the record only while the row is in Removed: a browser that put it back counts it all.
    const cut = s === 'removed' ? r.p.removed || null : null;
    const upTo = (when: string) => !cut || when <= cut;
    const hit = r.hit && upTo(r.hit.when) ? r.hit : null;
    // A negation after a hit comes later than it, so it is no miss, and where the hit falls outside the record so does it.
    const miss = r.st.failed && upTo(r.st.failed.when) ? r.st.failed : null;
    if (hit) {
      hits++;
      if (s !== 'target') moved.push({ sym: r.p.sym, dir: r.p.dir, section: s, negated: !!r.st.failed, when: hit.when });
      const tag = hit.btype && hit.btype.tag && hit.btype.tag !== 'B4' ? hit.btype.tag : null;
      const d = r.st.breakout ? spanDays(r.st.breakout.when, hit.when) : null;
      if (d != null) toTarget.push(d);
      if (!tag) { untyped++; continue; }
      counts[tag]++;
      if (d != null) days[tag].push(d);
    } else if (miss) {
      misses++;
      counts.B4++;
      const d = r.st.breakout ? spanDays(r.st.breakout.when, miss.when) : null;
      if (d != null) { toFailure.push(d); days.B4.push(d); }
    } else if (s === 'breakout' || s === 'reentered' || s === 'stopped') {
      open++;
    } else if (s === 'failed') {
      byHand++;
    } else if (s === 'removed' && r.st.breakout && upTo(r.st.breakout.when)) {
      removedBeforeOutcome++;
    }
  }
  moved.sort((a, b) => a.when.localeCompare(b.when) || a.sym.localeCompare(b.sym));
  const resolved = hits + misses;
  return {
    hits, misses, resolved,
    hitRate: resolved ? Math.round(hits / resolved * 100) : null,
    byType: OUTCOME_TAGS.map(tag => ({ tag, count: counts[tag], medianDays: median(days[tag]) })),
    open, untyped, byHand, removedBeforeOutcome, moved,
    medianToTarget: median(toTarget), medianToFailure: median(toFailure),
  };
}
