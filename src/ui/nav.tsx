import { ackStore } from '../data/acks';
import { app } from '../data/app';
import { todayOf } from '../data/selectors';
import type { Page } from '../router';
import { hashFor } from '../router';
import { useStore } from '../store';
import { Popover } from './components';
import { IconBenchmarks, IconHistory, IconMethod, IconMore, IconPositions, IconSetups, IconSignals, IconToday } from './icons';

/* The routes that exist today. Each later phase adds its own here; the order is the order on screen. The first group is
   the tab bar (the plan's five, with Model still to come); the rest are under "More", a menu on a desktop and a page on a phone. */

export interface NavItem {
  page: Page;
  label: string;
  icon: () => preact.JSX.Element;
  badge?: true;
  /** One line for the More page. */
  blurb?: string;
}

export const NAV: NavItem[] = [
  { page: 'today', label: 'Today', icon: IconToday, badge: true },
  { page: 'setups', label: 'Setups', icon: IconSetups },
  { page: 'positions', label: 'Positions', icon: IconPositions },
  { page: 'history', label: 'History', icon: IconHistory },
];

export const MORE: NavItem[] = [
  { page: 'signals', label: 'Signals', icon: IconSignals, blurb: 'Moving averages, crosses of them, and the day against the index and sector.' },
  { page: 'benchmarks', label: 'Benchmarks', icon: IconBenchmarks, blurb: 'The same board for the benchmark list.' },
  { page: 'method', label: 'Method', icon: IconMethod, blurb: 'The rules, where the data comes from, and how fresh it is.' },
];

/** More is current on its own page and on any page that lives under it. */
export const inMore = (page: Page): boolean => page === 'more' || MORE.some(m => m.page === page);

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
        <Popover label="More" align="right" triggerClass="navmore" current={inMore(page)}>
          {MORE.map(m => (
            <a class="menuitem" href={hashFor({ page: m.page, row: null })} data-closes aria-current={m.page === page ? 'page' : undefined}>{m.label}</a>
          ))}
        </Popover>
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
      <a href={hashFor({ page: 'more', row: null })} aria-current={inMore(page) ? 'page' : undefined}>
        <IconMore />
        <span>More</span>
      </a>
    </nav>
  );
}
