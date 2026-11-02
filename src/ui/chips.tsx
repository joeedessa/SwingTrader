import type { Chip } from '../engine/chips';
import { chipText } from './flagview';
import { IconCalendar } from './icons';

/* The chips of a row's Flags column. A dot carries the tier (and a name for assistive tech, since colour alone is not
   an answer); the words are the flag's own. */

const DOT_NAME = { act: 'Needs a decision', watch: 'Worth a look' } as const;

export function Chips({ chips, today }: { chips: readonly Chip[]; today: string }) {
  if (!chips.length) return null;
  return (
    <ul class="fchips" aria-label="Flags">
      {chips.map(c => {
        const t = chipText(c, today);
        return (
          <li class={'fchip ' + c.kind} title={t.title}>
            {c.kind === 'calendar'
              ? <span class="ficon" role="img" aria-label="Coming up"><IconCalendar /></span>
              : <span class={'fdot ' + c.kind} role="img" aria-label={DOT_NAME[c.kind]} />}
            <span class="ftext">{t.text}</span>
          </li>
        );
      })}
    </ul>
  );
}
