import type { BarsFile } from '../engine/bars';
import type { SeriesEntry, SeriesFile } from '../engine/signals';
import type { Bars, DayBar, Setup, SymbolEvents } from '../engine/types';

/* The shared files are hand-maintained and written by a report sync, so they are validated at the edge:
   a bad row is reported and dropped rather than reaching the engine as a NaN. Fields the engine never
   reads (`state`, `hold`, `alert`, `alertOp`) are stripped, so a stray value cannot change a section. */

const NUMBERS = ['breakthrough', 'target', 'negation', 'boundary', 'lfd', 'duration_m'] as const;
const DATES = ['created', 'confirmed', 'reached', 'removed', 'ex_div'] as const;
const IGNORED = ['state', 'hold', 'alert', 'alertOp'] as const;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export interface Parsed {
  rows: Setup[];
  problems: string[];
}

export const idOf = (p: { sym: string; dir: string }): string => p.sym + '|' + p.dir;

export function parseSetups(json: unknown, file: string): Parsed {
  if (!Array.isArray(json)) return { rows: [], problems: [`${file}: expected a list of setups`] };
  const problems: string[] = [];
  const rows: Setup[] = [];
  const seen = new Set<string>();
  json.forEach((raw, i) => {
    const where = `${file}[${i}]`;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      problems.push(`${where}: not an object`);
      return;
    }
    const r = { ...(raw as Record<string, unknown>) };
    if (typeof r.sym !== 'string' || !r.sym.trim()) {
      problems.push(`${where}: missing symbol`);
      return;
    }
    if (r.dir !== 'long' && r.dir !== 'short') {
      problems.push(`${where} ${r.sym}: direction must be long or short`);
      return;
    }
    const id = idOf(r as { sym: string; dir: string });
    if (seen.has(id)) {
      problems.push(`${where}: ${id} is listed twice; the second is dropped`);
      return;
    }
    seen.add(id);
    for (const f of IGNORED) delete r[f];
    for (const f of NUMBERS) {
      const v = r[f];
      if (v !== undefined && v !== null && !(typeof v === 'number' && isFinite(v))) {
        problems.push(`${where} ${id}: ${f} is not a number (${JSON.stringify(v)}); treated as unset`);
        r[f] = null;
      }
    }
    for (const f of DATES) {
      const v = r[f];
      if (v !== undefined && v !== null && !(typeof v === 'string' && ISO.test(v))) {
        problems.push(`${where} ${id}: ${f} is not a YYYY-MM-DD date (${JSON.stringify(v)}); treated as unset`);
        r[f] = null;
      }
    }
    if (r.source_open !== undefined && !(Array.isArray(r.source_open) && r.source_open.every(d => typeof d === 'string'))) {
      problems.push(`${where} ${id}: source_open is not a list of dates; ignored`);
      delete r.source_open;
    }
    rows.push(r as unknown as Setup);
  });
  return { rows, problems };
}

const finite = (v: unknown): v is number => typeof v === 'number' && isFinite(v);

/** bars.json as the page reads it. A bar with a zero or a negative in it is Yahoo's "no price", not a day: it is left out
    and reported, since a low of zero would read as a touch of every negation. The close may be null (a day without one). */
