/* More than one modal can be on screen at once: the setup drawer is closing as the form opened from it appears. The page
   behind is made inert and kept from scrolling by the first, and released only by the last; and focus goes back to where it
   was before the first, not to wherever the second one found it. Counting them is the whole job. */

interface PageLike {
  querySelectorAll(selector: string): ArrayLike<Element>;
  documentElement: { classList: { add(name: string): void; remove(name: string): void } };
  activeElement: Element | null;
  contains(node: Element | null): boolean;
}

let depth = 0;
let behind: Element[] = [];
let opener: Element | null = null;

/** A modal opened. The first one makes the page behind inert and remembers what had focus. */
export function lockPage(doc: PageLike = document): void {
  if (depth++ === 0) opener = doc.activeElement;
  // Re-read each time: the page behind may have drawn something new since the first modal opened.
  behind = [...new Set([...behind, ...Array.from(doc.querySelectorAll('[data-underlay]'))])];
  behind.forEach(n => n.setAttribute('inert', ''));
  doc.documentElement.classList.add('locked');
}

/** A modal closed. Returns the element focus should go back to once the last one has closed, and null while any is left
    (or when that element is gone). */
export function unlockPage(doc: PageLike = document): Element | null {
  if (depth === 0) return null;
  if (--depth > 0) return null;
  behind.forEach(n => n.removeAttribute('inert'));
  behind = [];
  doc.documentElement.classList.remove('locked');
  const back = opener && doc.contains(opener) ? opener : null;
  opener = null;
  return back;
}

/** For tests. */
export const modalDepth = (): number => depth;
