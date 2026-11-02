import { runupOf, stopFor } from './derived';
import { setupEvents } from './events';
import type { LogItem } from './events';
import { daysUntil, fmt, fmtD, fmtRatio } from './format';
import { sig7 } from './precision';
import type { Row } from './row';
import type { Bars, Dir, History, SymbolEvents } from './types';

/* Flags: everything the board knows that needs a look, as one list (plan, A2).

   Every settled event the engine already produces (breakout, target, failure, boundary close, pullback N, exit N,
   re-entry N) becomes a flag, rebuilt from the bars on every load, so "nothing missed" is a property of the data and
   not of a notification queue. The live, proximity and calendar rules are added to them.

   A flag's id is `sym|dir|kind|when`: the setup, what happened, and the day it is about (the event's date, the
   ex-dividend or earnings date, the session a proximity rule was read on), or `live` for a condition that only exists
   while a session runs. An acknowledgement is keyed by that id, so it holds across reloads, new bars and price moves,
   and is lost only when the thing it acknowledged is no longer the same thing. */

export type Tier = 'act' | 'watch' | 'info';

export type FlagKind =
  | 'breakout' | 'reentry' | 'exit' | 'failed' | 'target'
  | 'live-negation' | 'live-stop' | 'exdiv-2d'
  | 'live-trigger' | 'near-trigger' | 'near-stop' | 'pullback' | 'boundary' | 'late-entry'
  | 'earnings-7d' | 'exdiv-7d' | 'source-kept'
  | 'removed' | 'data';

export type Surface = 'today' | 'setups' | 'positions' | 'history' | 'method';

export interface FlagRule {
  tier: Tier;
  /** Exists only while a session runs; never needs an acknowledgement. */
  live: boolean;
  /** `ack`: stays until acknowledged (or five sessions pass). `itself`: goes when its condition does. */
  clears: 'ack' | 'itself';
  surfaces: Surface[];
  /** The rule as the plan states it. */
  rule: string;
}

/** The plan's table, as data: one entry per kind, in the plan's order. */
export const RULES: Record<FlagKind, FlagRule> = {
  'breakout': { tier: 'act', live: false, clears: 'ack', surfaces: ['today', 'setups'], rule: 'first settled close strictly past the trigger' },
  'reentry': { tier: 'act', live: false, clears: 'ack', surfaces: ['today', 'positions'], rule: 'settled close back past the trigger while out' },
  'exit': { tier: 'act', live: false, clears: 'ack', surfaces: ['today', 'positions'], rule: 'touch of the last full day' },
  'failed': { tier: 'act', live: false, clears: 'ack', surfaces: ['today', 'history'], rule: 'negation touched (B4)' },
  'target': { tier: 'act', live: false, clears: 'ack', surfaces: ['today', 'history'], rule: 'settled close at/past target, or `reached`' },
  'live-negation': { tier: 'act', live: true, clears: 'itself', surfaces: ['today', 'positions'], rule: 'live price beyond the negation, in trade' },
  'live-stop': { tier: 'act', live: true, clears: 'itself', surfaces: ['today', 'positions'], rule: 'live price beyond the last full day, in trade' },
  'exdiv-2d': { tier: 'act', live: false, clears: 'itself', surfaces: ['today', 'positions'], rule: 'long in trade, ex-date ≤ 2 days, dividend ≥ 0.25 ATR' },
  'live-trigger': { tier: 'watch', live: true, clears: 'itself', surfaces: ['today', 'setups'], rule: 'watching row trading past its trigger' },
  'near-trigger': { tier: 'watch', live: false, clears: 'itself', surfaces: ['today', 'setups'], rule: 'watching row, last close within 1.0 ATR of the trigger' },
  'near-stop': { tier: 'watch', live: false, clears: 'itself', surfaces: ['today', 'positions'], rule: 'in trade, last close within 1.0 ATR of the last full day (or the negation where there is none)' },
  'pullback': { tier: 'watch', live: false, clears: 'ack', surfaces: ['today', 'setups'], rule: 'B2 pullback N started' },
  'boundary': { tier: 'watch', live: false, clears: 'ack', surfaces: ['today', 'setups'], rule: 'closed past the boundary, stop recorded, not confirmed' },
  'late-entry': { tier: 'watch', live: false, clears: 'itself', surfaces: ['setups'], rule: 'confirmed row still B1 with ≥ 50% of the trigger → target move used' },
  'earnings-7d': { tier: 'watch', live: false, clears: 'itself', surfaces: ['today', 'positions'], rule: 'earnings within 7 days on an in-trade or near-trigger row' },
  'exdiv-7d': { tier: 'watch', live: false, clears: 'itself', surfaces: ['today', 'positions'], rule: 'the dividend rule, days 3–7' },
  'source-kept': { tier: 'watch', live: false, clears: 'itself', surfaces: ['history'], rule: 'Failed row with source_open.length ≥ 2' },
  'removed': { tier: 'info', live: false, clears: 'ack', surfaces: ['setups', 'history'], rule: '`removed` date present' },
  'data': { tier: 'info', live: false, clears: 'itself', surfaces: ['today', 'method'], rule: 'no history / no bars / snapshot in use / tip older than 6h / symbol missing from events' },
};

