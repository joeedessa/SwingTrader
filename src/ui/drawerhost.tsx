import { app, updateOverlay } from '../data/app';
import { applyLevelEdit, clearManual, deleteAdded, resetField, saveEdit, SETS } from '../data/overlay';
import type { LevelChanges, SetId } from '../data/overlay';
import type { Board, Row } from '../engine/row';
import type { Setup } from '../engine/types';
import { closeRow, route } from '../router';
import { useStore } from '../store';
import { Modal } from './components';
import { DrawerHeading, SetupDrawer } from './drawer';
import type { Action } from './drawer';
import { say } from './notice';

/* The setup drawer, opened by the address (`#/today/AME/long`, `#/setups/AME/long`) over whichever page is showing.
   It is the same panel everywhere: the page that hosts it only has to hand over its list. */

export function DrawerHost({ set, bd, today, loading }: { set: SetId; bd: Board; today: string; loading: boolean }) {
  const s = useStore(app);
  const r = useStore(route);
  if (!r.row) return null;

  const meta = SETS[set];
  const { sym, dir } = r.row;
  const openRow = bd.rows.find(x => x.p.sym === sym && x.p.dir === dir) ?? null;
  const sharedRow = openRow ? s.shared[set].find(x => x.sym === openRow.p.sym && x.dir === openRow.p.dir) ?? null : null;

  const act = (x: Row, a: Action) => {
    const p = x.p as Setup & { shared: boolean };
    const label = `${p.sym} ${p.dir}`;
    if (a === 'breakout') { updateOverlay(set, ov => saveEdit(ov, p, { manualState: 'breakout', confirmed: today })); say(`${label} moved to Confirmed.`); }
    else if (a === 'remove') { updateOverlay(set, ov => saveEdit(ov, p, { manualState: 'removed' })); say(`${label} removed. Restore brings it back.`); }
    else if (a === 'fail') { updateOverlay(set, ov => saveEdit(ov, p, { manualState: 'failed' })); say(`${label} moved to Failed. Restore undoes it.`); }
    else if (a === 'restore' || a === 'undo') { updateOverlay(set, ov => clearManual(ov, p)); say(`${label} restored.`); }
    else if (a === 'delete') { updateOverlay(set, ov => deleteAdded(ov, p)); closeRow(); say(`${label} deleted.`); }
  };

  const onEdit = (x: Row, changes: LevelChanges) => {
    if (!Object.keys(changes).length) { say('Nothing changed.'); return; }
    const p = x.p as Setup & { shared: boolean };
    updateOverlay(set, ov => applyLevelEdit(ov, sharedRow, p, changes));
    say('Levels saved in this browser. The shared list is unchanged.');
  };

  return (
    <Modal id="drawer" title={`${sym} ${dir}`} variant="side" onClose={closeRow} heading={openRow ? <DrawerHeading r={openRow} /> : undefined}>
      {openRow ? (
        <SetupDrawer key={openRow.p.sym + openRow.p.dir} r={openRow} sharedRow={sharedRow} overlay={s.overlays[set]} showExDiv={meta.extras} today={today} canAct
          onEdit={c => onEdit(openRow, c)} onResetField={f => updateOverlay(set, ov => resetField(ov, openRow.p, f as never))} onAction={a => act(openRow, a)} />
      ) : loading ? <p class="note">Loading…</p> : (
        <div class="empty"><p>{sym} {dir} is not on this list.</p><button type="button" class="btn" onClick={closeRow}>Back to the board</button></div>
      )}
    </Modal>
  );
}
