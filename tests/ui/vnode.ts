import type { ComponentChildren, VNode } from 'preact';

/* A component is a function of its props, so what it does when pressed can be tested without a browser: call it, walk the
   tree it returns, and call the handlers it hung on its buttons. Function components inside the tree are called too. */

type Props = Record<string, unknown> & { children?: ComponentChildren };

const isNode = (x: unknown): x is VNode<Props> => !!x && typeof x === 'object' && 'type' in (x as object) && 'props' in (x as object);

/** Every element in a tree (calling the components in it) that the predicate accepts. */
export function findAll(node: ComponentChildren, test: (type: string, props: Props) => boolean): { type: string; props: Props }[] {
  const out: { type: string; props: Props }[] = [];
  const walk = (n: ComponentChildren): void => {
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (!isNode(n)) return;
    if (typeof n.type === 'function') { walk((n.type as (p: Props) => ComponentChildren)(n.props)); return; }
    if (test(n.type as string, n.props)) out.push({ type: n.type as string, props: n.props });
    walk(n.props.children);
  };
  walk(node);
  return out;
}

/** The buttons whose accessible name or text starts with the given words. */
export const buttons = (node: ComponentChildren, startsWith: string) =>
  findAll(node, (type, p) => type === 'button' && String(p['aria-label'] ?? textOf(p.children)).startsWith(startsWith));

export function textOf(n: ComponentChildren): string {
  if (Array.isArray(n)) return n.map(textOf).join('');
  if (n == null || typeof n === 'boolean') return '';
  if (typeof n === 'string' || typeof n === 'number') return String(n);
  if (isNode(n)) return typeof n.type === 'function' ? textOf((n.type as (p: Props) => ComponentChildren)(n.props)) : textOf(n.props.children);
  return '';
}
