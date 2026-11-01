import { useEffect, useState } from 'preact/hooks';

/** True while a media query matches, and updates when it changes. False where there is no window (tests). */
export function useMedia(query: string): boolean {
  const get = () => typeof matchMedia !== 'undefined' && matchMedia(query).matches;
  const [on, setOn] = useState(get);
  useEffect(() => {
    if (typeof matchMedia === 'undefined') return;
    const m = matchMedia(query);
    const h = () => setOn(matchMedia(query).matches);
    h();
    m.addEventListener('change', h);
    // The change event is the right signal, but a page that was not on screen when the window changed shape (a
    // background tab, a restored page) can miss it; resize and rotation catch what it did not.
    addEventListener('resize', h);
    addEventListener('orientationchange', h);
    return () => { m.removeEventListener('change', h); removeEventListener('resize', h); removeEventListener('orientationchange', h); };
  }, [query]);
  return on;
}

/** The phone layout: narrow, or a phone turned on its side. The same query the style sheet uses. */
export const NARROW_QUERY = '(max-width: 700px), (orientation: landscape) and (max-height: 500px) and (pointer: coarse)';
export const useNarrow = (): boolean => useMedia(NARROW_QUERY);

/** localStorage that never throws: private mode and blocked storage read as empty and write nowhere. */
export const store = {
  get(key: string): string | null {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  set(key: string, value: string): void {
    try { localStorage.setItem(key, value); } catch { /* private mode */ }
  },
};

/** A value remembered per browser. */
export function usePersisted(key: string, fallback: string, valid: (v: string) => boolean): [string, (v: string) => void] {
  const [v, setV] = useState(() => {
    const saved = store.get(key);
    return saved !== null && valid(saved) ? saved : fallback;
  });
  return [v, (next: string) => { setV(next); store.set(key, next); }];
}
