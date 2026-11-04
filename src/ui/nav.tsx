import { ackStore } from '../data/acks';
import { app } from '../data/app';
import { todayOf } from '../data/selectors';
import type { Page } from '../router';
import { hashFor } from '../router';
import { useStore } from '../store';
import { Popover } from './components';
import { IconBenchmarks, IconHistory, IconMethod, IconModel, IconMore, IconPositions, IconSetups, IconSignals, IconToday } from './icons';

/* The routes, in the order they are on screen. The first group is the top bar's tabs (the plan's five); a phone's tab bar
   has room for four of them and More, so the fifth, Model, sits under More there. The rest are under "More" everywhere:
   a menu on a desktop and a page on a phone. */

export interface NavItem {
  page: Page;
  label: string;
  icon: () => preact.JSX.Element;
  badge?: true;
  /** One line for the More page. */
  blurb?: string;
  /** Not in a phone's tab bar: the page is under More there. */
  tabbar?: false;
}

export const NAV: NavItem[] = [
  { page: 'today', label: 'Today', icon: IconToday, badge: true, blurb: 'What needs a decision this morning, and what changed since you last looked.' },
  { page: 'setups', label: 'Setups', icon: IconSetups, blurb: 'Where every setup stands: the board, one section at a time.' },
  { page: 'positions', label: 'Positions', icon: IconPositions, blurb: 'Am I still right, and where do I get out: the stop ladder.' },
  { page: 'history', label: 'History', icon: IconHistory, blurb: 'What happened, what the record looks like, and the journal.' },
  { page: 'model', label: 'Model', icon: IconModel, blurb: 'What to play and how much: the strategies run over your own breakouts.', tabbar: false },
];

export const MORE: NavItem[] = [
  { page: 'signals', label: 'Signals', icon: IconSignals, blurb: 'Moving averages, crosses of them, and the day against the index and sector.' },
  { page: 'benchmarks', label: 'Benchmarks', icon: IconBenchmarks, blurb: 'The same board for the benchmark list.' },
  { page: 'method', label: 'Method', icon: IconMethod, blurb: 'The rules, where the data comes from, and how fresh it is.' },
];

/** The tab bar's pages, and what a phone lists under More: the pages it has no tab for, then the rest. */
export const TAB_PAGES: NavItem[] = NAV.filter(n => n.tabbar !== false);
export const MORE_ON_PHONE: NavItem[] = [...NAV.filter(n => n.tabbar === false), ...MORE];

/** On a desktop, More is current on its own page and on the pages in its menu. */
export const inMoreMenu = (page: Page): boolean => page === 'more' || MORE.some(m => m.page === page);

/** On a phone, More is current on its own page and on any page that lives under it there. */
export const inMore = (page: Page): boolean => page === 'more' || MORE_ON_PHONE.some(m => m.page === page);

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
        <Popover label="More" align="right" triggerClass="navmore" current={inMoreMenu(page)}>
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
      {TAB_PAGES.map(n => (
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
