import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ACK_KEYS } from '../../src/data/acks';
import { KEYS } from '../../src/data/keys';
import { LEGACY, migrateLegacyKeys } from '../../src/data/migrate';
import type { KV } from '../../src/data/overlay';
import { SETS } from '../../src/data/overlay';
import { LOG_KEY } from '../../src/data/tradelog';

/* SwingTrader keeps its own keys in the browser's storage. The old watchlist page's values are copied into them once, on the
   first load, and an old key is never written from here: the two sites share nothing, so a save on one cannot overwrite a save
   on the other. */

interface Spy extends KV {
  store: Map<string, string>;
  /** Every key a write was attempted on, in order. */
  wrote: string[];
  failOn?: string;
}

function memory(initial: Record<string, string> = {}): Spy {
  const store = new Map(Object.entries(initial));
  const kv: Spy = {
    store, wrote: [],
    getItem: k => store.get(k) ?? null,
    setItem: (k, v) => {
      kv.wrote.push(k);
      if (kv.failOn === k) throw new Error('quota');
      store.set(k, v);
    },
  };
  return kv;
}

const OLD = {
  watchlist: 'macro-compass-watch-overlay-v2',
  benchmarks: 'macro-compass-benchmarks-overlay-v1',
  journal: 'macro-compass-tradelog-v1',
};
const OVERLAY = JSON.stringify({ added: [{ sym: 'ZZZ', dir: 'long' }], over: { 'AME|long': { target: 300 } } });
const BENCH = JSON.stringify({ added: [], over: { 'SPX|long': { target: 1 } } });
const JOURNAL = JSON.stringify({ added: [{ id: 'f1', sym: 'AME', side: 'buy', date: '2026-10-01', price: 100 }], over: {}, deleted: ['x'] });

describe('the keys', () => {
  it('are this site\'s own, and none is one of the old page\'s', () => {
    expect(SETS.watchlist.key).toBe(KEYS.overlay.watchlist);
    expect(SETS.benchmarks.key).toBe(KEYS.overlay.benchmarks);
    expect(LOG_KEY).toBe(KEYS.journal);
    const own = [SETS.watchlist.key, SETS.benchmarks.key, LOG_KEY, KEYS.migrated, ACK_KEYS.watchlist, ACK_KEYS.benchmarks];
    expect(new Set(own).size).toBe(own.length);
    for (const k of own) expect(k, k).not.toMatch(/macro-compass/);
    for (const l of LEGACY) expect(own).not.toContain(l.from);
  });

  it('are listed, old and new, for each thing that is copied', () => {
    expect(LEGACY.map(l => l.from)).toEqual(expect.arrayContaining(Object.values(OLD)));
    expect(new Set(LEGACY.map(l => l.to)).size).toBe(LEGACY.length);
  });
});

