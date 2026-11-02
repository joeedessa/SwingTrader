import { app } from '../data/app';
import type { SetId } from '../data/overlay';
import { fmtDay } from '../engine/format';
import { useStore } from '../store';

/* The line under a page's title: where the prices came from, how current they are, and what is missing. */

const clock = (ms: number) => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const stampOf = (iso: string) => {
  const d = new Date(iso);
  return isNaN(+d) ? '' : d.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};

export function DataLine({ set }: { set: SetId }) {
  const s = useStore(app);
  const syms = new Set(Object.keys(s.hist));
  let closes = '';
  for (const h of Object.values(s.hist)) {
    const d = h.settled.length ? h.settled[h.settled.length - 1][0] : '';
    if (d > closes) closes = d;
  }
  const noPrice = [...new Set(s.shared[set].concat(s.overlays[set].added).map(p => p.sym))].filter(x => !syms.has(x));
  const tone = s.problems.some(p => /did not load/.test(p)) ? 'bad' : s.liveStatus === 'ok' ? 'good' : 'warn';
  const bits: string[] = [];
  if (s.liveStatus === 'loading') bits.push('Checking live prices…');
  else if (s.liveStatus === 'ok' && s.live) bits.push(`Live quotes at ${clock(s.live.at)}`);
  else if (s.liveStatus === 'failed') bits.push('Live quotes unavailable, showing the snapshot');
  if (s.snapshot && s.snapshot.generated_at && s.liveStatus !== 'ok') bits.push('snapshot from ' + stampOf(s.snapshot.generated_at));
  if (closes) bits.push('closes through ' + fmtDay(closes));
  return (
    <>
      <p class="dataline"><span class={'dot ' + tone} aria-hidden="true" />{bits.join(' · ') || 'Loading prices…'}</p>
      {noPrice.length ? <p class="dataline warn">No prices for {noPrice.join(', ')}.</p> : null}
      {s.problems.filter(p => /did not load/.test(p)).map(p => <p class="dataline bad">{p}</p>)}
      {s.saveFailed ? <p class="dataline bad">This browser would not save the last edit, so it will be gone on reload.</p> : null}
    </>
  );
}
