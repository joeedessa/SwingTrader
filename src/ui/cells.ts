import { lfdRisk, pct1, rrOf, runupOf, sinceTarget, stopFor } from '../engine/derived';
import { agoText, count, daysTag, daysUntil, direction, fmt, fmtD, fmtRatio, MINUS, signedFmt, signedPct } from '../engine/format';
import { LFD_LOOKBACK } from '../engine/lfd';
import type { Row } from '../engine/row';
import type { Section } from '../engine/types';

/* What each cell says, as plain data. The components only lay these out, so the wording (which is the old
   page's, carried over) can be tested without a browser, and the drawer can show the same explanation a
   tooltip gives on the desktop. */

export type Tone = 'good' | 'bad' | 'warn' | 'held';

export interface Cell {
  value: string;
  sub?: string;
  /** Colours the value. */
  tone?: Tone;
  /** Colours the sub-line. */
  subTone?: Tone;
  /** The long explanation: a tooltip on the desktop, a paragraph in the drawer. */
  title?: string;
  /** A coloured pill in place of plain text (the breakout type). */
  badge?: { text: string; cls: string };
}

const OPEN: ReadonlySet<Section> = new Set<Section>(['breakout', 'reentered', 'stopped']);
const lowHigh = (r: Row) => (r.p.dir === 'long' ? 'low' : 'high');
const above = (r: Row) => (r.p.dir === 'long' ? 'above' : 'below');

/* ------------------------------------------------------------------ the two fixed columns */

export interface SymbolCell { sym: string; dir: 'long' | 'short'; name: string; ccy: string }

export const symbolCell = (r: Row): SymbolCell => ({ sym: r.p.sym, dir: r.p.dir, name: r.p.note || '', ccy: r.currency });

export interface LiveCell {
  price: string;
  ccy: string;
  day: { text: string; dir: 'up' | 'down' | 'flat' } | null;
  /** The price is a tick from a session still running, not a settled close. */
  live: boolean;
  liveDate: string;
}

export const liveCell = (r: Row): LiveCell => ({
  price: r.live != null ? fmt(r.live) : '–',
  ccy: r.currency,
  day: r.dayPct != null ? { text: signedPct(r.dayPct), dir: direction(r.dayPct) } : null,
  live: r.isLive,
  liveDate: r.liveDate,
});

/* ------------------------------------------------------------------ levels */

function gapSub(r: Row): { sub?: string; title?: string } {
  if (r.gap == null) return {};
  const money = r.gapAbs != null ? ' · ' + signedFmt(r.gapAbs) + ' ' + r.currency : '';
  return {
    sub: signedFmt(r.gap, '%') + ' to trigger' + money,
    ...(r.gapAbs != null ? { title: 'Needs to move ' + fmt(Math.abs(r.gapAbs)) + ' ' + r.currency + ' to reach the trigger' } : {}),
  };
}

export function triggerCell(r: Row, section: Section): Cell {
  const { p } = r;
  const value = fmt(p.breakthrough);
  if (section === 'watch' || section === 'removed') return { value, ...gapSub(r) };
  if (section === 'stopped') {
    const T = r.btype;
    const d = (r.prevClose && p.breakthrough)
      ? (p.dir === 'long' ? p.breakthrough / r.prevClose - 1 : 1 - p.breakthrough / r.prevClose) * 100 : null;
    const last = T && T.breaches && T.breaches.length ? T.breaches[T.breaches.length - 1] : null;
    return {
      value,
      ...(d != null ? { sub: signedFmt(pct1(d), '%') + ' to re-entry' } : {}),
      ...(last ? { title: 'Exited ' + last.when + '. A close ' + above(r) + ' ' + fmt(p.breakthrough) + ' is the re-entry signal; the negation (' + fmt(p.negation) + ') ends it.' } : {}),
    };
  }
  // Confirmed and re-entered: how far past the trigger, how much of the move is used, what entering now pays.
  const x = runupOf(p, r.live, r.prevClose, r.lfd);
  if (!x) return { value };
  const past = pct1(x.past) as number;
  const bits: string[] = [];
  bits.push(past >= 0 ? '+' + fmt(past) + '% past' : fmt(Math.abs(past)) + '% back under');
  if (past >= 0 && x.used != null) bits.push(Math.round(x.used * 100) + '% of move');
  if (x.rr != null) bits.push(fmtRatio(x.rr) + ' : 1 now');
  return {
    value,
    sub: bits.join(' · '),
    ...(x.used != null && x.used >= 1 ? { subTone: 'bad' as const } : x.used != null && x.used >= 0.5 ? { subTone: 'warn' as const } : {}),
    title: (past >= 0 ? fmt(past) + '% past' : fmt(Math.abs(past)) + '% back under') + ' the trigger (' + fmt(p.breakthrough) + ')' +
      (past >= 0 && x.used != null ? '; ' + Math.round(x.used * 100) + '% of the trigger → target move (' + fmt(p.target) + ') is used' : '') +
      (x.rr != null ? '. Entering here: ' + fmtRatio(x.rr) + ' : 1 against the ' + x.vs + '.' : '.'),
  };
}

