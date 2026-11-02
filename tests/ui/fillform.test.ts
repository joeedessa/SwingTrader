import { describe, expect, it } from 'vitest';
import { FillFormModel, initialForm, priceStartsByHand } from '../../src/ui/fillform';
import type { FormDeps, ListFacts } from '../../src/ui/fillform';
import type { Fill } from '../../src/engine/journal';

/* The entry form's logic with nothing drawn: what it starts as, how the price follows the date until a price is typed by
   hand, what a symbol brings with it, the answers that arrive late, and the fill it builds. */

interface Pending { sym: string; date: string; resolve: (v: { date: string; close: number } | null) => void }

function rig(over: Partial<FormDeps> = {}, known: ListFacts[] = []) {
  const asked: Pending[] = [];
  const deps: FormDeps = {
    lookup: (sym, date) => new Promise(resolve => { asked.push({ sym, date, resolve }); }),
    known: () => known,
    today: () => '2026-11-02',
    now: () => new Date('2026-11-02T10:00:00.000Z'),
    newId: () => 'fnew',
    ...over,
  };
  return { deps, asked };
}
const tick = () => new Promise(r => setTimeout(r, 0));

const manual: Fill = { id: 'f12', sym: 'GDX', side: 'sell', date: '2026-10-20', price: 63, priceManual: true, pattern: 'Flag', duration_m: 2, market: 'US', note: 'edited', logged_at: '2026-10-20T14:00:00.000Z' };
const auto: Fill = { ...manual, id: 'f13', price: 61.5, priceManual: false, logged_at: '2026-10-21T14:00:00.000Z' };

describe('what the form starts as', () => {
  it('a new fill: a buy, today on the person\'s clock, nothing else', () => {
    expect(initialForm({}, '2026-11-02')).toMatchObject({ sym: '', side: 'buy', date: '2026-11-02', price: '', touched: false, priceNote: '', error: '' });
  });

  it('a fill started from a setup: its symbol, and the side its direction suggests', () => {
    expect(initialForm({ sym: 'AME', side: 'sell' }, '2026-11-02')).toMatchObject({ sym: 'AME', side: 'sell' });
  });

  it('an edit: the fill\'s own values, and a note that saving replaces it', () => {
    const f = initialForm({ editing: manual }, '2026-11-02');
    expect(f).toMatchObject({ sym: 'GDX', side: 'sell', date: '2026-10-20', price: '63', pattern: 'Flag', dur: '2', market: 'US', note: 'edited' });
    expect(f.priceNote).toBe('Editing the sell of GDX on 20-10-26: saving replaces it.');
  });

  it('an edit of a fill whose price was typed by hand starts with the price held, so the date cannot set it again', () => {
    expect(priceStartsByHand(manual)).toBe(true);
    expect(initialForm({ editing: manual }, 'x').touched).toBe(true);
    expect(initialForm({ editing: auto }, 'x').touched).toBe(false);
    expect(priceStartsByHand(null)).toBe(false);
    expect(priceStartsByHand(undefined)).toBe(false);
  });
});

