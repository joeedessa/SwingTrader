import { useEffect, useState } from 'preact/hooks';

/** The smallest store that does the job: one value, a way to patch it, and a way to hear about it. */
export class Store<T> {
  private listeners = new Set<() => void>();
  constructor(private state: T) {}

  get(): T {
    return this.state;
  }

  set(patch: Partial<T> | ((s: T) => Partial<T>)): void {
    this.state = { ...this.state, ...(typeof patch === 'function' ? patch(this.state) : patch) };
    this.listeners.forEach(l => l());
  }

  subscribe(l: () => void): () => void {
    this.listeners.add(l);
    return () => void this.listeners.delete(l);
  }
}

/** Re-render when the store changes. An update that lands between render and subscription is caught on subscribe. */
export function useStore<T>(store: Store<T>): T {
  const [, bump] = useState(0);
  const seen = store.get();
  useEffect(() => {
    if (store.get() !== seen) bump(n => n + 1);
    return store.subscribe(() => bump(n => n + 1));
  }, [store]);
  return seen;
}