describe('the one-time copy', () => {
  it('copies what the old page saved into this site\'s own keys, text for text, and leaves the old keys exactly as they were', () => {
    const kv = memory({ [OLD.watchlist]: OVERLAY, [OLD.benchmarks]: BENCH, [OLD.journal]: JOURNAL });
    const m = migrateLegacyKeys(kv, new Date('2026-11-02T10:00:00Z'));
    expect(m).toMatchObject({ ran: true, failed: false });
    expect(m.copied.sort()).toEqual(Object.values(OLD).sort());
    expect(kv.store.get(KEYS.overlay.watchlist)).toBe(OVERLAY);
    expect(kv.store.get(KEYS.overlay.benchmarks)).toBe(BENCH);
    expect(kv.store.get(KEYS.journal)).toBe(JOURNAL);
    expect(kv.store.get(OLD.watchlist)).toBe(OVERLAY);
    expect(kv.store.get(OLD.journal)).toBe(JOURNAL);
  });

  it('never writes an old key: every write is to a key of this site\'s', () => {
    const kv = memory({ [OLD.watchlist]: OVERLAY, [OLD.journal]: JOURNAL });
    migrateLegacyKeys(kv);
    expect(kv.wrote.length).toBeGreaterThan(0);
    for (const k of kv.wrote) expect(LEGACY.map(l => l.from), k).not.toContain(k);
    expect(kv.wrote.some(k => /^macro-compass-/.test(k))).toBe(false);
  });

  it('carries the remembered section across too, so it is not forgotten', () => {
    const kv = memory({ 'mc-seg-macro-compass-watch-overlay-v2': 'breakout', 'mc-seg-macro-compass-benchmarks-overlay-v1': 'stopped' });
    migrateLegacyKeys(kv);
    expect(kv.store.get('mc-seg-' + KEYS.overlay.watchlist)).toBe('breakout');
    expect(kv.store.get('mc-seg-' + KEYS.overlay.benchmarks)).toBe('stopped');
  });

  it('copies only what there is: an old key with no value is left, and the others still go', () => {
    const kv = memory({ [OLD.journal]: JOURNAL });
    const m = migrateLegacyKeys(kv);
    expect(m.copied).toEqual([OLD.journal]);
    expect(kv.store.has(KEYS.overlay.watchlist)).toBe(false);
    expect(m.left).toContain(OLD.watchlist);
  });

  it('does not overwrite a key of this site\'s that already has a value', () => {
    const mine = JSON.stringify({ added: [], over: { 'MINE|long': { target: 1 } } });
    const kv = memory({ [OLD.watchlist]: OVERLAY, [KEYS.overlay.watchlist]: mine });
    const m = migrateLegacyKeys(kv);
    expect(kv.store.get(KEYS.overlay.watchlist)).toBe(mine);
    expect(m.copied).not.toContain(OLD.watchlist);
    expect(m.left).toContain(OLD.watchlist);
  });

  it('is done once: later changes to an old key, or a key of ours cleared on purpose, bring nothing back', () => {
    const kv = memory({ [OLD.journal]: JOURNAL });
    migrateLegacyKeys(kv);
    expect(kv.store.get(KEYS.migrated)).toBeTruthy();
    kv.store.delete(KEYS.journal);                          // cleared on purpose
    kv.store.set(OLD.watchlist, OVERLAY);                   // the old page saved something since
    const again = migrateLegacyKeys(kv);
    expect(again.ran).toBe(false);
    expect(kv.store.has(KEYS.journal)).toBe(false);
    expect(kv.store.has(KEYS.overlay.watchlist)).toBe(false);
  });

  it('records that it ran even when there was nothing to copy, so a later old value is not taken in', () => {
    const kv = memory();
    expect(migrateLegacyKeys(kv)).toMatchObject({ ran: true, copied: [] });
    expect(JSON.parse(kv.store.get(KEYS.migrated)!)).toMatchObject({ copied: [] });
    kv.store.set(OLD.journal, JOURNAL);
    expect(migrateLegacyKeys(kv).ran).toBe(false);
    expect(kv.store.has(KEYS.journal)).toBe(false);
  });

  it('records when it ran and what it copied', () => {
    const kv = memory({ [OLD.journal]: JOURNAL });
    migrateLegacyKeys(kv, new Date('2026-11-02T10:00:00.000Z'));
    expect(JSON.parse(kv.store.get(KEYS.migrated)!)).toEqual({ at: '2026-11-02T10:00:00.000Z', copied: [OLD.journal] });
  });

  it('tries again on the next load if the browser refused a write, and says so', () => {
    const kv = memory({ [OLD.watchlist]: OVERLAY, [OLD.journal]: JOURNAL });
    kv.failOn = KEYS.overlay.watchlist;
    const first = migrateLegacyKeys(kv);
    expect(first.failed).toBe(true);
    expect(kv.store.has(KEYS.migrated)).toBe(false);
    expect(kv.store.get(KEYS.journal)).toBe(JOURNAL);       // the rest went through
    kv.failOn = undefined;
    const second = migrateLegacyKeys(kv);
    expect(second).toMatchObject({ ran: true, failed: false });
    expect(kv.store.get(KEYS.overlay.watchlist)).toBe(OVERLAY);
    expect(kv.store.has(KEYS.migrated)).toBe(true);
  });

  it('does nothing without storage, and does not throw when reading is refused', () => {
    expect(migrateLegacyKeys(null)).toEqual({ ran: false, copied: [], left: [], failed: false });
    const angry: KV = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(() => migrateLegacyKeys(angry)).not.toThrow();
  });
});

