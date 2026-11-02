import { hashFor } from '../router';
import { Hero } from './hero';
import { IconChevron } from './icons';
import { MORE } from './nav';

/* The pages that do not fit the tab bar. On a phone this is the last tab; on a desktop the same pages are under "More"
   in the top bar, and this page is there for anyone who arrives at its address. */

export function MorePage() {
  return (
    <main class="page more" data-underlay>
      <Hero title="More" stamp="The rest of the site." />
      <ul class="morelist">
        {MORE.map(m => (
          <li>
            <a href={hashFor({ page: m.page, row: null })}>
              <span class="moreicon"><m.icon /></span>
              <span class="moretext"><span class="morelabel">{m.label}</span><span class="moreblurb">{m.blurb}</span></span>
              <span class="morechev" aria-hidden="true"><IconChevron /></span>
            </a>
          </li>
        ))}
      </ul>
    </main>
  );
}
