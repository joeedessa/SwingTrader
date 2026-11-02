import { ackStore } from '../data/acks';
import { app } from '../data/app';
import { todayOf } from '../data/selectors';
import type { Page } from '../router';
import { hashFor } from '../router';
import { useStore } from '../store';
import { IconBenchmarks, IconSetups, IconToday } from './icons';

/* The routes that exist today. Each later phase adds its own here; the order is the order on screen. */
export const NAV: { page: Page; label: string; icon: () => preact.JSX.Element; badge?: true }[] = [
  { page: 'today', label: 'Today', icon: IconToday, badge: true },
  { page: 'setups', label: 'Setups', icon: IconSetups },
  { page: 'benchmarks', label: 'Benchmarks', icon: IconBenchmarks },
];

/** The Today tab's number: the live, Act and Watch flags still to look at. It is the same count the page's lists add up
    to, because both come from the one view. */
export function useBadge(): number {
  const s = useStore(app);
  useStore(ackStore);
  return s.phase === 'ready' ? todayOf(s, 'watchlist', null).badge : 0;
}

const shown = (n: number) => (n > 99 ? '99+' : String(n));

function Badge({ n }: { n: number }) {
  return n > 0 ? <span class="navbadge" aria-hidden="true">{shown(n)}</span> : null;
}

const linkLabel = (label: string, n: number) => (n > 0 ? `${label}, ${n} to review` : label);

/** Desktop: the brand and a segmented strip of pages along the top. */
export function TopNav({ page }: { page: Page }) {
  const badge = useBadge();
  return (
    <header class="topnav" data-underlay>
      <a class="brand" href={hashFor({ page: 'today', row: null })}>SwingTrader</a>
      <nav aria-label="Pages">
        {NAV.map(n => (
          <a href={hashFor({ page: n.page, row: null })} aria-current={n.page === page ? 'page' : undefined}
            aria-label={n.badge ? linkLabel(n.label, badge) : undefined}>
            {n.label}{n.badge ? <Badge n={badge} /> : null}
          </a>
        ))}
      </nav>
    </header>
  );
}

/** Phone: an iOS tab bar at the bottom, padded so it clears the home indicator. */
export function TabBar({ page }: { page: Page }) {
  const badge = useBadge();
  return (
    <nav class="tabbar" aria-label="Pages" data-underlay>
      {NAV.map(n => (
        <a href={hashFor({ page: n.page, row: null })} aria-current={n.page === page ? 'page' : undefined}
          aria-label={n.badge ? linkLabel(n.label, badge) : undefined}>
          <n.icon />
          <span>{n.label}</span>
          {n.badge ? <Badge n={badge} /> : null}
        </a>
      ))}
    </nav>
  );
}
