import { timelineOf } from '../engine/chips';
import type { TimelineItem } from '../engine/chips';
import { earningsView, hasEarningsCard } from '../engine/earnings';
import type { EarningsView } from '../engine/earnings';
import type { Acks, Flag } from '../engine/flags';
import type { Row } from '../engine/row';
import type { History } from '../engine/types';
import { averageLine, averagesOf } from './mareads';
import type { AverageLine } from './mareads';

/* What a setup's drawer reads beyond the row itself: its flags, the daily moving averages, and the earnings card. One pure
   function of the data, so the host only has to hand it over and a test can check what a drawer would say. */

export interface DrawerData {
  /** Every flag the row has raised, newest first, each open, acknowledged or past. */
  timeline: TimelineItem[];
  /** Null when the feed has nothing to say about the name. */
  earnings: EarningsView | null;
  /** The daily 150 and 200. */
  averages: AverageLine[];
}

export function drawerDataOf(r: Row, hist: Record<string, History | undefined>, flags: readonly Flag[], acks: Acks): DrawerData {
  const h = hist[r.p.sym];
  const mine = flags.filter(f => f.sym === r.p.sym && f.dir === r.p.dir);
  const card = earningsView(r.ev, { live: r.live, target: r.p.target, next: r.earnings, hist: h });
  return {
    timeline: timelineOf(mine, acks, hist),
    earnings: hasEarningsCard(card) ? card : null,
    averages: averagesOf(h ? h.settled.map(x => x[1]) : null).map(averageLine),
  };
}
