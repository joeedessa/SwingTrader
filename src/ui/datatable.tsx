import type { ComponentChildren } from 'preact';

/* A plain list drawn two ways from one set of columns, the way the board is: a table on a desktop, a stack of cards on a
   phone. The journal's three tables use it. The first column leads a card (the symbol); the rest are its figures. */

export interface DCol<T> {
  key: string;
  label: string;
  /** Words, not numbers: left-aligned. */
  text?: boolean;
  /** Nothing (null) leaves an empty table cell, and no line at all on a card. */
  cell: (row: T) => ComponentChildren;
}

export function DataTable<T>({ rows, cols, label, id, narrow, rowKey }: {
  rows: readonly T[];
  cols: readonly DCol<T>[];
  label: string;
  id: string;
  narrow: boolean;
  rowKey: (row: T) => string;
}) {
  if (narrow) {
    const [lead, ...rest] = cols;
    return (
      <ul class="cards jcards" id={id} aria-label={label}>
        {rows.map(t => (
          <li key={rowKey(t)} class="card">
            <div class="cardhead"><div class="cardsym">{lead.cell(t)}</div></div>
            <dl class="metrics jmetrics">
              {rest.map(c => {
                // A figure with nothing to say is left off the card rather than shown with a label and no value.
                const v = c.cell(t);
                return v == null || v === false || v === '' ? null : <div class="metric"><dt>{c.label}</dt><dd>{v}</dd></div>;
              })}
            </dl>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <table class="board jtable" id={id} aria-label={label}>
      <thead>
        <tr>{cols.map(c => <th scope="col" class={c.text ? 'text' : undefined}><span class="thbtn static">{c.label}</span></th>)}</tr>
      </thead>
      <tbody>
        {rows.map(t => <tr key={rowKey(t)}>{cols.map(c => <td class={c.text ? 'text' : undefined}>{c.cell(t)}</td>)}</tr>)}
      </tbody>
    </table>
  );
}
