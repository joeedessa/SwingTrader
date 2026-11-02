import { ackable, expired, latestSettled, sortFlags } from './flags';
import type { Acks, Flag, FlagKind } from './flags';
import type { History } from './types';

/* What the Today page shows, as data: the flags it can show, split into the strip of live conditions, the two tiers
   that need a person (Act and Watch), each tier's flags grouped by kind, and what was acknowledged today. It is a
   pure function of the flags, the acknowledgements and the clock, so the counts on the tabs, the lists and the badge
   on the Today tab agree by construction rather than by care. */

export type ShownTier = 'act' | 'watch';

/** How a tier's kinds are grouped, most pressing first. Every kind that can reach Today is listed once (a test holds
    that against the rule table); one that is not would still show, after these, rather than go missing. */
export const GROUPS: Record<ShownTier, FlagKind[]> = {
  act: ['exit', 'failed', 'exdiv-2d', 'target', 'reentry', 'breakout'],
  watch: ['near-stop', 'near-trigger', 'pullback', 'boundary', 'earnings-7d', 'exdiv-7d'],
};

/** Dated in the future: the soonest first. */
const CALENDAR: readonly FlagKind[] = ['earnings-7d', 'exdiv-7d', 'exdiv-2d'];
/** Conditions read on one session: the closest to its level first. */
const PROXIMITY: readonly FlagKind[] = ['near-trigger', 'near-stop'];

export interface Group {
  kind: FlagKind;
  flags: Flag[];
  /** How many of them were not on screen at the last visit. */
  fresh: number;
}

export interface TierView {
  tier: ShownTier;
  count: number;
  fresh: number;
  groups: Group[];
}

export interface TodayView {
  /** Conditions that only exist while a session runs: they need no acknowledgement and sit above the tiers. */
  live: Flag[];
  act: TierView;
  watch: TierView;
  /** Acknowledged since local midnight, the latest first. Yesterday's leave Today. */
  acked: Flag[];
  /** The data flags, for the footer. */
  data: Flag[];
  /** Live + Act + Watch still to look at: the Today tab's badge. */
  badge: number;
  fresh: number;
  /** The ids behind `fresh`: live, Act and Watch flags that were not on screen at the last visit. */
  newIds: string[];
  /** Every flag id on screen, in a list or in the acknowledged group, for remembering what a visit saw. */
  ids: string[];
}

export interface TodayInput {
  flags: Flag[];
  acks: Acks;
  hist: Record<string, History | undefined>;
  /** The flag ids on screen at the last visit. Null before there was one: then nothing can be new. */
  seen: ReadonlySet<string> | null;
  /** Local midnight, ms: what "acknowledged today" means. */
  dayStart: number;
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const NO_DISTANCE = 1e9;

function sortGroup(kind: FlagKind, flags: Flag[], isFresh: (f: Flag) => boolean): Flag[] {
  if (CALENDAR.includes(kind)) return flags.slice().sort((a, b) => cmp(a.when, b.when) || cmp(a.id, b.id));
  if (PROXIMITY.includes(kind)) {
    return flags.slice().sort((a, b) => (a.figure?.atrs ?? NO_DISTANCE) - (b.figure?.atrs ?? NO_DISTANCE) || cmp(a.id, b.id));
  }
  // Events: what you have not seen first, then the newest.
  return flags.slice().sort((a, b) => Number(isFresh(b)) - Number(isFresh(a)) || cmp(b.when, a.when) || cmp(a.id, b.id));
}

function tierView(tier: ShownTier, flags: Flag[], isFresh: (f: Flag) => boolean): TierView {
  const byKind = new Map<FlagKind, Flag[]>();
  for (const f of flags) byKind.set(f.kind, [...(byKind.get(f.kind) ?? []), f]);
  const order = [...GROUPS[tier], ...[...byKind.keys()].filter(k => !GROUPS[tier].includes(k)).sort()];
  const groups = order.filter(k => byKind.has(k)).map(kind => {
    const sorted = sortGroup(kind, byKind.get(kind)!, isFresh);
    return { kind, flags: sorted, fresh: sorted.filter(isFresh).length };
  });
  return { tier, count: flags.length, fresh: groups.reduce((n, g) => n + g.fresh, 0), groups };
}

/** What a person has been shown by looking at one tier: the live strip, that tier's groups (folded ones show their names and
    their count of new), and whatever they acknowledged. The other tier is on the page only as a count and a dot, so it is
    not seen until it is opened: a visit that never left Act must not mark Watch's new flags as old. */
export function shownIds(v: TodayView, tier: ShownTier): string[] {
  return [...v.live.map(f => f.id), ...v[tier].groups.flatMap(g => g.flags.map(f => f.id)), ...v.acked.map(f => f.id)];
}

export function todayView({ flags, acks, hist, seen, dayStart }: TodayInput): TodayView {
  const latest = latestSettled(hist);
  const onToday = (f: Flag) => (f.tier === 'act' || f.tier === 'watch') && f.surfaces.includes('today');
  const isAcked = (f: Flag) => ackable(f) && acks[f.id] != null;
  const isFresh = (f: Flag) => seen != null && !seen.has(f.id);

  const open = flags.filter(f => onToday(f) && !isAcked(f) && !expired(f, hist, latest));
  const live = sortFlags(open.filter(f => f.when === 'live'));
  const settled = open.filter(f => f.when !== 'live');
  const act = tierView('act', settled.filter(f => f.tier === 'act'), isFresh);
  const watch = tierView('watch', settled.filter(f => f.tier === 'watch'), isFresh);
  const acked = flags.filter(f => onToday(f) && ackable(f) && (acks[f.id] ?? -1) >= dayStart)
    .sort((a, b) => acks[b.id] - acks[a.id] || cmp(a.id, b.id));

  return {
    live, act, watch, acked,
    data: flags.filter(f => f.kind === 'data'),
    badge: live.length + act.count + watch.count,
    fresh: live.filter(isFresh).length + act.fresh + watch.fresh,
    newIds: [...live, ...act.groups.flatMap(g => g.flags), ...watch.groups.flatMap(g => g.flags)].filter(isFresh).map(f => f.id),
    ids: [...open.map(f => f.id), ...acked.map(f => f.id)],
  };
}
