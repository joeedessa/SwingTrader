import type { ComponentChildren } from 'preact';
import { app, load } from '../data/app';
import { useStore } from '../store';
import { useNarrow } from './hooks';
import { IconRefresh } from './icons';

/* The head of a page: its title, a line saying what is on it, and the refresh button. The pages that have a line about
   the data under it (where the prices came from) pass it as children. */

export function Refresh() {
  const s = useStore(app);
  const narrow = useNarrow();
  return (
    <button type="button" class={'btn primary refresh' + (narrow ? ' round' : '')} aria-label="Refresh prices" aria-busy={s.refreshing} disabled={s.refreshing} onClick={() => void load()}>
      <IconRefresh /><span>Refresh</span>
    </button>
  );
}

export function Hero({ title, stamp, children, actions }: {
  title: string;
  stamp: ComponentChildren;
  children?: ComponentChildren;
  /** Buttons at the right; the refresh button is added after them. */
  actions?: ComponentChildren;
}) {
  return (
    <header class="hero">
      <div class="herotext">
        <h1>{title}</h1>
        <p class="stamp">{stamp}</p>
        {children}
      </div>
      <div class="heroactions">{actions}<Refresh /></div>
    </header>
  );
}
