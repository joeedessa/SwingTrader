import { MIN_BARS, PERIODS_BY_TF, TAGGED, TF_WORDS } from '../engine/ma';
import type { MaState, Timeframe } from '../engine/ma';
import { signedFmt, signedPct } from '../engine/format';
import type { Row } from '../engine/row';
import { MIN_SECTOR_PEERS } from '../engine/signals';
import type { MaColumn, Relative, Scan, ScanHit, ScanScope, StructureEvent } from '../engine/signals';
import { SECTION_LABELS, SECTIONS } from '../engine/types';
import type { Cell, Tone } from './cells';
import type { ColSpec } from './columns';
import { averageLineOn } from './mareads';
import type { Tile } from './tiles';

/* What each figure on the Signals page says, as plain data (the way cells.ts does for the board): an average and where the
   close sits against it, the day against the index and the sector, a change of sides, a cross. The page only lays them out. */

/* ------------------------------------------------------------------ the average columns */

/** The level test, coloured by what it says for the close: held and reclaimed are above the line, rejected and lost below. */
const STATE_TONE: Record<MaState, Tone> = { held: 'good', reclaimed: 'good', rejected: 'bad', lost: 'bad' };

/** Where the close sits against one average: the side and how far, then on the lines that carry them the level test and
    which way the average is heading. Green above and red below, whichever way the setup trades: the arrow says which side. */
export function maCell(c: MaColumn, tf: Timeframe): Cell {
  // A line that does not carry the level test does not say it in its tooltip either.
  const read = c.read && !c.tagged ? { ...c.read, state: null } : c.read;
  const line = averageLineOn({ period: c.period, read, slope: c.slope }, tf);
  if (!c.read) return { value: '–', title: line.text };
  const state = read ? read.state : null;
  const sub = [state, line.slope ? line.slope.glyph : null].filter(Boolean).join(' ');
  return {
    value: line.value,
    tone: c.read.above ? 'good' : 'bad',
    ...(sub ? { sub } : {}),
    ...(state ? { subTone: STATE_TONE[state] } : {}),
    title: line.text,
  };
}

const points = (v: number) => signedFmt(v, 'pp');
/** Ahead of the market by a point and a half or more is worth a colour. */
const relTone = (v: number): { tone?: Tone } => (v >= 1.5 ? { tone: 'good' } : v <= -1.5 ? { tone: 'bad' } : {});

export function vsIndexCell(rel: Relative, country: string | undefined): Cell {
  if (rel.vsIndex == null) {
    return { value: '–', title: !rel.index ? (country ? `No index is read for ${country}.` : 'No country on file for this setup.')
      : rel.day == null ? 'No day move for this name yet.' : `No day move for ${rel.index} yet.` };
  }
  return {
    value: points(rel.vsIndex), ...relTone(rel.vsIndex), ...(rel.index ? { sub: rel.index } : {}),
    title: `${signedPct(rel.day)} on the day, against ${signedPct(rel.indexDay)} for ${rel.index}, in percentage points.`,
  };
}

export function vsSectorCell(rel: Relative, sector: string | null | undefined): Cell {
  if (rel.vsSector == null) {
    return { value: '–', title: !sector ? 'No sector on file for this setup.' : rel.day == null ? 'No day move for this name yet.'
      : `Only ${rel.peers} ${rel.peers === 1 ? 'name has' : 'names have'} a day move in ${sector}; a median needs ${MIN_SECTOR_PEERS}.` };
  }
  return {
    value: points(rel.vsSector), ...relTone(rel.vsSector), ...(sector ? { sub: sector } : {}),
    title: `${signedPct(rel.day)} on the day, against a median of ${signedPct(rel.sectorDay)} across the ${rel.peers} names in ${sector} on the list, in percentage points.`,
  };
}

/** The columns of the Averages table for one timeframe, after the symbol and the live price every board starts with. */
export function averageColumns(tf: Timeframe, ladder: (r: Row) => MaColumn[], rel: (r: Row) => Relative): ColSpec[] {
  const cols: ColSpec[] = [{ key: 'section', label: 'Section', text: true, sortBy: 'section', asc: true, cell: r => ({ value: SECTION_LABELS[r.section] }) }];
  PERIODS_BY_TF[tf].forEach((period, i) => {
    const tagged = TAGGED[tf].includes(period);
    cols.push({
      key: 'ma' + period, label: period + TF_WORDS[tf].unit, ...(tagged ? { sub: 'tested · heading' } : {}),
      sortBy: 'ma' + period, cell: r => maCell(ladder(r)[i], tf),
    });
  });
  cols.push(
    { key: 'vsindex', label: 'vs index', sub: 'day move, points', sortBy: 'vsindex', cell: r => vsIndexCell(rel(r), r.p.country) },
    { key: 'vssector', label: 'vs sector', sub: 'day move, points', sortBy: 'vssector', cell: r => vsSectorCell(rel(r), r.ev.sector) },
  );
  return cols;
}

