import type { Bars, History, ReplayState, Setup } from './types';

/* Replay on SETTLED closes only:
     watch    --close above trigger (long) / below it (short)-->  breakout
     any      --touch of the negation the wrong way-->             failed (outranks all)
     breakout --close at or past target-->                         target (not terminal)
   Entries with `confirmed` (imported from the source's breakout list) start
   in the breakout state on that date.

   The negation belongs to the breakout, not to the watchlist: a setup still
   waiting has no position to invalidate, so it is tested only after the
   trigger. It is a touch, not a close: the day's low for a long and its high
   for a short, where the bar is known; the close where it is not, and the
   result says which basis it ran on. */
export function replay(p: Setup, hist: History | null | undefined, bars: Bars | null | undefined): ReplayState {
  const st: ReplayState = { state: 'watch', breakout: null, targetHit: null, failed: null };
  if (p.confirmed) {
    st.state = 'breakout';
    st.breakout = { when: p.confirmed, close: null };
  }
  if (!hist) return st;
  const long = p.dir === 'long';
  const from = p.confirmed || p.created;
  for (const [date, c] of hist.settled) {
    if (from && date < from) continue;
    const ext = bars ? bars[date] : undefined;
    const level = ext ? (long ? ext[0] : ext[1]) : c;
    const negHit = st.state !== 'watch' && p.negation != null &&
      (long ? level < p.negation : level > p.negation);
    if (negHit) {
      // A held position records the touch and keeps its state: staying in is a
      // judgement the replay has no business overturning, but it must not go unmarked.
      if (p.hold) {
        st.touched = st.touched || { when: date, at: level, byTouch: !!ext && level !== c };
        continue;
      }
      st.failed = { when: date, close: c, at: level, byTouch: !!ext && level !== c,
        reason: st.state === 'target' ? 'negated after reaching target' : 'failed breakout' };
      st.state = 'failed';
      break;
    }
    if (st.state === 'watch' && p.breakthrough != null &&
        (long ? c > p.breakthrough : c < p.breakthrough)) {
      st.state = 'breakout';
      st.breakout = { when: date, close: c };
      continue;
    }
    if (st.state === 'breakout' && p.target != null &&
        (long ? c >= p.target : c <= p.target)) {
      st.state = 'target';
      st.targetHit = { when: date, close: c };
    }
  }
  // `reached`: the source counts the target as met where our closes fell just short.
  if (p.reached && st.state === 'breakout') {
    st.state = 'target';
    st.targetHit = { when: p.reached, close: null, bySource: true };
  }
  return st;
}
