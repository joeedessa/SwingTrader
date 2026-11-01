import type { Row } from '../engine/row';
import type { Section } from '../engine/types';
import { SECTION_LABELS } from '../engine/types';
import { humanDates } from '../engine/format';
import { liveCell, symbolCell } from './cells';
import type { Cell } from './cells';
import { COLUMNS, LIVE_SORT, SYMBOL_SORT } from './columns';
import type { Sort } from './columns';
import { IconExternal } from './icons';
import { chartUrl } from './links';

/* The board, drawn two ways from one list of columns: a table on a desktop, a stack of cards on a phone.
   Nothing here decides what a cell says (see cells.ts); this only lays it out. */

export const rowKey = (r: Row): string => r.p.sym + '|' + r.p.dir;

export function CellView({ cell }: { cell: Cell }) {
  return (
    <div class="cell" title={cell.title ? humanDates(cell.title) : undefined}>
      <div class={'v' + (cell.tone ? ' tone-' + cell.tone : '')}>
        {cell.badge ? <span class={'btag ' + cell.badge.cls}>{cell.badge.text}</span> : cell.value}
      </div>
      {cell.sub ? <div class={'s' + (cell.subTone ? ' tone-' + cell.subTone : '')}>{cell.sub}</div> : null}
    </div>
  );
}

const DirPill = ({ dir }: { dir: 'long' | 'short' }) => <span class={'dirpill ' + dir}>{dir}</span>;

const ChartLink = ({ sym }: { sym: string }) => (
  <a class="ext" href={chartUrl(sym)} target="_blank" rel="noopener noreferrer" aria-label={sym + ' chart on Yahoo Finance, opens in a new tab'}>
    <IconExternal />
  </a>
);

export function LiveView({ r }: { r: Row }) {
  const c = liveCell(r);
  return (
    <div class="livecell">
      <div class="v">{c.price}{c.ccy ? <span class="ccy">{c.ccy}</span> : null}</div>
      <div class="s">
        {c.day ? <span class={'chg ' + c.day.dir}>{c.day.text}</span> : null}
        {c.live ? <span class="livedot" title="A session is open: this is a live price, not a settled close">live</span> : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ table */

function Th({ id, label, sub, sort, onSort, sortable = true, className }: {
  id: string; label: string; sub?: string; sort: Sort; onSort: (key: string) => void; sortable?: boolean; className?: string;
}) {
  const on = sortable && sort[0] === id;
  return (
    <th scope="col" class={className} aria-sort={on ? (sort[1] ? 'ascending' : 'descending') : undefined}>
      {sortable
        ? <button type="button" class="thbtn" onClick={() => onSort(id)}>{label}<span class="sortmark" aria-hidden="true">{on ? (sort[1] ? '▲' : '▼') : ''}</span></button>
        : <span class="thbtn static">{label}</span>}
      {sub ? <span class="hsub">{sub}</span> : null}
    </th>
  );
}

export function BoardTable({ rows, section, sort, onSort, onOpen, today, panelId }: {
  rows: Row[];
  section: Section;
  sort: Sort;
  onSort: (key: string) => void;
  onOpen: (r: Row) => void;
  today: string;
  panelId: string;
}) {
  const cols = COLUMNS[section];
  return (
    <table class="board" id={panelId} aria-label={SECTION_LABELS[section] + ' setups'}>
      <thead>
        <tr>
          <Th id={SYMBOL_SORT} label="Symbol" sub="settled closes drive the rules" sort={sort} onSort={onSort} className="left" />
          <Th id={LIVE_SORT} label="Live" sub="day move" sort={sort} onSort={onSort} />
          {cols.map(c => <Th id={c.key} label={c.label} sub={c.sub} sort={sort} onSort={onSort} sortable={!!c.sortBy} className={c.text ? 'text' : undefined} />)}
        </tr>
      </thead>
      <tbody>
        {rows.map(r => {
          const s = symbolCell(r);
          return (
            <tr key={rowKey(r)} class="row" onClick={e => { if (!(e.target as HTMLElement).closest('a, button')) onOpen(r); }}>
              <td class="left">
                <div class="symline">
                  <button type="button" class="symbtn" onClick={() => onOpen(r)} aria-label={`${s.sym} ${s.dir}: open details`}>{s.sym}</button>
                  <DirPill dir={s.dir} />
                  <ChartLink sym={s.sym} />
                </div>
                {s.name ? <div class="s name">{s.name}</div> : null}
              </td>
              <td><LiveView r={r} /></td>
              {cols.map(c => <td class={c.text ? 'text' : undefined}><CellView cell={c.cell(r, section, today)} /></td>)}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/* ------------------------------------------------------------------ cards */

export function BoardCards({ rows, section, onOpen, today, panelId }: {
  rows: Row[];
  section: Section;
  onOpen: (r: Row) => void;
  today: string;
  panelId: string;
}) {
  const cols = COLUMNS[section];
  return (
    <ul class="cards" id={panelId} aria-label={SECTION_LABELS[section] + ' setups'}>
      {rows.map(r => {
        const s = symbolCell(r);
        const c = liveCell(r);
        return (
          <li key={rowKey(r)} class="card">
            <button type="button" class="cardhit" aria-label={`${s.sym} ${s.dir}: open details`} onClick={() => onOpen(r)} />
            <div class="cardhead">
              <div class="cardsym">
                <div class="symline"><span class="sym">{s.sym}</span><DirPill dir={s.dir} /><ChartLink sym={s.sym} /></div>
                {s.name ? <div class="s name">{s.name}</div> : null}
              </div>
              <div class="cardlive">
                <div class="v">{c.price}{c.ccy ? <span class="ccy">{c.ccy}</span> : null}</div>
                <div class="s">
                  {c.day ? <span class={'chg ' + c.day.dir}>{c.day.text}</span> : null}
                  {c.live ? <span class="livedot">live</span> : null}
                </div>
              </div>
            </div>
            <dl class="metrics">
              {cols.map(col => {
                const cell = col.cell(r, section, today);
                // A long line takes the whole row; short ones sit two to a row.
                const wide = (cell.sub || '').length > 24 || cell.value.length > 18;
                return (
                  <div class={'metric' + (wide ? ' full' : '')}>
                    <dt>{col.label}</dt>
                    <dd><CellView cell={cell} /></dd>
                  </div>
                );
              })}
            </dl>
          </li>
        );
      })}
    </ul>
  );
}
