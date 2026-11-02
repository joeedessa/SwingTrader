import { Store } from '../store';
import { localKV } from './kv';
import type { KV } from './overlay';

/* "Since your last visit". A skipped morning should be visible on Today, so the page remembers what it was showing
   when this browser last looked, and marks what has appeared since.

   It remembers the flag ids that were on screen, not a time. Bars arrive up to an hour after a close, so a flag dated
   before you left can still have appeared after you left; comparing dates would call it old. Comparing what you were
   shown cannot make that mistake. The time is kept for the label.

   A visit is one stretch of looking: coming back within half an hour is the same visit, so the marks do not vanish the
   moment you glance at another app. */

export const VISIT_KEY = 'st-visit-v1';
export const NEW_VISIT_AFTER_MS = 30 * 60 * 1000;

export interface Visit {
  /** When this browser last left a page it had looked at Today on, ms. */
  at: number;
  /** The flag ids Today had on screen by then, sorted. */
  seen: string[];
}

export function parseVisit(raw: unknown): Visit | null {
  const j = raw as Partial<Visit> | null;
  if (!j || typeof j !== 'object' || typeof j.at !== 'number' || !Number.isFinite(j.at) || !Array.isArray(j.seen)) return null;
  return { at: j.at, seen: j.seen.filter((x): x is string => typeof x === 'string' && x.length > 0) };
}

export function readVisit(storage: KV | null): Visit | null {
  try {
    const raw = storage && storage.getItem(VISIT_KEY);
    return raw ? parseVisit(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function writeVisit(storage: KV | null, v: Visit): boolean {
  try {
    if (!storage) return false;
    storage.setItem(VISIT_KEY, JSON.stringify(v));
    return true;
  } catch {
    return false;
  }
}

/** What to remember on leaving: everything seen before and during this visit that Today still has a place for.
    `still` is the ids on screen now (open and acknowledged), so what has gone away is forgotten and cannot pile up. */
export function nextVisit(since: Visit | null, shown: Iterable<string>, still: Iterable<string>, now: number): Visit {
  const keep = new Set(still);
  const seen = new Set<string>();
  for (const id of [...(since ? since.seen : []), ...shown]) if (keep.has(id)) seen.add(id);
  return { at: now, seen: [...seen].sort() };
}

export interface VisitState {
  /** What this visit compares with; null until a first visit has been recorded, when nothing can be new. */
  since: Visit | null;
}

/** The state machine, with its storage and clock handed in so it can be tested without a browser. */
export class VisitTracker {
  readonly state: Store<VisitState>;
  private shown = new Set<string>();
  private viewed = false;
  private awayAt: number | null = null;

  constructor(private readonly kv: KV | null) {
    this.state = new Store<VisitState>({ since: readVisit(kv) });
  }

  /** Today has these on screen. Only a visit that looked at Today is remembered. */
  noteShown(ids: readonly string[]): void {
    this.viewed = true;
    for (const id of ids) this.shown.add(id);
  }

  /** The page is going out of sight. */
  leave(now: number, still: readonly string[]): void {
    this.awayAt = now;
    if (!this.viewed) return;
    writeVisit(this.kv, nextVisit(this.state.get().since, this.shown, still, now));
  }

  /** The page is back in sight. After half an hour away that is a new visit, measured from the time it was left. */
  back(now: number): void {
    const away = this.awayAt;
    this.awayAt = null;
    if (away == null || now - away < NEW_VISIT_AFTER_MS) return;
    this.shown.clear();
    this.viewed = false;
    this.state.set({ since: readVisit(this.kv) });
  }
}

export const visits = new VisitTracker(localKV());
