import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import { app, load, loadSeries } from '../data/app';
import { boardView } from '../data/selectors';
import { publishSignals } from '../debug';
import { fmt, signedPct } from '../engine/format';
import { TIERS, TIMEFRAMES, TF_WORDS } from '../engine/ma';
import type { Timeframe } from '../engine/ma';
import type { Row } from '../engine/row';
import { closeSource, isLive, ladderOf, relatives, scanOf, scanRows, SCAN_SCOPES, structureEvents } from '../engine/signals';
import type { MaColumn, Relative, Scan, ScanScope, StructureEvent } from '../engine/signals';
import { SECTION_LABELS } from '../engine/types';
import { go } from '../router';
import { useStore } from '../store';
import { BoardCards, BoardTable, CellView } from './board';
import { Choice, Segmented } from './components';
import { nextSort, sortRows } from './columns';
import type { Sort } from './columns';
import { DataLine } from './dataline';
import { DataTable } from './datatable';
import type { DCol } from './datatable';
import { DrawerHost } from './drawerhost';
import { Hero } from './hero';
import { useMedia, useNarrow, usePersisted } from './hooks';
import { agoWords, averageColumns, averageSort, changeText, crossAgo, forSetup, scanEmpty, scanNote, SCOPE_LABEL, signalTiles } from './signalcells';
import type { SlowBars } from './signalcells';
import { Tiles } from './tiles';

/* Signals: which setups are changing structure on their moving averages? Three views of the same closes. The fresh changes of
   sides on a 150 or 200, ranked monthly first. The cross scan, bullish and bearish, quickest tier to slowest. And every
   setup's averages on a timeframe, with the day against its index and its sector. The figures are the engine's (ma.ts and
   signals.ts, the old site's); this lays them out. */

type Tab = 'changes' | 'scan' | 'averages';
const TABS: readonly Tab[] = ['changes', 'scan', 'averages'];
const LABEL: Record<Tab, string> = { changes: 'Level changes', scan: 'Cross scan', averages: 'Averages' };
const SHORT: Record<Tab, string> = { changes: 'Changes', scan: 'Scan', averages: 'Averages' };
const PANEL = 'signals-panel';

const stampOf = (iso: string) => {
  const d = new Date(iso);
  return isNaN(+d) ? '' : d.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};

const DirPill = ({ dir }: { dir: 'long' | 'short' }) => <span class={'dirpill ' + dir}>{dir}</span>;

/** A setup in a list: its symbol, which opens its drawer, its direction and where it stands. */
function SetupLink({ row, onOpen }: { row: Row; onOpen: (r: Row) => void }) {
  return (
    <span class="setuplink">
      <button type="button" class="symbtn" onClick={() => onOpen(row)} aria-label={`${row.p.sym} ${row.p.dir}: open details`}>{row.p.sym}</button>
      <DirPill dir={row.p.dir} />
      <span class={'sectag st-' + row.section}>{SECTION_LABELS[row.section]}</span>
    </span>
  );
}

/** The switch between the three timeframes, which the scan and the averages share. */
function TimeframeChoice({ tf, setTf }: { tf: Timeframe; setTf: (t: Timeframe) => void }) {
  return (
    <div class="sigctl">
      <span class="siglabel">Timeframe</span>
      <Choice label="Timeframe" value={tf} onChange={setTf} items={TIMEFRAMES.map(t => ({ id: t, label: TF_WORDS[t].label }))} />
    </div>
  );
}

/* ------------------------------------------------------------------ level changes */