export function targetCell(r: Row, section: Section): Cell {
  const value = fmt(r.p.target);
  if (section === 'watch') return { value, ...(r.upside != null ? { sub: signedFmt(r.upside, '%') + ' payoff' } : {}) };
  if (OPEN.has(section) && r.upside != null) return { value, sub: signedFmt(r.upside, '%') + ' to go' };
  return { value };
}

export function negationCell(r: Row, section: Section): Cell {
  const { p } = r;
  if (p.negation == null) return { value: '–', sub: 'not set', title: 'The source publishes a negation only once a setup has broken out.' };
  const cell: Cell = { value: fmt(p.negation) };
  if (OPEN.has(section) && r.risk != null) cell.sub = MINUS + fmt(Math.abs(r.risk)) + '% away';
  return cell;
}

export function lfdCell(r: Row, section: Section): Cell {
  const { p } = r;
  const L = r.lfd;
  if (L && L.src === 'none') {
    return { value: '–', sub: 'none in report',
      title: 'The report gives no last full day for this breakout — it predates June, when Tech Charts started recording it.' };
  }
  if (!L || L.at == null) {
    return { value: '–', title: section === 'watch'
      ? (p.boundary == null ? 'No pattern boundary on file. Edit the row to add it.'
        : 'Recorded on the first close ' + above(r) + ' the boundary at ' + fmt(p.boundary) + '.')
      : 'No close through the trigger within ' + LFD_LOOKBACK + ' sessions of the listed date, or no daily bars yet. Edit the row to enter the level from the report.' };
  }
  if (L.looser) {
    return { value: '–', sub: 'bar ' + fmtD(L.bar) + ' is past the negation',
      title: 'The full day before the confirming close (' + L.bar + ') reached ' + fmt(L.at) + ', beyond the negation at ' + fmt(p.negation) +
        ' — no tighter than the pattern itself. Edit the row to enter the level from the report.' };
  }
  const risk = lfdRisk(p.dir, L, r.live);
  const tip: string[] = [];
  if (L.src === 'report') tip.push('Entered from the report.');
  else {
    tip.push('The ' + lowHigh(r) + ' of ' + L.bar + ', the full day before the first close past the ' + L.kind + ' (' + L.anchor + ').');
    if (L.kind === 'trigger') tip.push('No pattern boundary on file, so the trigger is the anchor. Edit the row to add the boundary.');
  }
  if (L.pending) tip.push('Not a trade yet: a close ' + above(r) + ' ' + fmt(p.breakthrough) + ' confirms it, and the stop is tested from then.');
  if (L.alt) tip.push("Anchored to the confirming close instead (" + L.conf + ", Tech Charts' wording) it would be " + fmt(L.alt.at) + ', the ' + lowHigh(r) + ' of ' + L.alt.bar + '.');
  // Back in after an exit: the original level is the stop again, so an old touch is history, not a warning.
  const backIn = !!(L.hit && section === 'reentered' && r.btype && r.btype.reentry);
  if (L.hit && backIn) {
    tip.push('First taken out on ' + L.hit.when + ', then re-entered on ' + r.btype!.reentry!.when + ': the same level is the stop again, and a touch is exit ' +
      ((r.btype!.breaches || []).length + 1) + '.');
  } else if (L.hit) {
    tip.push('Taken out on ' + L.hit.when + ' — the tight stop is gone; the pattern still stands until the negation (' + fmt(p.negation) + ').');
  }
  const cell: Cell = { value: fmt(L.at), title: tip.join(' ') };
  if (L.hit && backIn) {
    cell.sub = (risk != null ? MINUS + fmt(Math.abs(risk)) + '% · ' : '') + 'first hit ' + fmtD(L.hit.when);
  } else if (L.hit) { cell.tone = 'bad'; cell.sub = 'hit ' + fmt(L.hit.at) + ' on ' + fmtD(L.hit.when); cell.subTone = 'held'; }
  else if (L.pending) cell.sub = 'past boundary ' + fmtD(L.anchor) + ' · not confirmed';
  else cell.sub = (risk != null ? MINUS + fmt(Math.abs(risk)) + '% · ' : '') +
    (L.src === 'report' ? 'from report' : 'bar ' + fmtD(L.bar) + (L.kind === 'trigger' ? ' · no boundary' : ''));
  return cell;
}

