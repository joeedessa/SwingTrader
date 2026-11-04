import { evaluate } from '../row';
import type { Row } from '../row';
import type { Bars, BreakoutTag, Dir, History } from '../types';
import type { ModelSettings } from './settings';

/* The trade universe (plan B1): every watchlist setup that broke out, by the board's own replay, each with the daily
   bars the simulation steps through. The board decides who broke out; this module only turns a row into something a
   strategy can run on, or says why it cannot.

   A setup the source removed counts only if it broke out on or before the removal date, as History counts it: the
   replay goes on reading the bars, and a breakout after the source dropped the setup is not the source's setup. The
   universe count is the breakout count the page prints; what is excluded is listed with its reason. */

/** One day the simulation steps through: a settled bar, or the newest session settled by its close alone. */
export interface Day {
  when: string;
  lo: number;
  hi: number;
  c: number | null;
  /** The open, where the bars have it. */
  o: number | null;
  /** The newest session, known by its close alone: nothing intraday is read from it, as the board reads nothing. */
  closeOnly: boolean;
}

/** Where the tight stop came from: the report; derived from the bars; none in the report (`lfd: 0`); derived but beyond
    the negation, so no stop; or not readable from the bars at all (no full bar before the run). */
export type StopSource = 'report' | 'derived' | 'none' | 'looser' | 'underived';

export const STOP_WORDS: Record<StopSource, string> = {
  report: 'the last full day in the report',
  derived: 'the last full day read from the bars',
  none: 'no tight stop: none in the report',
  looser: 'no tight stop: the derived last full day is beyond the negation',
  underived: 'no tight stop: none could be read from the bars',
};

export interface Candidate {
  key: string;
  sym: string;
  dir: Dir;
  currency: string;
  trigger: number;
  target: number | null;
  negation: number | null;
  boundary: number | null;
  /** The day the entry is signalled from, its close, and its index in `days`: the confirming close, or for a setup imported
      already confirmed and entered from the report, the last day on or before the report's date. */
  signal: { when: string; price: number; index: number };
  signalKind: 'close' | 'report';
  /** For an imported setup, the confirming close the lookback found, whichever day it enters from. */
  confirming: { when: string; price: number } | null;
  /** The tight stop, or null where there is none (the report gives none, or a derived one is beyond the negation). */
  stop: number | null;
  stopSource: StopSource;
  days: Day[];
  /** The last day of the record where the source removed the setup (its date, often a Saturday), else null. */
  removed: string | null;
  removedReason: string | null;
  /** The source counted the target on this day where the closes fell short. */
  reached: string | null;
  /** Imported already confirmed, so the confirming close was found by the lookback rather than the replay. */
  imported: boolean;
  /** The type at the setup's first outcome (B1 to B3 at the target, B4 at the negation), or its latest type before one. */
  tag: BreakoutTag | null;
  row: Row;
}

export interface Excluded {
  key: string;
  sym: string;
  dir: Dir;
  reason: string;
}

export interface Universe {
  /** Every setup that broke out: the number the page prints. */
  breakouts: number;
  candidates: Candidate[];
  excluded: Excluded[];
}

export const keyOf = (sym: string, dir: Dir): string => sym + '|' + dir;

/** Whether the row broke out as the source's setup: a breakout, on or before the removal date where there is one. A
    breakout marked by hand in this browser counts too, so the model can say it has no close to enter at. */
export function brokeOut(r: Row): boolean {
  const b = r.st.breakout;
  if (!b) return r.p.manualState === 'breakout' && r.st.state === 'watch';
  const cut = r.section === 'removed' ? r.p.removed || null : null;
  return !cut || b.when <= cut;
}

/** The days in order: the bars on file up to the last settled close, then any later settled close as a close-only day. */
export function daysOf(bars: Bars | null | undefined, hist: History | null | undefined): Day[] {
  const out: Day[] = [];
  const settled = hist ? hist.settled : [];
  const lastSettled = settled.length ? settled[settled.length - 1][0] : null;
  const dates = bars ? Object.keys(bars).sort() : [];
  for (const d of dates) {
    if (lastSettled && d > lastSettled) continue;
    const b = (bars as Bars)[d];
    out.push({ when: d, lo: b[0], hi: b[1], c: b[2], o: b.length > 3 && b[3] != null ? b[3] : null, closeOnly: false });
  }
  const newest = out.length ? out[out.length - 1].when : '';
  for (const [d, c] of settled) if (d > newest) out.push({ when: d, lo: c, hi: c, c, o: null, closeOnly: true });
  return out;
}

