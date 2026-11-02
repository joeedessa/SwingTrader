/* A row of figures at the head of a page: a label, one number, and the sentence that says what it counts. The Positions
   and History pages both open with one. A tile with an action is a button (the nearest stop opens its setup). */

export interface Tile {
  label: string;
  value: string;
  sub?: string;
  /** Colours the value. */
  tone?: 'good' | 'bad' | 'warn';
  title?: string;
  /** Makes the tile a button. */
  onClick?: () => void;
  /** What the button does, for assistive technology. */
  action?: string;
}

export function Tiles({ tiles, label }: { tiles: readonly Tile[]; label: string }) {
  return (
    <dl class="tiles" aria-label={label}>
      {tiles.map(t => (
        <div class={'tile' + (t.onClick ? ' hasact' : '')} title={t.title}>
          <dt>{t.label}</dt>
          <dd>
            {t.onClick
              ? <button type="button" class={'tv' + (t.tone ? ' tone-' + t.tone : '')} aria-label={t.action ?? t.label + ': ' + t.value} onClick={t.onClick}>{t.value}</button>
              : <span class={'tv' + (t.tone ? ' tone-' + t.tone : '')}>{t.value}</span>}
            {t.sub ? <span class="ts">{t.sub}</span> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}
