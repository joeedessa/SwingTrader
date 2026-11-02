import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { app, updateLog } from '../data/app';
import { closeFor } from '../data/journal';
import { addFill, isSharedFill, logRows, newFillId, removeFill, saveFill } from '../data/tradelog';
import { fmt, fmtD, localISODate, MINUS } from '../engine/format';
import { journalStats, pairFills, statsLine, unrealised } from '../engine/journal';
import type { ClosedTrade, Fill } from '../engine/journal';
import { Store, useStore } from '../store';
import { Confirm, Modal } from './components';
import { DataTable } from './datatable';
import type { DCol } from './datatable';
import { chartUrl } from './links';
import { say } from './notice';

/* The trade journal on the History page, and the form that writes to it. The pairing and the statistics are the engine's
   (journal.ts, ported from the old page); this is the entry form, the three tables, and edit and delete. The form lives
   in a dialog at the app's level, so the setup drawer's "Log fill" can open it without a page change. */

/* ------------------------------------------------------------------ the dialog's own state */

export interface FillDraft {
  /** Set when an existing fill is being edited. */
  editing?: Fill;
  sym?: string;
  side?: 'buy' | 'sell';
}

interface JournalUi {
  form: FillDraft | null;
  deleting: Fill | null;
}

export const journalUi = new Store<JournalUi>({ form: null, deleting: null });

export const openFillForm = (draft: FillDraft = {}): void => journalUi.set({ form: draft, deleting: null });
const closeDialog = (): void => journalUi.set({ form: null, deleting: null });

/* ------------------------------------------------------------------ cells */

const sideWord = (side: string) => (side === 'buy' ? 'long' : 'short');

const Sym = ({ sym }: { sym: string }) => (
  <a class="symlink" href={chartUrl(sym)} target="_blank" rel="noopener noreferrer" title={sym + ' chart on Yahoo Finance, opens in a new tab'}>{sym}</a>
);

