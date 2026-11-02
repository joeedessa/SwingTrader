import { idOf } from './schema';
import { KEYS } from './keys';
import type { ManualState, Setup } from '../engine/types';

/* Personal edits live in this browser's localStorage, never in the repo: added setups, level overrides,
   manual moves and hides, keyed by `sym|dir`. The shape is the old page's, unchanged. The keys are this site's own:
   what the old page saved under its keys was copied into them once (migrate.ts), and the old keys are never written
   from here, so a save on either site cannot overwrite a save on the other. States are never stored: they are
   replayed from settled closes on every load. */

export type SetId = 'watchlist' | 'benchmarks';

export const SETS: Record<SetId, { file: string; title: string; key: string; extras: boolean }> = {
  watchlist: { file: 'watchlist.json', title: 'Setups', key: KEYS.overlay.watchlist, extras: true },
  // No trade log, calendar, import or add form: the same board on a different list.
  benchmarks: { file: 'benchmarks.json', title: 'Benchmarks', key: KEYS.overlay.benchmarks, extras: false },
};

export const LEVEL_FIELDS = ['breakthrough', 'boundary', 'target', 'negation', 'lfd'] as const;
export type LevelField = (typeof LEVEL_FIELDS)[number];

/** A per-row override. A field that is present, even as null, replaces the shared value. */
export interface OverlayEdit {
  negation?: number | null;
  lfd?: number | null;
  boundary?: number | null;
  breakthrough?: number | null;
  target?: number | null;
  ex_div?: string | null;
  confirmed?: string | null;
  manualState?: ManualState;
  deleted?: boolean;
}

export interface Overlay {
  added: Setup[];
  over: Record<string, OverlayEdit>;
}

/** A row after the overlay: `shared` says whether it came from the repo or was added in this browser. */
export type WorkingSetup = Setup & { shared: boolean };


export const emptyOverlay = (): Overlay => ({ added: [], over: {} });

