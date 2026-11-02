import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { app, updateLog } from '../data/app';
import { closeFor, latestCloseFor } from '../data/journal';
import { addFill, isSharedFill, logRows, newFillId, removeFill, saveFill } from '../data/tradelog';
import { fmt, fmtD, localISODate, MINUS } from '../engine/format';
import { journalStats, pairFills, statsLine, unrealised } from '../engine/journal';
import type { ClosedTrade, Fill } from '../engine/journal';
import { Store, useStore } from '../store';
import { Confirm, Modal } from './components';
import { FillFormModel } from './fillform';
import type { FillDraft } from './fillform';
import { DataTable } from './datatable';
import type { DCol } from './datatable';
import { chartUrl } from './links';
import { say } from './notice';

/* The trade journal on the History page, and the form that writes to it. The pairing and the statistics are the engine's
   (journal.ts, ported from the old page); this is the entry form, the three tables, and edit and delete. The form lives
   in a dialog at the app's level, so the setup drawer's "Log fill" can open it without a page change. */

/* ------------------------------------------------------------------ the dialog's own state */

interface JournalUi {
  form: FillDraft | null;
  deleting: Fill | null;
}

export const journalUi = new Store<JournalUi>({ form: null, deleting: null });

export type { FillDraft };

export const openFillForm = (draft: FillDraft = {}): void => journalUi.set({ form: draft, deleting: null });
const closeDialog = (): void => journalUi.set({ form: null, deleting: null });

/* ------------------------------------------------------------------ cells */

const sideWord = (side: string) => (side === 'buy' ? 'long' : 'short');

const Sym = ({ sym }: { sym: string }) => (
  <a class="symlink" href={chartUrl(sym)} target="_blank" rel="noopener noreferrer" title={sym + ' chart on Yahoo Finance, opens in a new tab'}>{sym}</a>
);

const Two = ({ v, s, tone, title }: { v: string; s?: string; tone?: 'good' | 'bad'; title?: string }) => (
  <div class="cell" title={title}><div class={'v' + (tone ? ' tone-' + tone : '')}>{v}</div>{s ? <div class="s">{s}</div> : null}</div>
);

const pctText = (v: number) => (v > 0 ? '+' : v < 0 ? MINUS : '') + Math.abs(v).toFixed(1) + '%';
const breakout = (pattern: string | null | undefined, dur: number | null | undefined) =>
  pattern ? pattern + (dur != null ? ' · ' + dur + 'm' : '') : dur != null ? dur + 'm' : '–';

/* ------------------------------------------------------------------ the three tables */