/** Every threshold a rule uses, named once so the Method page can print them. */
export const THRESHOLDS = {
  /** near-trigger and near-stop: the last close within this many ATRs of the level. */
  nearAtr: 1.0,
  /** late-entry: share of the trigger → target move already used. */
  lateUsed: 0.5,
  /** exdiv: a dividend at least this share of one ATR matters to a 2×ATR stop. */
  dividendAtr: 0.25,
  /** exdiv-2d: the ex-date this many days away or fewer; exdiv-7d: from the next day to the window's end. */
  exdivActDays: 2,
  exdivWatchDays: 7,
  /** earnings-7d: the report this many days away or fewer. */
  earningsDays: 7,
  /** source-kept: this many weekly sheets still listing a failed setup. */
  sourceSheets: 2,
  /** data: the tip file older than this. */
  staleTipHours: 6,
  /** A settled flag never acknowledged leaves Today after this many sessions of its symbol. */
  expirySessions: 5,
  /** ...or after this many weekdays on the board, for a symbol that has stopped trading (WBS has no bar after 19-08-26). */
  expiryWeekdays: 10,
} as const;

export type DataTopic = 'no-history' | 'no-bars' | 'snapshot' | 'stale-tip' | 'no-events';

/** The one comparison a flag turns on, for a list row: what was read, and the level it was read against.
    Prices stay in the listing currency; `ccy` says which. */
export interface Figure {
  read: 'close' | 'low' | 'high' | 'live' | 'last close' | 'last full day';
  price: number;
  vs: 'trigger' | 'last full day' | 'negation' | 'target' | 'boundary';
  level: number;
  /** ATRs between the two, for the rules that are about distance. */
  atrs?: number;
  ccy: string;
}

export interface Flag {
  /** `sym|dir|kind|when`; for a data flag `*|*|data.<topic>|<today>`. */
  id: string;
  tier: Tier;
  kind: FlagKind;
  sym: string | null;
  dir: Dir | null;
  /** The ISO date the flag is about, or `live`. */
  when: string;
  text: string;
  /** Where a tap goes: the setup's drawer, or the Method page for a data flag. */
  route: string;
  clears: 'ack' | 'itself';
  surfaces: Surface[];
  /** Pullback, exit and re-entry number, counted from 1. */
  n?: number;
  figure?: Figure;
  topic?: DataTopic;
  /** The symbols a data flag is about. */
  syms?: string[];
}

export interface FlagContext {
  /** The board's today: the UTC date, as everywhere else in the engine. */
  today: string;
  nowMs: number;
  /** Which board the rows came from, for the route. */
  page: 'setups' | 'benchmarks';
}

const SEP = '|';

export function flagId(sym: string, dir: Dir | '*', kind: string, when: string): string {
  return [sym, dir, kind, when].join(SEP);
}

/** The four parts of an id; null for anything else. Symbols never contain the separator. */
export function parseFlagId(id: string): { sym: string; dir: string; kind: string; when: string } | null {
  const parts = id.split(SEP);
  if (parts.length !== 4 || parts.some(x => !x)) return null;
  const [sym, dir, kind, when] = parts;
  return { sym, dir, kind, when };
}

const rowRoute = (page: FlagContext['page'], r: Row) => `#/${page}/${encodeURIComponent(r.p.sym)}/${r.p.dir}`;

