import { describe, expect, it } from 'vitest';
import {
  addSetup, clearManual, deleteAdded, editedFields, emptyOverlay, importSetups, readOverlay, resetField,
  saveEdit, SETS, workingList, writeOverlay,
} from '../../src/data/overlay';
import type { KV, Overlay } from '../../src/data/overlay';
import type { Setup } from '../../src/engine/types';

const shared: Setup[] = [
  { sym: 'AME', dir: 'long', breakthrough: 250, target: 300, negation: 214, boundary: 242, lfd: 236, confirmed: '2026-08-08' },
  { sym: 'ICLR', dir: 'long', breakthrough: 187.1, target: 207, negation: null, removed: '2026-10-31', removed_reason: 'objective reached' },
  { sym: 'OM.TO', dir: 'long', breakthrough: 2, target: 3, negation: 1 },
  { sym: 'OM.TO', dir: 'short', breakthrough: 1.5, target: 1, negation: 1.8 },
];

const map = (): KV & { store: Map<string, string> } => {
  const store = new Map<string, string>();
  return { store, getItem: k => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v) };
};

describe('storage keys', () => {
  it('are this site\'s own: what the old page saved was copied into them once, and the old keys are never written from here', () => {
    expect(SETS.watchlist.key).toBe('st-overlay-v1');
    expect(SETS.benchmarks.key).toBe('st-overlay-benchmarks-v1');
  });
});

describe('read and write', () => {
  it('round-trips exactly the old shape {added, over}', () => {
    const kv = map();
    const ov: Overlay = { added: [{ sym: 'GDX', dir: 'long', breakthrough: 80, negation: 70, target: 95, created: '2026-11-01' }], over: { 'AME|long': { target: 310 } } };
    expect(writeOverlay(kv, 'k', ov)).toBe(true);
    expect(JSON.parse(kv.store.get('k')!)).toEqual(ov);
    expect(readOverlay(kv, 'k')).toEqual(ov);
  });

  it('reads what the old page wrote, including a manual state and a stamped date', () => {
    const kv = map();
    kv.store.set('k', JSON.stringify({ added: [], over: { 'OM.TO|short': { manualState: 'breakout', confirmed: '2026-10-30' } } }));
    expect(readOverlay(kv, 'k').over['OM.TO|short']).toEqual({ manualState: 'breakout', confirmed: '2026-10-30' });
  });

  it('an empty, corrupt or odd value is an empty overlay, never a crash', () => {
    const kv = map();
    expect(readOverlay(kv, 'k')).toEqual(emptyOverlay());
    for (const bad of ['{', 'null', '[]', '"x"', '{"added":5,"over":[]}']) {
      kv.store.set('k', bad);
      expect(readOverlay(kv, 'k')).toEqual(emptyOverlay());
    }
    expect(readOverlay(null, 'k')).toEqual(emptyOverlay());
  });

  it('drops added rows that cannot be setups, and reports a refused write', () => {
    const kv = map();
    kv.store.set('k', JSON.stringify({ added: [{ sym: 'A', dir: 'long' }, { sym: 'B' }, null, { dir: 'long' }], over: {} }));
    expect(readOverlay(kv, 'k').added).toEqual([{ sym: 'A', dir: 'long' }]);
    expect(writeOverlay({ getItem: () => null, setItem: () => { throw new Error('quota'); } }, 'k', emptyOverlay())).toBe(false);
    expect(writeOverlay(null, 'k', emptyOverlay())).toBe(false);
  });
});

describe('the working list', () => {
  it('is the shared rows untouched when there is no overlay, with `removed` landing in Removed', () => {
    const list = workingList(shared, emptyOverlay());
    expect(list.map(p => [p.sym, p.dir, p.shared, p.manualState])).toEqual([
      ['AME', 'long', true, null], ['ICLR', 'long', true, 'removed'], ['OM.TO', 'long', true, null], ['OM.TO', 'short', true, null],
    ]);
    expect(list[0]).toMatchObject({ breakthrough: 250, lfd: 236, confirmed: '2026-08-08' });
  });

  it('overrides a level only where the overlay has the field, and a present null replaces the shared value', () => {
    const ov: Overlay = { added: [], over: { 'AME|long': { target: 310, lfd: null, negation: undefined } } };
    const [ame] = workingList(shared, ov);
    expect(ame.target).toBe(310);
    expect(ame.lfd).toBeNull();            // blank means "derive it", over the report's 236
    expect(ame.negation).toBe(214);        // undefined is not an override
    expect(ame.breakthrough).toBe(250);
  });

  it('keys by symbol and direction: the long and the short of one name never share an edit', () => {
    const ov: Overlay = { added: [], over: { 'OM.TO|short': { target: 0.9 } } };
    const list = workingList(shared, ov);
    expect(list[2].target).toBe(3);
    expect(list[3].target).toBe(0.9);
  });

  it('skips a deleted row, and an explicit manualState (even null) beats the shared `removed`', () => {
    const list = workingList(shared, { added: [], over: { 'OM.TO|long': { deleted: true }, 'ICLR|long': { manualState: null } } });
    expect(list.map(p => p.sym + p.dir)).toEqual(['AMElong', 'ICLRlong', 'OM.TOshort']);
    expect(list[1].manualState).toBeNull();
  });

  it('appends added rows after the shared ones, marked as not shared', () => {
    const list = workingList(shared, { added: [{ sym: 'GDX', dir: 'long', manualState: 'failed' }], over: {} });
    expect(list[4]).toMatchObject({ sym: 'GDX', shared: false, manualState: 'failed' });
  });

  it('never carries a legacy hold flag into the engine', () => {
    const list = workingList(shared, { added: [], over: { 'AME|long': { hold: true } as never } });
    expect(list[0].hold).toBeUndefined();
  });
});

