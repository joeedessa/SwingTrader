import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { IconClose, IconDown } from './icons';
import { lockPage, unlockPage } from './modallock';

/* The small pieces the pages are built from: a segmented control, a popover, a modal. Each is a plain
   component with no knowledge of setups, so they stay easy to read and to reuse on the pages still to come. */

/* ------------------------------------------------------------------ segmented control */

export interface SegItem {
  id: string;
  label: string;
  /** A shorter label for a narrow screen. */
  short?: string;
  count?: number;
  /** Something in this segment is new since the last visit. */
  dot?: boolean;
}

export function Segmented({ items, value, onChange, label, panelId }: {
  items: SegItem[];
  value: string;
  onChange: (id: string) => void;
  label: string;
  panelId?: string;
}) {
  const move = (e: KeyboardEvent, i: number) => {
    const to = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : null;
    if (to == null) return;
    e.preventDefault();
    const next = items[(to + items.length) % items.length];
    onChange(next.id);
    ((e.currentTarget as HTMLElement).parentElement?.querySelector(`[data-id="${next.id}"]`) as HTMLElement | null)?.focus();
  };
  return (
    <div class="seg" role="tablist" aria-label={label}>
      {items.map((it, i) => (
        <button type="button" role="tab" data-id={it.id} aria-selected={it.id === value} tabIndex={it.id === value ? 0 : -1}
          {...(panelId ? { 'aria-controls': panelId } : {})}
          onClick={() => onChange(it.id)} onKeyDown={e => move(e, i)}>
          <span class="lfull">{it.label}</span>
          <span class="lshort">{it.short ?? it.label}</span>
          {it.count != null && <span class="n">{it.count}</span>}
          {it.dot && <span class="segdot" role="img" aria-label="new since your last visit" />}
        </button>
      ))}
    </div>
  );
}

/** A small two- or three-way switch: the same look, no panel. */
export function Choice<T extends string>({ items, value, onChange, label }: {
  items: { id: T; label: string }[]; value: T; onChange: (id: T) => void; label: string;
}) {
  return (
    <div class="choice" role="group" aria-label={label}>
      {items.map(it => (
        <button type="button" aria-pressed={it.id === value} onClick={() => onChange(it.id)}>{it.label}</button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ popover */

/** A button that opens a panel under it. Closes on an outside press or Escape; Escape returns focus to the button.
    `round` is an icon-only trigger; `sheet` makes the panel a bottom sheet on a phone (for long lists). */
export function Popover({ label, badge, children, align = 'left', icon, round, sheet, triggerClass, current }: {
  label: string;
  badge?: number;
  children: ComponentChildren;
  align?: 'left' | 'right';
  icon?: ComponentChildren;
  round?: boolean;
  sheet?: boolean;
  /** Replaces the chip look of the trigger (the top bar's "More" looks like one of its own links). */
  triggerClass?: string;
  /** The trigger stands for the page being shown. */
  current?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); btn.current?.focus(); } };
    const inside = (e: Event) => { if ((e.target as HTMLElement).closest('[data-closes]')) setOpen(false); };
    document.addEventListener('pointerdown', down);
    document.addEventListener('keydown', key);
    box.current?.addEventListener('click', inside);
    const el = box.current;
    return () => { document.removeEventListener('pointerdown', down); document.removeEventListener('keydown', key); el?.removeEventListener('click', inside); };
  }, [open]);
  return (
    <div class="pop" ref={box}>
      {round ? (
        <button type="button" ref={btn} class="btn round" aria-label={label} aria-haspopup="true" aria-expanded={open} onClick={() => setOpen(o => !o)}>{icon}</button>
      ) : (
        <button type="button" ref={btn} class={triggerClass ?? 'chip' + (badge ? ' on' : '')} aria-haspopup="true" aria-expanded={open}
          aria-current={current ? 'page' : undefined} onClick={() => setOpen(o => !o)}>
          {label}{badge ? <span class="chipn">{badge}</span> : null}<IconDown />
        </button>
      )}
      {open && <div class={'poppanel ' + align + (sheet ? ' sheet' : '')} role="group" aria-label={label}>{children}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ modal */

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** A dialog over the page. `side` is the setup drawer: a panel at the right on a desktop, a full-height sheet on a
    phone. `dialog` is a form: centred on a desktop, a bottom sheet on a phone. Everything behind it is inert while
    it is open, Escape and the scrim close it, Tab stays inside, and focus goes back to where it came from. */
export function Modal({ title, heading, variant, onClose, children, id }: {
  title: string;
  /** Replaces the plain title in the header (the drawer shows the symbol and its direction). */
  heading?: ComponentChildren;
  variant: 'side' | 'dialog';
  onClose: () => void;
  children: ComponentChildren;
  id: string;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // An effect that runs after its modal has already gone (the drawer closed in the same breath as a form opened) has nothing
    // to lock, and no cleanup will come for it.
    if (!panel.current) return;
    lockPage();
    const first = panel.current?.querySelector<HTMLElement>('[data-autofocus]') ?? panel.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel.current)?.focus({ preventScroll: true });
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
      if (e.key !== 'Tab' || !panel.current) return;
      const f = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(n => n.offsetParent !== null);
      if (!f.length) { e.preventDefault(); return; }
      const a = document.activeElement;
      if (e.shiftKey && (a === f[0] || a === panel.current)) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && a === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    };
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      // Only the last modal to close gives the page back, and focus with it.
      const back = unlockPage();
      if (back instanceof HTMLElement) back.focus({ preventScroll: true });
    };
  }, []);
  return (
    <div class={'modal ' + variant}>
      <div class="scrim" onClick={onClose} />
      <div class="modalpanel" role="dialog" aria-modal="true" aria-labelledby={id + '-title'} ref={panel} tabIndex={-1}>
        <div class="grab" aria-hidden="true" />
        <header class="modalhead">
          <h2 id={id + '-title'} aria-label={title}>{heading ?? title}</h2>
          <button type="button" class="iconbtn" aria-label="Close" onClick={onClose}><IconClose /></button>
        </header>
        <div class="modalbody">{children}</div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ a line that asks first */

export function Confirm({ text, confirmLabel, onConfirm, onCancel, danger }: {
  text: string; confirmLabel: string; onConfirm: () => void; onCancel: () => void; danger?: boolean;
}) {
  return (
    <div class="confirm" role="alertdialog" aria-label={text}>
      <p>{text}</p>
      <div class="row">
        <button type="button" class="btn" data-autofocus onClick={onCancel}>Cancel</button>
        <button type="button" class={'btn ' + (danger ? 'danger' : 'primary')} onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </div>
  );
}