describe('the price follows the date, until one is typed', () => {
  it('asks for the close of the symbol on the date, fills it in to four places, and says where it came from', async () => {
    const { deps, asked } = rig();
    const m = new FillFormModel({ sym: 'AME' }, deps);
    m.start();
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({ sym: 'AME', date: '2026-11-02' });
    expect(m.get().priceNote).toBe('fetching the close of 02-11-26…');
    asked[0].resolve({ date: '2026-11-02', close: 251.78123456 });
    await tick();
    expect(m.get().price).toBe('251.7812');
    expect(m.get().priceNote).toBe('settled close of 02-11-26: type a price to override');
  });

  it('says it is the last trading day before the date when the market was shut that day', async () => {
    const { deps, asked } = rig();
    const m = new FillFormModel({ sym: 'AME' }, deps);
    m.setDate('2026-11-01');
    asked[0].resolve({ date: '2026-10-30', close: 12 });
    await tick();
    expect(m.get().priceNote).toBe('settled close of 30-10-26 (last trading day before your date): type a price to override');
  });

  it('says there is no history, and leaves the price for the person to type', async () => {
    const { deps, asked } = rig();
    const m = new FillFormModel({ sym: 'NOPE' }, deps);
    m.start();
    asked[0].resolve(null);
    await tick();
    expect(m.get().price).toBe('');
    expect(m.get().priceNote).toBe('no history found for NOPE: enter the price by hand');
  });

  it('asks again when the date changes, and a late answer for the old date is dropped', async () => {
    const { deps, asked } = rig();
    const m = new FillFormModel({ sym: 'AME' }, deps);
    m.start();
    m.setDate('2026-10-29');
    expect(asked.map(a => a.date)).toEqual(['2026-11-02', '2026-10-29']);
    asked[1].resolve({ date: '2026-10-29', close: 11 });
    await tick();
    asked[0].resolve({ date: '2026-11-02', close: 99 });           // the first answer arrives last
    await tick();
    expect(m.get().price).toBe('11');
  });

  it('stops following the date once a price is typed: the date no longer touches it, and an answer on its way is dropped', async () => {
    const { deps, asked } = rig();
    const m = new FillFormModel({ sym: 'AME' }, deps);
    m.start();
    m.typePrice('240');
    expect(m.get()).toMatchObject({ price: '240', touched: true, priceNote: 'price entered by hand: the date will not change it' });
    asked[0].resolve({ date: '2026-11-02', close: 99 });
    await tick();
    expect(m.get().price).toBe('240');
    m.setDate('2026-10-01');
    expect(asked).toHaveLength(1);                                   // nobody was asked again
    expect(m.get().price).toBe('240');
  });

  it('does not ask without a symbol or a date', () => {
    const { deps, asked } = rig();
    const m = new FillFormModel({}, deps);
    m.start();
    m.setDate('2026-10-01');
    m.setDate('');
    expect(asked).toEqual([]);
  });

  it('editing a fill whose price was typed by hand: changing the date leaves the price where it is (the bug this pins)', () => {
    const { deps, asked } = rig();
    const m = new FillFormModel({ editing: manual }, deps);
    m.start();
    m.setDate('2026-10-22');
    expect(asked).toEqual([]);
    expect(m.get()).toMatchObject({ price: '63', date: '2026-10-22' });
  });

  it('editing a fill whose price came from a close: changing the date asks for the new close', async () => {
    const { deps, asked } = rig();
    const m = new FillFormModel({ editing: auto }, deps);
    m.setDate('2026-10-22');
    expect(asked).toHaveLength(1);
    asked[0].resolve({ date: '2026-10-22', close: 70 });
    await tick();
    expect(m.get().price).toBe('70');
  });

  it('opening an edit asks for nothing', () => {
    const { deps, asked } = rig();
    new FillFormModel({ editing: auto }, deps).start();
    expect(asked).toEqual([]);
  });
});

describe('what a symbol brings with it', () => {
  const known: ListFacts[] = [{ sym: 'AME', pattern: 'Ascending triangle', duration_m: 5, country: 'US' }, { sym: 'NUTX', country: 'US' }];

  it('is normalised, and brings its pattern, months forming and market, where the form has none yet', () => {
    const { deps, asked } = rig({}, known);
    const m = new FillFormModel({}, deps);
    m.commitSym(' ame ');
    expect(m.get()).toMatchObject({ sym: 'AME', pattern: 'Ascending triangle', dur: '5', market: 'US' });
    expect(asked[0]).toMatchObject({ sym: 'AME' });
  });

  it('never overwrites what the person already typed', () => {
    const { deps } = rig({}, known);
    const m = new FillFormModel({}, deps);
    m.field('pattern', 'My own');
    m.field('market', 'Elsewhere');
    m.commitSym('AME');
    expect(m.get()).toMatchObject({ pattern: 'My own', market: 'Elsewhere', dur: '5' });
  });

  it('brings only what the list has, and nothing for a name it does not know', () => {
    const { deps } = rig({}, known);
    const m = new FillFormModel({}, deps);
    m.commitSym('NUTX');
    expect(m.get()).toMatchObject({ pattern: '', dur: '', market: 'US' });
    m.commitSym('GDX');
    expect(m.get().sym).toBe('GDX');
  });
});