function make(r: Row, ctx: FlagContext, kind: FlagKind, when: string, text: string, extra: Partial<Flag> = {}): Flag {
  const rule = RULES[kind];
  return {
    id: flagId(r.p.sym, r.p.dir, kind, when),
    tier: rule.tier, kind, sym: r.p.sym, dir: r.p.dir, when, text,
    route: rowRoute(ctx.page, r), clears: rule.clears, surfaces: rule.surfaces,
    ...extra,
  };
}

/* ------------------------------------------------------------------ who a rule applies to */

/** In the trade: confirmed (B1/B2), back in after an exit, or past the target and still held. Not stopped out. */
export const inTrade = (r: Row): boolean => r.section === 'breakout' || r.section === 'reentered' || r.section === 'target';

/** The stop a trade is managed against: the last full day where one is known and tighter than the pattern, else the negation. */
export function activeStop(r: Row): { level: number; kind: 'last full day' | 'negation' } | null {
  const L = r.lfd;
  if (L && L.at != null && !L.looser) return { level: L.at, kind: 'last full day' };
  if (r.p.negation != null) return { level: r.p.negation, kind: 'negation' };
  return null;
}

/** How far the last settled close is from a level, the setup's way, in money and in ATRs (rounded like every comparison). */
function distance(r: Row, level: number, towards: 'below-for-long' | 'above-for-long'): { money: number; atrs: number } | null {
  const atr = r.ev.atr;
  if (r.prevClose == null || atr == null || !(atr > 0)) return null;
  const c = sig7(r.prevClose), lvl = sig7(level);
  const long = r.p.dir === 'long';
  // below-for-long: the level is under the price for a long (a stop); above-for-long: over it (a trigger).
  const money = towards === 'above-for-long' ? (long ? lvl - c : c - lvl) : (long ? c - lvl : lvl - c);
  return { money: sig7(money), atrs: money / atr };
}

/** The watching row's last close within 1.0 ATR of its trigger, not yet past it. */
export function nearTrigger(r: Row): { money: number; atrs: number } | null {
  if (r.section !== 'watch' || r.p.breakthrough == null) return null;
  const d = distance(r, r.p.breakthrough, 'above-for-long');
  return d && d.money >= 0 && d.atrs <= THRESHOLDS.nearAtr ? d : null;
}

/** The number a flag turns on, read off the row the way the rule read it: the close that broke out against the trigger,
    the low that touched against the last full day, the live price against the level it is past. */
export function figureOf(r: Row, kind: FlagKind, n?: number): Figure | undefined {
  const { p, st } = r;
  const touch = p.dir === 'long' ? 'low' : 'high';
  const T = r.btype;
  const fig = (read: Figure['read'], price: number | null | undefined, vs: Figure['vs'], level: number | null | undefined, atrs?: number): Figure | undefined =>
    price == null || level == null ? undefined : { read, price, vs, level, ccy: r.currency, ...(atrs != null ? { atrs } : {}) };
  switch (kind) {
    case 'breakout': return st.breakout ? fig('close', st.breakout.close, 'trigger', p.breakthrough) : undefined;
    case 'target': return st.targetHit ? fig('close', st.targetHit.close, 'target', p.target) : undefined;
    case 'failed': return st.failed ? fig(st.failed.byTouch ? touch : 'close', st.failed.byTouch ? st.failed.at : st.failed.close, 'negation', p.negation) : undefined;
    case 'pullback': { const x = T && T.pullbacks && n != null ? T.pullbacks[n - 1] : null; return x ? fig(touch, x.at, 'trigger', T!.trig) : undefined; }
    case 'exit': { const x = T && T.breaches && n != null ? T.breaches[n - 1] : null; return x ? fig(touch, x.at, 'last full day', T!.stop) : undefined; }
    case 'reentry': { const x = T && T.reentries && n != null ? T.reentries[n - 1] : null; return x ? fig('close', x.close, 'trigger', p.breakthrough) : undefined; }
    case 'boundary': return r.lfd && r.lfd.at != null ? fig('last full day', r.lfd.at, 'boundary', p.boundary) : undefined;
    case 'live-trigger': return fig('live', r.live, 'trigger', p.breakthrough);
    case 'live-stop': return T ? fig('live', r.live, 'last full day', T.stop) : undefined;
    case 'live-negation': return fig('live', r.live, 'negation', p.negation);
    default: return undefined;
  }
}

