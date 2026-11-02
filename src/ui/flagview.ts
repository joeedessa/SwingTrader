import type { Visit } from '../data/visit';
import type { Chip } from '../engine/chips';
import { THRESHOLDS } from '../engine/flags';
import type { Figure, Flag, FlagKind } from '../engine/flags';
import { daysUntil, fmt, fmtDay, fmtRatio } from '../engine/format';
import type { TodayView } from '../engine/today';

/* What a flag says on the Today page, as plain data (the way cells.ts does for the board). The wording of the sentence
   is the engine's, the old weekly log's, unchanged; everything here is the frame around it: the title of a group, the
   colour a kind reads in, the number a row leads with, and the date. */

export type FlagTone = 'good' | 'bad' | 'warn' | 'info';

/** Green for what you may act on, red for what hurts, amber for a heads-up: the weekly log's own colours. */
export const TONE: Record<FlagKind, FlagTone> = {
  'breakout': 'good', 'reentry': 'good', 'target': 'good',
  'exit': 'bad', 'failed': 'bad', 'live-negation': 'bad', 'live-stop': 'bad',
  'exdiv-2d': 'warn', 'live-trigger': 'warn', 'near-trigger': 'warn', 'near-stop': 'warn', 'pullback': 'warn', 'boundary': 'warn',
  'late-entry': 'warn', 'earnings-7d': 'info', 'exdiv-7d': 'info', 'source-kept': 'info', 'removed': 'info', 'data': 'info',
};

export const GROUP_TITLE: Record<FlagKind, string> = {
  'breakout': 'Breakouts',
  'reentry': 'Re-entries',
  'exit': 'Exits',
  'failed': 'Failed',
  'target': 'Targets reached',
  'live-negation': 'Past the negation',
  'live-stop': 'Past the last full day',
  'exdiv-2d': 'Ex-dividend within ' + THRESHOLDS.exdivActDays + ' days',
  'live-trigger': 'Past the trigger',
  'near-trigger': 'Near the trigger',
  'near-stop': 'Near the stop',
  'pullback': 'Pullbacks',
  'boundary': 'Closed past the boundary',
  'late-entry': 'Late entries',
  'earnings-7d': 'Earnings within ' + THRESHOLDS.earningsDays + ' days',
  'exdiv-7d': 'Ex-dividend within ' + THRESHOLDS.exdivWatchDays + ' days',
  'source-kept': 'Still listed by the source',
  'removed': 'Removed',
  'data': 'Data',
};

/** One line under a group's title: the rule it follows, with the engine's own thresholds. */
export const GROUP_RULE: Record<FlagKind, string> = {
  'breakout': 'first settled close past the trigger',
  'reentry': 'closed back past the trigger after an exit',
  'exit': 'touched the last full day',
  'failed': 'touched the negation',
  'target': 'closed at or past the target',
  'live-negation': 'trading past the negation now',
  'live-stop': 'trading past the last full day now',
  'exdiv-2d': 'a dividend large enough to move a stop, on a long you hold',
  'live-trigger': 'trading past the trigger now',
  'near-trigger': 'last close within ' + THRESHOLDS.nearAtr + ' ATR of the trigger',
  'near-stop': 'last close within ' + THRESHOLDS.nearAtr + ' ATR of the stop',
  'pullback': 'through the trigger while the last full day holds',
  'boundary': 'closed past the pattern boundary; the stop is recorded',
  'late-entry': 'confirmed, with half the move to the target already used',
  'earnings-7d': 'a report on a trade, or on a name near its trigger',
  'exdiv-7d': 'an ex-date ahead on a long you hold',
  'source-kept': 'failed, but the source still lists it',
  'removed': 'dropped by the source',
  'data': 'a gap in the data',
};

