import { useEffect, useMemo } from 'preact/hooks';
import { app, load } from '../data/app';
import { boardView } from '../data/selectors';
import { publishModelPage } from '../debug';
import { runModel } from '../engine/backtest/model';
import type { StrategyRun } from '../engine/backtest/model';
import { moneyStatsOf } from '../engine/backtest/stats';
import type { MoneyStats } from '../engine/backtest/stats';
import { LIST_BEGAN, SIZINGS, STRATEGY_IDS } from '../engine/backtest/settings';
import type { ModelSettings, SizingId, StrategyId } from '../engine/backtest/settings';
import type { Leg } from '../engine/backtest/simulate';
import { fmtD } from '../engine/format';
import { go, route, setQuery } from '../router';
import { useStore } from '../store';
import { CellView } from './board';
import { LineChart } from './charts';
import { Choice } from './components';
import { DataLine } from './dataline';
import { DataTable } from './datatable';
import type { DCol } from './datatable';
import { DrawerHost } from './drawerhost';
import { Hero } from './hero';
import { useCards, useNarrow } from './hooks';
import { caveatText, DIAL_WORDS, exclusionLines, fxWords, gridRows, legsInScope, modelTiles, moneyWords, ratioRows, reasonLine, SCOPE_NOTE, SIZING_LABEL, SORT_LABEL, sortTrades, STRATEGY_LABEL, STRATEGY_SHORT, strategyWords, tradeCells, typeRows } from './modelcells';
import { cleanLabel, DEFAULT_VIEW, engineSettings, modelQuery, parseModelQuery, PCT_MAX, readNumber, TRADE_SORTS, UNITS_MAX } from './modelurl';
import type { ModelView, Scope, TradeSort } from './modelurl';
import { say } from './notice';
import { Tiles } from './tiles';

/* Model: what should I play, and how much per trade? (plan B, phase 8). The engine (src/engine/backtest) runs every
   strategy over every setup that broke out; this page chooses one strategy and one sizing to look at, keeps every dial
   in the address so a scenario is a link, and lays out the tiles, the equity line, the trade list, the ratio question,
   the sensitivity grid and the caveats, each number with its unit. */

const PANEL = 'model-panel';

interface TradeRow { leg: Leg; size: number }

/** One dial: a label, a short switch, and a line of help on hover. */
function Dial<T extends string>({ label, hint, value, items, onChange }: {
  label: string; hint: string; value: T; items: { id: T; label: string }[]; onChange: (id: T) => void;
}) {
  return (
    <div class="dial" title={hint}>
      <span class="diallabel">{label}</span>
      <Choice label={label} value={value} onChange={onChange} items={items} />
    </div>
  );
}

/** A number the model runs on, committed when the field is left or Enter is pressed. An empty field, a word, a negative
    number or one over the cap is put back to what it was: nothing but a number from zero to the cap reaches the engine. */
function NumberField({ label, value, unit, step, max, onCommit }: { label: string; value: number; unit: string; step: string; max: number; onCommit: (v: number) => void }) {
  const commit = (e: Event) => {
    const el = e.currentTarget as HTMLInputElement;
    const v = readNumber(el.value, max);
    if (v == null) { el.value = String(value); return; }
    if (v !== value) onCommit(v);
  };
  return (
    <label class="numfield">
      <span class="diallabel">{label}</span>
      <span class="numwrap">
        <input type="number" inputMode="decimal" min="0" max={String(max)} step={step} value={String(value)} onChange={commit} aria-label={label} />
        <span class="numunit">{unit}</span>
      </span>
    </label>
  );
}

