import { useState } from 'preact/hooks';
import type { Flag } from '../engine/flags';
import { daysTag, direction, fmt, fmtD, humanDates, MINUS, signedPct } from '../engine/format';
import type { Row } from '../engine/row';
import { SECTION_LABELS } from '../engine/types';
import type { Setup } from '../engine/types';
import { editedFields } from '../data/overlay';
import type { LevelChanges, Overlay } from '../data/overlay';
import { Confirm } from './components';
import { addedText, brokeOutCell, breachesCell, lfdCell, negationCell, pullbacksText, statusCell, targetCell, trailingStopCell, triggerCell, typeCell } from './cells';
import type { Cell } from './cells';
import { CellView } from './board';
import type { DrawerData } from './drawerdata';
import { AveragesSection, DSection as Section, EarningsSection, FlagsSection } from './drawersections';
import { EditLevels } from './forms';
import { IconExternal } from './icons';
import { chartUrl } from './links';

/* The drawer: everything about one setup that does not fit a table row. Every level with how it was arrived at
   (the text a tooltip gives on the desktop, written out here so a phone can read it), the setup's own events,
   the calendar, the facts, and the actions. */

export type Action = 'breakout' | 'remove' | 'fail' | 'delete' | 'restore' | 'undo';

export function DrawerHeading({ r }: { r: Row }) {
  return (
    <span class="dhead">
      <span class="dsym">{r.p.sym}</span>
      <span class={'dirpill ' + r.p.dir}>{r.p.dir}</span>
      <span class={'secbadge sec-' + r.section}>{SECTION_LABELS[r.section]}</span>
    </span>
  );
}

const Level = ({ label, cell, edited, onReset, extra }: {
  label: string; cell: Cell; edited?: { shared: string; field: string }; onReset?: (field: string) => void; extra?: string;
}) => (
  <div class="lvl">
    <dt>{label}</dt>
    <dd>
      <CellView cell={{ ...cell, title: undefined }} />
      {edited ? (
        <div class="edited">
          Edited in this browser · shared value {edited.shared}
          {onReset ? <button type="button" class="linkbtn" onClick={() => onReset(edited.field)}>Reset</button> : null}
        </div>
      ) : null}
      {cell.title ? <p class="note">{humanDates(cell.title)}</p> : null}
      {extra ? <p class="note">{extra}</p> : null}
    </dd>
  </div>
);