export function rrCell(r: Row): Cell {
  const { p } = r;
  const x = rrOf(p, r.lfd);
  if (!x) {
    if (p.target != null && p.breakthrough != null) {
      return { value: '–', sub: 'no stop yet',
        title: 'Fills in once the stock closes past its boundary' + (p.boundary != null ? ' (' + fmt(p.boundary) + ')' : '') +
          ' and the tight stop is recorded — before the trigger, when the position is sized.' };
    }
    return { value: '–' };
  }
  return {
    value: fmtRatio(x.ratio) + ' : 1',
    sub: 'vs ' + x.vs,
    ...(x.ratio < 1 ? { tone: 'bad' as const } : {}),
    title: 'Payoff ' + fmt(Math.abs((p.target as number) - (p.breakthrough as number))) + ' (trigger ' + fmt(p.breakthrough) + ' → target ' + fmt(p.target) +
      ') against ' + fmt(Math.abs((p.breakthrough as number) - x.stop)) + ' of risk to the ' + x.vs + ' at ' + fmt(x.stop) + '.',
  };
}

/* ------------------------------------------------------------------ type, status, counts */

export function typeCell(r: Row): Cell {
  const T = r.btype;
  if (!T || !T.tag) return { value: '–' };
  const lh = lowHigh(r);
  let sub: string, title: string;
  if (T.tag === 'B3') {
    const k = (T.breaches || []).length;
    sub = count('breach', k) + (T.final ? ' · then target' : '');
    title = 'Took out its last full day ' + lh + ' (' + fmt(T.stop) + ') on ' + (T.breaches || [])[0]?.when +
      ' without reaching the negation' + (T.final ? ', then reached the target.' : '.');
  } else if (T.tag === 'B2') {
    const k = (T.pullbacks || []).length;
    sub = (T.final ? '' : 'potential · ') + count('pullback', k);
    title = 'Pulled back through the trigger (' + fmt(T.trig) + ') ' + count('time', k) + ', first on ' + (T.pullbacks || [])[0]?.when +
      ', and has held its last full day' + (T.noStop ? ' — no last full day on file, so a B3 cannot be told apart.' : '.');
  } else if (T.tag === 'B4') {
    return { value: 'B4', badge: { text: 'B4', cls: 'b4' }, title: 'The negation was touched.' };
  } else {
    sub = T.final ? 'no pullback' : 'potential · no pullback';
    title = 'No pullback through the trigger (' + fmt(T.trig) + ') since the breakout' +
      (T.final ? ' — straight to target.' : '. A touch of it makes this a B2.');
  }
  return { value: T.tag, badge: { text: T.tag, cls: T.tag.toLowerCase() }, sub, title };
}

