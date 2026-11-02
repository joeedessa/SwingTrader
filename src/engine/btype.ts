import { against, atOrAgainst, past } from './precision';
import type { Bars, BreakoutType, Hit, History, Lfd, Reentry, ReplayState, Setup, Touch } from './types';

/* Breakout type, Tech Charts' four, followed day by day while the trade is
   open. A breakout starts as B1, can fall to B2, then to B3; B4 is the
   negation (the Failed section):
     B1  no pullback through the trigger since the confirming close
     B2  pulled back through the trigger, last full day intact: stay in, and
         count the pullbacks
     B3  took out the last full day: exit, and count the breaches
   The trigger is the breakout level (boundary plus the 3% filter). It, not
   the boundary, is what Tech Charts' own type 2 examples gave back.

   Counting, on settled daily bars after the confirming close:
     · a pullback starts on the first touch of the trigger (low for a long,
       high for a short) and ends on the first day trading entirely past it;
       the next touch is the next pullback
     · a breach is a touch of the last full day: an exit. Out until a close
       back past the trigger (the re-entry), then in again with the same last
       full day as the stop, so the next touch is breach 2
   At target the counting stops and the type is final. */
export function typeOf(p: Setup, st: ReplayState, L: Lfd | null, hist: History | null | undefined,
                       bars: Bars | null | undefined): BreakoutType | null {
  if (st.state === 'failed') return { tag: 'B4' };
  if (st.state !== 'breakout' && st.state !== 'target') return null;
  const long = p.dir === 'long';
  const dates = bars ? Object.keys(bars).sort() : [];
  if (!dates.length || !bars || p.breakthrough == null) return { tag: null };
  const lastSettled = hist && hist.settled.length ? hist.settled[hist.settled.length - 1][0] : null;
  const from = (L && L.conf) || (st.breakout && st.breakout.when) || p.confirmed || p.created || '';
  const end = st.state === 'target' && st.targetHit ? st.targetHit.when : lastSettled;
  const trig = p.breakthrough;
  const stop = L && L.at != null && !L.looser ? L.at : null;
  const pullbacks: Touch[] = [], breaches: Touch[] = [], reentries: Reentry[] = [];
  let inPull = false, out = false;
  for (const d of dates) {
    if (d <= from || (end && d > end)) continue;
    const [lo, hi, c] = bars[d];
    const ext = long ? lo : hi;
    if (!out && stop != null && against(long, ext, stop)) {
      breaches.push({ when: d, at: ext }); out = true; inPull = false; continue;
    }
    if (out) {
      if (c != null && past(long, c, trig)) { reentries.push({ when: d, close: c }); out = false; }
      continue;
    }
    if (breaches.length) continue;             // after a re-entry only the stop is watched
    if (atOrAgainst(long, ext, trig)) {
      if (!inPull) { pullbacks.push({ when: d, at: ext }); inPull = true; }
    } else inPull = false;
  }
  return { tag: breaches.length ? 'B3' : pullbacks.length ? 'B2' : 'B1', final: st.state === 'target',
           pullbacks, breaches, reentries, out, trig, stop,
           stopHit: breaches[0] || null, retest: pullbacks[0] || null,
           reentry: reentries[reentries.length - 1] || null,
           noStop: stop == null };
}

/* The target a breakout reached before the negation was touched, with the type it had at that moment; null when the negation
   came first or neither has happened yet.

   The replay stops at the first touch of the negation, so a target it recorded came first, and the touch does not take it
   back: the type is read as of the target day (the counting stops there), where `typeOf` says B4 for a setup the negation
   ended. A `reached` date the replay could not use, because the negation was touched after it, has the same standing; one on
   the day of the touch or later has not, as the replay tests the touch first on a day. */
export function hitOf(p: Setup, st: ReplayState, L: Lfd | null, hist: History | null | undefined,
                      bars: Bars | null | undefined, btype: BreakoutType | null): Hit | null {
  let when: string, bySource: boolean;
  if (st.targetHit) { when = st.targetHit.when; bySource = !!st.targetHit.bySource; }
  else if (st.failed && p.reached && p.reached < st.failed.when) { when = p.reached; bySource = true; }
  else return null;
  if (st.state !== 'failed') return { when, btype, bySource };
  const atTarget: ReplayState = { ...st, state: 'target', targetHit: { when, close: null, bySource }, failed: null };
  return { when, btype: typeOf(p, atTarget, L, hist, bars), bySource };
}