export function parseBars(json: unknown): { file: BarsFile | null; problems: string[] } {
  const problems: string[] = [];
  if (!json || typeof json !== 'object' || Array.isArray(json)) return { file: null, problems: ['bars.json: not an object'] };
  const j = json as { generated_at?: unknown; missing?: unknown; ccy?: unknown; bars?: unknown };
  if (!j.bars || typeof j.bars !== 'object' || Array.isArray(j.bars)) return { file: null, problems: ['bars.json: no bars'] };
  const bars: Record<string, Bars> = {};
  for (const [sym, days] of Object.entries(j.bars as Record<string, unknown>)) {
    if (!days || typeof days !== 'object' || Array.isArray(days)) { problems.push(`bars.json ${sym}: not a map of days; left out`); continue; }
    const kept: Bars = {};
    for (const [d, raw] of Object.entries(days as Record<string, unknown>)) {
      const b = raw as unknown[];
      const ok = Array.isArray(b) && b.length >= 3 && finite(b[0]) && b[0] > 0 && finite(b[1]) && b[1] > 0
        && (b[2] === null || (finite(b[2]) && b[2] > 0)) && (b.length < 4 || b[3] === null || (finite(b[3]) && b[3] > 0));
      if (!ok) { problems.push(`bars.json ${sym} ${d}: a bar with no price in it was left out`); continue; }
      kept[d] = b as unknown as DayBar;
    }
    if (Object.keys(kept).length) bars[sym] = kept;
  }
  return {
    file: {
      generated_at: typeof j.generated_at === 'string' ? j.generated_at : '',
      missing: Array.isArray(j.missing) ? (j.missing as unknown[]).filter((x): x is string => typeof x === 'string') : [],
      ccy: j.ccy && typeof j.ccy === 'object' && !Array.isArray(j.ccy) ? (j.ccy as Record<string, string>) : {},
      bars,
    },
    problems,
  };
}

export interface EventsFile {
  generated_at?: string;
  symbols: Record<string, SymbolEvents>;
}

/** watch-events.json: `{symbols: {SYM: {...}}}`. Anything else is an empty feed, not an error. */
export function parseEvents(json: unknown): EventsFile {
  if (json && typeof json === 'object' && !Array.isArray(json)) {
    const j = json as { generated_at?: unknown; symbols?: unknown };
    if (j.symbols && typeof j.symbols === 'object' && !Array.isArray(j.symbols)) {
      return {
        symbols: j.symbols as Record<string, SymbolEvents>,
        ...(typeof j.generated_at === 'string' ? { generated_at: j.generated_at } : {}),
      };
    }
  }
  return { symbols: {} };
}

export interface ParsedSeries {
  file: SeriesFile | null;
  problems: string[];
}

/** One timeframe of series.json: `{SYM: {ccy, t: [stamps], c: [closes]}}`. A symbol whose arrays are not the same length of
    numbers is left out and reported, so a bad entry cannot reach the averages as a NaN. */
function parseTimeframe(raw: unknown, name: string, problems: string[]): Record<string, SeriesEntry> {
  const out: Record<string, SeriesEntry> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    problems.push(`series.json: ${name} is not a map of symbols`);
    return out;
  }
  for (const [sym, e] of Object.entries(raw as Record<string, unknown>)) {
    const r = e as { ccy?: unknown; t?: unknown; c?: unknown } | null;
    if (!r || !Array.isArray(r.t) || !Array.isArray(r.c) || r.t.length !== r.c.length || !r.t.every(finite) || !r.c.every(finite)) {
      problems.push(`series.json ${name} ${sym}: expected matching lists of stamps and closes; left out`);
      continue;
    }
    out[sym] = { ccy: typeof r.ccy === 'string' ? r.ccy : null, t: r.t as number[], c: r.c as number[] };
  }
  return out;
}

/** series.json: the weekly and monthly closes the Signals page reads. Anything that is not that is no file, not an error:
    the page says the slower timeframes are missing and shows the daily one. */
export function parseSeries(json: unknown): ParsedSeries {
  const problems: string[] = [];
  if (!json || typeof json !== 'object' || Array.isArray(json)) return { file: null, problems: ['series.json: not an object'] };
  const j = json as { generated_at?: unknown; weekly?: unknown; monthly?: unknown };
  if (j.weekly === undefined && j.monthly === undefined) return { file: null, problems: ['series.json: no weekly or monthly series'] };
  if (j.weekly === undefined) problems.push('series.json: weekly is missing');
  if (j.monthly === undefined) problems.push('series.json: monthly is missing');
  return {
    file: {
      generated_at: typeof j.generated_at === 'string' ? j.generated_at : '',
      weekly: parseTimeframe(j.weekly ?? {}, 'weekly', problems),
      monthly: parseTimeframe(j.monthly ?? {}, 'monthly', problems),
    },
    problems,
  };
}
