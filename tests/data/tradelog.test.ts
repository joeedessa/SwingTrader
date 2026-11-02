import { describe, expect, it } from 'vitest';
import {
  addFill, emptyLog, importFills, isSharedFill, LOG_KEY, logRows, newFillId, readLogOverlay, removeFill, saveFill, writeLogOverlay,
} from '../../src/data/tradelog';
import type { LogOverlay } from '../../src/data/tradelog';
import type { KV } from '../../src/data/overlay';
import type { Fill } from '../../src/engine/journal';

const map = (): KV & { store: Map<string, string> } => {
  const store = new Map<string, string>();
  return { store, getItem: k => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v) };
};

const fill = (id: string, over: Partial<Fill> = {}): Fill => ({
  id, sym: 'AME', side: 'buy', date: '2026-10-01', price: 100, priceManual: false, pattern: null, duration_m: null, market: null, note: null,
  logged_at: '2026-10-01T10:00:00.000Z', ...over,
});

const shared = [fill('s1'), fill('s2', { date: '2026-10-03', side: 'sell', price: 110, logged_at: '2026-10-03T10:00:00.000Z' })];

describe('the storage key and shape', () => {
  it('are the old page\'s, so a fill logged there is here and the old page can read what is written back', () => {
    expect(LOG_KEY).toBe('macro-compass-tradelog-v1');
    const kv = map();
    const ov: LogOverlay = { added: [fill('a1')], over: { s1: fill('s1', { price: 101 }) }, deleted: ['s2'] };
    expect(writeLogOverlay(kv, ov)).toBe(true);
    expect(JSON.parse(kv.store.get(LOG_KEY)!)).toEqual(ov);
    expect(readLogOverlay(kv)).toEqual(ov);
  });

  it('reads an empty or damaged store as an empty journal', () => {
    const kv = map();
    expect(readLogOverlay(kv)).toEqual(emptyLog());
    kv.store.set(LOG_KEY, '{not json');
    expect(readLogOverlay(kv)).toEqual(emptyLog());
    kv.store.set(LOG_KEY, '[1,2]');
    expect(readLogOverlay(kv)).toEqual(emptyLog());
    expect(readLogOverlay(null)).toEqual(emptyLog());
  });

  it('drops a stored fill that is not a fill, and keeps the rest', () => {
    const kv = map();
    kv.store.set(LOG_KEY, JSON.stringify({ added: [fill('ok'), { id: 'x' }, null, fill('bad', { price: NaN as unknown as number })], over: {}, deleted: ['a', 3] }));
    const ov = readLogOverlay(kv);
    expect(ov.added.map(f => f.id)).toEqual(['ok']);
    expect(ov.deleted).toEqual(['a']);
  });

  it('says so when the browser refuses the write', () => {
    expect(writeLogOverlay(null, emptyLog())).toBe(false);
    expect(writeLogOverlay({ getItem: () => null, setItem: () => { throw new Error('full'); } }, emptyLog())).toBe(false);
  });
});

describe('adding, editing and deleting', () => {
  it('adds a fill in this browser without touching the shared journal', () => {
    const ov = addFill(emptyLog(), fill('a1', { date: '2026-10-02' }));
    expect(logRows(shared, ov).map(f => f.id)).toEqual(['s1', 'a1', 's2']);
    expect(shared).toHaveLength(2);
  });

  it('an edit to a shared fill is an override over it, and the file is not changed', () => {
    const ov = saveFill(emptyLog(), shared, fill('s1', { price: 105, priceManual: true }));
    expect(ov.over.s1.price).toBe(105);
    expect(ov.added).toEqual([]);
    expect(logRows(shared, ov).find(f => f.id === 's1')!.price).toBe(105);
    expect(shared[0].price).toBe(100);
  });

  it('an edit to a local fill replaces it where it stands', () => {
    const ov = saveFill(addFill(emptyLog(), fill('a1')), shared, fill('a1', { price: 99 }));
    expect(ov.added).toHaveLength(1);
    expect(ov.added[0].price).toBe(99);
    expect(ov.over).toEqual({});
  });

  it('deleting a shared fill hides it by id (once), and deleting a local one drops it', () => {
    const hidden = removeFill(removeFill(emptyLog(), shared, 's2'), shared, 's2');
    expect(hidden.deleted).toEqual(['s2']);
    expect(logRows(shared, hidden).map(f => f.id)).toEqual(['s1']);
    const dropped = removeFill(addFill(emptyLog(), fill('a1')), shared, 'a1');
    expect(dropped.added).toEqual([]);
    expect(dropped.deleted).toEqual([]);
  });

  it('knows which fills came from the shared file', () => {
    expect(isSharedFill(shared, 's1')).toBe(true);
    expect(isSharedFill(shared, 'a1')).toBe(false);
  });

  it('does not change the overlay it is handed', () => {
    const ov = emptyLog();
    addFill(ov, fill('a1'));
    removeFill(ov, shared, 's1');
    saveFill(ov, shared, fill('s1'));
    expect(ov).toEqual(emptyLog());
  });
});

describe('ordering', () => {
  it('is the day traded, then the moment logged, whichever list a fill came from', () => {
    const ov = addFill(addFill(emptyLog(), fill('a2', { date: '2026-10-01', logged_at: '2026-10-01T12:00:00.000Z' })), fill('a1', { date: '2026-10-01', logged_at: '2026-10-01T09:00:00.000Z' }));
    expect(logRows(shared, ov).map(f => f.id)).toEqual(['a1', 's1', 'a2', 's2']);
  });

  it('puts a fill with no logged_at first among its day\'s, which cannot happen to one this page wrote', () => {
    const bare = fill('a1', { date: '2026-10-01' });
    delete bare.logged_at;
    expect(logRows(shared, addFill(emptyLog(), bare)).map(f => f.id).slice(0, 2)).toEqual(['a1', 's1']);
  });
});

describe('new ids', () => {
  it('have the old page\'s form: f, the time in base 36, four random characters', () => {
    const id = newFillId(Date.parse('2026-11-02T10:00:00Z'), 0.123456789);
    expect(id).toMatch(/^f[0-9a-z]+[0-9a-z]{4}$/);
    expect(id.startsWith('f' + Date.parse('2026-11-02T10:00:00Z').toString(36))).toBe(true);
  });

  it('differ between two fills made in the same millisecond', () => {
    expect(newFillId(1, 0.1)).not.toBe(newFillId(1, 0.7));
  });
});

describe('importing fills from an export', () => {
  it('adds the ones this journal does not have, skips repeats and anything that is not a fill, and says how many', () => {
    const have = addFill(emptyLog(), fill('a1'));
    const res = importFills(have, shared, [fill('s1'), fill('a1'), fill('n1'), { id: 'junk' }, null, fill('n1'), fill('n2')]);
    expect(res.added).toBe(2);
    expect(res.skipped).toBe(5);
    expect(res.overlay.added.map(f => f.id)).toEqual(['a1', 'n1', 'n2']);
  });

  it('leaves the overlay itself alone when nothing is new', () => {
    const ov = emptyLog();
    expect(importFills(ov, shared, [fill('s1')]).overlay).toBe(ov);
  });

  it('drops the `shared` marker the old page put on every row of its export', () => {
    const res = importFills(emptyLog(), [], [{ ...fill('n1'), shared: false }]);
    expect(res.overlay.added[0]).not.toHaveProperty('shared');
  });
});