export function SetupDrawer({ r, sharedRow, overlay, showExDiv, today, canAct, canLog, data, onAck, onUndo, onLog, onEdit, onResetField, onAction }: {
  r: Row;
  /** The row as the repo has it, for rows that came from the shared list; null for rows added here. */
  sharedRow: Setup | null;
  overlay: Overlay;
  /** Lists with a calendar (the watchlist) edit and show the ex-dividend date; benchmarks do not. */
  showExDiv: boolean;
  today: string;
  canAct: boolean;
  /** The watchlist keeps a journal; the benchmarks do not. */
  canLog: boolean;
  data: DrawerData;
  onAck: (flags: Flag[]) => void;
  onUndo: (flags: Flag[]) => void;
  onLog: () => void;
  onEdit: (changes: LevelChanges) => void;
  onResetField: (field: string) => void;
  onAction: (a: Action) => void;
}) {
  const { p, st } = r;
  const [editing, setEditing] = useState(false);
  const [asking, setAsking] = useState<Action | null>(null);
  const section = r.section;
  const edits = sharedRow ? editedFields(overlay, sharedRow) : [];
  const editedOf = (field: string) => {
    const e = edits.find(x => x.field === field);
    return e ? { field, shared: e.shared == null ? 'none' : String(e.shared) } : undefined;
  };
  const T = r.btype;
  const trailing = trailingStopCell(r, today);
  const earn = r.earnings ? daysTag(r.earnings, today) : null;
  const exTag = r.exdiv ? daysTag(r.exdiv, today) : null;
  const dayDir = r.dayPct != null ? direction(r.dayPct) : null;

  const MESSAGES: Record<Action, [text: string, confirm: string, danger?: boolean]> = {
    breakout: [`Move ${p.sym} ${p.dir} to Confirmed now? The rules keep running underneath: a negation or a target still wins.`, 'Move to Confirmed'],
    remove: [`Remove ${p.sym} ${p.dir} from the list? It moves to Removed and can be restored.`, 'Remove', true],
    fail: [`Move ${p.sym} ${p.dir} to Failed? Restore is available afterwards.`, 'Move to Failed', true],
    delete: [`Delete ${p.sym} ${p.dir} permanently? It was added in this browser and is not kept anywhere else.`, 'Delete', true],
    restore: ['', ''],
    undo: ['', ''],
  };

  const buttons: { a: Action; label: string; hint: string }[] = [];
  if (canAct) {
    if (p.manualState === 'removed' || p.manualState === 'failed') {
      buttons.push({ a: 'restore', label: 'Restore', hint: p.manualState === 'removed' ? 'Put this setup back on the list' : 'Undo the manual move to Failed' });
    } else if (section === 'watch') {
      buttons.push({ a: 'breakout', label: 'Mark as breakout', hint: 'Move to Confirmed now, without waiting for a close past the trigger' });
      buttons.push({ a: 'remove', label: 'Remove', hint: 'Take this off the list; it moves to Removed and can be restored' });
    } else if (section === 'breakout' || section === 'reentered' || section === 'stopped' || section === 'target') {
      if (p.manualState === 'breakout') buttons.push({ a: 'undo', label: 'Undo breakout', hint: 'Send this back to Watching: it was promoted by hand' });
      buttons.push({ a: 'fail', label: 'Mark as failed', hint: 'Move to Failed manually' });
    }
    if (!p.shared) buttons.push({ a: 'delete', label: 'Delete', hint: 'Remove it from this browser for good' });
  }

  return (
    <div class="drawer">
      <div class="dtop">
        <div>
          {p.note ? <div class="dname">{p.note}</div> : null}
          <div class="s">{[p.country, p.exchange, r.currency].filter(Boolean).join(' · ')}</div>
        </div>
        <div class="dtopbtns">
          {canLog ? <button type="button" class="btn" onClick={onLog}>Log fill</button> : null}
          <a class="btn" href={chartUrl(p.sym)} target="_blank" rel="noopener noreferrer">Chart <IconExternal /></a>
        </div>
      </div>

      <Section title="Price">
        <div class="pricebox">
          <div class="bigprice">{r.live != null ? fmt(r.live) : '–'}<span class="ccy">{r.currency}</span></div>
          {r.dayPct != null ? <span class={'chg ' + dayDir}>{signedPct(r.dayPct)}</span> : null}
          {r.isLive ? <span class="livedot">live</span> : null}
        </div>
        <p class="note">
          {r.prevClose != null
            ? <>Last settled close {fmt(r.prevClose)} on {fmtD(r.prevDate)}{r.prevClose2 != null ? <>, prior {fmt(r.prevClose2)}</> : null}
              {r.prevChg != null ? <> ({r.prevChg > 0 ? '+' : r.prevChg < 0 ? MINUS : ''}{fmt(Math.abs(r.prevChg))}% on the day)</> : null}. The rules read settled closes only.</>
            : 'No price history for this symbol yet.'}
        </p>
      </Section>

      <Section title="Levels" action={!editing && canAct ? <button type="button" class="btn small" onClick={() => setEditing(true)}>Edit levels</button> : undefined}>
        {editing ? (
          <EditLevels r={r} showExDiv={showExDiv} onCancel={() => setEditing(false)}
            onSave={changes => { onEdit(changes); setEditing(false); }} />
        ) : (
          <dl class="levels">
            <Level label="Trigger" cell={triggerCell(r, section)} edited={editedOf('breakthrough')} onReset={onResetField}
              extra={'A settled close ' + (p.dir === 'long' ? 'above' : 'below') + ' it confirms the breakout.'} />
            {p.boundary != null ? <Level label="Boundary" cell={{ value: fmt(p.boundary) }} edited={editedOf('boundary')} onReset={onResetField}
              extra="The pattern level. The tight stop is recorded on the first close past it." /> : null}
            <Level label="Target" cell={targetCell(r, section)} edited={editedOf('target')} onReset={onResetField} />
            <Level label="Negation" cell={negationCell(r, section)} edited={editedOf('negation')} onReset={onResetField}
              extra={p.negation != null ? 'A touch (the ' + (p.dir === 'long' ? 'low' : 'high') + ') after the breakout fails the trade. Failed is final.' : undefined} />
            <Level label="Tight stop" cell={lfdCell(r, section)} edited={editedOf('lfd')} onReset={onResetField} />
            {trailing ? <Level label="Trailing stop" cell={trailing} /> : null}
          </dl>
        )}
      </Section>

      {T && T.tag && T.tag !== 'B4' ? (
        <Section title="Type">
          <div class="typebox"><CellView cell={{ ...typeCell(r), title: undefined }} /></div>
          {typeCell(r).title ? <p class="note">{humanDates(typeCell(r).title!)}</p> : null}
          {T.breaches && T.breaches.length ? (
            <>
              <div class="statusline"><CellView cell={{ ...statusCell(r), title: undefined }} /></div>
              {statusCell(r).title ? <p class="note">{humanDates(statusCell(r).title!)}</p> : null}
            </>
          ) : null}
          {T.pullbacks && T.pullbacks.length ? <><h4>Pullbacks through the trigger</h4><pre class="list">{humanDates(pullbacksText(r))}</pre></> : null}
          {T.breaches && T.breaches.length ? <><h4>Exits at the last full day</h4><pre class="list">{humanDates(breachesCell(r).title || '')}</pre></> : null}
        </Section>
      ) : null}

      <FlagsSection timeline={data.timeline} onAck={onAck} onUndo={onUndo} />

      <AveragesSection lines={data.averages} />

      {data.earnings ? <EarningsSection v={data.earnings} ccy={r.currency} today={today} sym={p.sym} name={p.note || ''} live={r.live} /> : null}

      <Section title="Calendar">
        <dl class="facts">
          <div><dt>Earnings</dt><dd>{r.earnings ? <>{fmtD(r.earnings)}{earn ? <span class={'days ' + earn.cls}>{earn.text}</span> : null}{r.ev.earnings_to && r.ev.earnings_to !== r.earnings ? <span class="s"> to {fmtD(r.ev.earnings_to as string)}</span> : null}</> : '–'}</dd></div>
          <div><dt>Ex-dividend</dt><dd>{r.exdiv ? <>{fmtD(r.exdiv)}{exTag ? <span class={'days ' + exTag.cls}>{exTag.text}</span> : null}{p.ex_div ? <span class="s"> manual</span> : null}{r.ev.div_amount != null && !p.ex_div ? <span class="s"> {fmt(r.ev.div_amount)} {r.currency}</span> : null}</> : '–'}</dd></div>
        </dl>
      </Section>

      <Section title="About this setup">
        <dl class="facts">
          {p.pattern ? <div><dt>Pattern</dt><dd>{p.pattern}{p.duration_m != null ? <span class="s"> · {p.duration_m} {p.duration_m === 1 ? 'month' : 'months'}</span> : null}</dd></div> : null}
          <div><dt>Added</dt><dd>{addedText(r, today)}</dd></div>
          {st.breakout ? <div><dt>Broke out</dt><dd>{brokeOutCell(r).value}<span class="s"> {brokeOutCell(r).sub}</span></dd></div> : null}
          {p.removed ? <div><dt>Dropped by source</dt><dd>{fmtD(p.removed)}{p.removed_reason ? <span class="s"> · {p.removed_reason}</span> : null}</dd></div> : null}
          {p.source_open && p.source_open.length ? <div><dt>Still on the sheet</dt><dd>{p.source_open.map(fmtD).join(', ')}</dd></div> : null}
          <div><dt>Kept</dt><dd>{p.shared ? 'In the shared list' : 'Only in this browser'}</dd></div>
        </dl>
      </Section>

      {buttons.length ? (
        <Section title="Actions">
          {asking && MESSAGES[asking][0] ? (
            <Confirm text={MESSAGES[asking][0]} confirmLabel={MESSAGES[asking][1]} danger={MESSAGES[asking][2]}
              onCancel={() => setAsking(null)} onConfirm={() => { const a = asking; setAsking(null); onAction(a); }} />
          ) : (
            <div class="actions">
              {buttons.map(b => (
                <button type="button" class={'btn' + (b.a === 'delete' || b.a === 'fail' || b.a === 'remove' ? ' quiet-danger' : '')} title={b.hint}
                  onClick={() => (b.a === 'restore' || b.a === 'undo') ? onAction(b.a) : setAsking(b.a)}>{b.label}</button>
              ))}
            </div>
          )}
        </Section>
      ) : null}
    </div>
  );
}
