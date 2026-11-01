import type { Page } from '../router';
import { hashFor } from '../router';
import { IconBenchmarks, IconSetups } from './icons';

/* The routes that exist today. Each later phase adds its own here; the order is the order on screen. */
export const NAV: { page: Page; label: string; icon: () => preact.JSX.Element }[] = [
  { page: 'setups', label: 'Setups', icon: IconSetups },
  { page: 'benchmarks', label: 'Benchmarks', icon: IconBenchmarks },
];

/** Desktop: the brand and a segmented strip of pages along the top. */
export function TopNav({ page }: { page: Page }) {
  return (
    <header class="topnav" data-underlay>
      <a class="brand" href={hashFor({ page: 'setups', row: null })}>SwingTrader</a>
      <nav aria-label="Pages">
        {NAV.map(n => (
          <a href={hashFor({ page: n.page, row: null })} aria-current={n.page === page ? 'page' : undefined}>{n.label}</a>
        ))}
      </nav>
    </header>
  );
}

/** Phone: an iOS tab bar at the bottom, padded so it clears the home indicator. */
export function TabBar({ page }: { page: Page }) {
  return (
    <nav class="tabbar" aria-label="Pages" data-underlay>
      {NAV.map(n => (
        <a href={hashFor({ page: n.page, row: null })} aria-current={n.page === page ? 'page' : undefined}>
          <n.icon />
          <span>{n.label}</span>
        </a>
      ))}
    </nav>
  );
}
