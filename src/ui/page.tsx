import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { ackStore, importAcks } from '../data/acks';
import { app, load, updateLog, updateOverlay } from '../data/app';
import { addSetup, importSetups, SETS } from '../data/overlay';
import type { SetId } from '../data/overlay';
import { boardView, flagsOf } from '../data/selectors';
import { importFills, logRows } from '../data/tradelog';
import { dataInfo, publish } from '../debug';
import { chipsOf, flagRank, openByRow, rowKeyOf } from '../engine/chips';
import type { Row } from '../engine/row';
import { SECTIONS, SECTION_LABELS } from '../engine/types';
import type { Section, Setup } from '../engine/types';
import { go } from '../router';
import { useStore } from '../store';
import { BoardCards, BoardTable } from './board';
import { Choice, Modal, Popover, Segmented } from './components';
import { DEFAULT_SORT, nextSort, sortRows } from './columns';
import type { Sort } from './columns';
import { DataLine } from './dataline';
import { DrawerHost } from './drawerhost';
import { isFiltered, marketsOf, matches, NO_FILTERS } from './filters';
import type { Filters } from './filters';
import { AddSetup } from './forms';
import { useNarrow, usePersisted } from './hooks';
import { IconMore, IconPlus, IconRefresh, IconSearch } from './icons';
import { say } from './notice';

/* One board, two lists: the watchlist and the benchmarks run the same code over different files, each with its
   own saved edits (the benchmarks have no add form or journal, as before). */

const SHORT: Record<Section, string> = {
  watch: 'Watch', breakout: 'Confirmed', reentered: 'Re-in', stopped: 'Out', target: 'Target', failed: 'Failed', removed: 'Removed',
};

const EMPTY: Record<Section, string> = {
  watch: 'Nothing is waiting. Every setup has triggered, failed or been removed.',
  breakout: 'No confirmed breakouts right now.',
  reentered: 'None are back in after a stop-out.',
  stopped: 'None are stopped out and waiting to re-enter.',
  target: 'No setup has reached its target.',
  failed: 'No failed breakouts.',
  removed: 'Nothing has been removed.',
};