function Controls({ view, onView, onSettings }: { view: ModelView; onView: (p: Partial<ModelView>) => void; onSettings: (p: Partial<ModelSettings>) => void }) {
  const s = view.settings;
  return (
    <section class="modelctl" aria-label="Settings">
      <div class="dials">
        <Dial label="Strategy" hint={strategyWords(view.strategy)} value={view.strategy} onChange={v => onView({ strategy: v })}
          items={STRATEGY_IDS.map(id => ({ id, label: STRATEGY_SHORT[id] }))} />
        <Dial label="Sizing" hint={DIAL_WORDS.sizing} value={view.sizing} onChange={v => onView({ sizing: v })}
          items={SIZINGS.map(id => ({ id, label: SIZING_LABEL[id] }))} />
        <Dial<Scope> label="Count" hint="What the lines, the trade list and the types count: every leg, the open ones marked at the latest settled close, or the closed trades only. The tiles show both." value={view.scope} onChange={v => onView({ scope: v })}
          items={[{ id: 'all', label: 'All legs' }, { id: 'closed', label: 'Closed only' }]} />
      </div>
      <p class="dialwords">{strategyWords(view.strategy)}</p>
      <div class="dials">
        <Dial label="Entry" hint={DIAL_WORDS.entry} value={s.entry} onChange={v => onSettings({ entry: v })}
          items={[{ id: 'open', label: 'Next open' }, { id: 'close', label: 'Confirming close' }, { id: 'trigger', label: 'At the trigger' }]} />
        <Dial label="Imported" hint={DIAL_WORDS.importedEntry} value={s.importedEntry} onChange={v => onSettings({ importedEntry: v })}
          items={[{ id: 'report', label: 'From the report' }, { id: 'close', label: 'Confirming close' }]} />
        <Dial label="Target" hint={DIAL_WORDS.targetOn} value={s.targetOn} onChange={v => onSettings({ targetOn: v })}
          items={[{ id: 'close', label: 'On a close' }, { id: 'touch', label: 'On a touch' }]} />
        <Dial label="Re-entry stop" hint={DIAL_WORDS.reentryStop} value={s.reentryStop} onChange={v => onSettings({ reentryStop: v })}
          items={[{ id: 'original', label: 'Original' }, { id: 'new', label: 'New' }]} />
        <Dial label="Removed" hint={DIAL_WORDS.removed} value={s.removed} onChange={v => onSettings({ removed: v })}
          items={[{ id: 'include', label: 'Close on removal' }, { id: 'exclude', label: 'Leave out' }]} />
        <Dial label="From" hint={DIAL_WORDS.from} value={s.from ? 'list' : 'all'} onChange={v => onSettings({ from: v === 'list' ? 'list' : null })}
          items={[{ id: 'all', label: 'All breakouts' }, { id: 'list', label: `From ${fmtD(LIST_BEGAN)}` }]} />
      </div>
      <div class="dials numbers">
        <NumberField label="Commission" unit="% a side" step="0.05" max={PCT_MAX} value={s.commissionPct} onCommit={v => onSettings({ commissionPct: v })} />
        <NumberField label="Slippage" unit="% a side" step="0.05" max={PCT_MAX} value={s.slippagePct} onCommit={v => onSettings({ slippagePct: v })} />
        <NumberField label="Per entry" unit={view.label} step="1000" max={UNITS_MAX} value={s.size} onCommit={v => onSettings({ size: v })} />
        <NumberField label="At risk per entry" unit={view.label} step="100" max={UNITS_MAX} value={s.riskUnits} onCommit={v => onSettings({ riskUnits: v })} />
        <NumberField label="Risk-based cap" unit={view.label} step="1000" max={UNITS_MAX} value={s.maxSize} onCommit={v => onSettings({ maxSize: v })} />
        <label class="numfield">
          <span class="diallabel">Currency label</span>
          <span class="numwrap">
            <input type="text" maxLength={12} value={view.label} aria-label="Account currency label" onChange={e => onView({ label: cleanLabel((e.currentTarget as HTMLInputElement).value) })} />
          </span>
        </label>
      </div>
    </section>
  );
}

