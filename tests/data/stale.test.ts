import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ACK_KEYS, ackStore, acknowledge, reloadAcks, unacknowledge } from '../../src/data/acks';
import { app, reloadStored, updateLog, updateOverlay } from '../../src/data/app';
import { useStorageForTests } from '../../src/data/kv';
import { emptyOverlay, saveEdit, SETS } from '../../src/data/overlay';
import type { KV } from '../../src/data/overlay';
import { addFill, emptyLog, LOG_KEY } from '../../src/data/tradelog';
import type { Fill } from '../../src/engine/journal';

/* Three things this page writes are shared with other tabs, and some with the old watchlist page, which uses the same keys:
   the saved edits, the journal and the acknowledgements. A change must be applied to what is stored now, not to what was
   stored when the page loaded, or writing it back erases whatever another tab wrote in between. */

const fill = (id: string): Fill => ({ id, sym: 'AME', side: 'buy', date: '2026-10-01', price: 100, logged_at: '2026-10-01T10:00:00.000Z' });

function memory(): KV & { store: Map<string, string>; failing: boolean } {
  const store = new Map<string, string>();
  const kv = {
    store, failing: false,
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { if (kv.failing) throw new Error('quota'); store.set(k, v); },
  };
  return kv;
}

let kv: ReturnType<typeof memory>;

beforeEach(() => {
  kv = memory();
  useStorageForTests(kv);
  app.set({ overlays: { watchlist: emptyOverlay(), benchmarks: emptyOverlay() }, log: emptyLog(), saveFailed: false, logSaveFailed: false, shared: { watchlist: [], benchmarks: [] } });
  ackStore.set({ acks: { watchlist: {}, benchmarks: {} }, saveFailed: false });
});
afterEach(() => useStorageForTests(undefined));

const storedLog = () => JSON.parse(kv.store.get(LOG_KEY)!) as { added: Fill[] };

describe('the journal', () => {
  it('keeps a fill another tab saved while this page was open, when this page logs another', () => {
    // Another tab (or the old page) logs X; this page still has the journal it loaded: empty.
    kv.store.set(LOG_KEY, JSON.stringify({ added: [fill('x')], over: {}, deleted: [] }));
    expect(app.get().log.added).toEqual([]);
    updateLog(ov => addFill(ov, fill('y')));
    expect(storedLog().added.map(f => f.id)).toEqual(['x', 'y']);
    expect(app.get().log.added.map(f => f.id)).toEqual(['x', 'y']);
  });

  it('keeps another tab\'s delete and edit too, because it writes the whole overlay back', () => {
    kv.store.set(LOG_KEY, JSON.stringify({ added: [], over: { s1: { ...fill('s1'), price: 5 } }, deleted: ['s2'] }));
    updateLog(ov => addFill(ov, fill('y')));
    const s = JSON.parse(kv.store.get(LOG_KEY)!);
    expect(s.deleted).toEqual(['s2']);
    expect(s.over.s1.price).toBe(5);
  });

  it('keeps what is in memory when the last write was refused, so an unsaved fill is not lost on the next try', () => {
    kv.failing = true;
    updateLog(ov => addFill(ov, fill('a')));
    expect(app.get().logSaveFailed).toBe(true);
    kv.failing = false;
    kv.store.set(LOG_KEY, JSON.stringify({ added: [fill('x')], over: {}, deleted: [] }));
    updateLog(ov => addFill(ov, fill('b')));
    expect(app.get().logSaveFailed).toBe(false);
    expect(app.get().log.added.map(f => f.id)).toEqual(['a', 'b']);
  });

  it('works with no storage at all, in memory', () => {
    useStorageForTests(null);
    updateLog(ov => addFill(ov, fill('a')));
    expect(app.get().log.added.map(f => f.id)).toEqual(['a']);
    expect(app.get().logSaveFailed).toBe(true);
  });
});