export function JournalPanel({ narrow }: { narrow: boolean }) {
  const s = useStore(app);
  const rows = useMemo(() => logRows(s.tradelog, s.log), [s.tradelog, s.log]);
  const { opens, closed } = useMemo(() => pairFills(rows), [rows]);
  const stats = journalStats(rows, opens, closed);
  /* A position in a symbol that is on neither list has no live price here, so its latest settled close is fetched once. */
  const [off, setOff] = useState<Record<string, { close: number; ccy: string; date: string }>>({});
  const tried = useRef(new Set<string>());
  const missing = useMemo(() => [...new Set(opens.map(o => o.sym))].filter(sym => !(s.hist[sym] && s.hist[sym].settled.length)), [opens, s.hist]);
  useEffect(() => {
    for (const sym of missing) {
      if (tried.current.has(sym)) continue;
      tried.current.add(sym);
      void latestCloseFor(sym, app.get().hist).then(r => { if (r) setOff(o => ({ ...o, [sym]: r })); }, () => tried.current.delete(sym));
    }
  }, [missing.join(',')]);
  const live = (sym: string): number | null => { const h = s.hist[sym]; return h ? h.live : off[sym] ? off[sym].close : null; };
  const ccy = (sym: string): string => { const h = s.hist[sym]; return h ? h.currency : off[sym] ? off[sym].ccy : ''; };
  const price = (sym: string, v: number) => <span>{fmt(v)}{ccy(sym) ? <span class="ccy">{ccy(sym)}</span> : null}</span>;

  const openCols: DCol<Fill>[] = [
    { key: 'sym', label: 'Symbol', text: true, cell: e => <div class="symline"><Sym sym={e.sym} /><span class={'dirpill ' + sideWord(e.side)}>{sideWord(e.side)}</span></div> },
    { key: 'entry', label: 'Entry', cell: e => <Two v={fmtD(e.date)} s={fmt(e.price)} /> },
    { key: 'now', label: 'Now', cell: e => {
      const lv = live(e.sym);
      const last = !s.hist[e.sym] && off[e.sym] ? 'Last settled close, ' + fmtD(off[e.sym].date) + ': this symbol is on neither list, so there is no live price' : undefined;
      return <Two v={lv != null ? fmt(lv) : '–'} s={lv != null ? ccy(e.sym) : undefined} title={last} />;
    } },
    { key: 'pnl', label: 'Unrealised', cell: e => { const u = unrealised(e, live(e.sym)); return u == null ? <Two v="–" /> : <Two v={pctText(u)} tone={u >= 0 ? 'good' : 'bad'} />; } },
    { key: 'pattern', label: 'Breakout', text: true, cell: e => <Two v={breakout(e.pattern, e.duration_m)} /> },
    { key: 'market', label: 'Market', text: true, cell: e => <Two v={e.market || '–'} /> },
    { key: 'note', label: 'Note', text: true, cell: e => (e.note ? <Two v={e.note} /> : null) },
  ];

  const closedCols: DCol<ClosedTrade>[] = [
    { key: 'sym', label: 'Symbol', text: true, cell: c => <div class="symline"><Sym sym={c.sym} /><span class={'dirpill ' + c.dir}>{c.dir}</span></div> },
    { key: 'in', label: 'In', cell: c => <Two v={fmtD(c.entry.date)} s={fmt(c.entry.price)} /> },
    { key: 'out', label: 'Out', cell: c => <Two v={fmtD(c.exit.date)} s={fmt(c.exit.price)} /> },
    { key: 'pnl', label: 'P&L', cell: c => <Two v={pctText(c.pnl)} tone={c.pnl >= 0 ? 'good' : 'bad'} /> },
    { key: 'held', label: 'Held', cell: c => <Two v={c.days + 'd'} /> },
    { key: 'pattern', label: 'Breakout', text: true, cell: c => <Two v={breakout(c.pattern, c.duration_m)} /> },
    { key: 'market', label: 'Market', text: true, cell: c => <Two v={c.market || '–'} /> },
  ];

  const fillCols: DCol<Fill>[] = [
    { key: 'sym', label: 'Symbol', text: true, cell: f => <div class="symline"><span class="sym2">{f.sym}</span><span class={'sidepill ' + f.side}>{f.side}</span></div> },
    { key: 'date', label: 'Date', cell: f => <Two v={fmtD(f.date)} /> },
    { key: 'price', label: 'Price', cell: f => (
      <div class="cell" title={f.priceManual ? 'Price entered by hand: the date no longer sets it' : 'Settled close of ' + fmtD(f.date)}>
        <div class="v">{price(f.sym, f.price)}</div>{f.priceManual ? <div class="s">by hand</div> : null}
      </div>
    ) },
    { key: 'pattern', label: 'Breakout', text: true, cell: f => <Two v={breakout(f.pattern, f.duration_m)} /> },
    { key: 'market', label: 'Market', text: true, cell: f => <Two v={f.market || '–'} /> },
    { key: 'note', label: 'Note', text: true, cell: f => (f.note ? <Two v={f.note} /> : null) },
    { key: 'act', label: '', cell: f => (
      <div class="wact">
        <button type="button" class="btn small" onClick={() => openFillForm({ editing: f })}>Edit<span class="sr"> the {f.side} of {f.sym} on {fmtD(f.date)}</span></button>
        <button type="button" class="btn small quiet-danger" onClick={() => journalUi.set({ deleting: f })}>Delete<span class="sr"> the {f.side} of {f.sym} on {fmtD(f.date)}</span></button>
      </div>
    ) },
  ];

  return (
    <div class="journal">
      <div class="journalhead">
        <p class="jsummary" aria-live="polite">{statsLine(stats)}</p>
        <button type="button" class="btn primary" onClick={() => openFillForm()}>Log a fill</button>
      </div>
      {rows.length ? (
        <>
          <JournalBlock title="Open positions" count={opens.length}>
            <DataTable rows={opens} cols={openCols} label="Open positions" id="journal-open" narrow={narrow} rowKey={f => f.id} />
          </JournalBlock>
          <JournalBlock title="Closed trades" count={closed.length}>
            <DataTable rows={closed.slice().reverse()} cols={closedCols} label="Closed trades" id="journal-closed" narrow={narrow} rowKey={c => c.entry.id + c.exit.id} />
          </JournalBlock>
          <JournalBlock title="Every fill" count={rows.length}>
            <DataTable rows={rows.slice().reverse()} cols={fillCols} label="Every fill" id="journal-fills" narrow={narrow} rowKey={f => f.id} />
          </JournalBlock>
        </>
      ) : (
        <div class="empty">
          <p>Nothing is logged yet. The journal records the fills you actually made, by price and date, with no sizes: each buy pairs with the next sell, first in first out, to make a round trip. It is kept apart from the setups, so logging a buy never moves one.</p>
          <button type="button" class="btn" onClick={() => openFillForm()}>Log your first fill</button>
        </div>
      )}
      {s.logSaveFailed ? <p class="dataline bad">This browser would not save the last change to the journal, so it will be gone on reload.</p> : null}
    </div>
  );
}