export function BoardPage({ set }: { set: SetId }) {
  const s = useStore(app);
  const narrow = useNarrow();
  const meta = SETS[set];
  const [section, setSection] = usePersisted('mc-seg-' + meta.key, 'watch', v => (SECTIONS as readonly string[]).includes(v));
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [sorts, setSorts] = useState<Record<Section, Sort>>({ ...DEFAULT_SORT });
  const [adding, setAdding] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const page = useRef<HTMLElement>(null);
  const acks = useStore(ackStore);
  const { list, bd, today } = boardView(s, set);

  /* The Flags column: each row's open flags, the ones Today lists, read from the same acknowledgements. */
  const flags = flagsOf(s, set);
  const open = useMemo(() => openByRow(flags, acks.acks[set], s.hist), [flags, acks.acks[set], s.hist]);
  const chipsFor = (x: Row) => chipsOf(open.get(rowKeyOf(x.p.sym, x.p.dir)) ?? []);
  const sortCtx = useMemo(() => ({ flagRank: (x: Row) => flagRank(open.get(rowKeyOf(x.p.sym, x.p.dir))) }), [open]);

  const visible = useMemo(() => bd.rows.filter(x => matches(x, filters)), [bd, filters]);
  const shownCounts = useMemo(() => {
    const out = Object.fromEntries(SECTIONS.map(x => [x, 0])) as Record<Section, number>;
    for (const x of visible) out[x.section]++;
    return out;
  }, [visible]);
  const rows = useMemo(() => sortRows(visible.filter(x => x.section === section), section as Section, sorts[section as Section], sortCtx), [visible, section, sorts, sortCtx]);

  // Keep the sticky table head just under the segment bar, whatever height the bar wraps to.
  useEffect(() => {
    const b = bar.current, p = page.current;
    if (!b || !p || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => p.style.setProperty('--bar-h', b.offsetHeight + 'px'));
    ro.observe(b);
    return () => ro.disconnect();
  }, []);

  // The page's own account of itself, for a check in the console.
  useEffect(() => {
    if (s.phase !== 'ready') return;
    publish(set, bd, shownCounts, s.problems, flags, dataInfo(s));
  }, [bd, shownCounts, s.phase, s.problems, s.liveStatus, s.noBars, flags]);

  const sec = section as Section;
  const openRow = (x: Row) => go({ page: set === 'watchlist' ? 'setups' : 'benchmarks', row: { sym: x.p.sym, dir: x.p.dir } });

  /* ---- add, export, import */
  const onAdd = (setup: Setup): string | null => {
    const res = addSetup(s.overlays[set], list, setup);
    if ('error' in res) return res.error;
    updateOverlay(set, () => res.overlay);
    setAdding(false);
    setFilters(NO_FILTERS);
    setSection('watch');
    say(`Added ${setup.sym.toUpperCase()} ${setup.dir}. Fetching its prices…`);
    return null;
  };

  const exportData = () => {
    // The journal goes too, merged (the shared fills with this browser's changes applied): that is the file to commit as
    // tradelog.json. So do the acknowledgements, which are this browser's: the phone and the desktop each keep their own.
    const payload = { watchlist: list, tradelog: logRows(s.tradelog, s.log), acks: ackStore.get().acks.watchlist };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    a.download = 'swingtrader-export.json';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importFile = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const f = input.files && input.files[0];
    if (!f) return;
    try {
      const data = JSON.parse(await f.text()) as unknown;
      const items = Array.isArray(data) ? data : (data && Array.isArray((data as { watchlist?: unknown }).watchlist) ? (data as { watchlist: unknown[] }).watchlist : null);
      if (!items) throw new Error('not a list of setups');
      const res = importSetups(s.overlays[set], list, items);
      updateOverlay(set, () => res.overlay);
      const extra = Array.isArray(data) ? {} : (data as { acks?: unknown; tradelog?: unknown });
      const newAcks = extra.acks === undefined ? 0 : importAcks('watchlist', extra.acks);
      const fills = Array.isArray(extra.tradelog) ? importFills(s.log, s.tradelog, extra.tradelog) : null;
      if (fills && fills.added) updateLog(() => fills.overlay);
      const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
      const more = [fills && fills.added ? plural(fills.added, 'fill', 'fills') : '', newAcks ? plural(newAcks, 'acknowledgement', 'acknowledgements') : ''].filter(Boolean);
      say(`Imported ${plural(res.added, 'new setup', 'new setups')} (${res.skipped} already present or invalid)` + (more.length ? ' and ' + more.join(' and ') : '') + '.',
        res.added || more.length ? 'ok' : 'warn');
    } catch (err) {
      say('Could not import: ' + (err as Error).message, 'warn');
    }
    input.value = '';
  };

  /* ---- what the panel shows */
  const panelId = 'board-panel';
  const loading = s.phase === 'loading';
  const total = list.length;
  const syms = new Set(list.map(p => p.sym)).size;
  const markets = useMemo(() => marketsOf(bd.rows), [bd]);

  let body;
  if (s.phase === 'error') {
    body = (
      <div class="empty" role="alert">
        <p>{s.error}</p>
        <button type="button" class="btn primary" onClick={() => void load()}>Try again</button>
      </div>
    );
  } else if (loading) {
    body = <div class="empty" aria-busy="true"><p>Loading setups…</p></div>;
  } else if (!rows.length) {
    body = (
      <div class="empty" id={panelId}>
        <p>{isFiltered(filters) ? 'No matches in ' + SECTION_LABELS[sec] + '.' : EMPTY[sec]}</p>
        {isFiltered(filters) ? <button type="button" class="btn" onClick={() => setFilters(NO_FILTERS)}>Clear search and filters</button> : null}
      </div>
    );
  } else if (narrow) {
    body = <BoardCards rows={rows} section={sec} onOpen={openRow} today={today} panelId={panelId} chipsFor={chipsFor} />;
  } else {
    body = <BoardTable rows={rows} section={sec} sort={sorts[sec]} onSort={k => setSorts(o => ({ ...o, [sec]: nextSort(sec, o[sec], k) }))} onOpen={openRow} today={today} panelId={panelId} chipsFor={chipsFor} />;
  }

  return (
    <>
      <main class="page" ref={page} data-underlay>
        <header class="hero">
          <div class="herotext">
            <h1>{meta.title}</h1>
            <p class="stamp">
              {loading ? 'Loading…' : <>{total} {set === 'watchlist' ? 'setups' : 'benchmarks'} · {syms} symbols<span class="wideonly"> · each price in its own listing currency</span></>}
            </p>
            <DataLine set={set} />
          </div>
          <div class="heroactions">
            {meta.extras && !narrow ? (
              <>
                <button type="button" class="btn" onClick={() => setAdding(true)}>Add setup</button>
                <button type="button" class="btn" onClick={exportData}>Export</button>
                <button type="button" class="btn" onClick={() => file.current?.click()}>Import</button>
              </>
            ) : null}
            {meta.extras && narrow ? (
              <>
                <button type="button" class="btn round" aria-label="Add setup" onClick={() => setAdding(true)}><IconPlus /></button>
                <Popover label="More" icon={<IconMore />} round align="right">
                  <button type="button" class="menuitem" data-closes onClick={exportData}>Export setups, journal and acknowledgements</button>
                  <button type="button" class="menuitem" data-closes onClick={() => file.current?.click()}>Import a list or an export</button>
                </Popover>
              </>
            ) : null}
            <button type="button" class={'btn primary refresh' + (narrow ? ' round' : '')} aria-label="Refresh prices" aria-busy={s.refreshing} disabled={s.refreshing} onClick={() => void load()}>
              <IconRefresh /><span>Refresh</span>
            </button>
            <input ref={file} type="file" accept="application/json,.json" hidden onChange={importFile} />
          </div>
        </header>

        <div class="segbar" ref={bar}>
          <Segmented label="Section" panelId={panelId} value={section} onChange={setSection}
            items={SECTIONS.map(x => ({ id: x, label: SECTION_LABELS[x], short: SHORT[x], ...(loading ? {} : { count: shownCounts[x] }) }))} />
          <div class="tools">
            <label class="search">
              <IconSearch />
              <input type="search" placeholder="Search" aria-label="Search by symbol or name" autocomplete="off" spellcheck={false}
                value={filters.q} onInput={e => setFilters(f => ({ ...f, q: (e.target as HTMLInputElement).value }))} />
            </label>
            <Choice label="Direction" value={filters.dir} onChange={dir => setFilters(f => ({ ...f, dir }))}
              items={[{ id: 'all', label: 'All' }, { id: 'long', label: 'Long' }, { id: 'short', label: 'Short' }]} />
            {markets.length > 1 ? (
              <Popover label="Market" badge={filters.markets.length || undefined} align="right" sheet>
                <div class="marketlist">
                  {markets.map(m => (
                    <label class="opt">
                      <input type="checkbox" checked={filters.markets.includes(m.name)}
                        onChange={e => setFilters(f => ({ ...f, markets: (e.target as HTMLInputElement).checked ? [...f.markets, m.name] : f.markets.filter(x => x !== m.name) }))} />
                      <span>{m.name}</span><span class="n">{m.n}</span>
                    </label>
                  ))}
                </div>
                {filters.markets.length ? <button type="button" class="linkbtn clear" onClick={() => setFilters(f => ({ ...f, markets: [] }))}>Clear</button> : null}
              </Popover>
            ) : null}
          </div>
        </div>

        <div class="panel" role="tabpanel" aria-label={SECTION_LABELS[sec]}>{body}</div>

        <footer class="foot">
          <p>Levels come from Tech Charts. A breakout is the first settled close past the trigger; a negation is an intraday touch after it. Edits here are kept in this browser only. Not investment advice.</p>
        </footer>
      </main>

      {adding ? (
        <Modal id="add" title="Add setup" variant="dialog" onClose={() => setAdding(false)}>
          <AddSetup onAdd={onAdd} onCancel={() => setAdding(false)} />
        </Modal>
      ) : null}

      <DrawerHost set={set} bd={bd} today={today} loading={loading} />
    </>
  );
}
