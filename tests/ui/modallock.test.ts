import { beforeEach, describe, expect, it } from 'vitest';
import { lockPage, modalDepth, unlockPage } from '../../src/ui/modallock';

/* The setup drawer is closing as the form opened from it appears, so two modals overlap for a moment. Whichever closes first
   must not give the page back, or take focus, while the other is still open. A fake page stands in for the document. */

type Fake = { attrs: Set<string>; setAttribute(n: string): void; removeAttribute(n: string): void };
const el = (): Fake => {
  const attrs = new Set<string>();
  return { attrs, setAttribute: n => void attrs.add(n), removeAttribute: n => void attrs.delete(n) };
};

function page(underlays = 3) {
  const behind = Array.from({ length: underlays }, el);
  const classes = new Set<string>();
  const inDom = new Set<unknown>();
  const doc = {
    activeElement: null as unknown as Element | null,
    querySelectorAll: () => behind as unknown as ArrayLike<Element>,
    documentElement: { classList: { add: (c: string) => void classes.add(c), remove: (c: string) => void classes.delete(c) } },
    contains: (n: Element | null) => inDom.has(n),
  };
  return { doc, behind, classes, inDom, focus: (e: unknown) => { doc.activeElement = e as Element; inDom.add(e); } };
}

beforeEach(() => { while (modalDepth() > 0) unlockPage(page().doc); });

describe('one modal', () => {
  it('makes the page behind inert and unscrollable, and gives both back, with focus, when it closes', () => {
    const p = page();
    const button = {};
    p.focus(button);
    lockPage(p.doc);
    expect(p.behind.every(b => b.attrs.has('inert'))).toBe(true);
    expect(p.classes.has('locked')).toBe(true);
    expect(modalDepth()).toBe(1);
    expect(unlockPage(p.doc)).toBe(button);
    expect(p.behind.some(b => b.attrs.has('inert'))).toBe(false);
    expect(p.classes.has('locked')).toBe(false);
    expect(modalDepth()).toBe(0);
  });

  it('does not offer focus back to something that has left the page', () => {
    const p = page();
    const gone = {};
    p.doc.activeElement = gone as unknown as Element;      // never in the page's DOM
    lockPage(p.doc);
    expect(unlockPage(p.doc)).toBeNull();
  });
});

describe('two modals at once: the drawer closing as a form opens', () => {
  it('keeps the page locked, and focus where it is, when the first one closes while the second is open', () => {
    const p = page();
    const rowButton = {}, formField = {};
    p.focus(rowButton);
    lockPage(p.doc);                  // the drawer
    p.focus(formField);
    lockPage(p.doc);                  // the form, opened from the drawer
    expect(modalDepth()).toBe(2);
    expect(unlockPage(p.doc)).toBeNull();            // the drawer goes: nothing is given back
    expect(p.behind.every(b => b.attrs.has('inert'))).toBe(true);
    expect(p.classes.has('locked')).toBe(true);
    expect(p.doc.activeElement).toBe(formField);    // and focus was not touched
    expect(modalDepth()).toBe(1);
  });

  it('gives the page back, and focus to what had it before the first, when the last one closes', () => {
    const p = page();
    const rowButton = {}, formField = {};
    p.focus(rowButton);
    lockPage(p.doc);
    p.focus(formField);
    lockPage(p.doc);
    unlockPage(p.doc);
    expect(unlockPage(p.doc)).toBe(rowButton);
    expect(p.behind.some(b => b.attrs.has('inert'))).toBe(false);
    expect(p.classes.has('locked')).toBe(false);
  });

  it('makes inert something the page drew while the first modal was open', () => {
    const p = page(1);
    lockPage(p.doc);
    const late = el();
    (p.behind as Fake[]).push(late);
    lockPage(p.doc);
    expect(late.attrs.has('inert')).toBe(true);
    unlockPage(p.doc);
    unlockPage(p.doc);
    expect(late.attrs.has('inert')).toBe(false);
  });
});

describe('closing more than was opened', () => {
  it('does nothing, and does not go negative', () => {
    const p = page();
    expect(unlockPage(p.doc)).toBeNull();
    expect(modalDepth()).toBe(0);
    lockPage(p.doc);
    expect(modalDepth()).toBe(1);
    unlockPage(p.doc);
  });
});