export function statusCell(r: Row): Cell {
  const T = r.btype;
  const { p } = r;
  if (!T || !T.breaches || !T.breaches.length) return { value: '–' };
  if (!T.out) {
    const re = T.reentry;
    const away = (r.live && T.stop != null)
      ? (p.dir === 'long' ? 1 - T.stop / r.live : T.stop / r.live - 1) * 100 : null;
    return {
      value: 'Re-entered', tone: 'good',
      sub: re ? fmtD(re.when) + ' @ ' + fmt(re.close) + (away != null ? ' · stop ' + fmt(T.stop) + ' (' + MINUS + fmt(Math.abs(pct1(away) as number)) + '%)' : '') : '',
      title: 'Re-entry ' + (T.reentries || []).length + ': closed back ' + above(r) + ' the trigger (' + fmt(p.breakthrough) +
        '). Stop is the original last full day, ' + fmt(T.stop) + ' — a touch is exit ' + (T.breaches.length + 1) + '.',
    };
  }
  return statusOut(r);
}

function statusOut(r: Row): Cell {
  const T = r.btype!;
  const last = T.breaches![T.breaches!.length - 1];
  return { value: 'Out', title: 'Exited ' + last.when + '. A close ' + above(r) + ' ' + fmt(r.p.breakthrough) + ' is the re-entry signal; the negation (' + fmt(r.p.negation) + ') ends it.' };
}

export function breachesCell(r: Row): Cell {
  const T = r.btype;
  if (!T || !T.breaches) return { value: '–' };
  const k = T.breaches.length;
  return {
    value: String(k),
    ...(k ? { sub: 'last ' + fmtD(T.breaches[k - 1].when) } : {}),
    title: T.breaches.map((x, i) => 'Exit ' + (i + 1) + ': ' + x.when + ' (' + fmt(x.at) + ')' +
      ((T.reentries || [])[i] ? ' → re-entry ' + (T.reentries || [])[i].when + ' @ ' + fmt((T.reentries || [])[i].close) : '')).join('\n'),
  };
}

export function pullbacksText(r: Row): string {
  const T = r.btype;
  if (!T || !T.pullbacks || !T.pullbacks.length) return 'No pullback through the trigger yet.';
  return T.pullbacks.map((x, i) => (i + 1) + '. ' + x.when + ' (' + fmt(x.at) + ')').join('\n');
}

/* ------------------------------------------------------------------ outcomes */

export function reachedCell(r: Row): Cell {
  const t = r.st.targetHit;
  if (!t) return { value: '–' };
  return { value: fmtD(t.when), sub: t.bySource ? 'per source' : '@ ' + fmt(t.close) };
}

export function sinceTargetCell(r: Row): Cell {
  const v = sinceTarget(r.p, r.st, r.live);
  if (v == null) return { value: '–' };
  const t = r.st.targetHit;
  return {
    value: signedFmt(v, '%'),
    ...(v > 0 ? { tone: 'good' as const } : v < 0 ? { tone: 'bad' as const } : {}),
    sub: 'after ' + fmtD(t && t.when),
    title: 'Price now against ' + (t && t.bySource ? 'the target level' : 'the close on the day the target was reached (' + fmtD(t && t.when) + ')') + ', signed the setup\'s way.',
  };
}

export function failedCell(r: Row): Cell {
  const f = r.st.failed;
  if (!f) return { value: r.p.manualState === 'failed' ? 'by you' : '–' };
  return { value: fmtD(f.when), sub: f.byTouch ? 'touched ' + fmt(f.at) : 'closed ' + fmt(f.close) };
}

export function reasonText(r: Row): string {
  const f = r.st.failed;
  if (!f) return 'moved manually';
  return f.reason + (f.byTouch ? ' (touched ' + fmt(f.at) + ' intraday)' : f.close != null ? ' (close ' + fmt(f.close) + ')' : '');
}

/** `source_open` lists the weekly sheet dates on which Tech Charts still showed a setup as ongoing after it had hit
    its negation. One sheet can be a lag; two or more means the analyst kept it. */