describe('the fill it builds', () => {
  const filled = (deps: FormDeps, draft = {}) => {
    const m = new FillFormModel(draft, deps);
    m.field('sym', ' ame ');
    m.field('side', 'sell');
    m.setDate('2026-10-29');
    m.typePrice('1,234.5');
    return m;
  };

  it('is the symbol in capitals, the side, the day, and a price read with its thousands comma', () => {
    const { deps } = rig();
    const r = filled(deps).build();
    expect(r).toEqual({ fill: {
      id: 'fnew', sym: 'AME', side: 'sell', date: '2026-10-29', price: 1234.5, priceManual: true,
      pattern: null, duration_m: null, market: null, note: null, logged_at: '2026-11-02T10:00:00.000Z',
    } });
  });

  it('leaves what was typed for the record as it was, trimmed, and nothing blank as empty text', () => {
    const { deps } = rig();
    const m = filled(deps);
    m.field('pattern', '  Flag ');
    m.field('dur', ' 2.5 ');
    m.field('market', '');
    m.field('note', 'half size');
    expect((m.build() as { fill: Fill }).fill).toMatchObject({ pattern: 'Flag', duration_m: 2.5, market: null, note: 'half size' });
  });

  it('says a price that came from a close was not typed by hand', async () => {
    const { deps, asked } = rig();
    const m = new FillFormModel({ sym: 'AME' }, deps);
    m.start();
    asked[0].resolve({ date: '2026-11-02', close: 10 });
    await tick();
    expect((m.build() as { fill: Fill }).fill).toMatchObject({ price: 10, priceManual: false });
  });

  it('keeps the id and the time it was logged when editing, and the hand-typed mark when the price was not touched', () => {
    const { deps } = rig();
    const m = new FillFormModel({ editing: manual }, deps);
    const f = (m.build() as { fill: Fill }).fill;
    expect(f).toMatchObject({ id: 'f12', logged_at: '2026-10-20T14:00:00.000Z', price: 63, priceManual: true });
  });

  it('a fill logged before the journal recorded the time gets the time it is saved at', () => {
    const { deps } = rig();
    const noTime: Fill = { ...auto }; delete noTime.logged_at;
    expect(((new FillFormModel({ editing: noTime }, deps)).build() as { fill: Fill }).fill.logged_at).toBe('2026-11-02T10:00:00.000Z');
  });

  it('says what is wrong rather than saving it: no symbol, no price, no day, months that are not a number', () => {
    const { deps } = rig();
    const m = new FillFormModel({}, deps);
    expect(m.build()).toEqual({ error: 'Enter a symbol.' });
    m.field('sym', 'AME');
    expect(m.build()).toEqual({ error: 'Enter a price: the box above fills in the close of the day, or type your own.' });
    m.typePrice('abc');
    expect(m.build()).toMatchObject({ error: expect.stringContaining('Enter a price') });
    m.typePrice('10');
    m.setDate('');
    expect(m.build()).toEqual({ error: 'Enter the date of the trade.' });
    m.setDate('2026-10-29');
    m.field('dur', 'two');
    expect(m.build()).toEqual({ error: 'Duration is a number of months.' });
    m.field('dur', '');
    expect('fill' in m.build()).toBe(true);
  });

  it('is told to the person in the old page\'s words', () => {
    const { deps } = rig();
    const m = filled(deps);
    const f = (m.build() as { fill: Fill }).fill;
    expect(m.savedMessage(f)).toBe('Logged sell AME @ 1,234.5.');
    expect(new FillFormModel({ editing: manual }, deps).savedMessage(manual)).toBe('Saved the sell GDX @ 63.');
  });
});
