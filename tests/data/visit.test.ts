import { describe, expect, it } from 'vitest';
import { NEW_VISIT_AFTER_MS, nextVisit, parseVisit, readVisit, VISIT_KEY, VisitTracker, writeVisit } from '../../src/data/visit';
import type { KV } from '../../src/data/overlay';

const kv = (init: Record<string, string> = {}): KV & { data: Map<string, string> } => {
  const data = new Map(Object.entries(init));
  return { data, getItem: k => (data.has(k) ? data.get(k)! : null), setItem: (k, v) => void data.set(k, v) };
};

const T0 = Date.parse('2026-11-01T20:00:00Z');
const MIN = 60_000;

describe('what is remembered', () => {
  it('reads back what was written, and nothing from storage that is missing, corrupt or the wrong shape', () => {
    const store = kv();
    expect(readVisit(store)).toBeNull();
    expect(writeVisit(store, { at: T0, seen: ['a', 'b'] })).toBe(true);
    expect(readVisit(store)).toEqual({ at: T0, seen: ['a', 'b'] });
    expect(readVisit(null)).toBeNull();
    expect(readVisit(kv({ [VISIT_KEY]: '{oops' }))).toBeNull();
    expect(readVisit(kv({ [VISIT_KEY]: '{"at":"x","seen":[]}' }))).toBeNull();
    expect(readVisit(kv({ [VISIT_KEY]: '{"at":5}' }))).toBeNull();
    expect(parseVisit({ at: 5, seen: ['ok', 7, '', null] })).toEqual({ at: 5, seen: ['ok'] });
  });

  it('says so when the browser refuses the write', () => {
    expect(writeVisit({ getItem: () => null, setItem: () => { throw new Error('quota'); } }, { at: 1, seen: [] })).toBe(false);
    expect(writeVisit(null, { at: 1, seen: [] })).toBe(false);
  });

  it('keeps what was seen before and during, sorted, and forgets what Today no longer has a place for', () => {
    const v = nextVisit({ at: 1, seen: ['b', 'old'] }, ['c', 'a', 'gone'], ['a', 'b', 'c', 'never-seen'], T0);
    expect(v).toEqual({ at: T0, seen: ['a', 'b', 'c'] });
    expect(nextVisit(null, [], [], T0)).toEqual({ at: T0, seen: [] });
  });
});

describe('a visit', () => {
  it('starts with whatever the last one left, or nothing at all on a first visit', () => {
    expect(new VisitTracker(kv()).state.get().since).toBeNull();
    expect(new VisitTracker(kv({ [VISIT_KEY]: JSON.stringify({ at: T0, seen: ['a'] }) })).state.get().since).toEqual({ at: T0, seen: ['a'] });
    expect(new VisitTracker(null).state.get().since).toBeNull();
  });

  it('is remembered on leaving, once Today has been looked at', () => {
    const store = kv();
    const t = new VisitTracker(store);
    t.noteShown(['a', 'b']);
    t.noteShown(['b', 'c']);
    t.leave(T0, ['a', 'b', 'c', 'd']);
    expect(readVisit(store)).toEqual({ at: T0, seen: ['a', 'b', 'c'] });
  });

  it('is not remembered if the visit never looked at Today: opening the Setups page is not seeing the flags', () => {
    const store = kv({ [VISIT_KEY]: JSON.stringify({ at: 5, seen: ['a'] }) });
    const t = new VisitTracker(store);
    t.leave(T0, ['a', 'b']);
    expect(readVisit(store)).toEqual({ at: 5, seen: ['a'] });
  });

  it('a short absence is the same visit: what was new stays marked', () => {
    const store = kv({ [VISIT_KEY]: JSON.stringify({ at: 5, seen: ['a'] }) });
    const t = new VisitTracker(store);
    t.noteShown(['a', 'b']);
    t.leave(T0, ['a', 'b']);
    t.back(T0 + NEW_VISIT_AFTER_MS - 1);
    expect(t.state.get().since).toEqual({ at: 5, seen: ['a'] });          // b is still new
  });

  it('half an hour away is a new visit, compared with what was on screen when it was left', () => {
    const store = kv({ [VISIT_KEY]: JSON.stringify({ at: 5, seen: ['a'] }) });
    const t = new VisitTracker(store);
    t.noteShown(['a', 'b']);
    t.leave(T0, ['a', 'b']);
    t.back(T0 + NEW_VISIT_AFTER_MS);
    expect(t.state.get().since).toEqual({ at: T0, seen: ['a', 'b'] });
  });

  it('a new visit starts again: the next departure remembers only what that visit saw, plus what came before', () => {
    const store = kv();
    const t = new VisitTracker(store);
    t.noteShown(['a']);
    t.leave(T0, ['a', 'b']);
    t.back(T0 + 40 * MIN);
    t.leave(T0 + 41 * MIN, ['a', 'b']);                                    // looked at nothing this time
    expect(readVisit(store)).toEqual({ at: T0, seen: ['a'] });
    t.back(T0 + 100 * MIN);
    t.noteShown(['b']);
    t.leave(T0 + 101 * MIN, ['a', 'b']);
    expect(readVisit(store)).toEqual({ at: T0 + 101 * MIN, seen: ['a', 'b'] });
  });

  it('coming back without having left changes nothing', () => {
    const t = new VisitTracker(kv({ [VISIT_KEY]: JSON.stringify({ at: 5, seen: ['a'] }) }));
    t.back(T0);
    expect(t.state.get().since).toEqual({ at: 5, seen: ['a'] });
  });

  it('tells whoever listens when a new visit begins', () => {
    const store = kv();
    const t = new VisitTracker(store);
    let heard = 0;
    t.state.subscribe(() => heard++);
    t.noteShown(['a']);
    t.leave(T0, ['a']);
    t.back(T0 + 10 * MIN);
    expect(heard).toBe(0);
    t.leave(T0 + 11 * MIN, ['a']);
    t.back(T0 + 60 * MIN);
    expect(heard).toBe(1);
  });
});
