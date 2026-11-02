import type { Row } from './row';

/* How the setups that have run their course ended (plan A6): by the type they ended as, how often a breakout reached its
   target rather than its negation, and how long each took.

   A setup is resolved when it reached its target or the negation ended it, on settled closes. The ones still in play
   (Confirmed, Re-entered, Stopped out) are not counted: they have no outcome yet, and counting them as anything would make
   the rate say more than the data does. A setup moved to Failed by hand is left out too, since nothing in the bars ended it.

   The type is the one the setup ended as. One that reached its target ended as B1 (no pullback through the trigger), B2
   (pulled back, the last full day held) or B3 (took out its last full day on the way); the negation ends one as B4. */

export type OutcomeTag = 'B1' | 'B2' | 'B3' | 'B4';

export const OUTCOME_TAGS: readonly OutcomeTag[] = ['B1', 'B2', 'B3', 'B4'];

export interface TypeOutcome {
  tag: OutcomeTag;
  count: number;
  /** Calendar days from the breakout to the target (B1 to B3) or to the failure (B4), the middle one; null with none. */
  medianDays: number | null;
}

export interface Outcomes {
  reached: number;
  failed: number;
  /** `reached + failed`. */
  resolved: number;
  /** Reached as a share of resolved, whole per cent; null with nothing resolved. */
  hitRate: number | null;
  byType: TypeOutcome[];
  /** Broke out and still in play: Confirmed, Re-entered or Stopped out. */
  open: number;
  /** At target, but without daily bars to say which of B1 to B3 it ended as. */
  untyped: number;
  /** Moved to Failed by hand: no bar ended them, so no outcome is counted. */
  byHand: number;
  /** Failed, but only after reaching the target: they count as failed (B4), where they ended. */
  failedAfterTarget: number;
  /** Reached the target and were then removed by the source: in neither count. */
  removedAfterTarget: number;
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
  let reached = 0, failed = 0, open = 0, untyped = 0, byHand = 0, failedAfterTarget = 0, removedAfterTarget = 0;
  for (const r of rows) {
    const s = r.section;
    if (s === 'breakout' || s === 'reentered' || s === 'stopped') { open++; continue; }
    if (s === 'target') {
      reached++;
      const tag = r.btype && r.btype.tag && r.btype.tag !== 'B4' ? r.btype.tag : null;
      const d = r.st.breakout && r.st.targetHit ? spanDays(r.st.breakout.when, r.st.targetHit.when) : null;
      if (d != null) toTarget.push(d);
      if (!tag) { untyped++; continue; }
      counts[tag]++;
      if (d != null) days[tag].push(d);
    } else if (s === 'failed') {
      if (!r.st.failed) { byHand++; continue; }
      failed++;
      if (r.st.targetHit) failedAfterTarget++;
      counts.B4++;
      const d = r.st.breakout ? spanDays(r.st.breakout.when, r.st.failed.when) : null;
      if (d != null) { toFailure.push(d); days.B4.push(d); }
    } else if (s === 'removed' && r.st.targetHit) {
      removedAfterTarget++;
    }
  }
  const resolved = reached + failed;
  return {
    reached, failed, resolved,
    hitRate: resolved ? Math.round(reached / resolved * 100) : null,
    byType: OUTCOME_TAGS.map(tag => ({ tag, count: counts[tag], medianDays: median(days[tag]) })),
    open, untyped, byHand, failedAfterTarget, removedAfterTarget,
    medianToTarget: median(toTarget), medianToFailure: median(toFailure),
  };
}
