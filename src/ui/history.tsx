import { useEffect, useMemo, useState } from 'preact/hooks';
import { app, load } from '../data/app';
import { boardView } from '../data/selectors';
import { logRows } from '../data/tradelog';
import { publishHistory } from '../debug';
import { outcomesOf } from '../engine/outcomes';
import type { Outcomes, OutcomeTag } from '../engine/outcomes';
import type { Row } from '../engine/row';
import { SECTION_LABELS } from '../engine/types';
import type { Section } from '../engine/types';
import { go } from '../router';
import { useStore } from '../store';
import { BoardCards, BoardTable } from './board';
import { Segmented } from './components';
import { DEFAULT_SORT, nextSort, sortRows } from './columns';
import type { Sort } from './columns';
import { DataLine } from './dataline';
import { DrawerHost } from './drawerhost';
import { Hero } from './hero';
import { useNarrow, usePersisted } from './hooks';
import { JournalPanel, openFillForm } from './journal';
import { Tiles } from './tiles';
import type { Tile } from './tiles';

/* History: what happened, and what the record looks like. Outcome tiles by the type a setup ended as, then the setups
   that reached their target, failed, or were removed (the same tables as Setups), then the trade journal. */

type Tab = 'target' | 'failed' | 'removed' | 'journal';
const TABS: readonly Tab[] = ['target', 'failed', 'removed', 'journal'];
const SHORT: Record<Tab, string> = { target: 'Target', failed: 'Failed', removed: 'Removed', journal: 'Journal' };
const LABEL: Record<Tab, string> = { target: 'At target', failed: 'Failed', removed: 'Removed', journal: 'Journal' };

const EMPTY: Record<'target' | 'failed' | 'removed', string> = {
  target: 'No setup has reached its target.',
  failed: 'No failed breakouts.',
  removed: 'Nothing has been removed.',
};

const TYPE_LABEL: Record<OutcomeTag, string> = { B1: 'B1 · no pullback', B2: 'B2 · pulled back', B3: 'B3 · took the stop', B4: 'B4 · failed' };
const TYPE_TITLE: Record<OutcomeTag, string> = {
  B1: 'Reached the target without a pullback through the trigger.',
  B2: 'Reached the target after pulling back through the trigger, the last full day holding.',
  B3: 'Reached the target after taking out its last full day and coming back in.',
  B4: 'The negation was touched.',
};

const days = (n: number | null) => {
  if (n == null) return '';
  const d = Math.round(n);
  return 'median ' + d + (d === 1 ? ' day' : ' days');
};

/** What the tiles do and do not count, in the numbers of the day. */
export function tileNote(o: Outcomes): string {
  const parts = ['Settled closes, resolved setups only: those that reached the target or had the negation touched.'];
  if (o.open) {
    parts.push(`The ${o.open} still in play are not in these numbers${o.byHand ? `, nor are the ${o.byHand} you moved to Failed by hand` : ''}.`);
  } else if (o.byHand) {
    parts.push(`The ${o.byHand} you moved to Failed by hand are not in these numbers.`);
  }
  if (o.untyped) parts.push(`${o.untyped} that reached the target without daily bars have no type.`);
  parts.push('The list began with setups already confirmed, so read it as a record, not a forecast.');
  return parts.join(' ');
}

/** The outcome tiles, in the words of the day's data: a hit rate, then one tile for each type a setup can end as. */
export function outcomeTiles(o: Outcomes): Tile[] {
  const tiles: Tile[] = [{
    label: 'Hit rate',
    value: o.hitRate == null ? '–' : o.hitRate + '%',
    sub: o.resolved ? `${o.reached} of ${o.resolved} resolved reached the target · ${o.open} still open` : o.open ? `nothing has resolved yet · ${o.open} still open` : 'nothing has resolved yet',
    title: 'Setups that reached their target, out of those that reached it or had the negation touched, on settled closes. Setups still in play are not counted.',
  }];
  for (const t of o.byType) {
    tiles.push({
      label: TYPE_LABEL[t.tag], value: String(t.count), title: TYPE_TITLE[t.tag],
      sub: t.count ? days(t.medianDays) + (t.tag === 'B4' ? ' to failure' : ' to target') : 'none yet',
    });
  }
  return tiles;
}