function JournalBlock({ title, count, children }: { title: string; count: number; children: preact.ComponentChildren }) {
  if (!count) return null;
  return (
    <section class="jblock" aria-label={title}>
      <div class="sechead"><h3>{title}</h3><span class="gcount">{count}</span></div>
      {children}
    </section>
  );
}

/* ------------------------------------------------------------------ the dialog: log, edit, delete */

/** The form: the model holds what it says and does (fillform.ts); this draws it. */
function FillForm({ draft }: { draft: FillDraft }) {
  const s = useStore(app);
  const [model] = useState(() => new FillFormModel(draft, {
    lookup: (sym, date) => closeFor(sym, date, app.get().hist),
    known: () => {
      const a = app.get();
      return [...a.shared.watchlist, ...a.overlays.watchlist.added].map(p => ({ sym: p.sym, pattern: p.pattern, duration_m: p.duration_m, country: p.country }));
    },
    today: () => localISODate(),
    now: () => new Date(),
    newId: () => newFillId(),
  }));
  const f = useStore(model);
  const editing = model.editing;
  useEffect(() => { model.start(); }, []);

  const lists = useMemo(() => {
    const all = [...s.shared.watchlist, ...s.overlays.watchlist.added];
    const uniq = (xs: (string | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x))].sort();
    return { patterns: uniq(all.map(p => p.pattern)), markets: uniq(all.map(p => p.country)) };
  }, [s.shared, s.overlays]);

  const submit = (e: Event) => {
    e.preventDefault();
    const r = model.build();
    if ('error' in r) { model.set({ error: r.error }); return; }
    updateLog(ov => (editing ? saveFill(ov, app.get().tradelog, r.fill) : addFill(ov, r.fill)));
    say(model.savedMessage(r.fill));
    closeDialog();
  };

  const val = (e: Event) => (e.target as HTMLInputElement).value;
  return (
    <form class="form" onSubmit={submit} noValidate>
      <div class="grid2">
        <div class="field">
          <label for="fill-sym">Symbol</label>
          {/* Leaving the box reads the box itself, not the state: a value pasted and left in one breath has not been rendered back yet. */}
          <input id="fill-sym" type="text" autocomplete="off" autocapitalize="characters" spellcheck={false} value={f.sym} data-autofocus={!f.sym ? true : undefined}
            onInput={e => model.field('sym', val(e))} onChange={e => model.commitSym(val(e))} />
        </div>
        <div class="field">
          <label for="fill-side">Side</label>
          <select id="fill-side" value={f.side} onChange={e => model.field('side', (e.target as HTMLSelectElement).value)}>
            <option value="buy">Buy</option>
            <option value="sell">Sell</option>
          </select>
        </div>
        <div class="field">
          <label for="fill-date">Date traded</label>
          <input id="fill-date" type="date" value={f.date} onInput={e => model.setDate(val(e))} />
        </div>
        <div class="field">
          <label for="fill-price">Price</label>
          <input id="fill-price" type="text" inputMode="decimal" autocomplete="off" value={f.price} onInput={e => model.typePrice(val(e))} />
        </div>
      </div>
      <p class="hint" aria-live="polite">{f.priceNote || 'The price starts as the settled close of the day traded, in the symbol\'s own currency.'}</p>
      <div class="grid2">
        <div class="field">
          <label for="fill-pattern">Breakout</label>
          <input id="fill-pattern" type="text" list="fill-patterns" autocomplete="off" value={f.pattern} onInput={e => model.field('pattern', val(e))} />
          <datalist id="fill-patterns">{lists.patterns.map(p => <option value={p} />)}</datalist>
        </div>
        <div class="field">
          <label for="fill-dur">Months forming</label>
          <input id="fill-dur" type="text" inputMode="decimal" autocomplete="off" value={f.dur} onInput={e => model.field('dur', val(e))} />
        </div>
        <div class="field">
          <label for="fill-market">Market</label>
          <input id="fill-market" type="text" list="fill-markets" autocomplete="off" value={f.market} onInput={e => model.field('market', val(e))} />
          <datalist id="fill-markets">{lists.markets.map(m => <option value={m} />)}</datalist>
        </div>
        <div class="field">
          <label for="fill-note">Note</label>
          <input id="fill-note" type="text" autocomplete="off" value={f.note} onInput={e => model.field('note', val(e))} />
        </div>
      </div>
      <p class="hint">Saved in this browser only. It is a record of what you did, kept apart from the setups: logging a buy never moves one.</p>
      {f.error ? <p class="formerror" role="alert">{f.error}</p> : null}
      <div class="row">
        <button type="button" class="btn" onClick={closeDialog}>Cancel</button>
        <button type="submit" class="btn primary">{editing ? 'Save fill' : 'Log it'}</button>
      </div>
    </form>
  );
}

/** At the root of the app: shows the form or the delete question when something asked for one. */
export function FillDialog() {
  const ui = useStore(journalUi);
  const s = useStore(app);
  if (ui.deleting) {
    const f = ui.deleting;
    return (
      <Modal id="fill-delete" title="Delete this fill" variant="dialog" onClose={closeDialog}>
        <Confirm text={`Delete this ${f.side} of ${f.sym} on ${fmtD(f.date)}?${isSharedFill(s.tradelog, f.id) ? ' It is in the shared journal, so it is hidden in this browser only.' : ''}`}
          confirmLabel="Delete" danger onCancel={closeDialog}
          onConfirm={() => { updateLog(ov => removeFill(ov, app.get().tradelog, f.id)); say(`Deleted the ${f.side} of ${f.sym}.`); closeDialog(); }} />
      </Modal>
    );
  }
  if (!ui.form) return null;
  return (
    <Modal id="fill-form" title={ui.form.editing ? 'Edit fill' : 'Log a fill'} variant="dialog" onClose={closeDialog}>
      <FillForm key={ui.form.editing ? ui.form.editing.id : 'new:' + (ui.form.sym ?? '')} draft={ui.form} />
    </Modal>
  );
}
