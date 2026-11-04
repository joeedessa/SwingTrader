/* A row of figures at the head of a page: a label, one number, and the sentence that says what it counts. The Positions
   and History pages both open with one. A tile with an action is a button (the nearest stop opens its setup). A tile
   with columns shows two figures side by side under their own captions (the Model: every leg beside the closed ones). */

export interface TileCol {
  /** The caption over the figure. */
  head: string;
  value: string;
  sub?: string;
  tone?: Tile['tone'];
}

export interface Tile {
  label: string;
  /** The figure; with columns, the first column's, for anything that reads a tile as one number. */
  value: string;
  sub?: string;
  /** Colours the value. */
  tone?: 'good' | 'bad' | 'warn';
  title?: string;
  /** Makes the tile a button. */
  onClick?: () => void;
  /** What the button does, for assistive technology. */
  action?: string;
  /** Two figures side by side, each under its caption, in place of the one value. */
  cols?: readonly TileCol[];
}

export function Tiles({ tiles, label }: { tiles: readonly Tile[]; label: string }) {
  return (
    <dl class="tiles" aria-label={label}>
      {tiles.map(t => (
        <div class={'tile' + (t.onClick ? ' hasact' : '') + (t.cols ? ' pair' : '')} title={t.title}>
          <dt>{t.label}</dt>
          <dd>
            {t.cols ? (
              <span class="tvs">
                {t.cols.map(c => (
                  <span class="tcol" key={c.head}>
                    <span class="th">{c.head}</span>
                    <span class={'tv' + (c.tone ? ' tone-' + c.tone : '')}>{c.value}</span>
                    {c.sub ? <span class="ts">{c.sub}</span> : null}
                  </span>
                ))}
              </span>
            ) : t.onClick
              ? <button type="button" class={'tv' + (t.tone ? ' tone-' + t.tone : '')} aria-label={t.action ?? t.label + ': ' + t.value} onClick={t.onClick}>{t.value}</button>
              : <span class={'tv' + (t.tone ? ' tone-' + t.tone : '')}>{t.value}</span>}
            {!t.cols && t.sub ? <span class="ts">{t.sub}</span> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}
