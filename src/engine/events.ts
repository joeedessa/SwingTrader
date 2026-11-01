import type { Row } from './row';
import type { Dir } from './types';

/* Setup events are a weekly log: every event dated in the window, newest
   first, rebuilt from the settled bars on each load (so last week can be
   shown exactly as it happened). Intraday flags carry "live" instead of a
   date and only show in the current week. */

export type LogClass = 'new' | 'bad' | 'warn';

export type EventKind =
  | 'breakout' | 'target' | 'failed' | 'boundary' | 'pullback' | 'exit' | 'reentry'
  | 'live-trigger' | 'live-stop' | 'live-negation';

export interface LogItem {
  kind: EventKind;
  cls: LogClass;
  /** An ISO date, or "live" for an intraday flag. */
  when: string;
  sym: string;
  dir: Dir;
  /** Pullback / exit / re-entry number, counted from 1. */
  n?: number;
  text: string;
}

/** Numbers as the board prints them: one decimal from 100 up, two below. */
export const fmt = (v: number | null | undefined): string =>
  v == null || !isFinite(v) ? '–'
  : v.toLocaleString('en-US', { maximumFractionDigits: Math.abs(v) >= 100 ? 1 : 2 });

/** Every event one row has raised, settled ones dated, live ones marked "live". Removed rows raise none. */
export function setupEvents(r: Row): LogItem[] {
  const items: LogItem[] = [];
  if (r.section === 'removed') return items;
  const { p, st } = r;
  const up = p.dir === 'long';
  const lh = up ? 'low' : 'high';
  const ev = (kind: EventKind, cls: LogClass, when: string | null | undefined, text: string, n?: number) => {
    if (when) items.push({ kind, cls, when, sym: p.sym, dir: p.dir, text, ...(n != null ? { n } : {}) });
  };
  const lv = (kind: EventKind, cls: LogClass, text: string) =>
    items.push({ kind, cls, when: 'live', sym: p.sym, dir: p.dir, text });
  const who = p.sym + ' ' + p.dir + ' — ';

  if (st.breakout && st.breakout.close != null)
    ev('breakout', 'new', st.breakout.when, who + 'BREAKOUT CONFIRMED: closed ' +
      (up ? 'above' : 'below') + ' the trigger at ' + fmt(st.breakout.close) + ' (trigger ' + fmt(p.breakthrough) + ')');
  if (st.targetHit && !st.targetHit.bySource)
    ev('target', 'new', st.targetHit.when, who + 'reached its target on the close (' +
      fmt(st.targetHit.close) + ' vs target ' + fmt(p.target) + ')');
  if (st.failed)
    ev('failed', 'bad', st.failed.when, who + st.failed.reason + ': ' +
      (st.failed.byTouch ? 'touched ' + fmt(st.failed.at) : 'closed ' + fmt(st.failed.close)) +
      ' vs negation ' + fmt(p.negation) + ' (B4)');
  // First close past the boundary: the stop is now known, the trade is not yet on.
  if (r.lfd && r.lfd.kind === 'boundary' && r.lfd.anchor && r.lfd.at != null && r.lfd.src !== 'none')
    ev('boundary', 'warn', r.lfd.anchor, who + 'closed ' + (up ? 'above' : 'below') +
      ' its pattern boundary (' + fmt(p.boundary) + '); last full day ' + lh + ' ' + fmt(r.lfd.at) +
      ' recorded' + (r.lfd.pending ? '. Not confirmed until a close ' + (up ? 'above ' : 'below ') + fmt(p.breakthrough) : ''));
  // The B1 → B2 → B3 path. A breach is the exit for a trader on last-full-day
  // stops, worded so it is not read as a failed pattern, which only the negation decides.
  const T = r.btype;
  if (T && T.tag && T.pullbacks) {
    T.pullbacks.forEach((x, i) => ev('pullback', 'warn', x.when, who + 'pullback ' + (i + 1) +
      ' through the trigger (' + fmt(T.trig) + ', ' + lh + ' ' + fmt(x.at) + '): B2 while the last full day ' +
      (T.stop != null ? fmt(T.stop) : '–') + ' holds', i + 1));
    (T.breaches || []).forEach((x, i) => ev('exit', 'bad', x.when, who + 'exit ' + (i + 1) +
      ': took out its last full day ' + lh + ' ' + fmt(T.stop) + ' (' + fmt(x.at) + '). B3 — the pattern stands until the negation ' +
      fmt(p.negation) + '; a close ' + (up ? 'above ' : 'below ') + fmt(p.breakthrough) + ' re-enters', i + 1));
    (T.reentries || []).forEach((x, i) => ev('reentry', 'new', x.when, who + 're-entry ' + (i + 1) +
      ': closed ' + fmt(x.close) + ' ' + (up ? 'above' : 'below') + ' the trigger ' + fmt(p.breakthrough) +
      '. Stop back at the last full day ' + fmt(T.stop), i + 1));
  }
  // Live, intraday: only while the tick is from a session still running.
  if (r.live != null && r.liveDate !== r.prevDate) {
    if (st.state === 'watch' && p.breakthrough != null && (up ? r.live > p.breakthrough : r.live < p.breakthrough))
      lv('live-trigger', 'warn', who + 'trading ' + (up ? 'above' : 'below') + ' its trigger (' + fmt(r.live) +
        ' vs ' + fmt(p.breakthrough) + '); a close ' + (up ? 'above' : 'below') + ' confirms the breakout');
    if (T && T.tag && !T.out && T.stop != null && (st.state === 'breakout' || st.state === 'target') &&
        (up ? r.live < T.stop : r.live > T.stop))
      lv('live-stop', 'bad', who + 'trading ' + (up ? 'below' : 'above') + ' its last full day ' + lh +
        ' (' + fmt(r.live) + ' vs ' + fmt(T.stop) + '): a touch is exit ' + ((T.breaches || []).length + 1));
    if ((st.state === 'breakout' || st.state === 'target') && p.negation != null &&
        (up ? r.live < p.negation : r.live > p.negation))
      lv('live-negation', 'bad', who + 'trading ' + (up ? 'below' : 'above') + ' its negation (' +
        fmt(r.live) + ' vs ' + fmt(p.negation) + '); a touch fails the trade');
  }
  return items;
}

const isoLocal = (d: Date) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' +
  String(d.getDate()).padStart(2, '0');

/** Monday to Sunday, local time. "last" is the week before the one `now` is in. */
export function weekWindow(which: 'this' | 'last', now: Date = new Date()): { from: string; to: string } {
  const mon = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (now.getDay() + 6) % 7);
  if (which === 'last') {
    const from = new Date(mon); from.setDate(mon.getDate() - 7);
    const to = new Date(mon); to.setDate(mon.getDate() - 1);
    return { from: isoLocal(from), to: isoLocal(to) };
  }
  return { from: isoLocal(mon), to: '9999-12-31' };
}

const CLS_RANK: Record<LogClass, number> = { bad: 0, new: 1, warn: 2 };

/** The log for one week: live flags first (this week only), then newest first, bad before new before warn. */
export function weekLog(items: LogItem[], which: 'this' | 'last', now: Date = new Date()): LogItem[] {
  const W = weekWindow(which, now);
  return items
    .filter(it => it.when === 'live' ? which === 'this' : it.when >= W.from && it.when <= W.to)
    .sort((a, b) => (b.when === 'live' ? 1 : 0) - (a.when === 'live' ? 1 : 0) ||
                    (a.when < b.when ? 1 : a.when > b.when ? -1 : 0) ||
                    CLS_RANK[a.cls] - CLS_RANK[b.cls]);
}