/* ------------------------------------------------------------------ the rules */

const EVENT_KINDS: Record<LogItem['kind'], FlagKind> = {
  'breakout': 'breakout', 'target': 'target', 'failed': 'failed', 'boundary': 'boundary',
  'pullback': 'pullback', 'exit': 'exit', 'reentry': 'reentry',
  'live-trigger': 'live-trigger', 'live-stop': 'live-stop', 'live-negation': 'live-negation',
};

function dividendFlag(r: Row, ctx: FlagContext): Flag | null {
  const { p, ev } = r;
  if (p.dir !== 'long' || !inTrade(r)) return null;
  const exDate = r.exdiv;
  if (!exDate || ev.div_amount == null || ev.atr == null || !(ev.atr > 0)) return null;
  const days = daysUntil(exDate, ctx.today);
  if (days == null || days < 0 || days > THRESHOLDS.exdivWatchDays) return null;
  const ratio = ev.div_amount / ev.atr;
  if (sig7(ratio) < THRESHOLDS.dividendAtr) return null;
  const kind: FlagKind = days <= THRESHOLDS.exdivActDays ? 'exdiv-2d' : 'exdiv-7d';
  const st = stopFor(p, r.live, { ...ev, ex_div: exDate }, ctx.today);
  // The old page's wording: the stop gets widened before the drop, not explained after it.
  const text = p.sym + ' goes ex-dividend ' + (days === 0 ? 'today' : days === 1 ? 'tomorrow' : 'in ' + days + ' days') +
    ' (' + fmtD(exDate) + '): ' + fmt(ev.div_amount) + ' is ' + Math.round(ratio * 100) + '% of one ATR, so a 2×ATR stop loses ' +
    Math.round(ratio / 2 * 100) + '% of its room to a drop that means nothing' +
    (st ? ' — widen to ' + fmt(st.at) + ' until it has passed, then back to ' + fmt(st.plain) : '');
  return make(r, ctx, kind, exDate, text);
}