describe('edits and actions', () => {
  it('saveEdit merges into a shared row\'s override and into an added row itself, without mutating the input', () => {
    const ov: Overlay = { added: [{ sym: 'GDX', dir: 'long', target: 90 }], over: {} };
    const a = saveEdit(ov, { sym: 'AME', dir: 'long', shared: true }, { target: 310 });
    const b = saveEdit(a, { sym: 'AME', dir: 'long', shared: true }, { negation: 220 });
    expect(b.over['AME|long']).toEqual({ target: 310, negation: 220 });
    expect(ov.over).toEqual({});
    const c = saveEdit(b, { sym: 'GDX', dir: 'long', shared: false }, { target: 95 });
    expect(c.added[0].target).toBe(95);
    expect(Object.keys(c.over)).toEqual(['AME|long']);
  });

  it('promoting by hand stamps a manual state and a date, and Undo takes both away', () => {
    let ov = saveEdit(emptyOverlay(), { sym: 'OM.TO', dir: 'long', shared: true }, { manualState: 'breakout', confirmed: '2026-11-01' });
    expect(workingList(shared, ov)[2]).toMatchObject({ manualState: 'breakout', confirmed: '2026-11-01' });
    ov = clearManual(ov, { sym: 'OM.TO', dir: 'long', shared: true, removed: null });
    expect(ov.over['OM.TO|long']).toEqual({});
    expect(workingList(shared, ov)[2]).toMatchObject({ manualState: null, confirmed: undefined });
  });

  it('Restore on a row the source dropped writes an explicit "not removed", or the shared flag puts it straight back', () => {
    const ov = clearManual(emptyOverlay(), { sym: 'ICLR', dir: 'long', shared: true, removed: '2026-10-31' });
    expect(ov.over['ICLR|long']).toEqual({ manualState: null });
    expect(workingList(shared, ov)[1].manualState).toBeNull();
  });

  it('clearing a manual move on an added row removes the flag and the date from the row', () => {
    const ov: Overlay = { added: [{ sym: 'GDX', dir: 'long', manualState: 'removed', confirmed: '2026-11-01' }], over: {} };
    expect(clearManual(ov, { sym: 'GDX', dir: 'long', shared: false, removed: null }).added[0]).toEqual({ sym: 'GDX', dir: 'long' });
  });

  it('lists what this browser overrides, with the shared value it replaces, and puts a field back', () => {
    const ov: Overlay = { added: [], over: { 'AME|long': { target: 310, lfd: null, manualState: 'failed' } } };
    expect(editedFields(ov, shared[0])).toEqual([
      { field: 'target', shared: 300, mine: 310 },
      { field: 'lfd', shared: 236, mine: null },
    ]);
    const back = resetField(ov, shared[0], 'target');
    expect(back.over['AME|long']).toEqual({ lfd: null, manualState: 'failed' });
    expect(resetField(resetField(back, shared[0], 'lfd'), shared[0], 'manualState').over).toEqual({});
  });
});

describe('adding, deleting and importing', () => {
  it('adds an uppercase symbol, refuses a duplicate and an empty symbol', () => {
    const ok = addSetup(emptyOverlay(), shared, { sym: ' gdx ', dir: 'long', breakthrough: 80 });
    expect('overlay' in ok && ok.overlay.added[0].sym).toBe('GDX');
    expect(addSetup(emptyOverlay(), shared, { sym: 'ame', dir: 'long' })).toEqual({ error: 'AME long is already on the list.' });
    expect(addSetup(emptyOverlay(), shared, { sym: 'ame', dir: 'short' })).toHaveProperty('overlay');
    expect(addSetup(emptyOverlay(), shared, { sym: '  ', dir: 'long' })).toEqual({ error: 'Enter a symbol.' });
  });

  it('deletes an added row only', () => {
    const ov: Overlay = { added: [{ sym: 'GDX', dir: 'long' }, { sym: 'GDX', dir: 'short' }], over: {} };
    expect(deleteAdded(ov, { sym: 'GDX', dir: 'long' }).added).toEqual([{ sym: 'GDX', dir: 'short' }]);
  });

  it('imports new valid setups and counts the rest as skipped', () => {
    const r = importSetups(emptyOverlay(), shared, [
      { sym: 'AME', dir: 'long' }, { sym: 'NEW', dir: 'long', breakthrough: 5 }, { sym: 'NEW', dir: 'long' }, { sym: 'BAD' }, null,
    ]);
    expect(r.added).toBe(1);
    expect(r.skipped).toBe(4);
    expect(r.overlay.added.map(p => p.sym)).toEqual(['NEW']);
  });
});
