import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { app, load, updateOverlay } from '../data/app';
import {
  addSetup, applyLevelEdit, clearManual, deleteAdded, importSetups, resetField, saveEdit, SETS, workingList,
} from '../data/overlay';
import type { LevelChanges, SetId } from '../data/overlay';
import { logRows, readLogOverlay } from '../data/tradelog';
import type { Fill } from '../data/tradelog';
import { loadJson } from '../data/load';
import { publish } from '../debug';
import { board, isoToday } from '../engine/row';
import type { Row } from '../engine/row';
import { SECTIONS, SECTION_LABELS } from '../engine/types';
import type { Section, Setup } from '../engine/types';
import { closeRow, go, route } from '../router';
import { useStore } from '../store';
import { BoardCards, BoardTable } from './board';
import { Choice, Modal, Popover, Segmented } from './components';
import { DEFAULT_SORT, nextSort, sortRows } from './columns';
import type { Sort } from './columns';
import { SetupDrawer, DrawerHeading } from './drawer';
import type { Action } from './drawer';
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

const dayName = (iso: string) =>
  new Date(iso + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const clock = (ms: number) => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const stampOf = (iso: string) => {
  const d = new Date(iso);
  return isNaN(+d) ? '' : d.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};

function DataLine({ set }: { set: SetId }) {
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
  if (closes) bits.push('closes through ' + dayName(closes));
  return (
    <>
      <p class="dataline"><span class={'dot ' + tone} aria-hidden="true" />{bits.join(' · ') || 'Loading prices…'}</p>
      {noPrice.length ? <p class="dataline warn">No prices for {noPrice.join(', ')}.</p> : null}
      {s.problems.filter(p => /did not load/.test(p)).map(p => <p class="dataline bad">{p}</p>)}
      {s.saveFailed ? <p class="dataline bad">This browser would not save the last edit, so it will be gone on reload.</p> : null}
    </>
  );
}

export function BoardPage({ set }: { set: SetId }) {
  const s = useStore(app);
  const r = useStore(route);
  const narrow = useNarrow();
  const meta = SETS[set];
  const [section, setSection] = usePersisted('mc-seg-' + meta.key, 'watch', v => (SECTIONS as readonly string[]).includes(v));
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [sorts, setSorts] = useState<Record<Section, Sort>>({ ...DEFAULT_SORT });
  const [adding, setAdding] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const page = useRef<HTMLElement>(null);
  const today = isoToday(new Date(s.now));

  const list = useMemo(() => workingList(s.shared[set], s.overlays[set]), [s.shared, s.overlays, set]);
  const bd = useMemo(() => board(list, s.hist, s.barsFile?.bars ?? {}, s.events, today), [list, s.hist, s.barsFile, s.events, today]);

  const visible = useMemo(() => bd.rows.filter(x => matches(x, filters)), [bd, filters]);
  const shownCounts = useMemo(() => {
    const out = Object.fromEntries(SECTIONS.map(x => [x, 0])) as Record<Section, number>;
    for (const x of visible) out[x.section]++;
    return out;
  }, [visible]);
  const rows = useMemo(() => sortRows(visible.filter(x => x.section === section), section as Section, sorts[section as Section]), [visible, section, sorts]);

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
    publish(set, bd, shownCounts, s.problems, {
      snapshot: s.snapshot ? s.snapshot.generated_at : null,
      bars: s.barsFile ? s.barsFile.generated_at : null,
      live: s.liveStatus,
      symbols: Object.keys(s.hist).length,
      withoutBars: s.noBars,
    });
  }, [bd, shownCounts, s.phase, s.problems, s.liveStatus, s.noBars]);

  const sec = section as Section;
  const open = (x: Row) => go({ page: set === 'watchlist' ? 'setups' : 'benchmarks', row: { sym: x.p.sym, dir: x.p.dir } });
  const sharedRows = s.shared[set];
  const openRow = r.row ? bd.rows.find(x => x.p.sym === r.row!.sym && x.p.dir === r.row!.dir) ?? null : null;
  const sharedRow = openRow ? sharedRows.find(x => x.sym === openRow.p.sym && x.dir === openRow.p.dir) ?? null : null;

  /* ---- actions on the open setup */
  const act = (x: Row, a: Action) => {
    const p = x.p as Setup & { shared: boolean };
    const label = `${p.sym} ${p.dir}`;
    if (a === 'breakout') { updateOverlay(set, ov => saveEdit(ov, p, { manualState: 'breakout', confirmed: today })); say(`${label} moved to Confirmed.`); }
    else if (a === 'remove') { updateOverlay(set, ov => saveEdit(ov, p, { manualState: 'removed' })); say(`${label} removed. Restore brings it back.`); }
    else if (a === 'fail') { updateOverlay(set, ov => saveEdit(ov, p, { manualState: 'failed' })); say(`${label} moved to Failed. Restore undoes it.`); }
    else if (a === 'restore' || a === 'undo') { updateOverlay(set, ov => clearManual(ov, p)); say(`${label} restored.`); }
    else if (a === 'delete') { updateOverlay(set, ov => deleteAdded(ov, p)); closeRow(); say(`${label} deleted.`); }
  };

  const onEdit = (x: Row, changes: LevelChanges) => {
    if (!Object.keys(changes).length) { say('Nothing changed.'); return; }
    const p = x.p as Setup & { shared: boolean };
    updateOverlay(set, ov => applyLevelEdit(ov, sharedRow, p, changes));
    say('Levels saved in this browser. The shared list is unchanged.');
  };

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

  const exportData = async () => {
    let shared: Fill[] = [];
    try { shared = await loadJson<Fill[]>('tradelog.json'); } catch { /* the journal is optional */ }
    let ls: Storage | null = null;
    try { ls = localStorage; } catch { /* private mode */ }
    const payload = { watchlist: list, tradelog: logRows(shared, readLogOverlay(ls)) };
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
      say(`Imported ${res.added} new ${res.added === 1 ? 'setup' : 'setups'} (${res.skipped} already present or invalid).`, res.added ? 'ok' : 'warn');
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
    body = <BoardCards rows={rows} section={sec} onOpen={open} today={today} panelId={panelId} />;
  } else {
    body = <BoardTable rows={rows} section={sec} sort={sorts[sec]} onSort={k => setSorts(o => ({ ...o, [sec]: nextSort(sec, o[sec], k) }))} onOpen={open} today={today} panelId={panelId} />;
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
                <button type="button" class="btn" onClick={() => void exportData()}>Export</button>
                <button type="button" class="btn" onClick={() => file.current?.click()}>Import</button>
              </>
            ) : null}
            {meta.extras && narrow ? (
              <>
                <button type="button" class="btn round" aria-label="Add setup" onClick={() => setAdding(true)}><IconPlus /></button>
                <Popover label="More" icon={<IconMore />} round align="right">
                  <button type="button" class="menuitem" data-closes onClick={() => void exportData()}>Export setups and journal</button>
                  <button type="button" class="menuitem" data-closes onClick={() => file.current?.click()}>Import setups</button>
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

      {r.row ? (
        <Modal id="drawer" title={`${r.row.sym} ${r.row.dir}`} variant="side" onClose={closeRow} heading={openRow ? <DrawerHeading r={openRow} /> : undefined}>
          {openRow ? (
            <SetupDrawer key={openRow.p.sym + openRow.p.dir} r={openRow} sharedRow={sharedRow} overlay={s.overlays[set]} showExDiv={meta.extras} today={today} canAct
              onEdit={c => onEdit(openRow, c)} onResetField={f => updateOverlay(set, ov => resetField(ov, openRow.p, f as never))} onAction={a => act(openRow, a)} />
          ) : loading ? <p class="note">Loading…</p> : (
            <div class="empty"><p>{r.row.sym} {r.row.dir} is not on this list.</p><button type="button" class="btn" onClick={closeRow}>Back to the board</button></div>
          )}
        </Modal>
      ) : null}
    </>
  );
}