/** The minimal storage the overlay needs, so tests can pass a Map-backed one. */
export interface KV {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function readOverlay(storage: KV | null, key: string): Overlay {
  try {
    const raw = storage && storage.getItem(key);
    if (!raw) return emptyOverlay();
    const j = JSON.parse(raw) as Partial<Overlay> | null;
    if (!j || typeof j !== 'object') return emptyOverlay();
    return {
      added: Array.isArray(j.added) ? j.added.filter(p => p && typeof p.sym === 'string' && (p.dir === 'long' || p.dir === 'short')) : [],
      over: j.over && typeof j.over === 'object' && !Array.isArray(j.over) ? j.over : {},
    };
  } catch {
    return emptyOverlay();
  }
}

/** Returns false when storage refused the write (private mode, quota), so the page can say so. */
export function writeOverlay(storage: KV | null, key: string, ov: Overlay): boolean {
  try {
    if (!storage) return false;
    storage.setItem(key, JSON.stringify(ov));
    return true;
  } catch {
    return false;
  }
}

/** The list the engine runs over: shared rows with the overlay applied, then the rows added here.
    `removed` in the shared file is a setup the source has dropped from its watchlist; it lands in Removed
    like a hand removal, and an explicit per-browser choice (including Restore) wins. */
export function workingList(shared: Setup[], ov: Overlay): WorkingSetup[] {
  const list: WorkingSetup[] = [];
  for (const p of shared) {
    const o = ov.over[idOf(p)] || {};
    if (o.deleted) continue;
    list.push({
      ...p,
      negation: o.negation !== undefined ? o.negation : p.negation,
      lfd: o.lfd !== undefined ? o.lfd : p.lfd,
      boundary: o.boundary !== undefined ? o.boundary : p.boundary,
      breakthrough: o.breakthrough !== undefined ? o.breakthrough : p.breakthrough,
      target: o.target !== undefined ? o.target : p.target,
      ex_div: o.ex_div !== undefined ? o.ex_div : p.ex_div,
      // A hand-promoted setup needs a start date like an imported one, or the replay walks from
      // `created` and a negation entered afterwards reaches back over bars that predate the promotion.
      confirmed: o.confirmed !== undefined ? o.confirmed : p.confirmed,
      manualState: 'manualState' in o ? (o.manualState ?? null) : (p.removed ? 'removed' : null),
      shared: true,
    });
  }
  for (const p of ov.added) list.push({ ...p, shared: false });
  return list;
}

/** Merge fields into a shared row's override, or into an added row itself. */
export function saveEdit(ov: Overlay, p: Pick<WorkingSetup, 'sym' | 'dir' | 'shared'>, fields: OverlayEdit): Overlay {
  const id = idOf(p);
  if (p.shared) return { ...ov, over: { ...ov.over, [id]: { ...(ov.over[id] || {}), ...fields } } };
  return { ...ov, added: ov.added.map(x => (idOf(x) === id ? { ...x, ...fields } as Setup : x)) };
}

/** Undo a manual move. The stamped date goes with the flag: leaving it behind would keep the setup seeded
    as a breakout after the promotion was undone. A setup the source dropped needs an explicit "not removed". */
export function clearManual(ov: Overlay, p: Pick<WorkingSetup, 'sym' | 'dir' | 'shared' | 'removed'>): Overlay {
  const id = idOf(p);
  if (p.shared) {
    const o = { ...(ov.over[id] || {}) };
    delete o.manualState;
    delete o.confirmed;
    if (p.removed) o.manualState = null;
    return { ...ov, over: { ...ov.over, [id]: o } };
  }
  return {
    ...ov,
    added: ov.added.map(x => {
      if (idOf(x) !== id) return x;
      const y = { ...x } as Setup;
      delete y.manualState;
      delete y.confirmed;
      return y;
    }),
  };
}

/** Put one overridden field back to the shared value. */
export function resetField(ov: Overlay, p: Pick<WorkingSetup, 'sym' | 'dir'>, field: keyof OverlayEdit): Overlay {
  const id = idOf(p);
  const o = { ...(ov.over[id] || {}) };
  delete o[field];
  const over = { ...ov.over };
  if (Object.keys(o).length) over[id] = o; else delete over[id];
  return { ...ov, over };
}

/** Fields of a shared row this browser overrides, with the shared value they replace. */
export function editedFields(ov: Overlay, p: Setup): { field: LevelField | 'ex_div'; shared: unknown; mine: unknown }[] {
  const o = ov.over[idOf(p)];
  if (!o) return [];
  const out: { field: LevelField | 'ex_div'; shared: unknown; mine: unknown }[] = [];
  for (const f of [...LEVEL_FIELDS, 'ex_div'] as const) {
    if (f in o && o[f] !== undefined) out.push({ field: f, shared: p[f] ?? null, mine: o[f] });
  }
  return out;
}

/** Add a setup typed in here: the new overlay, or the reason it cannot be added. */
export function addSetup(ov: Overlay, existing: Setup[], s: Setup): { overlay: Overlay } | { error: string } {
  const sym = s.sym.trim().toUpperCase();
  if (!sym) return { error: 'Enter a symbol.' };
  const id = sym + '|' + s.dir;
  if (existing.some(x => idOf(x) === id)) return { error: `${sym} ${s.dir} is already on the list.` };
  return { overlay: { ...ov, added: [...ov.added, { ...s, sym }] } };
}

export function deleteAdded(ov: Overlay, p: Pick<Setup, 'sym' | 'dir'>): Overlay {
  const id = idOf(p);
  return { ...ov, added: ov.added.filter(x => idOf(x) !== id) };
}

/** Merge a list of setups into the added rows, skipping ones already present or invalid. */
export function importSetups(ov: Overlay, existing: Setup[], data: unknown[]): { overlay: Overlay; added: number; skipped: number } {
  const seen = new Set(existing.map(idOf));
  const added: Setup[] = [];
  for (const p of data) {
    const s = p as Partial<Setup> | null;
    if (!s || typeof s.sym !== 'string' || !s.sym || (s.dir !== 'long' && s.dir !== 'short')) continue;
    const id = idOf(s as Setup);
    if (seen.has(id)) continue;
    seen.add(id);
    added.push(s as Setup);
  }
  return { overlay: { ...ov, added: [...ov.added, ...added] }, added: added.length, skipped: data.length - added.length };
}

export type LevelChanges = Partial<Record<LevelField, number | null>> & { ex_div?: string | null };

/** Save only what an edit actually changed. A field put back to the shared value drops its override rather than
    pinning the old number: an override that matches today's value would silently mask the next report's. */
export function applyLevelEdit(ov: Overlay, shared: Setup | null, p: Pick<WorkingSetup, 'sym' | 'dir' | 'shared'>, changes: LevelChanges): Overlay {
  let next = ov;
  const set: OverlayEdit = {};
  for (const [k, v] of Object.entries(changes) as [LevelField | 'ex_div', number | string | null][]) {
    if (p.shared && shared && (shared[k] ?? null) === v) next = resetField(next, p, k);
    else (set as Record<string, unknown>)[k] = v;
  }
  return Object.keys(set).length ? saveEdit(next, p, set) : next;
}