describe('the saved edits', () => {
  const key = SETS.watchlist.key;
  const edit = (sym: string, target: number) => (ov: ReturnType<typeof emptyOverlay>) => saveEdit(ov, { sym, dir: 'long', shared: true }, { target });

  it('keeps an edit another tab saved, when this page saves another', () => {
    kv.store.set(key, JSON.stringify({ added: [], over: { 'AME|long': { target: 300 } } }));
    updateOverlay('watchlist', edit('NUTX', 55));
    const stored = JSON.parse(kv.store.get(key)!);
    expect(stored.over).toEqual({ 'AME|long': { target: 300 }, 'NUTX|long': { target: 55 } });
    expect(app.get().overlays.watchlist.over['AME|long']).toEqual({ target: 300 });
  });

  it('keeps the two lists apart', () => {
    kv.store.set(SETS.benchmarks.key, JSON.stringify({ added: [], over: { 'SPX|long': { target: 1 } } }));
    updateOverlay('watchlist', edit('NUTX', 55));
    expect(JSON.parse(kv.store.get(SETS.benchmarks.key)!).over).toEqual({ 'SPX|long': { target: 1 } });
  });

  it('keeps what is in memory when the last write was refused', () => {
    kv.failing = true;
    updateOverlay('watchlist', edit('NUTX', 55));
    expect(app.get().saveFailed).toBe(true);
    kv.failing = false;
    updateOverlay('watchlist', edit('AME', 300));
    expect(app.get().saveFailed).toBe(false);
    expect(Object.keys(JSON.parse(kv.store.get(key)!).over).sort()).toEqual(['AME|long', 'NUTX|long']);
  });
});

describe('the acknowledgements', () => {
  const key = ACK_KEYS.watchlist;

  it('keeps an acknowledgement another tab made, when this page acknowledges another flag', () => {
    kv.store.set(key, JSON.stringify({ 'A|long|exit|2026-10-30': Date.now() }));
    acknowledge('watchlist', ['B|long|exit|2026-10-30']);
    expect(Object.keys(JSON.parse(kv.store.get(key)!)).sort()).toEqual(['A|long|exit|2026-10-30', 'B|long|exit|2026-10-30']);
  });

  it('keeps another tab\'s acknowledgement when this page undoes its own', () => {
    acknowledge('watchlist', ['B|long|exit|2026-10-30']);
    kv.store.set(key, JSON.stringify({ ...JSON.parse(kv.store.get(key)!), 'A|long|exit|2026-10-30': Date.now() }));
    unacknowledge('watchlist', ['B|long|exit|2026-10-30']);
    expect(Object.keys(JSON.parse(kv.store.get(key)!))).toEqual(['A|long|exit|2026-10-30']);
  });
});

describe('taking in what another tab wrote', () => {
  it('updates the journal, the edits and the acknowledgements from storage', () => {
    kv.store.set(LOG_KEY, JSON.stringify({ added: [fill('x')], over: {}, deleted: [] }));
    kv.store.set(SETS.watchlist.key, JSON.stringify({ added: [], over: { 'AME|long': { target: 300 } } }));
    kv.store.set(ACK_KEYS.watchlist, JSON.stringify({ 'A|long|exit|2026-10-30': Date.now() }));
    reloadStored();
    expect(app.get().log.added.map(f => f.id)).toEqual(['x']);
    expect(app.get().overlays.watchlist.over['AME|long']).toEqual({ target: 300 });
    expect(Object.keys(ackStore.get().acks.watchlist)).toEqual(['A|long|exit|2026-10-30']);
  });

  it('leaves the state alone, and tells nobody, when nothing changed', () => {
    reloadStored();
    let calls = 0;
    const offApp = app.subscribe(() => { calls++; });
    const offAcks = ackStore.subscribe(() => { calls++; });
    reloadStored();
    reloadAcks();
    offApp();
    offAcks();
    expect(calls).toBe(0);
  });

  it('does not throw away what could not be saved: with a refused write pending it keeps its own state', () => {
    kv.failing = true;
    updateLog(ov => addFill(ov, fill('a')));
    kv.failing = false;
    kv.store.set(LOG_KEY, JSON.stringify({ added: [fill('x')], over: {}, deleted: [] }));
    reloadStored();
    expect(app.get().log.added.map(f => f.id)).toEqual(['a']);
  });

  it('does nothing without storage', () => {
    useStorageForTests(null);
    expect(() => reloadStored()).not.toThrow();
  });
});