export function ChangesPanel({ events, onOpen, narrow, waiting }: { events: readonly StructureEvent[]; onOpen: (r: Row) => void; narrow: boolean; waiting: string | null }) {
  const cols: DCol<StructureEvent>[] = [
    { key: 'setup', label: 'Setup', text: true, cell: e => <SetupLink row={e.row} onOpen={onOpen} /> },
    { key: 'change', label: 'Change', text: true, cell: e => changeText(e) },
    { key: 'when', label: 'When', text: true, cell: e => agoWords(e.ago, e.tf) },
    {
      key: 'close', label: 'Close against it',
      cell: e => <CellView cell={{ value: (e.dist >= 0 ? '▲ ' : '▼ ') + signedPct(e.dist), tone: e.dist >= 0 ? 'good' : 'bad', sub: 'the average is at ' + fmt(e.ma) + (e.row.currency ? ' ' + e.row.currency : '') }} />,
    },
    { key: 'for', label: 'For this setup', text: true, cell: e => { const f = forSetup(e); return <span class={'tone-' + f.tone}>{f.text}</span>; } },
  ];
  return (
    <>
      <div class="sechead">
        <h2>Level changes</h2>
        <span class="gcount">{events.length}</span>
        <span class="secnote">A close that has just changed sides on a 150 or 200 and is still near it. Monthly first, then weekly, then daily; the 200 before the 150.</span>
      </div>
      {waiting ? <p class="signote">{waiting}</p> : null}
      {events.length
        ? <DataTable rows={events} cols={cols} label="Fresh changes of sides on a 150 or 200" id={PANEL} narrow={narrow} rowKey={e => `${e.row.p.sym}|${e.row.p.dir}|${e.tf}|${e.period}`} />
        : <div class="empty" id={PANEL}><p>Nothing has just changed sides on a 150 or 200 and stayed near it.</p></div>}
    </>
  );
}

/* ------------------------------------------------------------------ the cross scan */