function TradeList({ run, legs, sizes, view, narrow, onOpen, onSort }: { run: StrategyRun; legs: Leg[]; sizes: number[]; view: ModelView; narrow: boolean; onOpen: (l: Leg) => void; onSort: (s: TradeSort) => void }) {
  const rows = useMemo(() => sortTrades(legs, sizes, view.sort), [legs, sizes, view.sort]);
  const label = view.label;
  const st = view.scope === 'closed' ? run.stats.closed : run.stats.all;
  const cols: DCol<TradeRow>[] = [
    {
      key: 'setup', label: 'Setup', text: true,
      cell: t => (
        <span class="setuplink">
          <button type="button" class="symbtn" onClick={() => onOpen(t.leg)} aria-label={`${t.leg.sym} ${t.leg.dir}: open details`}>{t.leg.sym}</button>
          <span class={'dirpill ' + t.leg.dir}>{t.leg.dir}</span>
          {t.leg.n > 1 ? <span class="retag">re-entry {t.leg.n - 1}</span> : null}
        </span>
      ),
    },
    { key: 'entry', label: 'Entry', cell: t => <CellView cell={tradeCells(t.leg, t.size, label).entry} /> },
    { key: 'exit', label: 'Exit', cell: t => <CellView cell={tradeCells(t.leg, t.size, label).exit} /> },
    { key: 'ret', label: 'Return', cell: t => <CellView cell={tradeCells(t.leg, t.size, label).ret} /> },
    { key: 'r', label: 'R', cell: t => <CellView cell={tradeCells(t.leg, t.size, label).r} /> },
    { key: 'days', label: 'Days', cell: t => <CellView cell={tradeCells(t.leg, t.size, label).days} /> },
    { key: 'type', label: 'Type', cell: t => <CellView cell={tradeCells(t.leg, t.size, label).type} /> },
    { key: 'stop', label: 'Stop', cell: t => <CellView cell={tradeCells(t.leg, t.size, label).stop} /> },
    { key: 'size', label: 'Size', cell: t => <CellView cell={tradeCells(t.leg, t.size, label).size} /> },
  ];
  return (
    <>
      <div class="sechead">
        <h2>Trades</h2>
        <span class="gcount">{rows.length}</span>
        <span class="secnote">{reasonLine(st) || 'none'}</span>
        <div class="dial sortdial">
          <span class="diallabel">Order</span>
          <Choice label="Order" value={view.sort} onChange={onSort} items={TRADE_SORTS.map(id => ({ id, label: SORT_LABEL[id] }))} />
        </div>
      </div>
      {rows.length
        ? <DataTable rows={rows} cols={cols} label="Every leg under this strategy" id={PANEL} narrow={narrow} rowKey={t => t.leg.key + '#' + t.leg.n} />
        : <div class="empty" id={PANEL}><p>No trade under these settings.</p></div>}
    </>
  );
}