/** Every flag one row raises. A removed row raises only `removed`: it is off the list. */
export function setupFlags(r: Row, ctx: FlagContext): Flag[] {
  const out: Flag[] = [];
  const { p, st } = r;
  const who = p.sym + ' ' + p.dir + ' — ';

  if (p.removed) {
    out.push(make(r, ctx, 'removed', p.removed, who + 'dropped by the source on ' + fmtD(p.removed) + (p.removed_reason ? ' (' + p.removed_reason + ')' : '')));
  }
  if (r.section === 'removed') return out;

  // Settled events and live conditions, exactly as the weekly log builds them. One narrowing: the plan's live-negation
  // is "in trade", and the old page also raised it on a stopped-out row, where there is no position to act on.
  for (const e of setupEvents(r)) {
    if (e.kind === 'live-negation' && !inTrade(r)) continue;
    const kind = EVENT_KINDS[e.kind];
    const figure = figureOf(r, kind, e.n);
    out.push(make(r, ctx, kind, e.when, e.text, { ...(e.n != null ? { n: e.n } : {}), ...(figure ? { figure } : {}) }));
  }

  // A target the source counted where our closes fell short: the log left it out, the flags do not.
  if (st.targetHit && st.targetHit.bySource) {
    const figure = figureOf(r, 'target');
    out.push(make(r, ctx, 'target', st.targetHit.when, who + 'reached its target per the source (' + fmtD(st.targetHit.when) +
      '); our closes fell just short of ' + fmt(p.target), figure ? { figure } : {}));
  }

  const div = dividendFlag(r, ctx);
  if (div) out.push(div);

  const near = nearTrigger(r);
  if (near && r.prevDate) {
    const figure = r.prevClose != null && p.breakthrough != null
      ? { read: 'last close', price: r.prevClose, vs: 'trigger', level: p.breakthrough, atrs: near.atrs, ccy: r.currency } as const : null;
    out.push(make(r, ctx, 'near-trigger', r.prevDate, who + 'last close ' + fmt(r.prevClose) + ' is ' + fmt(near.money) + ' ' + r.currency +
      ' (' + fmtRatio(near.atrs) + ' ATR) from its trigger ' + fmt(p.breakthrough), figure ? { figure } : {}));
  }

  if (inTrade(r) && r.prevDate) {
    const stop = activeStop(r);
    const d = stop ? distance(r, stop.level, 'below-for-long') : null;
    if (stop && d && d.money >= 0 && d.atrs <= THRESHOLDS.nearAtr) {
      const figure = r.prevClose != null ? { read: 'last close', price: r.prevClose, vs: stop.kind, level: stop.level, atrs: d.atrs, ccy: r.currency } as const : null;
      out.push(make(r, ctx, 'near-stop', r.prevDate, who + 'last close ' + fmt(r.prevClose) + ' is ' + fmt(d.money) + ' ' + r.currency +
        ' (' + fmtRatio(d.atrs) + ' ATR) from its ' + stop.kind + ' ' + fmt(stop.level) + (stop.kind === 'negation' ? ' (no last full day)' : ''), figure ? { figure } : {}));
    }
  }

  if (r.section === 'breakout' && r.btype && r.btype.tag === 'B1') {
    // Settled: measured on the last close, not the live price.
    const x = runupOf(p, null, r.prevClose, r.lfd);
    if (x && x.used != null && sig7(x.used) >= THRESHOLDS.lateUsed) {
      out.push(make(r, ctx, 'late-entry', st.breakout ? st.breakout.when : (r.prevDate || ctx.today),
        who + 'still B1 with ' + Math.round(x.used * 100) + '% of the trigger → target move used' +
        (x.rr != null ? '; entering now pays ' + fmtRatio(x.rr) + ' : 1 against the ' + x.vs : '')));
    }
  }

  if (r.earnings && (inTrade(r) || near)) {
    const days = daysUntil(r.earnings, ctx.today);
    if (days != null && days >= 0 && days <= THRESHOLDS.earningsDays) {
      out.push(make(r, ctx, 'earnings-7d', r.earnings, who + 'reports ' + (days === 0 ? 'today' : days === 1 ? 'tomorrow' : 'in ' + days + ' days') +
        ' (' + fmtD(r.earnings) + ')' + (inTrade(r) ? ', with the trade on' : ', close to its trigger')));
    }
  }

  if (r.section === 'failed' && p.source_open && p.source_open.length >= THRESHOLDS.sourceSheets) {
    const d = p.source_open;
    out.push(make(r, ctx, 'source-kept', d[d.length - 1], who + 'failed' + (st.failed ? ' on ' + fmtD(st.failed.when) : '') +
      ', but Tech Charts still lists it as ongoing (' + d.length + ' sheets, ' + fmtD(d[0]) + ' → ' + fmtD(d[d.length - 1]) + ')'));
  }
  return out;
}

/* ------------------------------------------------------------------ data flags */

export interface DataStatus {
  /** Every symbol on the list. */
  symbols: string[];
  hist: Record<string, History | undefined>;
  bars: Record<string, Bars | undefined>;
  events: Record<string, SymbolEvents | undefined>;
  /** prices-latest.json's generated_at. */
  snapshotAt: string | null;
  liveStatus: 'idle' | 'loading' | 'ok' | 'failed';
  /** Whether this list has a calendar to miss. The benchmarks have none, so a missing symbol there is not news. */
  checkEvents?: boolean;
}

export function dataFlags(d: DataStatus, ctx: FlagContext): Flag[] {
  const out: Flag[] = [];
  const add = (topic: DataTopic, text: string, syms?: string[]) => {
    const rule = RULES.data;
    out.push({
      id: flagId('*', '*', 'data.' + topic, ctx.today), tier: rule.tier, kind: 'data', sym: null, dir: null, when: ctx.today,
      text, route: '#/method', clears: rule.clears, surfaces: rule.surfaces, topic, ...(syms ? { syms } : {}),
    });
  };
  const syms = [...new Set(d.symbols)].sort();
  const noHistory = syms.filter(s => !d.hist[s] || !d.hist[s]!.settled.length);
  const noBars = syms.filter(s => !noHistory.includes(s) && !d.bars[s]);
  const noEvents = d.checkEvents === false ? [] : syms.filter(s => !d.events[s]);
  if (noHistory.length) add('no-history', 'No price history for ' + noHistory.join(', '), noHistory);
  if (noBars.length) add('no-bars', 'No daily highs and lows for ' + noBars.join(', ') + ': touches are read on closes', noBars);
  if (d.liveStatus === 'failed') add('snapshot', 'Live quotes unavailable: showing the snapshot');
  if (d.snapshotAt) {
    const age = (ctx.nowMs - Date.parse(d.snapshotAt)) / 3.6e6;
    if (age > THRESHOLDS.staleTipHours) add('stale-tip', 'The latest-price file is ' + Math.floor(age) + ' hours old');
  }
  if (noEvents.length) add('no-events', 'No earnings or dividend dates for ' + noEvents.join(', '), noEvents);
  return out;
}

