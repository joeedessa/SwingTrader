import type { Setup, SymbolEvents } from '../engine/types';

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
