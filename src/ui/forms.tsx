import { useEffect, useRef, useState } from 'preact/hooks';
import { fmt } from '../engine/format';
import { LEVEL_FIELDS } from '../data/overlay';
import type { LevelChanges, LevelField } from '../data/overlay';
import type { Row } from '../engine/row';
import type { Setup } from '../engine/types';

/* Two forms: the levels of one setup (inside the drawer), and a new setup. Numbers are typed as text and
   parsed here so a blank field means "no level" rather than 0, and the phone's keyboard is the decimal one. */

const toNum = (s: string): number | null | 'bad' => {
  const t = s.trim().replace(/,/g, '');
  if (t === '') return null;
  const n = Number(t);
  return isFinite(n) ? n : 'bad';
};

const LABELS: Record<LevelField, string> = {
  breakthrough: 'Trigger', boundary: 'Boundary', target: 'Target', negation: 'Negation', lfd: 'Tight stop',
};

const Field = ({ id, label, hint, children }: { id: string; label: string; hint?: string; children: preact.ComponentChildren }) => (
  <div class="field">
    <label for={id}>{label}</label>
    {children}
    {hint ? <div class="hint">{hint}</div> : null}
  </div>
);

export function EditLevels({ r, showExDiv, onSave, onCancel }: {
  r: Row;
  showExDiv: boolean;
  onSave: (changes: LevelChanges) => void;
  onCancel: () => void;
}) {
  const { p } = r;
  const start = (f: LevelField) => (p[f] != null ? String(p[f]) : '');
  const [vals, setVals] = useState<Record<LevelField, string>>(() => Object.fromEntries(LEVEL_FIELDS.map(f => [f, start(f)])) as Record<LevelField, string>);
  const [exDiv, setExDiv] = useState(p.ex_div || '');
  const [error, setError] = useState('');
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => { first.current?.focus(); first.current?.select(); }, []);

  const submit = (e: Event) => {
    e.preventDefault();
    const changes: LevelChanges = {};
    for (const f of LEVEL_FIELDS) {
      const n = toNum(vals[f]);
      if (n === 'bad') { setError(LABELS[f] + ' must be a number.'); return; }
      if (n !== (p[f] ?? null)) changes[f] = n;
    }
    if (showExDiv && (exDiv || null) !== (p.ex_div ?? null)) changes.ex_div = exDiv || null;
    onSave(changes);
  };

  return (
    <form class="form" onSubmit={submit} noValidate>
      <div class="grid2">
        {LEVEL_FIELDS.map((f, i) => (
          <Field id={'lv-' + f} label={LABELS[f]} hint={f === 'lfd' ? 'Blank derives it from the bars.' : undefined}>
            <input id={'lv-' + f} type="text" inputMode="decimal" autocomplete="off" value={vals[f]} ref={i === 0 ? first : undefined}
              placeholder={f === 'lfd' && r.lfd && r.lfd.src === 'derived' ? fmt(r.lfd.at) : ''}
              onInput={e => setVals(v => ({ ...v, [f]: (e.target as HTMLInputElement).value }))} />
          </Field>
        ))}
        {showExDiv ? (
          <Field id="lv-exdiv" label="Ex-dividend date" hint="Overrides the feed.">
            <input id="lv-exdiv" type="date" value={exDiv} onInput={e => setExDiv((e.target as HTMLInputElement).value)} />
          </Field>
        ) : null}
      </div>
      {error ? <p class="formerror" role="alert">{error}</p> : null}
      <div class="row">
        <button type="button" class="btn" onClick={onCancel}>Cancel</button>
        <button type="submit" class="btn primary">Save</button>
      </div>
    </form>
  );
}

export function AddSetup({ onAdd, onCancel }: {
  /** Returns an error message, or null when the setup was added. */
  onAdd: (s: Setup) => string | null;
  onCancel: () => void;
}) {
  const [sym, setSym] = useState('');
  const [dir, setDir] = useState<'long' | 'short'>('long');
  const [vals, setVals] = useState({ breakthrough: '', boundary: '', target: '', negation: '' });
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const submit = (e: Event) => {
    e.preventDefault();
    const nums: Record<string, number | null> = {};
    for (const [k, v] of Object.entries(vals)) {
      const n = toNum(v);
      if (n === 'bad') { setError(k === 'breakthrough' ? 'Trigger must be a number.' : k[0].toUpperCase() + k.slice(1) + ' must be a number.'); return; }
      nums[k] = n;
    }
    const msg = onAdd({
      sym: sym.trim().toUpperCase(), dir,
      breakthrough: nums.breakthrough, boundary: nums.boundary, target: nums.target, negation: nums.negation,
      note: note.trim(), created: new Date().toISOString().slice(0, 10),
    });
    if (msg) setError(msg);
  };
  const num = (k: keyof typeof vals) => (e: Event) => setVals(v => ({ ...v, [k]: (e.target as HTMLInputElement).value }));
  const closer = dir === 'long' ? 'close above' : 'close below';
  return (
    <form class="form" onSubmit={submit} noValidate>
      <div class="grid2">
        <Field id="add-sym" label="Symbol" hint="Yahoo's symbol, e.g. GDX or 7936.T.">
          <input id="add-sym" type="text" autocomplete="off" autocapitalize="characters" spellcheck={false} value={sym} data-autofocus
            onInput={e => setSym((e.target as HTMLInputElement).value)} />
        </Field>
        <Field id="add-dir" label="Direction">
          <select id="add-dir" value={dir} onChange={e => setDir((e.target as HTMLSelectElement).value as 'long' | 'short')}>
            <option value="long">Long</option>
            <option value="short">Short</option>
          </select>
        </Field>
        <Field id="add-brk" label="Trigger" hint={closer + ' confirms it'}>
          <input id="add-brk" type="text" inputMode="decimal" autocomplete="off" value={vals.breakthrough} onInput={num('breakthrough')} />
        </Field>
        <Field id="add-bnd" label="Boundary" hint="the pattern level">
          <input id="add-bnd" type="text" inputMode="decimal" autocomplete="off" value={vals.boundary} onInput={num('boundary')} />
        </Field>
        <Field id="add-tgt" label="Target" hint="where the thesis pays">
          <input id="add-tgt" type="text" inputMode="decimal" autocomplete="off" value={vals.target} onInput={num('target')} />
        </Field>
        <Field id="add-neg" label="Negation" hint={dir === 'long' ? 'invalidates below' : 'invalidates above'}>
          <input id="add-neg" type="text" inputMode="decimal" autocomplete="off" value={vals.negation} onInput={num('negation')} />
        </Field>
      </div>
      <Field id="add-note" label="Note" hint="Why this trade (optional).">
        <input id="add-note" type="text" autocomplete="off" value={note} onInput={e => setNote((e.target as HTMLInputElement).value)} />
      </Field>
      <p class="hint">Saved in this browser only. Its prices are fetched from Yahoo when you add it.</p>
      {error ? <p class="formerror" role="alert">{error}</p> : null}
      <div class="row">
        <button type="button" class="btn" onClick={onCancel}>Cancel</button>
        <button type="submit" class="btn primary">Add setup</button>
      </div>
    </form>
  );
}
