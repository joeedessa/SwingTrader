import type { AppState } from '../data/app';
import { logRows } from '../data/tradelog';
import { workingList } from '../data/overlay';
import { THRESHOLDS } from '../engine/flags';
import { ageText, fmtDay } from '../engine/format';

/* The freshness table on the Method page: for each thing the site reads, when it was written, how old that is, and what
   is in it. Every number is counted from what is loaded; nothing here knows how long a list is. */

export interface DataRow {
  name: string;
  /** What it feeds. */
  what: string;
  /** When it was written, as the file says. */
  at: string | null;
  /** "12 minutes ago", or nothing for a thing with no timestamp. */
  age: string;
  detail: string;
  tone: 'good' | 'warn' | 'bad';
}

const ageOf = (iso: string | null | undefined, now: number): { age: string; ms: number | null } => {
  const t = iso ? Date.parse(iso) : NaN;
  return isFinite(t) ? { age: ageText(now - t), ms: now - t } : { age: '', ms: null };
};

const plural = (n: number, one: string, many: string) => n + ' ' + (n === 1 ? one : many);

/** The newest day any symbol has a bar for. */
function newestBar(bars: NonNullable<AppState['barsFile']>['bars']): string {
  let max = '';
  for (const days of Object.values(bars)) for (const d in days) if (d > max) max = d;
  return max;
}

export function dataRows(s: AppState, now: number): DataRow[] {
  const rows: DataRow[] = [];

  const bars = s.barsFile;
  const barSyms = bars ? Object.keys(bars.bars).length : 0;
  const newest = bars ? newestBar(bars.bars) : '';
  rows.push({
    name: 'Daily bars', what: 'Every rule: breakouts, touches, stops, types. Settled days only.',
    at: bars && bars.generated_at ? bars.generated_at : null, age: ageOf(bars && bars.generated_at, now).age,
    detail: bars ? plural(barSyms, 'symbol', 'symbols') + (newest ? ', the newest day ' + fmtDay(newest) : '') + '.' : 'Not loaded.',
    tone: bars ? 'good' : 'bad',
  });

  const snap = s.snapshot;
  const snapAge = ageOf(snap && snap.generated_at, now);
  const stale = snapAge.ms != null && snapAge.ms > THRESHOLDS.staleTipHours * 36e5;
  rows.push({
    name: 'Latest prices', what: 'The price on every row, until a live quote replaces it.',
    at: snap && snap.generated_at ? snap.generated_at : null, age: snapAge.age,
    detail: snap ? plural(Object.keys(snap.latest).length, 'symbol', 'symbols') + (stale ? ', older than ' + THRESHOLDS.staleTipHours + ' hours' : '') + '.' : 'Not loaded.',
    tone: !snap ? 'bad' : stale ? 'warn' : 'good',
  });

  rows.push({
    name: 'Live quotes', what: 'Live flags, and the live price while a session is open.',
    at: s.live ? new Date(s.live.at).toISOString() : null, age: s.live ? ageText(now - s.live.at) : '',
    detail: s.liveStatus === 'ok' ? 'Answered through the Worker.'
      : s.liveStatus === 'loading' ? 'Asking now.'
      : s.liveStatus === 'failed' ? 'Did not answer: the page shows the latest prices above, and says so.'
      : 'Not asked yet.',
    tone: s.liveStatus === 'ok' ? 'good' : s.liveStatus === 'failed' ? 'warn' : 'good',
  });

  const ev = ageOf(s.eventsAt, now);
  rows.push({
    name: 'Earnings and dividends', what: 'Calendar flags, the earnings card, the ATR behind the trailing stop and the near-stop rule.',
    at: s.eventsAt, age: ev.age,
    detail: plural(Object.keys(s.events).length, 'symbol', 'symbols') + '.',
    tone: s.eventsAt ? 'good' : 'warn',
  });

  const list = workingList(s.shared.watchlist, s.overlays.watchlist);
  const bench = workingList(s.shared.benchmarks, s.overlays.benchmarks);
  const mine = list.filter(p => !p.shared).length;
  rows.push({
    name: 'Setups', what: 'The levels, from Tech Charts. Edits made here stay in this browser.',
    at: null, age: '',
    detail: `${plural(list.length, 'setup', 'setups')} and ${plural(bench.length, 'benchmark', 'benchmarks')}` + (mine ? `, ${mine} of them added in this browser` : '') + '.',
    tone: list.length ? 'good' : 'bad',
  });

  rows.push({
    name: 'Journal', what: 'The fills you logged. Kept apart from the setups.',
    at: null, age: '', detail: plural(logRows(s.tradelog, s.log).length, 'fill', 'fills') + '.', tone: 'good',
  });
  return rows;
}
