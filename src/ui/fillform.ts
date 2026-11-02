import { fmt, fmtD } from '../engine/format';
import type { Fill } from '../engine/journal';
import { Store } from '../store';

/* The entry form's logic, apart from how it is drawn, so it can be tested without a browser. The rule it ports from the old
   page: a fill's price starts as the settled close of the day traded and re-follows the date, until a price is typed by hand;
   from then on the date no longer touches it. A fill whose price was typed by hand earlier is edited the same way. */

export interface FillDraft {
  /** Set when an existing fill is being edited. */
  editing?: Fill;
  sym?: string;
  side?: 'buy' | 'sell';
}

export interface FormState {
  sym: string;
  side: string;
  date: string;
  price: string;
  pattern: string;
  dur: string;
  market: string;
  note: string;
  /** A price was typed by hand, or the fill being edited had one: the date no longer sets it. */
  touched: boolean;
  priceNote: string;
  error: string;
}

/** What a name on the lists brings with it into a new fill. */
export interface ListFacts {
  sym: string;
  pattern?: string;
  duration_m?: number | null;
  country?: string;
}

export interface FormDeps {
  /** The settled close of a symbol on or before a date, or nothing. */
  lookup: (sym: string, date: string) => Promise<{ date: string; close: number } | null>;
  known: () => readonly ListFacts[];
  /** The date on the person's own clock. */
  today: () => string;
  now: () => Date;
  newId: () => string;
}

/** A fill whose price was typed by hand keeps it when its date is edited: the table says "the date no longer sets it", so the
    form must not quietly set it again. A new fill, and one whose price came from a close, follow the date until a price is typed. */
export const priceStartsByHand = (editing: Fill | null | undefined): boolean => !!(editing && editing.priceManual);

const round4 = (v: number): number => Math.round(v * 10000) / 10000;

export function initialForm(draft: FillDraft, today: string): FormState {
  const e = draft.editing;
  return {
    sym: e ? e.sym : draft.sym ?? '',
    side: e ? e.side : draft.side ?? 'buy',
    date: e ? e.date : today,
    price: e ? String(e.price) : '',
    pattern: e ? e.pattern ?? '' : '',
    dur: e && e.duration_m != null ? String(e.duration_m) : '',
    market: e ? e.market ?? '' : '',
    note: e ? e.note ?? '' : '',
    touched: priceStartsByHand(e),
    priceNote: e ? `Editing the ${e.side} of ${e.sym} on ${fmtD(e.date)}: saving replaces it.` : '',
    error: '',
  };
}

export class FillFormModel extends Store<FormState> {
  readonly editing: Fill | null;
  private ask = 0;

  constructor(draft: FillDraft, private readonly deps: FormDeps) {
    super(initialForm(draft, deps.today()));
    this.editing = draft.editing ?? null;
  }

  /** The form opened: a symbol that came with it (from the drawer) gets its price at once. */
  start(): void {
    if (!this.editing && this.get().sym) void this.autoPrice();
  }

  field(name: 'side' | 'sym' | 'pattern' | 'dur' | 'market' | 'note', value: string): void {
    this.set({ [name]: value } as Partial<FormState>);
  }

  /** The symbol box was left: normalised, what the name brings with it filled in where the form has nothing yet, and its price. */
  commitSym(raw: string): void {
    const sym = raw.trim().toUpperCase();
    const st = this.get();
    const patch: Partial<FormState> = { sym };
    const p = this.deps.known().find(x => x.sym === sym);
    if (p) {
      if (!st.pattern && p.pattern) patch.pattern = p.pattern;
      if (!st.dur && p.duration_m != null) patch.dur = String(p.duration_m);
      if (!st.market && p.country) patch.market = p.country;
    }
    this.set(patch);
    void this.autoPrice();
  }

  setDate(value: string): void {
    this.set({ date: value });
    void this.autoPrice();
  }

  typePrice(value: string): void {
    this.set({ price: value, touched: true, priceNote: 'price entered by hand: the date will not change it' });
  }

  /** The settled close of the day traded, until a price has been typed by hand. An answer that arrives after the symbol or
      the date has changed again, or after a price was typed, is dropped. */
  async autoPrice(): Promise<void> {
    const st = this.get();
    const sym = st.sym.trim().toUpperCase();
    if (st.touched || !sym || !st.date) return;
    const mine = ++this.ask;
    const date = st.date;
    this.set({ priceNote: 'fetching the close of ' + fmtD(date) + '…' });
    const got = await this.deps.lookup(sym, date);
    if (mine !== this.ask || this.get().touched) return;
    if (got) {
      this.set({ price: String(round4(got.close)),
        priceNote: 'settled close of ' + fmtD(got.date) + (got.date !== date ? ' (last trading day before your date)' : '') + ': type a price to override' });
    } else {
      this.set({ priceNote: 'no history found for ' + sym + ': enter the price by hand' });
    }
  }

  /** The fill the form describes, or what is wrong with it. */
  build(): { fill: Fill } | { error: string } {
    const st = this.get();
    const e = this.editing;
    const sym = st.sym.trim().toUpperCase();
    const price = parseFloat(st.price.replace(/,/g, ''));
    if (!sym) return { error: 'Enter a symbol.' };
    if (!isFinite(price)) return { error: 'Enter a price: the box above fills in the close of the day, or type your own.' };
    if (!st.date) return { error: 'Enter the date of the trade.' };
    const dur = st.dur.trim() === '' ? null : Number(st.dur);
    if (dur != null && !isFinite(dur)) return { error: 'Duration is a number of months.' };
    return {
      fill: {
        id: e ? e.id : this.deps.newId(),
        sym, side: st.side, date: st.date, price,
        priceManual: st.touched,
        pattern: st.pattern.trim() || null, duration_m: dur, market: st.market.trim() || null, note: st.note.trim() || null,
        logged_at: e && e.logged_at ? e.logged_at : this.deps.now().toISOString(),
      },
    };
  }

  /** What the person is told when it is saved. */
  savedMessage(fill: Fill): string {
    return (this.editing ? 'Saved the ' : 'Logged ') + fill.side + ' ' + fill.sym + ' @ ' + fmt(fill.price) + '.';
  }
}
