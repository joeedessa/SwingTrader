import { pct1 } from './derived';
import type { History, LastEps, Ratings, SymbolEvents, WireHead } from './types';

/* The earnings and news card of a setup, as data: what the last report delivered against what was expected, how the market
   took it, what the wires said, what the street expects next, and where the street's target stands against the price and
   against yours. Ported from the old page's card. The estimates are analyst consensus; company guidance is not available
   from a free feed, and the wire block classifies the language of headlines only: each is shown as it was published. */

/** 2.07bn, 42.9m, 1.5k: large figures the way the old page wrote them. */
export function fmtBig(v: number | null | undefined): string | null {
  if (v == null) return null;
  const a = Math.abs(v);
  if (a >= 1e12) return (v / 1e12).toFixed(2) + 'tn';
  if (a >= 1e9) return (v / 1e9).toFixed(2) + 'bn';
  if (a >= 1e6) return (v / 1e6).toFixed(1) + 'm';
  if (a >= 1e3) return (v / 1e3).toFixed(1) + 'k';
  return String(v);
}

/** How the market took the last report: the move on the session the result was traded. A result released before the open
    (or during the session) is traded that same day; one released after the close, or with no slot given, the next. */
export function earningsReaction(hist: History | null | undefined, e: LastEps | null | undefined): { pct: number; when: string } | null {
  if (!hist || !e || !e.reported) return null;
  const s = hist.settled;
  const after = e.when === 'after close' || !e.when;
  const idx = s.findIndex(p => (after ? p[0] > (e.reported as string) : p[0] >= (e.reported as string)));
  if (idx < 1) return null;
  const move = (s[idx][1] / s[idx - 1][1] - 1) * 100;
  return { pct: pct1(move) as number, when: s[idx][0] };
}

/** A surprise or a move, read for what it means: positive is good news. */
export interface Figure { value: number; good: boolean }
const fig = (v: number | null | undefined): Figure | null => (v == null ? null : { value: v, good: v >= 0 });

export interface Measure {
  actual: number;
  estimate: number | null;
  surprise: Figure | null;
}

export interface LastReport {
  reported: string;
  when: string | null;
  eps: Measure | null;
  revenue: Measure | null;
  epsYoy: Figure | null;
  reaction: { pct: number; when: string; good: boolean } | null;
}

export type CueTone = 'good' | 'bad' | 'plain';
export const GOOD_CUES: readonly string[] = ['guidance raised', 'beat', 'record quarter'];
export const BAD_CUES: readonly string[] = ['guidance cut', 'miss'];
const cueTone = (c: string): CueTone => (GOOD_CUES.includes(c) ? 'good' : BAD_CUES.includes(c) ? 'bad' : 'plain');

export interface EarningsView {
  sector: string | null;
  /** The newest of the last report and the newest headline. */
  latest: string | null;
  last: LastReport | null;
  wire: { cues: { text: string; tone: CueTone }[]; heads: WireHead[] } | null;
  next: { date: string | null; when: string | null; eps: number | null; revenue: number | null };
  street: {
    targetAvg: number | null;
    /** The consensus target against the price now, in %. */
    vsLive: Figure | null;
    /** Your target, and whether the street's is below or above it. */
    yours: { target: number; streetIs: 'below' | 'above' } | null;
    analysts: { total: number; bullish: number; hold: number; bearish: number } | null;
  } | null;
}

/** How many headlines the card shows. */
export const HEADLINES = 4;

function analystsOf(rt: Ratings | null | undefined): NonNullable<EarningsView['street']>['analysts'] {
  if (!rt || !rt.total) return null;
  return { total: rt.total, bullish: (rt.buy || 0) + (rt.over || 0), hold: rt.hold || 0, bearish: (rt.under || 0) + (rt.sell || 0) };
}

export function earningsView(ev: SymbolEvents, ctx: { live: number | null; target: number | null | undefined; next: string | null; hist: History | null | undefined }): EarningsView {
  const e = ev.last_eps || null;
  let last: LastReport | null = null;
  if (e && e.reported) {
    const react = earningsReaction(ctx.hist, e);
    last = {
      reported: e.reported, when: e.when || null,
      eps: e.actual != null ? { actual: e.actual, estimate: e.estimate ?? null, surprise: fig(e.surprise_pct) } : null,
      revenue: e.revenue != null ? { actual: e.revenue, estimate: e.revenue_est ?? null, surprise: fig(e.revenue_surprise_pct) } : null,
      epsYoy: fig(e.eps_yoy),
      reaction: react ? { ...react, good: react.pct >= 0 } : null,
    };
  }
  const heads = ev.wire && ev.wire.heads ? ev.wire.heads : [];
  const wire = heads.length ? { cues: (ev.wire!.cues || []).map(c => ({ text: c, tone: cueTone(c) })), heads: heads.slice(0, HEADLINES) } : null;
  const n = ev.next_est || {};
  const latest = [e && e.reported ? e.reported : '', ...heads.map(h => h.d)].sort().pop() || null;
  const analysts = analystsOf(ev.ratings);
  const street = ev.target_avg != null || analysts
    ? {
      targetAvg: ev.target_avg ?? null,
      vsLive: ev.target_avg != null && ctx.live != null ? fig(pct1((ev.target_avg / ctx.live - 1) * 100)) : null,
      yours: ev.target_avg != null && ctx.target != null ? { target: ctx.target, streetIs: ctx.target > ev.target_avg ? 'below' as const : 'above' as const } : null,
      analysts,
    }
    : null;
  return {
    sector: ev.sector ?? null, latest, last, wire,
    next: { date: ctx.next, when: ev.earnings_when ?? null, eps: n.eps ?? null, revenue: n.revenue ?? null },
    street,
  };
}

/** True when the feed has anything to say about this name beyond its volatility and sector. */
export const hasEarningsCard = (v: EarningsView): boolean => !!(v.last || v.wire || v.street || v.next.date || v.next.eps != null || v.next.revenue != null);