/** The type for the breakdown: the one at the setup's first outcome (History's rule), or its latest before one. A setup the
    source removed is read as it stood on the removal date, since the board's own type goes on counting the bars after it. */
function tagOf(r: Row, hist: History | undefined, bars: Bars | undefined, removed: string | null): BreakoutTag | null {
  let row = r;
  if (removed && hist) {
    const cut: History = { ...hist, settled: hist.settled.filter(([d]) => d <= removed) };
    row = evaluate(r.p, cut, bars, null, removed);
  }
  return row.hit ? (row.hit.btype ? row.hit.btype.tag : null) : (row.btype ? row.btype.tag : null);
}

function candidateOf(r: Row, hist: History | undefined, bars: Bars | undefined, settings: ModelSettings): Candidate | Excluded {
  const p = r.p;
  const key = keyOf(p.sym, p.dir);
  const no = (reason: string): Excluded => ({ key, sym: p.sym, dir: p.dir, reason });
  if (!r.st.breakout) return no('marked as a breakout by hand: no confirming close in the bars');
  if (p.breakthrough == null) return no('no trigger level');
  const days = daysOf(bars, hist);
  if (!days.some(d => !d.closeOnly)) return no('no daily bars');
  const b = r.st.breakout;
  let when: string, price: number | null = null, index: number;
  let signalKind: Candidate['signalKind'] = 'close';
  let confirming: Candidate['confirming'] = null;
  if (b.close != null) {
    when = b.when; price = b.close;
    index = days.findIndex(d => d.when === when);
    if (index < 0) return no(`the confirming close (${when}) is not in the bars`);
  } else {
    // Imported already confirmed: the report's date is the breakout's, and the lookback found the close behind it.
    const conf = r.lfd ? r.lfd.conf : null;
    if (!conf) return no('the confirming close was not found in the sessions before the report\'s date');
    const ci = days.findIndex(d => d.when === conf);
    if (ci < 0 || days[ci].c == null) return no(`the confirming close (${conf}) is not in the bars`);
    confirming = { when: conf, price: days[ci].c as number };
    if (settings.importedEntry === 'report' && p.confirmed) {
      // The last close on or before the report's date: what was known when the report came out.
      let k = days.length - 1;
      while (k > ci && (days[k].when > p.confirmed || days[k].c == null)) k--;
      index = k; when = days[k].when; price = days[k].c; signalKind = 'report';
    } else { index = ci; when = conf; price = confirming.price; }
  }
  if (price == null) return no(`the signal day (${when}) has no close`);
  const L = r.lfd;
  const stopSource: StopSource = !L || L.src == null ? 'underived' : L.looser ? 'looser' : L.src;
  const stop = L && L.at != null && !L.looser ? L.at : null;
  const removed = r.section === 'removed' ? p.removed || null : null;
  return {
    key, sym: p.sym, dir: p.dir, currency: hist ? hist.currency : '',
    trigger: p.breakthrough, target: p.target ?? null, negation: p.negation ?? null, boundary: p.boundary ?? null,
    signal: { when, price, index }, signalKind, confirming,
    stop, stopSource, days,
    removed,
    removedReason: removed ? p.removed_reason || null : null,
    reached: p.reached || null,
    imported: b.close == null,
    tag: tagOf(r, hist, bars, removed),
    row: r,
  };
}

export function universeOf(rows: readonly Row[], hist: Record<string, History | undefined>, bars: Record<string, Bars | undefined>,
                           settings: ModelSettings): Universe {
  const candidates: Candidate[] = [];
  const excluded: Excluded[] = [];
  let breakouts = 0;
  for (const r of rows) {
    if (!brokeOut(r)) continue;
    breakouts++;
    const c = candidateOf(r, hist[r.p.sym], bars[r.p.sym], settings);
    if ('reason' in c) { excluded.push(c); continue; }
    if (settings.from && c.signal.when < settings.from) { excluded.push({ key: c.key, sym: c.sym, dir: c.dir, reason: `broke out before ${settings.from}` }); continue; }
    if (settings.removed === 'exclude' && c.removed) { excluded.push({ key: c.key, sym: c.sym, dir: c.dir, reason: 'removed by the source after breaking out' }); continue; }
    candidates.push(c);
  }
  return { breakouts, candidates, excluded };
}

/** The payoff the pattern promised, trigger to target, in % the setup's way; null without a target past the trigger. */
export function payoffOf(c: Pick<Candidate, 'dir' | 'trigger' | 'target'>): number | null {
  if (c.target == null || c.trigger === 0) return null;
  const v = (c.target - c.trigger) / c.trigger * 100 * (c.dir === 'long' ? 1 : -1);
  return v > 0 ? v : null;
}
