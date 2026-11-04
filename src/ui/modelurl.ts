import { DEFAULT_SETTINGS, SIZINGS, STRATEGY_IDS } from '../engine/backtest/settings';
import type { ModelSettings, SizingId, StrategyId } from '../engine/backtest/settings';

/* The Model's dials live in the address (plan B6: "settings are stored in the URL, so a scenario is a shareable link").
   Only what differs from the defaults is written, so #/model is the default scenario and a shared link stays short.
   Anything unreadable falls back to its default rather than breaking the page. */

export type Scope = 'closed' | 'all';

export type TradeSort = 'entry' | 'exit' | 'best' | 'worst' | 'r' | 'days';
export const TRADE_SORTS: readonly TradeSort[] = ['entry', 'exit', 'best', 'worst', 'r', 'days'];

export interface ModelView {
  settings: ModelSettings;
  strategy: StrategyId;
  sizing: SizingId;
  /** Closed trades only, or every leg with the open ones marked at the latest close. */
  scope: Scope;
  /** The account currency's name, printed next to every sum of money (Q4). */
  label: string;
  sort: TradeSort;
}

export const DEFAULT_VIEW: ModelView = { settings: DEFAULT_SETTINGS, strategy: 'S2-u', sizing: 'flat', scope: 'all', label: 'units', sort: 'entry' };

/** The label is a word: letters, digits and the common currency signs, twelve characters at most. */
export const LABEL_MAX = 12;
export const cleanLabel = (raw: string): string => {
  const s = raw.replace(/[^\p{L}\p{N}$€£¥₹ ]/gu, '').trim().slice(0, LABEL_MAX).trim();
  return s || DEFAULT_VIEW.label;
};

/** Costs are a share of the position per side; a hundred per cent would be a joke, so that is the cap. */
const PCT_MAX = 100;
/** Amounts in account units; a thousand million is plenty. */
const UNITS_MAX = 1e9;

const num = (raw: string | null, max: number, fallback: number): number => {
  if (raw == null || raw === '') return fallback;
  const v = Number(raw);
  return isFinite(v) && v >= 0 && v <= max ? v : fallback;
};

const oneOf = <T extends string>(raw: string | null, allowed: readonly T[], fallback: T): T =>
  raw != null && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;

export function parseModelQuery(query: string | null | undefined): ModelView {
  const q = new URLSearchParams(query ?? '');
  const d = DEFAULT_SETTINGS;
  return {
    settings: {
      entry: oneOf(q.get('entry'), ['open', 'close'], d.entry),
      importedEntry: oneOf(q.get('imp'), ['report', 'close'], d.importedEntry),
      targetOn: oneOf(q.get('tgt'), ['close', 'touch'], d.targetOn),
      reentryStop: oneOf(q.get('re'), ['original', 'new'], d.reentryStop),
      removed: oneOf(q.get('rm'), ['include', 'exclude'], d.removed),
      from: q.get('from') === 'list' ? 'list' : null,
      commissionPct: num(q.get('c'), PCT_MAX, d.commissionPct),
      slippagePct: num(q.get('sl'), PCT_MAX, d.slippagePct),
      size: num(q.get('n'), UNITS_MAX, d.size),
      riskUnits: num(q.get('r'), UNITS_MAX, d.riskUnits),
      maxSize: num(q.get('max'), UNITS_MAX, d.maxSize),
      resamples: d.resamples,
      seed: d.seed,
    },
    strategy: oneOf(q.get('s'), STRATEGY_IDS, DEFAULT_VIEW.strategy),
    sizing: oneOf(q.get('sz'), SIZINGS, DEFAULT_VIEW.sizing),
    scope: oneOf(q.get('scope'), ['closed', 'all'], DEFAULT_VIEW.scope),
    label: q.has('cur') ? cleanLabel(q.get('cur') as string) : DEFAULT_VIEW.label,
    sort: oneOf(q.get('sort'), TRADE_SORTS, DEFAULT_VIEW.sort),
  };
}

/** The "from" dial in the address says "list" for the day the list began; the date itself is the engine's constant. */
export const fromDate = (v: ModelView, listBegan: string): string | null => (v.settings.from === 'list' ? listBegan : null);

export function modelQuery(v: ModelView): string {
  const q = new URLSearchParams();
  const d = DEFAULT_SETTINGS, s = v.settings;
  const put = (k: string, val: string | number, def: string | number) => { if (val !== def) q.set(k, String(val)); };
  put('s', v.strategy, DEFAULT_VIEW.strategy);
  put('sz', v.sizing, DEFAULT_VIEW.sizing);
  put('scope', v.scope, DEFAULT_VIEW.scope);
  put('entry', s.entry, d.entry);
  put('imp', s.importedEntry, d.importedEntry);
  put('tgt', s.targetOn, d.targetOn);
  put('re', s.reentryStop, d.reentryStop);
  put('rm', s.removed, d.removed);
  if (s.from) q.set('from', 'list');
  put('c', s.commissionPct, d.commissionPct);
  put('sl', s.slippagePct, d.slippagePct);
  put('n', s.size, d.size);
  put('r', s.riskUnits, d.riskUnits);
  put('max', s.maxSize, d.maxSize);
  put('cur', v.label, DEFAULT_VIEW.label);
  put('sort', v.sort, DEFAULT_VIEW.sort);
  return q.toString();
}

/** The settings the engine runs on: the view's, with the "from" dial turned into its date. */
export const engineSettings = (v: ModelView, listBegan: string): ModelSettings => ({ ...v.settings, from: fromDate(v, listBegan) });