export function ScanPanel({ scan, tf, setTf, scope, setScope, counts, onOpen, waiting }: {
  scan: Scan; tf: Timeframe; setTf: (t: Timeframe) => void; scope: ScanScope; setScope: (s: ScanScope) => void;
  counts: Record<ScanScope, number>; onOpen: (r: Row) => void; waiting: string | null;
}) {
  const empty = waiting ? null : scanEmpty(scan);
  const note = waiting ?? scanNote(scan);
  return (
    <>
      <div class="sigcontrols">
        <TimeframeChoice tf={tf} setTf={setTf} />
        <div class="sigctl">
          <span class="siglabel">Scan</span>
          <Choice label="Which setups" value={scope} onChange={setScope} items={SCAN_SCOPES.map(sc => ({ id: sc, label: `${SCOPE_LABEL[sc]} (${counts[sc]})` }))} />
        </div>
      </div>
      {note ? <p class="signote">{note}</p> : null}
      <div id={PANEL}>
        {empty ? <div class="empty"><p>{empty}</p></div> : waiting ? null : [true, false].map(bullish => (
          <section class={'sigblock ' + (bullish ? 'bull' : 'bear')} aria-label={bullish ? 'Bullish crosses' : 'Bearish crosses'}>
            <h2>
              <span class="sigarrow" aria-hidden="true">{bullish ? '▲' : '▼'}</span>
              {bullish ? 'Bullish crosses' : 'Bearish crosses'}
              <span class="sigladder">quickest and noisiest first → slowest and most reliable last</span>
            </h2>
            <div class="sigcols">
              {TIERS.map(t => {
                const mine = scan.hits.filter(h => h.bullish === bullish && h.key === t.key).sort((a, b) => a.ago - b.ago);
                return (
                  <div class="sigcol" key={t.key}>
                    <p class="tierhead">{t.label}</p>
                    <p class="tiersub">{t.sub}</p>
                    {mine.length ? (
                      <ul class="sigitems">
                        {mine.map(h => (
                          <li class="sigitem" key={h.row.p.sym + h.ago}>
                            <span class="signame">
                              <button type="button" class="symbtn" onClick={() => onOpen(h.row)} aria-label={`${h.row.p.sym}: open details`}>{h.row.p.sym}</button>
                              {h.whip ? <span class="whiptag" title="The sign flipped back again later in the window: a cross that was given back">whipsawed</span> : null}
                            </span>
                            <span class="sighint">{h.row.p.note ? h.row.p.note + ' · ' : ''}{crossAgo(h, tf)}</span>
                          </li>
                        ))}
                      </ul>
                    ) : <p class="signone">none</p>}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ the averages */

/** Below this width the ten columns do not fit and the page would scroll sideways, so the averages are cards, as on a phone. */
const TABLE_MIN = '(max-width: 1100px)';

export function AveragesPanel({ rows, tf, setTf, ladder, rel, narrow, onOpen, today, waiting }: {
  rows: Row[]; tf: Timeframe; setTf: (t: Timeframe) => void; ladder: (r: Row) => MaColumn[]; rel: (r: Row) => Relative;
  narrow: boolean; onOpen: (r: Row) => void; today: string; waiting: string | null;
}) {
  const cards = useMedia(TABLE_MIN) || narrow;
  const [chosen, setSort] = useState<Sort>(['sym', true]);
  const cols = useMemo(() => averageColumns(tf, ladder, rel), [tf, ladder, rel]);
  const ctx = useMemo(() => ({ extra: averageSort(tf, ladder, rel) }), [tf, ladder, rel]);
  // A column the last sort was on may not exist on this timeframe: read it as the symbol (and the choice comes back with the column).
  const sort: Sort = chosen[0] === 'sym' || chosen[0] === 'live' || cols.some(c => c.key === chosen[0]) ? chosen : ['sym', true];
  const sorted = useMemo(() => sortRows(rows, cols, sort, ctx), [rows, cols, sort[0], sort[1], ctx]);
  return (
    <>
      <div class="sigcontrols"><TimeframeChoice tf={tf} setTf={setTf} /></div>
      <p class="signote">
        {waiting ?? 'A simple average of closes. ▲ means the close is above it and ▼ below, and the number is how far. On the lines a chartist trades off, the cell also says whether the average was tested lately (held, rejected, reclaimed, lost) and which way it is heading.'}
      </p>
      {waiting ? <div class="empty" id={PANEL}><p>{waiting}</p></div>
        : sorted.length
          ? (cards
            ? <BoardCards rows={sorted} section="breakout" cols={cols} label="Moving averages" onOpen={onOpen} today={today} panelId={PANEL} />
            : <BoardTable rows={sorted} section="breakout" cols={cols} label="Moving averages" sort={sort} onSort={k => setSort(nextSort(cols, sort, k))} onOpen={onOpen} today={today} panelId={PANEL} />)
          : <div class="empty" id={PANEL}><p>No setup is in play.</p></div>}
    </>
  );
}

/* ------------------------------------------------------------------ the page */

export function SignalsPage() {
  const s = useStore(app);
  const narrow = useNarrow();
  const ready = s.phase === 'ready';
  const loading = s.phase === 'loading';
  const { bd, today } = boardView(s, 'watchlist');

  // The weekly and monthly closes are 1.7 MB and only this page reads them: ask when it opens.
  useEffect(() => { void loadSeries(); }, []);

  const [tab, setTab] = usePersisted('mc-seg-signals', 'changes', v => (TABS as readonly string[]).includes(v));
  const [tf, setTf] = usePersisted('mc-seg-signals-tf', 'daily', v => (TIMEFRAMES as readonly string[]).includes(v));
  const [scope, setScope] = usePersisted('mc-seg-signals-scope', 'watch', v => (SCAN_SCOPES as readonly string[]).includes(v));
  const t = tab as Tab;
  const timeframe = tf as Timeframe;
  const sc = scope as ScanScope;

  const vals = useMemo(() => closeSource(s.hist, s.series), [s.hist, s.series]);
  const live = useMemo(() => bd.rows.filter(isLive), [bd]);
  const events = useMemo(() => structureEvents(bd.rows, vals), [bd, vals]);
  const rels = useMemo(() => relatives(bd.rows, s.hist), [bd, s.hist]);
  const rel = useCallback((r: Row): Relative => rels.get(r) as Relative, [rels]);
  const scopeRows = useMemo(() => Object.fromEntries(SCAN_SCOPES.map(x => [x, scanRows(bd.rows, x, s.hist)])) as Record<ScanScope, Row[]>, [bd, s.hist]);
  const all = useMemo(() => Object.fromEntries(TIMEFRAMES.map(x => [x, scanOf(scopeRows.all, x, vals)])) as Record<Timeframe, Scan>, [scopeRows, vals]);
  const scan = useMemo(() => (sc === 'all' ? all[timeframe] : scanOf(scopeRows[sc], timeframe, vals)), [sc, timeframe, all, scopeRows, vals]);
  const counts = useMemo(() => Object.fromEntries(SCAN_SCOPES.map(x => [x, scopeRows[x].length])) as Record<ScanScope, number>, [scopeRows]);
  const ladders = useMemo(() => new Map(live.map(r => [r, ladderOf(vals(r.p.sym, timeframe), timeframe)] as const)), [live, vals, timeframe]);
  const ladder = useCallback((r: Row): MaColumn[] => ladders.get(r) ?? ladderOf(null, timeframe), [ladders, timeframe]);

  const slow: SlowBars = s.series ? 'ready' : s.seriesStatus === 'failed' ? 'failed' : 'loading';
  const seriesWait = slow === 'failed' ? 'The weekly and monthly bars did not load, so only the daily timeframe is shown.'
    : slow === 'loading' ? 'Loading the weekly and monthly bars…' : null;
  // What a view says while the slower timeframes are not here: the daily one does not wait for them.
  const waitingFor = (tfs: readonly Timeframe[]): string | null => (seriesWait && tfs.some(x => x !== 'daily') ? seriesWait : null);

  useEffect(() => {
    if (!ready) return;
    publishSignals({
      rows: live.length,
      series: s.series ? { generatedAt: s.series.generated_at, weekly: Object.keys(s.series.weekly).length, monthly: Object.keys(s.series.monthly).length } : null,
      seriesStatus: s.seriesStatus, events, scan, scope: sc, all,
      relative: live.map(r => { const x = rels.get(r) as Relative; return { sym: r.p.sym, dir: r.p.dir, vsIndex: x.vsIndex, vsSector: x.vsSector, index: x.index, peers: x.peers }; }),
    });
  }, [ready, live, s.series, s.seriesStatus, events, scan, sc, all, rels]);

  const openRow = (r: Row) => go({ page: 'signals', row: { sym: r.p.sym, dir: r.p.dir } });
  const tiles = signalTiles(events, all, {
    changes: () => setTab('changes'),
    scan: x => { setTab('scan'); setTf(x); setScope('all'); },
  }, slow);

  let body;
  if (s.phase === 'error') {
    body = (
      <div class="empty" role="alert">
        <p>{s.error}</p>
        <button type="button" class="btn primary" onClick={() => void load()}>Try again</button>
      </div>
    );
  } else if (loading) {
    body = <div class="empty" aria-busy="true"><p>Loading signals…</p></div>;
  } else if (t === 'changes') {
    body = <ChangesPanel events={events} onOpen={openRow} narrow={narrow} waiting={waitingFor(['weekly'])} />;
  } else if (t === 'scan') {
    body = <ScanPanel scan={scan} tf={timeframe} setTf={setTf} scope={sc} setScope={setScope} counts={counts} onOpen={openRow} waiting={waitingFor([timeframe])} />;
  } else {
    body = <AveragesPanel rows={live} tf={timeframe} setTf={setTf} ladder={ladder} rel={rel} narrow={narrow} onOpen={openRow} today={today} waiting={waitingFor([timeframe])} />;
  }

  return (
    <>
      <main class="page signals" data-underlay>
        <Hero title="Signals" stamp={loading ? 'Loading…' : <>{live.length} in play · averages, crosses and the day against the market<span class="wideonly"> · each price in its own listing currency</span></>}>
          <DataLine set="watchlist" />
          {s.series && s.series.generated_at ? <p class="dataline"><span class="dot good" aria-hidden="true" />Weekly and monthly bars from {stampOf(s.series.generated_at)}, refreshed about daily</p> : null}
          {s.seriesStatus === 'failed' ? <p class="dataline warn">The weekly and monthly bars did not load. <button type="button" class="linkbtn" onClick={() => void loadSeries(true)}>Try again</button></p> : null}
          {s.seriesProblems.length ? <p class="dataline warn">{s.seriesProblems.length === 1 ? '1 problem' : `${s.seriesProblems.length} problems`} in the weekly and monthly file: what could not be read is left out (see Method).</p> : null}
        </Hero>

        {ready ? <Tiles tiles={tiles} label="Signals at a glance" /> : null}

        <div class="segbar">
          <Segmented label="Signals" panelId={PANEL} value={t} onChange={setTab}
            items={TABS.map(x => ({ id: x, label: LABEL[x], short: SHORT[x], ...(ready && x === 'changes' ? { count: events.length } : ready && x === 'averages' ? { count: live.length } : {}) }))} />
        </div>

        <div class="panel" role="tabpanel" aria-label={LABEL[t]}>{body}</div>

        <footer class="foot">
          <p>Averages are simple and read on closes only: the feed carries no intraday high or low here, so a wick through a line that closed back on the other side reads as held. The cross ladder uses exponential averages for its 5 and 21. Each daily figure is the latest settled close; the weekly and monthly bars are refreshed about once a day, and their last bar is the week or month in progress as of then. Failed and removed setups are left out. Not investment advice.</p>
        </footer>
      </main>
      <DrawerHost set="watchlist" bd={bd} today={today} loading={loading} />
    </>
  );
}

