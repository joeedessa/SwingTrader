import type { Bars, History, SettledClose } from './types';

/* The settled/live split, from the two data files the jobs write.

   bars.json holds settled daily bars only, keyed by the exchange's own
   calendar date. prices-latest.json holds the tip: the latest price, the
   exchange's previous close, the time of the print and the exchange's
   session hours. A tip is LIVE only if it belongs to the session running
   right now; otherwise it is a completed close from an earlier session, and
   if that day is not yet on file it is appended as a settled close (close
   only: the day's low and high arrive with the next bars run).

   The session is rebuilt from the exchange's local opening hours for the day
   it is being read on, against the exchange's timezone (so a stored offset
   cannot move the London open by an hour for four months of the year).
   Derived hours know weekends but not holidays, so on a holiday the session
   reads as open and no tick arrives: the tip from the last session predates
   the open and is still read as settled, which is right. */

export interface Tip {
  c: number;
  p?: number;
  t?: number;
  ccy?: string | null;
  /** Index into the sessions table. */
  z?: number;
}

export type SessionHours = [tz: string, openMinute: number, closeMinute: number];

export interface LatestFile {
  generated_at: string;
  sessions: SessionHours[];
  latest: Record<string, Tip>;
}

export interface BarsFile {
  generated_at: string;
  missing?: string[];
  ccy: Record<string, string>;
  bars: Record<string, Bars>;
}

interface Fields { y: number; mo: number; d: number; wd: string; h: number; mi: number; s: number }

const fmtCache = new Map<string, Intl.DateTimeFormat>();
const formatter = (tz: string) => {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour12: false, weekday: 'short',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    fmtCache.set(tz, f);
  }
  return f;
};

function tzFields(tz: string, ms: number): Fields {
  const o: Record<string, string> = {};
  for (const p of formatter(tz).formatToParts(ms)) o[p.type] = p.value;
  // Hour 24 is midnight in this formatter's output, not a 25th hour.
  return { y: +o.year, mo: +o.month, d: +o.day, wd: o.weekday,
           h: o.hour === '24' ? 0 : +o.hour, mi: +o.minute, s: +o.second };
}

/** Milliseconds to add to a UTC instant to read it as local time in tz. */
function tzOffset(tz: string, ms: number): number {
  const f = tzFields(tz, ms);
  return Date.UTC(f.y, f.mo - 1, f.d, f.h, f.mi, f.s) - ms;
}

/** The instant at which the local clock in tz reads the given date and minute. Applied twice: the first
    offset can be the wrong side of a clock change, and re-reading it at the corrected instant settles it. */
function zonedEpoch(tz: string, y: number, mo: number, d: number, minute: number): number {
  const wall = Date.UTC(y, mo - 1, d, 0, minute);
  let t = wall - tzOffset(tz, wall);
  t = wall - tzOffset(tz, t);
  return Math.floor(t / 1000);
}

// The weekend is Friday and Saturday in the Gulf and in Israel.
const FRI_SAT: Record<string, 1> = { 'Asia/Riyadh': 1, 'Asia/Qatar': 1, 'Asia/Dubai': 1,
  'Asia/Bahrain': 1, 'Asia/Kuwait': 1, 'Asia/Muscat': 1, 'Asia/Jerusalem': 1, 'Asia/Tel_Aviv': 1 };
const SAT_SUN: Record<string, 1> = { Sat: 1, Sun: 1 };
const FRI_SAT_DAYS: Record<string, 1> = { Fri: 1, Sat: 1 };

export interface Period { start: number; end: number }

/** The session running now, or the next one if today's has finished, as epoch seconds. */
export function derivedPeriod(hours: SessionHours | null | undefined, nowMs: number): Period | null {
  if (!hours) return null;
  const [tz, open, close] = hours;
  const WEEKEND = FRI_SAT[tz] ? FRI_SAT_DAYS : SAT_SUN;
  const now = Math.floor(nowMs / 1000);
  let ms = nowMs;
  // Eight steps is enough to clear any weekend from any starting day.
  for (let i = 0; i < 8; i++) {
    const f = tzFields(tz, ms);
    if (!WEEKEND[f.wd]) {
      const start = zonedEpoch(tz, f.y, f.mo, f.d, open);
      const end = zonedEpoch(tz, f.y, f.mo, f.d, close);
      if (end > now) return { start, end };
    }
    ms += 86400000;
  }
  return null;
}

/** The exchange's calendar date for an instant; UTC when the zone is unknown. */
export function localDate(epochSec: number, tz: string | null | undefined): string {
  if (!tz) return new Date(epochSec * 1000).toISOString().slice(0, 10);
  const f = tzFields(tz, epochSec * 1000);
  return f.y + '-' + String(f.mo).padStart(2, '0') + '-' + String(f.d).padStart(2, '0');
}

/** A tip is settled unless it belongs to the session running now. Without hours, six hours old counts as settled. */
export function tipSettled(tipTime: number, hours: SessionHours | null | undefined, nowMs: number): boolean {
  const nowSec = nowMs / 1000;
  const period = derivedPeriod(hours, nowMs);
  if (period) return !(tipTime >= period.start && nowSec < period.end);
  return tipTime < nowSec - 6 * 3600;
}

export function hoursFor(tip: Tip | undefined, latest: LatestFile | null | undefined): SessionHours | null {
  if (!tip || tip.z == null || !latest) return null;
  return latest.sessions[tip.z] || null;
}

/** One symbol's history: settled closes from the bars file, the tip spliced on by the rule above. */
export function historyOf(sym: string, barsFile: BarsFile | null | undefined, latest: LatestFile | null | undefined,
                          nowMs: number = Date.now()): History | null {
  const days = barsFile && barsFile.bars[sym];
  const tip = latest && latest.latest[sym];
  if (!days && !tip) return null;
  const settled: SettledClose[] = [];
  if (days) {
    for (const d of Object.keys(days).sort()) {
      const c = days[d][2];
      if (c != null) settled.push([d, c]);
    }
  }
  const lastDate = settled.length ? settled[settled.length - 1][0] : '';
  let live: number | null = settled.length ? settled[settled.length - 1][1] : null;
  let liveDate = lastDate;
  if (tip && tip.c != null && tip.t != null) {
    const hours = hoursFor(tip, latest);
    const date = localDate(tip.t, hours ? hours[0] : null);
    if (date > lastDate) {
      if (!tipSettled(tip.t, hours, nowMs)) { live = tip.c; liveDate = date; }
      else { settled.push([date, tip.c]); live = tip.c; liveDate = date; }
    } else if (date === lastDate) {
      // The day is on file, so it is settled; the tip is its close or a later print of it.
      live = tip.c; liveDate = date;
    }
    // An older tip than the last bar is stale and adds nothing.
  }
  return { settled, live, liveDate,
           currency: (barsFile && barsFile.ccy[sym]) || (tip && tip.ccy) || '' };
}

/** Every symbol in either file. */
export function allHistories(barsFile: BarsFile | null | undefined, latest: LatestFile | null | undefined,
                             nowMs: number = Date.now()): Record<string, History> {
  const out: Record<string, History> = {};
  const syms = new Set([...Object.keys(barsFile ? barsFile.bars : {}), ...Object.keys(latest ? latest.latest : {})]);
  for (const s of syms) {
    const h = historyOf(s, barsFile, latest, nowMs);
    if (h) out[s] = h;
  }
  return out;
}
