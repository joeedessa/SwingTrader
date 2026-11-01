import type { Bars, History, Lfd, ReplayState, Setup } from './types';

/* The tight stop: the last full day's low (a long) or high (a short).

   Anchored to the PATTERN BOUNDARY, by the desk's rule: the first close
   through the boundary records it, from the full daily bar before that
   close. That close confirms nothing; the trigger still does that, and the
   row stays in the watchlist until it does.

   The anchor is the start of the run of closes past the boundary that
   carries into the confirmation (or, still waiting, into the latest close).
   A close back inside the pattern ends the run, and the next close through
   starts a new one.

   Without a boundary on file the trigger is the anchor. A level from the
   report (`lfd`) wins over both; `lfd: 0` means the sheet gives none.

   A derived stop beyond the negation is no stop at all (`looser`).
   Breach is a touch, on settled bars after the confirming close. */
export const LFD_LOOKBACK = 40;

export function lfdOf(p: Setup, st: ReplayState, hist: History | null | undefined,
                      bars: Bars | null | undefined): Lfd | null {
  const long = p.dir === 'long';
  const confirmed = st.state !== 'watch' || p.manualState === 'breakout';
  if (!confirmed && p.boundary == null) return null;
  const b: Bars = bars || {};
  const dates = bars ? Object.keys(bars).sort() : [];
  const lastSettled = hist && hist.settled.length ? hist.settled[hist.settled.length - 1][0] : null;
  let last = dates.length - 1;
  while (last >= 0 && lastSettled && dates[last] > lastSettled) last--;
  const close = (i: number): number | null => b[dates[i]][2];
  const past = (c: number | null, lvl: number | null | undefined) =>
    c != null && lvl != null && (long ? c > lvl : c < lvl);
  const atOrPast = (c: number | null, lvl: number | null | undefined) =>
    c != null && lvl != null && (long ? c >= lvl : c <= lvl);
  // Most recent close crossing `lvl` on or before index k, within the lookback.
  const crossBefore = (k: number, lvl: number | null | undefined) => {
    for (let i = k; i > 0 && i > k - LFD_LOOKBACK; i--)
      if (atOrPast(close(i), lvl) && !atOrPast(close(i - 1), lvl)) return i;
    return -1;
  };
  const listedIdx = () => {
    const listed = p.confirmed || p.created || '9999';
    let k = last;
    while (k >= 0 && dates[k] > listed) k--;
    return k;
  };

  // The confirming close: the replay's own, or for a setup imported already
  // confirmed (dated by the report, often a Saturday) the latest trigger cross.
  let ci = -1;
  if (confirmed && dates.length) {
    if (st.breakout && st.breakout.close != null) ci = dates.indexOf(st.breakout.when);
    else if (p.breakthrough != null) ci = crossBefore(listedIdx(), p.breakthrough);
  }

  // The anchor: first close of the run past the boundary.
  const kind = p.boundary != null ? 'boundary' : 'trigger';
  let ai = -1;
  if (dates.length) {
    if (kind === 'trigger') ai = ci;
    else {
      const end = confirmed ? ci : (last >= 0 && past(close(last), p.boundary) ? last : -1);
      if (end >= 0) {
        let i = end, n = 0;
        while (i > 0 && past(close(i - 1), p.boundary) && n < LFD_LOOKBACK) { i--; n++; }
        ai = n < LFD_LOOKBACK ? i : -1;
      } else if (confirmed) ai = crossBefore(listedIdx(), p.boundary);
    }
  }

  const out: Lfd = { at: null, src: null, kind, pending: !confirmed,
    conf: ci >= 0 ? dates[ci] : null, anchor: ai >= 0 ? dates[ai] : null,
    bar: null, alt: null, hit: null };
  if (ai > 0) { out.bar = dates[ai - 1]; out.at = b[out.bar][long ? 0 : 1]; out.src = 'derived'; }
  // The confirmation-anchored reading, where it differs.
  if (kind === 'boundary' && ci > 0 && ci !== ai)
    out.alt = { bar: dates[ci - 1], at: b[dates[ci - 1]][long ? 0 : 1] };
  if (p.lfd === 0) { out.at = null; out.src = 'none'; out.bar = null; out.alt = null; return out; }
  if (p.lfd != null) { out.at = p.lfd; out.src = 'report'; }
  if (out.at == null) return out;

  // A derived bar can be wider than the pattern itself (NWH.AX broke out the
  // day after a 6.69–7.70 range, putting its "tight" stop below the negation).
  if (out.src === 'derived' && p.negation != null &&
      (long ? out.at <= p.negation : out.at >= p.negation)) { out.looser = true; return out; }
  if (!confirmed) return out;
  const from = out.conf || p.confirmed || p.created || '';
  for (let i = 0; i <= last; i++) {
    const d = dates[i];
    if (d <= from) continue;
    const lvl = b[d][long ? 0 : 1];
    if (long ? lvl < out.at : lvl > out.at) { out.hit = { when: d, at: lvl }; break; }
  }
  return out;
}