describe('the app on its first load', () => {
  afterEach(() => { vi.resetModules(); });

  it('shows what the old page saved, from the copy, before anything reads it', async () => {
    const kv = memory({ [OLD.watchlist]: OVERLAY, [OLD.benchmarks]: BENCH, [OLD.journal]: JOURNAL });
    vi.resetModules();
    const { useStorageForTests } = await import('../../src/data/kv');
    useStorageForTests(kv);
    const { app } = await import('../../src/data/app');
    expect(app.get().overlays.watchlist.added.map(p => p.sym)).toEqual(['ZZZ']);
    expect(app.get().overlays.watchlist.over['AME|long']).toEqual({ target: 300 });
    expect(app.get().overlays.benchmarks.over['SPX|long']).toEqual({ target: 1 });
    expect(app.get().log.added.map(f => f.id)).toEqual(['f1']);
    expect(app.get().log.deleted).toEqual(['x']);
    useStorageForTests(undefined);
  });

  it('writes its changes to its own keys, and never to an old one', async () => {
    const kv = memory({ [OLD.watchlist]: OVERLAY, [OLD.journal]: JOURNAL });
    vi.resetModules();
    const { useStorageForTests } = await import('../../src/data/kv');
    useStorageForTests(kv);
    const { app, updateLog, updateOverlay } = await import('../../src/data/app');
    const { addFill } = await import('../../src/data/tradelog');
    const { saveEdit } = await import('../../src/data/overlay');
    const { acknowledge } = await import('../../src/data/acks');
    updateLog(ov => addFill(ov, { id: 'f2', sym: 'NUTX', side: 'buy', date: '2026-10-02', price: 5 }));
    updateOverlay('watchlist', ov => saveEdit(ov, { sym: 'NUTX', dir: 'long', shared: true }, { target: 9 }));
    updateOverlay('benchmarks', ov => saveEdit(ov, { sym: 'SPX', dir: 'long', shared: true }, { target: 2 }));
    acknowledge('watchlist', ['AME|long|exit|2026-10-30']);
    expect(app.get().log.added.map(f => f.id)).toEqual(['f1', 'f2']);
    for (const k of kv.wrote) expect(k, k).not.toMatch(/^macro-compass-/);
    // The old keys still hold exactly what the old page left in them.
    expect(kv.store.get(OLD.watchlist)).toBe(OVERLAY);
    expect(kv.store.get(OLD.journal)).toBe(JOURNAL);
    // And the new ones hold the changes.
    expect(JSON.parse(kv.store.get(KEYS.journal)!).added.map((f: { id: string }) => f.id)).toEqual(['f1', 'f2']);
    expect(JSON.parse(kv.store.get(KEYS.overlay.watchlist)!).over['NUTX|long']).toEqual({ target: 9 });
    useStorageForTests(undefined);
  });
});

/* The rule is structural, so it is held structurally: no file of the site names an old key except the one that reads them. */
describe('the source', () => {
  const files = (dir: string): string[] => readdirSync(dir).flatMap(n => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
  const src = files(join(__dirname, '../../src'));

  it('names the old page\'s storage keys only in migrate.ts, which reads them', () => {
    const legacy = LEGACY.map(l => l.from);
    for (const f of src) {
      const text = readFileSync(f, 'utf8');
      const hits = legacy.filter(k => text.includes(k));
      if (f.endsWith('migrate.ts')) expect(hits.length, f).toBe(legacy.length);
      else expect(hits, f).toEqual([]);
    }
  });

  it('has no other key that begins "macro-compass-" but the Worker\'s address', () => {
    for (const f of src) {
      if (f.endsWith('migrate.ts')) continue;
      const stray = (readFileSync(f, 'utf8').match(/['"`]macro-compass-[a-z0-9-]*/g) || []).filter(m => !/proxy/.test(m));
      expect(stray, f).toEqual([]);
    }
  });

  it('only ever reads the old keys in migrate.ts: nothing there calls setItem with one', () => {
    const text = readFileSync(join(__dirname, '../../src/data/migrate.ts'), 'utf8');
    expect(text).not.toMatch(/setItem\(\s*from/);
    expect(text).not.toMatch(/setItem\(\s*['"]macro-compass/);
  });
});