/* ------------------------------------------------------------------ the whole board */

const TIER_RANK: Record<Tier, number> = { act: 0, watch: 1, info: 2 };

/** Act before Watch before Info; within a tier, live first, then the newest; then by symbol, for a stable order. */
export function sortFlags(flags: Flag[]): Flag[] {
  return flags.slice().sort((a, b) =>
    TIER_RANK[a.tier] - TIER_RANK[b.tier] ||
    (b.when === 'live' ? 1 : 0) - (a.when === 'live' ? 1 : 0) ||
    (a.when < b.when ? 1 : a.when > b.when ? -1 : 0) ||
    a.id.localeCompare(b.id));
}

export function boardFlags(rows: Row[], ctx: FlagContext, data?: DataStatus): Flag[] {
  const out: Flag[] = [];
  for (const r of rows) out.push(...setupFlags(r, ctx));
  if (data) out.push(...dataFlags(data, ctx));
  return sortFlags(out);
}

/* ------------------------------------------------------------------ acknowledgements and expiry */

/** Acknowledged flag ids with the moment they were acknowledged, ms. The store (per browser) lives in the UI. */
export type Acks = Record<string, number>;

/** Live flags never need an acknowledgement: they are conditions, not events. */
export const ackable = (f: Flag): boolean => f.when !== 'live';

/** Settled sessions of the flag's symbol after the day it is about. */
export function sessionsSince(f: Flag, hist: Record<string, History | undefined>): number {
  if (!f.sym || f.when === 'live') return 0;
  const h = hist[f.sym];
  if (!h) return 0;
  let n = 0;
  for (let i = h.settled.length - 1; i >= 0 && h.settled[i][0] > f.when; i--) n++;
  return n;
}

/** Weekdays after `from`, up to and including `to` (both ISO dates). */
export function weekdaysBetween(from: string, to: string): number {
  let n = 0;
  const end = Date.parse(to + 'T00:00:00Z');
  for (let t = Date.parse(from + 'T00:00:00Z') + 864e5; t <= end; t += 864e5) {
    const wd = new Date(t).getUTCDay();
    if (wd !== 0 && wd !== 6) n++;
  }
  return n;
}

/** The newest settled close anywhere on the board. */
export function latestSettled(hist: Record<string, History | undefined>): string {
  let max = '';
  for (const h of Object.values(hist)) {
    const d = h && h.settled.length ? h.settled[h.settled.length - 1][0] : '';
    if (d > max) max = d;
  }
  return max;
}

/** A settled flag that clears on acknowledgement leaves Today once its symbol has traded five sessions since, acknowledged
    or not. It stays on the setup's own timeline and on History. A symbol that has stopped trading never adds a session,
    so two weeks of weekdays on the board also end it. Conditions go when they stop being true. */
export function expired(f: Flag, hist: Record<string, History | undefined>, latest: string = latestSettled(hist)): boolean {
  if (f.clears !== 'ack' || f.when === 'live') return false;
  return sessionsSince(f, hist) >= THRESHOLDS.expirySessions || (!!latest && weekdaysBetween(f.when, latest) >= THRESHOLDS.expiryWeekdays);
}

/** The Today tab's badge: Act and Watch flags that show on Today, not acknowledged, not expired. */
export function badgeCount(flags: Flag[], acks: Acks, hist: Record<string, History | undefined>): number {
  const latest = latestSettled(hist);
  return flags.filter(f => (f.tier === 'act' || f.tier === 'watch') && f.surfaces.includes('today') &&
    !(ackable(f) && acks[f.id] != null) && !expired(f, hist, latest)).length;
}
