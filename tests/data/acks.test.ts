import { describe, expect, it } from 'vitest';
import {
  ACK_KEEP_MS, ACK_KEYS, ackStore, acknowledge, addAcks, importAcks, mergeAcks, parseAcks, pruneAcks, readAcks, removeAcks,
  unacknowledge, writeAcks,
} from '../../src/data/acks';
import type { KV } from '../../src/data/overlay';

/* Acknowledgements are a fact about one browser's attention. They must survive a reload, never throw on bad storage,
   and never grow without end. */

const kv = (init: Record<string, string> = {}): KV & { data: Map<string, string> } => {
  const data = new Map(Object.entries(init));
  return { data, getItem: k => (data.has(k) ? data.get(k)! : null), setItem: (k, v) => void data.set(k, v) };
};

const NOW = Date.parse('2026-11-02T09:00:00Z');
const A = 'AME|long|breakout|2026-10-30';
const B = 'TVE.TO|long|pullback|2026-10-29';

describe('reading what is stored', () => {
  it('survives a reload: what was written is read back', () => {
    const store = kv();
    const acks = addAcks({}, [A, B], NOW);
    expect(writeAcks(store, ACK_KEYS.watchlist, acks)).toBe(true);
    expect(readAcks(store, ACK_KEYS.watchlist, NOW + 1000)).toEqual({ [A]: NOW, [B]: NOW });
  });

  it('keeps the watchlist\'s and the benchmarks\' apart', () => {
    expect(ACK_KEYS.watchlist).not.toBe(ACK_KEYS.benchmarks);
    const store = kv();
    writeAcks(store, ACK_KEYS.watchlist, { [A]: NOW });
    expect(readAcks(store, ACK_KEYS.benchmarks, NOW)).toEqual({});
  });

  it('never uses a key the old page does', () => {
    for (const key of Object.values(ACK_KEYS)) expect(key.startsWith('macro-compass')).toBe(false);
  });

  it('reads nothing from storage that is missing, empty, corrupt or the wrong shape', () => {
    expect(readAcks(null, 'k')).toEqual({});
    expect(readAcks(kv(), 'k')).toEqual({});
    expect(readAcks(kv({ k: '{not json' }), 'k')).toEqual({});
    expect(readAcks(kv({ k: '[1,2]' }), 'k')).toEqual({});
    expect(readAcks(kv({ k: 'null' }), 'k')).toEqual({});
  });

  it('drops entries that are not an id with a time', () => {
    expect(parseAcks({ [A]: NOW, bad: 'x', neg: -4, zero: 0, nan: null, '': 5, inf: Infinity })).toEqual({ [A]: NOW });
    expect(parseAcks(undefined)).toEqual({});
  });

  it('forgets an acknowledgement after ninety days, and keeps one just inside', () => {
    const acks = { old: NOW - ACK_KEEP_MS - 1, edge: NOW - ACK_KEEP_MS, fresh: NOW };
    expect(Object.keys(pruneAcks(acks, NOW)).sort()).toEqual(['edge', 'fresh']);
    const store = kv({ k: JSON.stringify(acks) });
    expect(Object.keys(readAcks(store, 'k', NOW)).sort()).toEqual(['edge', 'fresh']);
  });
});

describe('writing', () => {
  it('says so when the browser refuses, instead of throwing', () => {
    const refuse: KV = { getItem: () => null, setItem: () => { throw new Error('quota'); } };
    expect(writeAcks(refuse, 'k', { [A]: 1 })).toBe(false);
    expect(writeAcks(null, 'k', { [A]: 1 })).toBe(false);
  });

  it('adds and removes without touching the input', () => {
    const base = { [A]: 1 };
    const added = addAcks(base, [B], 5);
    expect(added).toEqual({ [A]: 1, [B]: 5 });
    expect(base).toEqual({ [A]: 1 });
    expect(removeAcks(added, [A])).toEqual({ [B]: 5 });
    expect(removeAcks(added, ['nothing'])).toEqual(added);
  });

  it('acknowledging again moves the time forward, and merging keeps the later one', () => {
    expect(addAcks({ [A]: 1 }, [A], 9)).toEqual({ [A]: 9 });
    expect(mergeAcks({ [A]: 5, [B]: 1 }, { [A]: 3, x: 7 })).toEqual({ [A]: 5, [B]: 1, x: 7 });
    expect(mergeAcks({ [A]: 3 }, { [A]: 5 })).toEqual({ [A]: 5 });
  });
});

describe('the store', () => {
  // The store reads the real localStorage at start-up; under Node there is none, so it starts empty and writes nowhere.
  it('acknowledges and undoes, per list, and reports a write that did not stick', () => {
    acknowledge('watchlist', [A, B], NOW);
    expect(ackStore.get().acks.watchlist).toEqual({ [A]: NOW, [B]: NOW });
    expect(ackStore.get().acks.benchmarks).toEqual({});
    expect(ackStore.get().saveFailed).toBe(true);          // no localStorage here: the page must be told
    unacknowledge('watchlist', [A]);
    expect(ackStore.get().acks.watchlist).toEqual({ [B]: NOW });
    unacknowledge('watchlist', [B]);
  });

  it('imports an exported set: the later time wins, and the count is what was new', () => {
    acknowledge('benchmarks', [A], 100);
    expect(importAcks('benchmarks', { [A]: 50, [B]: 70, junk: 'x' })).toBe(1);
    expect(ackStore.get().acks.benchmarks).toEqual({ [A]: 100, [B]: 70 });
    expect(importAcks('benchmarks', 'not a set')).toBe(0);
    expect(importAcks('benchmarks', { [A]: 900 })).toBe(0);
    expect(ackStore.get().acks.benchmarks[A]).toBe(900);
    unacknowledge('benchmarks', [A, B]);
  });

  it('notifies whoever is listening', () => {
    let heard = 0;
    const off = ackStore.subscribe(() => heard++);
    acknowledge('watchlist', [A], NOW);
    unacknowledge('watchlist', [A]);
    off();
    acknowledge('watchlist', [B], NOW);
    unacknowledge('watchlist', [B]);
    expect(heard).toBe(2);
  });
});