export function srcOpenCell(r: Row): Cell {
  const d = r.p.source_open;
  if (!d || !d.length) return { value: '–' };
  return {
    value: d.length > 1 ? 'Kept · ' + d.length + ' sheets' : 'Listed once',
    ...(d.length > 1 ? { tone: 'warn' as const } : {}),
    sub: fmtD(d[0]) + (d.length > 1 ? ' → ' + fmtD(d[d.length - 1]) : ''),
    title: "Still on Tech Charts' ongoing-breakouts sheet after hitting its negation: " + d.join(', ') +
      (d.length > 1 ? '. Not removed as per the plan.' : '. Possibly a one-week lag.'),
  };
}

export function removedCell(r: Row): Cell {
  const { p } = r;
  if (p.removed) {
    return { value: fmtD(p.removed), sub: 'dropped by source' + (p.removed_reason ? ' · ' + p.removed_reason : '') };
  }
  return { value: 'by you', sub: 'removed here' };
}

/* ------------------------------------------------------------------ the rest of what the drawer shows */

export function trailingStopCell(r: Row, today: string): Cell | null {
  const st = stopFor(r.p, r.live, r.ev, today);
  if (!st) return null;
  return {
    value: fmt(st.at),
    sub: 'ATR ' + fmt(st.atr) + (st.widenedBy ? ' + div ' + fmt(st.widenedBy) : ''),
    ...(st.widenedBy ? { tone: 'bad' as const } : {}),
    title: st.widenedBy
      ? 'Widened by the ' + fmt(st.widenedBy) + ' dividend going ex on ' + fmtD(st.exDiv) + '. Reverts to ' + fmt(st.plain) + ' once that has passed.'
      : 'Twice the 14-day ATR below the live price.',
  };
}

export function brokeOutCell(r: Row): Cell {
  const { st, p } = r;
  if (!st.breakout) return { value: p.manualState === 'breakout' ? 'by hand' : '–' };
  return {
    value: fmtD(st.breakout.when),
    sub: st.breakout.close != null ? '@ ' + fmt(st.breakout.close) : (p.manualState === 'breakout' ? 'promoted by hand' : 'as listed by source'),
  };
}

export function datedCell(iso: string | null | undefined, today: string, manual = false): { value: string; days: ReturnType<typeof daysTag>; sub?: string } {
  return { value: iso ? fmtD(iso) : '–', days: iso ? daysTag(iso, today) : null, ...(manual ? { sub: 'manual' } : {}) };
}

export function addedText(r: Row, today: string): string {
  const { p } = r;
  if (!p.created) return '–';
  const days = -(daysUntil(p.created, today) as number);
  return fmtD(p.created) + (days >= 0 ? ' · ' + agoText(days) : '');
}

/* ------------------------------------------------------------------ sorting */

/** The value a column sorts by: numbers sort numerically, strings alphabetically, null always last. */
export function sortValue(r: Row, key: string): number | string | null {
  const T = r.btype;
  switch (key) {
    case 'sym': return r.p.sym;
    case 'live': return r.dayPct;
    case 'gap': return r.gap == null ? null : Math.abs(r.gap);
    case 'upside': return r.upside;
    case 'rr': { const x = rrOf(r.p, r.lfd); return x ? x.ratio : null; }
    case 'runup': { const x = runupOf(r.p, r.live, r.prevClose, r.lfd); return x ? x.used : null; }
    case 'risk': return r.risk;
    case 'lfd': return lfdRisk(r.p.dir, r.lfd, r.live);
    case 'btype': return T && T.tag ? T.tag : '';
    case 'breaches': return T && T.breaches ? T.breaches.length : null;
    case 'reentry': {
      // Back in first, then the ones out, nearest the trigger.
      if (T && T.breaches && T.breaches.length && !T.out) return -1;
      return (r.prevClose && r.p.breakthrough) ? Math.abs(r.p.breakthrough / r.prevClose - 1) : null;
    }
    case 'when': return r.when;
    case 'since': return sinceTarget(r.p, r.st, r.live);
    case 'srcopen': return r.p.source_open ? r.p.source_open.length : 0;
    case 'removed': return r.p.removed || 'z';
    case 'target': return r.p.target ?? null;
    case 'negation': return r.p.negation ?? null;
    default: return null;
  }
}