const SINGULAR: Partial<Record<FlagKind, string>> = {
  'breakout': 'Breakout', 'target': 'Target reached', 'failed': 'Failed', 'boundary': 'Boundary close',
  'near-trigger': 'Near trigger', 'near-stop': 'Near stop', 'earnings-7d': 'Earnings', 'exdiv-2d': 'Ex-dividend', 'exdiv-7d': 'Ex-dividend',
  'live-trigger': 'Past the trigger', 'live-stop': 'Past the last full day', 'live-negation': 'Past the negation',
  'late-entry': 'Late entry',
};
const NUMBERED: Partial<Record<FlagKind, string>> = { 'pullback': 'Pullback', 'exit': 'Exit', 'reentry': 'Re-entry' };

/** What a single row is, in a word or two: "Exit 2", "Near stop". */
export function kindLabel(f: Flag): string {
  const numbered = NUMBERED[f.kind];
  if (numbered) return f.n != null ? numbered + ' ' + f.n : numbered;
  return SINGULAR[f.kind] ?? GROUP_TITLE[f.kind];
}

/** The engine's sentence, without the "AME long — " it opens with: the row already says who it is. */
export function detailOf(f: Flag): string {
  const who = f.sym + ' ' + f.dir + ' — ';
  return f.text.startsWith(who) ? f.text.slice(who.length) : f.text;
}

const CALENDAR: readonly FlagKind[] = ['earnings-7d', 'exdiv-7d', 'exdiv-2d'];

/** The date a row carries: the day it happened, or for a calendar flag the day it falls, with how far off that is. */
export function whenOf(f: Flag, today: string): { main: string; sub?: string } {
  if (f.when === 'live') return { main: 'Live' };
  if (!CALENDAR.includes(f.kind)) return { main: fmtDay(f.when) };
  const d = daysUntil(f.when, today);
  return { main: fmtDay(f.when), ...(d == null ? {} : { sub: d <= 0 ? 'today' : d === 1 ? 'tomorrow' : 'in ' + d + ' days' }) };
}

/** The number a row leads with, and what it was read against. */
export function figureView(g: Figure): { value: string; ccy: string; sub: string } {
  return {
    value: fmt(g.price),
    ccy: g.ccy,
    sub: g.read + ' vs ' + g.vs + ' ' + fmt(g.level) + (g.atrs != null ? ' · ' + fmtRatio(g.atrs) + ' ATR' : ''),
  };
}

/** The first few names in a group, for a group that is folded. */
export function previewOf(flags: readonly Flag[], max = 3): string {
  const syms = [...new Set(flags.map(f => f.sym).filter((s): s is string => !!s))];
  const shown = syms.slice(0, max).join(', ');
  return syms.length > max ? shown + ' and ' + (syms.length - max) + ' more' : shown;
}

/** "2 live · 9 to decide · 39 to look at", or that nothing is waiting. */
export function summaryOf(v: Pick<TodayView, 'live' | 'act' | 'watch'>): string {
  const parts: string[] = [];
  if (v.live.length) parts.push(v.live.length + ' live');
  if (v.act.count) parts.push(v.act.count + ' to decide');
  if (v.watch.count) parts.push(v.watch.count + ' to look at');
  return parts.length ? parts.join(' · ') : 'Nothing is waiting for you';
}

/** When the last visit ended, the way the screen says a time: "Sat 31 Oct, 21:14". */
export const sinceLabel = (since: Visit | null): string | null =>
  since ? new Date(since.at).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : null;

/** What a chip says. The tier chips lead with the flag's own name ("Breakout", "Near stop") and how many more stand
    behind it; the calendar chip says what and when ("Earnings in 3 days"). The title is the engine's sentence. */
export function chipText(c: Chip, today: string): { text: string; title: string } {
  const label = kindLabel(c.flag);
  const behind = c.more ? ' +' + c.more : '';
  const when = c.kind === 'calendar' ? whenOf(c.flag, today).sub : undefined;
  return {
    text: (c.kind === 'calendar' && when ? label + ' ' + when : label) + behind,
    title: detailOf(c.flag) + (c.more ? ' (and ' + c.more + ' more)' : ''),
  };
}