const Two = ({ v, s, tone }: { v: string; s?: string; tone?: 'good' | 'bad' }) => (
  <div class="cell"><div class={'v' + (tone ? ' tone-' + tone : '')}>{v}</div>{s ? <div class="s">{s}</div> : null}</div>
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
  const live = (sym: string): number | null => { const h = s.hist[sym]; return h ? h.live : null; };
  const ccy = (sym: string): string => { const h = s.hist[sym]; return h ? h.currency : ''; };
  const price = (sym: string, v: number) => <span>{fmt(v)}{ccy(sym) ? <span class="ccy">{ccy(sym)}</span> : null}</span>;

  const openCols: DCol<Fill>[] = [
    { key: 'sym', label: 'Symbol', text: true, cell: e => <div class="symline"><Sym sym={e.sym} /><span class={'dirpill ' + sideWord(e.side)}>{sideWord(e.side)}</span></div> },
    { key: 'entry', label: 'Entry', cell: e => <Two v={fmtD(e.date)} s={fmt(e.price)} /> },
    { key: 'now', label: 'Now', cell: e => { const lv = live(e.sym); return <Two v={lv != null ? fmt(lv) : '–'} s={lv != null ? ccy(e.sym) : undefined} />; } },
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

const today = () => localISODate();

/** The form, a port of the old page's: the price follows the date until a price is typed by hand. */
function FillForm({ draft }: { draft: FillDraft }) {
  const s = useStore(app);
  const editing = draft.editing ?? null;
  const [sym, setSym] = useState(editing ? editing.sym : draft.sym ?? '');
  const [side, setSide] = useState<string>(editing ? editing.side : draft.side ?? 'buy');
  const [date, setDate] = useState(editing ? editing.date : today());
  const [price, setPrice] = useState(editing ? String(editing.price) : '');
  const [pattern, setPattern] = useState(editing ? editing.pattern ?? '' : '');
  const [dur, setDur] = useState(editing && editing.duration_m != null ? String(editing.duration_m) : '');
  const [market, setMarket] = useState(editing ? editing.market ?? '' : '');
  const [note, setNote] = useState(editing ? editing.note ?? '' : '');
  const [touched, setTouched] = useState(false);
  const [priceNote, setPriceNote] = useState(editing ? `Editing the ${editing.side} of ${editing.sym} on ${fmtD(editing.date)}: saving replaces it.` : '');
  const [error, setError] = useState('');
  const ask = useRef(0);
  const manual = useRef(false);
  manual.current = touched;

  const lists = useMemo(() => {
    const all = [...s.shared.watchlist, ...s.overlays.watchlist.added];
    const uniq = (xs: (string | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x))].sort();
    return { patterns: uniq(all.map(p => p.pattern)), markets: uniq(all.map(p => p.country)), all };
  }, [s.shared, s.overlays]);

  /* The settled close of the day traded, until a price has been typed by hand. A late answer for an old symbol or date is dropped. */
  const autoPrice = async (forSym: string, forDate: string) => {
    if (manual.current || !forSym || !forDate) return;
    const mine = ++ask.current;
    setPriceNote('fetching the close of ' + fmtD(forDate) + '…');
    const got = await closeFor(forSym, forDate, app.get().hist);
    if (mine !== ask.current || manual.current) return;
    if (got) {
      setPrice(String(Math.round(got.close * 10000) / 10000));
      setPriceNote('settled close of ' + fmtD(got.date) + (got.date !== forDate ? ' (last trading day before your date)' : '') + ': type a price to override');
    } else {
      setPriceNote('no history found for ' + forSym + ': enter the price by hand');
    }
  };

  useEffect(() => { if (!editing && sym) void autoPrice(sym.trim().toUpperCase(), date); }, []);

  // Reads the box itself, not the state: a value pasted and left in one breath has not been rendered back yet.
  const onSym = (raw: string) => {
    const next = raw.trim().toUpperCase();
    setSym(next);
    // A name on the list brings its pattern, how long it took to form, and its market, where the form has none yet.
    const p = lists.all.find(x => x.sym === next);
    if (p) {
      if (!pattern && p.pattern) setPattern(p.pattern);
      if (!dur && p.duration_m != null) setDur(String(p.duration_m));
      if (!market && p.country) setMarket(p.country);
    }
    void autoPrice(next, date);
  };

  const submit = (e: Event) => {
    e.preventDefault();
    const symbol = sym.trim().toUpperCase();
    const px = parseFloat(price.replace(/,/g, ''));
    if (!symbol) { setError('Enter a symbol.'); return; }
    if (!isFinite(px)) { setError('Enter a price: the box above fills in the close of the day, or type your own.'); return; }
    if (!date) { setError('Enter the date of the trade.'); return; }
    const d = dur.trim() === '' ? null : Number(dur);
    if (d != null && !isFinite(d)) { setError('Duration is a number of months.'); return; }
    const fill: Fill = {
      id: editing ? editing.id : newFillId(),
      sym: symbol, side, date, price: px,
      priceManual: editing ? (touched || (!!editing.priceManual && px === editing.price)) : touched,
      pattern: pattern.trim() || null, duration_m: d, market: market.trim() || null, note: note.trim() || null,
      logged_at: editing && editing.logged_at ? editing.logged_at : new Date().toISOString(),
    };
    updateLog(ov => (editing ? saveFill(ov, app.get().tradelog, fill) : addFill(ov, fill)));
    say((editing ? 'Saved the ' : 'Logged ') + side + ' ' + symbol + ' @ ' + fmt(px) + '.');
    closeDialog();
  };

  return (
    <form class="form" onSubmit={submit} noValidate>
      <div class="grid2">
        <div class="field">
          <label for="fill-sym">Symbol</label>
          <input id="fill-sym" type="text" autocomplete="off" autocapitalize="characters" spellcheck={false} value={sym} data-autofocus={!sym ? true : undefined}
            onInput={e => setSym((e.target as HTMLInputElement).value)} onChange={e => onSym((e.target as HTMLInputElement).value)} />
        </div>
        <div class="field">
          <label for="fill-side">Side</label>
          <select id="fill-side" value={side} onChange={e => setSide((e.target as HTMLSelectElement).value)}>
            <option value="buy">Buy</option>
            <option value="sell">Sell</option>
          </select>
        </div>
        <div class="field">
          <label for="fill-date">Date traded</label>
          <input id="fill-date" type="date" value={date} onInput={e => { const v = (e.target as HTMLInputElement).value; setDate(v); void autoPrice(sym.trim().toUpperCase(), v); }} />
        </div>
        <div class="field">
          <label for="fill-price">Price</label>
          <input id="fill-price" type="text" inputMode="decimal" autocomplete="off" value={price}
            onInput={e => { setPrice((e.target as HTMLInputElement).value); setTouched(true); setPriceNote('price entered by hand: the date will not change it'); }} />
        </div>
      </div>
      <p class="hint" aria-live="polite">{priceNote || 'The price starts as the settled close of the day traded, in the symbol\'s own currency.'}</p>
      <div class="grid2">
        <div class="field">
          <label for="fill-pattern">Breakout</label>
          <input id="fill-pattern" type="text" list="fill-patterns" autocomplete="off" value={pattern} onInput={e => setPattern((e.target as HTMLInputElement).value)} />
          <datalist id="fill-patterns">{lists.patterns.map(p => <option value={p} />)}</datalist>
        </div>
        <div class="field">
          <label for="fill-dur">Months forming</label>
          <input id="fill-dur" type="text" inputMode="decimal" autocomplete="off" value={dur} onInput={e => setDur((e.target as HTMLInputElement).value)} />
        </div>
        <div class="field">
          <label for="fill-market">Market</label>
          <input id="fill-market" type="text" list="fill-markets" autocomplete="off" value={market} onInput={e => setMarket((e.target as HTMLInputElement).value)} />
          <datalist id="fill-markets">{lists.markets.map(m => <option value={m} />)}</datalist>
        </div>
        <div class="field">
          <label for="fill-note">Note</label>
          <input id="fill-note" type="text" autocomplete="off" value={note} onInput={e => setNote((e.target as HTMLInputElement).value)} />
        </div>
      </div>
      <p class="hint">Saved in this browser only. It is a record of what you did, kept apart from the setups: logging a buy never moves one.</p>
      {error ? <p class="formerror" role="alert">{error}</p> : null}
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