export function ModelPage() {
  const s = useStore(app);
  const r = useStore(route);
  const narrow = useNarrow();
  const cards = useCards();
  const ready = s.phase === 'ready';
  const loading = s.phase === 'loading';
  const { bd, today } = boardView(s, 'watchlist');
  const view = useMemo(() => parseModelQuery(r.query), [r.query]);
  const settings = useMemo(() => engineSettings(view, LIST_BEGAN), [view]);
  const key = JSON.stringify(settings);
  const bars = s.barsFile ? s.barsFile.bars : undefined;
  // The engine runs again only when a dial it reads moves, or the data does: picking a strategy or a sizing to look at is a lookup.
  const result = useMemo(() => (ready ? runModel({ rows: bd.rows, hist: s.hist, bars: bars ?? {} }, settings) : null), [ready, bd, s.hist, bars, key]);
  const run = result ? result.runs[view.strategy] : null;
  // The closed legs alone, with their money: one column of every tile, and what the view counts under the closed scope.
  const closed = useMemo(() => (run ? legsInScope(run, view.sizing, 'closed') : { legs: [] as Leg[], sizes: [] as number[] }), [run, view.sizing]);
  const closedMoney: MoneyStats | null = useMemo(() => (run ? moneyStatsOf(closed.legs, closed.sizes) : null), [run, closed]);
  const scoped = run && view.scope === 'all' ? { legs: run.legs, sizes: run.sizes[view.sizing] } : closed;
  const moneyInScope: MoneyStats | null = run ? (view.scope === 'all' ? run.money[view.sizing] : closedMoney) : null;

  const onView = (patch: Partial<ModelView>) => setQuery(modelQuery({ ...view, ...patch }));
  const onSettings = (patch: Partial<ModelSettings>) => setQuery(modelQuery({ ...view, settings: { ...view.settings, ...patch } }));
  const openRow = (l: Leg) => go({ page: 'model', row: { sym: l.sym, dir: l.dir }, ...(r.query ? { query: r.query } : {}) });
  const tiles = run && closedMoney ? modelTiles(run, view.sizing, view.label, { all: run.money[view.sizing], closed: closedMoney }) : [];

  useEffect(() => {
    if (result && run) publishModelPage({ view, settings, result, run, tiles: Object.fromEntries(tiles.map(t => [t.label, t.cols ? t.cols.map(c => `${c.head} ${c.value}`).join(' · ') : t.value])), query: modelQuery(view) });
  }, [result, run, view]);

  const copyLink = () => {
    const url = location.href;
    if (typeof navigator !== 'undefined' && navigator.clipboard) navigator.clipboard.writeText(url).then(() => say('Link copied: it opens this scenario.'), () => say('Could not copy the link; the address bar has it.', 'warn'));
    else say('The address bar has the link to this scenario.');
  };

  let body;
  if (s.phase === 'error') {
    body = (
      <div class="empty" role="alert">
        <p>{s.error}</p>
        <button type="button" class="btn primary" onClick={() => void load()}>Try again</button>
      </div>
    );
  } else if (loading || !result || !run || !moneyInScope) {
    body = <div class="empty" aria-busy="true"><p>Loading the model…</p></div>;
  } else {
    const m = moneyInScope;
    const equity = m.curve.equity;
    let peak = 0;
    const drawdown = equity.map(v => { if (v > peak) peak = v; return v - peak; });
    const types = typeRows(view.scope === 'closed' ? run.stats.closed : run.stats.all);
    const ratios = ratioRows(result);
    const grid = gridRows(result, view.label);
    const left = exclusionLines(result, run);
    body = (
      <>
        <Tiles tiles={tiles} label={`${STRATEGY_LABEL[view.strategy]} under ${SIZING_LABEL[view.sizing].toLowerCase()} sizing`} />
        <p class="tilenote">{STRATEGY_LABEL[view.strategy]}, {SIZING_LABEL[view.sizing].toLowerCase()} sizing, every leg beside the closed trades alone. {SCOPE_NOTE} Returns are in % of the position after both sides' costs ({(2 * (settings.commissionPct + settings.slippagePct)).toFixed(2)}% a round trip); R is the return over the risk taken; money is in {view.label}. The lines, the list and the types below count {view.scope === 'closed' ? 'closed trades only' : 'every leg, the open ones marked at the latest settled close'}.</p>

        <div class="charts">
          <LineChart dates={m.curve.dates} values={equity} kind="equity" label="Equity" unit={view.label} />
          <LineChart dates={m.curve.dates} values={drawdown} kind="drawdown" label="Drawdown" unit={view.label} />
        </div>
        <p class="tilenote">{moneyWords(m, view.label)}</p>

        <TradeList run={run} legs={scoped.legs} sizes={scoped.sizes} view={view} narrow={cards} onOpen={openRow} onSort={v => onView({ sort: v })} />

        <div class="sechead"><h2>By type</h2><span class="secnote">the type the setup had at its first outcome; B4 is a negation</span></div>
        {types.length ? (
          <table class="board small" aria-label="Results by the type the setup ended with">
            <thead><tr><th scope="col" class="text">Type</th><th scope="col">Legs</th><th scope="col">Setups</th><th scope="col">Win rate</th><th scope="col">Expectancy</th><th scope="col">Sum</th></tr></thead>
            <tbody>{types.map(t => <tr key={t.tag}><td class="text">{t.tag}</td><td>{t.legs}</td><td>{t.setups}</td><td>{t.winRate}</td><td>{t.expectancy}</td><td>{t.sum}</td></tr>)}</tbody>
          </table>
        ) : <div class="empty"><p>No trade to break down.</p></div>}

        <div class="sechead"><h2>The ratio question</h2><span class="secnote">how much to put on an S0 or an S2 entry against an S1 entry, as a ratio of the amounts</span></div>
        <table class="board small ratios" aria-label="S0 and S2 against S1, three ways">
          <thead><tr><th scope="col" class="text">Strategy</th><th scope="col">Equal risk per setup</th><th scope="col">Equal max drawdown</th><th scope="col">Equal capital in use</th><th scope="col" class="text">Behind the numbers</th></tr></thead>
          <tbody>{ratios.map(x => <tr key={x.id}><td class="text">{x.label}</td><td>{x.equalRisk}</td><td>{x.equalDrawdown}</td><td>{x.equalCapital}</td><td class="text sub">{x.behind}</td></tr>)}</tbody>
        </table>
        <p class="tilenote">Equal risk is the one that follows from the rules: the median, over setups, of the total risk S1 makes you take (entry to stop, every leg added up) over the same under S0 or S2. The other two scale the strategy's flat amount until its deepest drawdown, or its peak capital in use, equals S1's. Per-strategy sizing applies the equal-risk ratio.</p>

        <div class="sechead"><h2>Sensitivity</h2><span class="secnote">every strategy under every sizing, over every leg: the size-weighted return, the deepest drawdown and, for S0 and S2, the equal-risk ratio against S1; press a cell to look at it</span></div>
        <table class="board small grid" aria-label="Strategy by sizing">
          <thead><tr><th scope="col" class="text">Strategy</th>{SIZINGS.map(sz => <th scope="col" key={sz}>{SIZING_LABEL[sz]}</th>)}</tr></thead>
          <tbody>
            {grid.map(row => (
              <tr key={row.id}>
                <td class="text">{row.label}</td>
                {row.cells.map(c => (
                  <td key={c.sizing}>
                    <button type="button" class="gcell" aria-pressed={c.strategy === view.strategy && c.sizing === view.sizing}
                      aria-label={`${STRATEGY_LABEL[c.strategy]}, ${SIZING_LABEL[c.sizing]}: ${c.text}, drawdown ${c.dd}${c.ratio != null ? `, ratio ${c.ratio.toFixed(2)} to S1` : ''}`}
                      onClick={() => onView({ strategy: c.strategy as StrategyId, sizing: c.sizing as SizingId })}>
                      <span class={'gv' + (c.weightedPct != null && c.weightedPct < 0 ? ' tone-bad' : c.weightedPct != null && c.weightedPct > 0 ? ' tone-good' : '')}>{c.text}</span>
                      <span class="gs">{c.dd}{c.ratio != null ? ` · ratio ${c.ratio.toFixed(2)}` : ''}</span>
                    </button>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>

        <section class="prose caveats" aria-labelledby="m-caveats">
          <h2 id="m-caveats">Caveats</h2>
          <p>{caveatText(result.caveats, result.universe, !!settings.from)}</p>
          <p>{fxWords(view.label)}</p>
          <p>No hindsight: every strategy is a rule you could have followed on the day, and the final type only breaks the results down. {DIAL_WORDS.importedEntry}</p>
          {left.length ? (
            <details class="ruledetails" open={narrow ? undefined : true}>
              <summary>Left out, and why</summary>
              {left.map(g => (
                <div class="leftout" key={g.heading}>
                  <h3>{g.heading} <span class="gcount">{g.items.length}</span></h3>
                  <ul class="gaplist">{g.items.map(e => <li key={e.key}><b>{e.sym}</b> {e.dir}: {e.reason}</li>)}</ul>
                </div>
              ))}
            </details>
          ) : null}
        </section>
      </>
    );
  }

  return (
    <>
      <main class="page model" data-underlay>
        <Hero title="Model"
          stamp={s.phase === 'error' ? 'Not loaded.' : loading || !result ? 'Loading…' : <>{result.universe.breakouts} breakouts · {result.universe.candidates.length} setups in the trade list · {STRATEGY_LABEL[view.strategy]}<span class="wideonly"> · each price in its own listing currency</span></>}
          actions={<>
            {r.query ? <button type="button" class="btn" onClick={() => setQuery(modelQuery(DEFAULT_VIEW))}>Defaults</button> : null}
            <button type="button" class="btn" onClick={copyLink}>Copy link</button>
          </>}>
          <DataLine set="watchlist" />
        </Hero>

        {ready ? <Controls view={view} onView={onView} onSettings={onSettings} /> : null}

        <div class="panel" role="region" aria-label="Results">{body}</div>

        <footer class="foot">
          <p>Settled bars only; each day's low or high is read before its close, as the board does. {DIAL_WORDS.costs} {DIAL_WORDS.trail} A record of rules applied to published levels, not investment advice.</p>
        </footer>
      </main>
      <DrawerHost set="watchlist" bd={bd} today={today} loading={loading} />
    </>
  );
}