export function HistoryPage() {
  const s = useStore(app);
  const narrow = useNarrow();
  const ready = s.phase === 'ready';
  const loading = s.phase === 'loading';
  const { bd, today } = boardView(s, 'watchlist');
  const [tab, setTab] = usePersisted('mc-seg-history', 'target', v => (TABS as readonly string[]).includes(v));
  const [sorts, setSorts] = useState<Record<'target' | 'failed' | 'removed', Sort>>({ target: DEFAULT_SORT.target, failed: DEFAULT_SORT.failed, removed: DEFAULT_SORT.removed });
  const outcomes = useMemo(() => outcomesOf(bd.rows), [bd]);
  const fills = useMemo(() => logRows(s.tradelog, s.log).length, [s.tradelog, s.log]);
  const t = tab as Tab;

  useEffect(() => { if (ready) publishHistory(outcomes, bd.counts, fills); }, [ready, outcomes, bd, fills]);

  const openRow = (r: Row) => go({ page: 'history', row: { sym: r.p.sym, dir: r.p.dir } });
  const panel = 'history-panel';

  let body;
  if (s.phase === 'error') {
    body = (
      <div class="empty" role="alert">
        <p>{s.error}</p>
        <button type="button" class="btn primary" onClick={() => void load()}>Try again</button>
      </div>
    );
  } else if (loading) {
    body = <div class="empty" aria-busy="true"><p>Loading history…</p></div>;
  } else if (t === 'journal') {
    body = <JournalPanel narrow={narrow} />;
  } else {
    const section: Section = t;
    const rows = sortRows(bd.bySection[section], section, sorts[t]);
    body = rows.length ? (
      narrow
        ? <BoardCards rows={rows} section={section} onOpen={openRow} today={today} panelId={panel} />
        : <BoardTable rows={rows} section={section} sort={sorts[t]} onSort={k => setSorts(o => ({ ...o, [t]: nextSort(section, o[t], k) }))} onOpen={openRow} today={today} panelId={panel} />
    ) : <div class="empty" id={panel}><p>{EMPTY[t]}</p></div>;
  }

  return (
    <>
      <main class="page history" data-underlay>
        <Hero title="History"
          stamp={loading ? 'Loading…' : <>{outcomes.resolved} resolved · {outcomes.open} still open<span class="wideonly"> · each price in its own listing currency</span></>}
          actions={narrow ? undefined : <button type="button" class="btn" onClick={() => openFillForm()}>Log a fill</button>}>
          <DataLine set="watchlist" />
        </Hero>

        {ready ? (
          <>
            <Tiles tiles={outcomeTiles(outcomes)} label="Outcomes by the type a setup ended as" />
            <p class="tilenote">{tileNote(outcomes)}</p>
          </>
        ) : null}

        <div class="segbar">
          <Segmented label="History" panelId={panel} value={t} onChange={setTab}
            items={TABS.map(x => ({
              id: x, label: LABEL[x], short: SHORT[x],
              ...(ready ? { count: x === 'journal' ? fills : bd.counts[x] } : {}),
            }))} />
        </div>

        <div class="panel" role="tabpanel" aria-label={t === 'journal' ? 'Journal' : SECTION_LABELS[t]}>{body}</div>

        <footer class="foot">
          <p>Outcomes are read from settled closes: a target is a close at or past it, a failure is a touch of the negation. The journal is your own record of fills, kept in this browser and kept apart from the setups: logging a buy never moves one. P&L is in each instrument's own currency, price-based, with no sizes. Not investment advice.</p>
        </footer>
      </main>
      <DrawerHost set="watchlist" bd={bd} today={today} loading={loading} />
    </>
  );
}
