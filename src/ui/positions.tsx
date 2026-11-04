import { useEffect, useMemo, useState } from 'preact/hooks';
import { ackStore } from '../data/acks';
import { app, load } from '../data/app';
import { boardView, flagsOf } from '../data/selectors';
import { logRows } from '../data/tradelog';
import { publishPositions } from '../debug';
import { chipsOf, flagRank, openByRow, rowKeyOf } from '../engine/chips';
import { fmt, fmtD, fmtRatio, MINUS } from '../engine/format';
import { heldMap, pairFills } from '../engine/journal';
import { positionOf, positionsView } from '../engine/positions';
import type { Position } from '../engine/positions';
import type { Row } from '../engine/row';
import { go } from '../router';
import { useStore } from '../store';
import { BoardCards, BoardTable } from './board';
import { DEFAULT_SORT, nextSort, sortRows } from './columns';
import type { Sort } from './columns';
import { DataLine } from './dataline';
import { DrawerHost } from './drawerhost';
import { Hero } from './hero';
import { useCards } from './hooks';
import { ladderColumns, ladderSort } from './positioncells';
import { Tiles } from './tiles';
import type { Tile } from './tiles';

/* Positions: am I still right, and where do I get out? The stop ladder (what is in trade, nearest its stop first), then
   what is stopped out and waiting to come back. The figures are the engine's (positions.ts); this lays them out. */

const LADDER = 'ladder-panel';
const STOPPED = 'stopped-panel';

function SectionHead({ title, count, note }: { title: string; count: number; note: string }) {
  return (
    <div class="sechead">
      <h2>{title}</h2>
      <span class="gcount">{count}</span>
      <span class="secnote">{note}</span>
    </div>
  );
}

/** The sentence under a tile: what it counts, in the words of the data of the day. */
export function nearestTile(p: Position | null, onOpen: (r: Row) => void): Tile {
  if (!p || !p.stop || p.gapPct == null) return { label: 'Nearest stop', value: '–', sub: 'no stop to measure yet' };
  const past = p.gapPct <= 0;
  return {
    label: 'Nearest stop',
    value: p.row.p.sym,
    sub: (past ? 'past the ' : MINUS + fmt(Math.abs(p.gapPct)) + '% from the ') + p.stop.kind + (p.atrs != null && !past ? ' · ' + fmtRatio(p.atrs) + ' ATR' : ''),
    ...(past ? { tone: 'bad' as const } : {}),
    onClick: () => onOpen(p.row),
    action: `${p.row.p.sym} ${p.row.p.dir}: nearest stop, open details`,
  };
}