/** What the Averages headers sort by, for sortRows: the distance from each average, the day against the market, the section in the board's order. */
export function averageSort(tf: Timeframe, ladder: (r: Row) => MaColumn[], rel: (r: Row) => Relative): (r: Row, key: string) => number | null | undefined {
  return (r, key) => {
    if (key === 'section') return SECTIONS.indexOf(r.section);
    if (key === 'vsindex') return rel(r).vsIndex;
    if (key === 'vssector') return rel(r).vsSector;
    const i = PERIODS_BY_TF[tf].findIndex(p => 'ma' + p === key);
    return i < 0 ? undefined : ladder(r)[i].read?.dist ?? null;
  };
}

/* ------------------------------------------------------------------ fresh level changes */

/** "reclaimed its monthly 200". */
export const changeText = (e: StructureEvent): string => `${e.state} its ${e.tf} ${e.period}`;

/** "on the latest bar", "1 week ago". */
export function agoWords(ago: number, tf: Timeframe): string {
  const w = TF_WORDS[tf];
  return ago === 0 ? 'on the latest ' + (tf === 'daily' ? 'close' : w.name) : ago + ' ' + (ago === 1 ? w.one : w.word) + ' ago';
}

export const forSetup = (e: StructureEvent): { text: string; tone: Tone } =>
  e.helps ? { text: "the setup's way", tone: 'good' } : { text: 'against the setup', tone: 'bad' };

/* ------------------------------------------------------------------ the cross scan */

export const SCOPE_LABEL: Record<ScanScope, string> = { watch: 'Watching', trade: 'In trade', all: 'All in play' };

/** "3d ago", "latest close": how long ago a cross happened, in the timeframe's own unit. */
export const crossAgo = (h: ScanHit, tf: Timeframe): string => (h.ago === 0 ? 'latest close' : h.ago + TF_WORDS[tf].unit + ' ago');

/** The line over the scan: how far back it looked and how many names had the history for it; none for an empty group, which says
    so itself (see scanEmpty). */
export function scanNote(scan: Scan): string | null {
  if (!scan.total) return null;
  return `Crosses in the last ${scan.lookback} ${TF_WORDS[scan.tf].word} · ${scan.covered} of ${scan.total} with enough history`;
}

/** What the scan says when it has nothing to list. */
export function scanEmpty(scan: Scan): string | null {
  const w = TF_WORDS[scan.tf];
  if (!scan.total) return 'Nothing in this group to scan.';
  if (!scan.covered) return `None of these carry the ${MIN_BARS} ${w.word} a 200-period average needs.`;
  if (!scan.hits.length) return `No crosses in the last ${scan.lookback} ${w.word}.`;
  return null;
}

/* ------------------------------------------------------------------ the tiles */

const plural = (n: number, one: string, many: string) => n + ' ' + (n === 1 ? one : many);

export interface TileActions {
  changes: () => void;
  scan: (tf: Timeframe) => void;
}

/** Whether the weekly and monthly bars are here: the tiles for them say so, rather than count nothing. */
export type SlowBars = 'ready' | 'loading' | 'failed';

/** The page's four figures: the fresh changes of sides, then the crosses on each timeframe across everything in play. Each
    opens what it counts. */
export function signalTiles(events: readonly StructureEvent[], scans: Record<Timeframe, Scan>, go: TileActions, slow: SlowBars = 'ready'): Tile[] {
  const byTf = (['monthly', 'weekly', 'daily'] as const).map(tf => [tf, events.filter(e => e.tf === tf).length] as const).filter(([, n]) => n > 0);
  const missing = slow === 'loading' ? 'weekly and monthly loading' : 'weekly and monthly not loaded';
  const base = byTf.length ? byTf.map(([tf, n]) => `${n} ${tf}`).join(' · ') : 'nothing fresh on a 150 or 200';
  const tiles: Tile[] = [{
    label: 'Level changes', value: String(events.length),
    sub: slow === 'ready' ? base : `${base} · ${missing}`,
    title: 'Setups whose close has just changed sides on a 150 or 200 and is still near it (reclaimed or lost): on the latest bar of a weekly or monthly chart, within the latest two sessions of a daily one.',
    onClick: go.changes, action: `Level changes, ${events.length}: open the list`,
  }];
  for (const tf of ['daily', 'weekly', 'monthly'] as const) {
    const s = scans[tf];
    const bull = s.hits.filter(h => h.bullish).length;
    const waiting = tf !== 'daily' && slow !== 'ready';
    tiles.push({
      label: `Crosses, ${tf}`, value: waiting ? '–' : String(s.hits.length),
      sub: waiting ? (slow === 'loading' ? 'loading the bars…' : 'the bars did not load')
        : s.covered ? `${bull} bullish · ${s.hits.length - bull} bearish · ${plural(s.covered, 'name', 'names')} scanned` : 'no name has the history yet',
      title: `Crosses of the averages and the price in the last ${s.lookback} ${TF_WORDS[tf].word}, across everything still in play.`,
      onClick: () => go.scan(tf), action: `Crosses, ${tf}, ${waiting ? 'not loaded' : s.hits.length}: open the scan`,
    });
  }
  return tiles;
}