export function PositionsPage() {
  const s = useStore(app);
  const acks = useStore(ackStore);
  const cards = useCards();
  const ready = s.phase === 'ready';
  const loading = s.phase === 'loading';
  const { bd, today } = boardView(s, 'watchlist');
  const flags = flagsOf(s, 'watchlist');
  const view = useMemo(() => positionsView(bd, s.hist, flags, today), [bd, s.hist, flags, today]);
  const byRow = useMemo(() => new Map(view.ladder.map(p => [p.row, p] as const)), [view]);
  const posOf = (r: Row): Position => byRow.get(r) ?? positionOf(r, s.hist[r.p.sym], today);
  const cols = useMemo(() => ladderColumns(posOf, today), [byRow, today]);
  const open = useMemo(() => openByRow(flags, acks.acks.watchlist, s.hist), [flags, acks.acks.watchlist, s.hist]);
  const chipsFor = (r: Row) => chipsOf(open.get(rowKeyOf(r.p.sym, r.p.dir)) ?? []);

  const [sort, setSort] = useState<Sort>(['stop', true]);
  const [stoppedSort, setStoppedSort] = useState<Sort>(DEFAULT_SORT.stopped);
  const ctx = useMemo(() => ({ flagRank: (r: Row) => flagRank(open.get(rowKeyOf(r.p.sym, r.p.dir))), extra: ladderSort(posOf) }), [open, byRow]);
  const rows = useMemo(() => sortRows(view.ladder.map(p => p.row), cols, sort, ctx), [view, cols, sort, ctx]);
  const stopped = useMemo(() => sortRows(view.stopped, 'stopped', stoppedSort, ctx), [view, stoppedSort, ctx]);

  /* Held: the journal says a fill is open on this name. A mark, never an input to the rules. */
  const held = useMemo(() => heldMap(pairFills(logRows(s.tradelog, s.log)).opens), [s.tradelog, s.log]);
  const heldFor = (r: Row): string | null => {
    const fills = held.get(rowKeyOf(r.p.sym, r.p.dir));
    if (!fills || !fills.length) return null;
    const f = fills[0];
    return 'Open in your journal: ' + (f.side === 'buy' ? 'bought ' : 'sold ') + fmtD(f.date) + ' @ ' + fmt(f.price) + (fills.length > 1 ? ' and ' + (fills.length - 1) + ' more' : '');
  };

  const openRow = (r: Row) => go({ page: 'positions', row: { sym: r.p.sym, dir: r.p.dir } });

  const confirmed = view.ladder.filter(p => p.row.section === 'breakout').length;
  const tiles: Tile[] = [
    { label: 'In trade', value: String(view.tiles.inTrade), sub: `${confirmed} confirmed · ${view.tiles.inTrade - confirmed} back in` },
    { label: 'Stopped out', value: String(view.tiles.stopped), sub: 'waiting for a close back past the trigger' },
    nearestTile(view.tiles.nearest, openRow),
    { label: 'Next 7 days', value: String(view.tiles.events), sub: 'earnings and ex-dividend dates on names in trade' },
  ];

  useEffect(() => { if (ready) publishPositions(view); }, [ready, view]);

  let body;
  if (s.phase === 'error') {
    body = (
      <div class="empty" role="alert">
        <p>{s.error}</p>
        <button type="button" class="btn primary" onClick={() => void load()}>Try again</button>
      </div>
    );
  } else if (loading) {
    body = <div class="empty" aria-busy="true"><p>Loading positions…</p></div>;
  } else {
    body = (
      <>
        <Tiles tiles={tiles} label="Positions at a glance" />

        <SectionHead title="In trade" count={rows.length} note="Confirmed, or back in after an exit. Nearest its stop first." />
        {rows.length ? (
          cards
            ? <BoardCards rows={rows} section="breakout" cols={cols} label="Stop ladder" onOpen={openRow} today={today} panelId={LADDER} chipsFor={chipsFor} heldFor={heldFor} />
            : <BoardTable rows={rows} section="breakout" cols={cols} label="Stop ladder" sort={sort} onSort={k => setSort(o => nextSort(cols, o, k))} onOpen={openRow} today={today} panelId={LADDER} chipsFor={chipsFor} heldFor={heldFor} />
        ) : <div class="empty" id={LADDER}><p>Nothing is in trade right now.</p></div>}

        <SectionHead title="Stopped out" count={stopped.length} note="Out at the last full day. A close back past the trigger re-enters; the negation ends it." />
        {stopped.length ? (
          cards
            ? <BoardCards rows={stopped} section="stopped" onOpen={openRow} today={today} panelId={STOPPED} chipsFor={chipsFor} heldFor={heldFor} />
            : <BoardTable rows={stopped} section="stopped" sort={stoppedSort} onSort={k => setStoppedSort(o => nextSort('stopped', o, k))} onOpen={openRow} today={today} panelId={STOPPED} chipsFor={chipsFor} heldFor={heldFor} />
        ) : <div class="empty" id={STOPPED}><p>None are stopped out and waiting to re-enter.</p></div>}
      </>
    );
  }

  return (
    <>
      <main class="page positions" data-underlay>
        <Hero title="Positions" stamp={loading ? 'Loading…' : <>{view.tiles.inTrade} in trade · {view.tiles.stopped} stopped out<span class="wideonly"> · each price in its own listing currency</span></>}>
          <DataLine set="watchlist" />
        </Hero>
        <div class="panel">{body}</div>
        <footer class="foot">
          <p>The stop is the last full day where one is known and tighter than the pattern, else the negation. R is the move since the entry close over the distance from it to the stop. A "held" mark means your journal has the position open; it is never an input to the rules. Not investment advice.</p>
        </footer>
      </main>
      <DrawerHost set="watchlist" bd={bd} today={today} loading={loading} />
    </>
  );
}
