import type { Caveats, GridCell, ModelResult, StrategyRun } from '../engine/backtest/model';
import type { Ratios } from '../engine/backtest/ratio';
import { DEFAULT_SETTINGS, PAYOFF_SCALE, S2_IDS, SIZINGS, STRATEGY_IDS, STRATEGY_WORDS, TRAIL } from '../engine/backtest/settings';
import type { SizingId, StrategyId } from '../engine/backtest/settings';
import type { Leg } from '../engine/backtest/simulate';
import type { MoneyStats, Stats } from '../engine/backtest/stats';
import type { Excluded } from '../engine/backtest/universe';
import { fmt, fmtD, MINUS, signedPct } from '../engine/format';
import type { Cell } from './cells';
import type { Scope, TradeSort } from './modelurl';
import type { Tile } from './tiles';

/* What the Model page says, as plain data: the tiles, the words for each dial, a trade's cells, the caveats counted from
   the day's list. The page only lays these out, so the wording and the numbers can be tested without a browser. Every
   number carries its unit: % of the position, R (multiples of the risk taken), or the account currency's name. */

export const STRATEGY_LABEL: Record<StrategyId, string> = {
  S1: 'S1 · B1/B2 only', 'S2-1': 'S2 · one re-entry', 'S2-2': 'S2 · two re-entries', 'S2-3': 'S2 · three re-entries',
  'S2-u': 'S2 · re-entries unlimited', S3: 'S3 · negation only', S4: 'S4 · trailing',
};
export const STRATEGY_SHORT: Record<StrategyId, string> = { S1: 'S1', 'S2-1': 'S2 ×1', 'S2-2': 'S2 ×2', 'S2-3': 'S2 ×3', 'S2-u': 'S2 ×∞', S3: 'S3', S4: 'S4' };

export const SIZING_LABEL: Record<SizingId, string> = { flat: 'Flat', perStrategy: 'Per strategy', payoff: 'Payoff-scaled', risk: 'Risk-based' };

/** What the strategy does, in one line, for the line under the dial. */
export function strategyWords(id: StrategyId): string {
  const w = STRATEGY_WORDS[id.startsWith('S2') ? 'S2' : (id as 'S1' | 'S3' | 'S4')];
  return `In at ${w.entry}; out on ${w.exit}; the stop is ${w.stop}.`;
}

/** A sum of money in account units: whole, with a real minus and the currency's name. */
export const money = (v: number | null | undefined, label: string): string =>
  v == null || !isFinite(v) ? '–' : (v < 0 ? MINUS : '') + Math.round(Math.abs(v)).toLocaleString('en-US') + ' ' + label;

/** A return in multiples of the risk taken: "+1.33 R", "−0.50 R". */
export const signedR = (v: number | null | undefined): string =>
  v == null || !isFinite(v) ? '–' : (v > 0 ? '+' : v < 0 ? MINUS : '') + Math.abs(v).toFixed(2) + ' R';

/** A ratio such as the profit factor, two decimals. */
export const ratio2 = (v: number | null | undefined): string => (v == null || !isFinite(v) ? '–' : v.toFixed(2));

const whole = (v: number | null | undefined, unit: string): string => (v == null ? '–' : Math.round(v).toLocaleString('en-US') + ' ' + unit);

const tone = (v: number | null | undefined): Tile['tone'] => (v == null ? undefined : v > 0 ? 'good' : v < 0 ? 'bad' : undefined);

const plural = (n: number, one: string, many: string) => n + ' ' + (n === 1 ? one : many);

/** The legs a view counts, with their sizes: every leg, or the closed ones alone. */
export function legsInScope(run: StrategyRun, sizing: SizingId, scope: Scope): { legs: Leg[]; sizes: number[] } {
  if (scope === 'all') return { legs: run.legs, sizes: run.sizes[sizing] };
  const keep = run.legs.map((l, i) => [l, run.sizes[sizing][i]] as const).filter(([l]) => !l.open);
  return { legs: keep.map(([l]) => l), sizes: keep.map(([, s]) => s) };
}

/** The eight tiles for a strategy under a sizing: the trade count, the rates and means, the money. The money statistics are the
    view's own (closed legs alone, under that scope); every leg's by default. */
export function modelTiles(run: StrategyRun, sizing: SizingId, scope: Scope, label: string, m: MoneyStats = run.money[sizing]): Tile[] {
  const st = scope === 'closed' ? run.stats.closed : run.stats.all;
  const iv = scope === 'closed' ? run.bootstrap.pct.closed : run.bootstrap.pct.all;
  const scopeWords = scope === 'closed' ? 'closed trades only' : `${plural(st.open, 'open leg', 'open legs')} marked at the latest close`;
  return [
    {
      label: 'Trades', value: String(st.legs),
      sub: st.legs ? `${plural(st.setups, 'setup', 'setups')} · ${scopeWords}` : 'none under these settings',
      title: 'Legs: each entry is one, a re-entry included. ' + (scope === 'closed' ? 'Closed trades only.' : 'Open legs are marked at the latest settled close.'),
    },
    {
      label: 'Win rate', value: st.winRate == null ? '–' : Math.round(st.winRate) + '%',
      sub: st.legs ? `${st.wins} up · ${st.losses} down${st.flat ? ` · ${st.flat} flat` : ''}` : 'no trades',
      title: 'Legs that came out ahead after both sides\' costs, as a share of all legs.',
    },
    {
      label: 'Expectancy', value: signedPct(st.expectancyPct), tone: tone(st.expectancyPct),
      sub: iv ? `90% interval ${signedPct(iv.low)} to ${signedPct(iv.high)}` : 'too few trades for an interval',
      title: `The mean net return per leg, in % of the position. The interval is a bootstrap: the list resampled ${iv ? iv.resamples.toLocaleString('en-US') : DEFAULT_SETTINGS.resamples.toLocaleString('en-US')} times, the middle 90% of the means.`,
    },
    {
      label: 'In R', value: signedR(st.expectancyR), tone: tone(st.expectancyR),
      sub: st.withR ? `over ${plural(st.withR, 'leg', 'legs')} with a stop to measure from` : 'no leg had a stop to measure from',
      title: 'The mean net return in multiples of the risk taken: the distance from the entry to the stop in force (the negation where there was no tight stop).',
    },
    {
      label: 'Profit factor', value: ratio2(st.profitFactor),
      sub: st.profitFactor == null ? (st.legs ? 'no losing leg' : 'no trades') : 'gains over losses, net of costs',
      title: 'The sum of the winning legs\' returns over the sum of the losing legs\', both in % of the position.',
    },
    {
      label: 'Max drawdown', value: money(-m.maxDrawdown, label), tone: m.maxDrawdown > 0 ? 'bad' : undefined,
      sub: `from a high of ${money(m.peakEquity, label)} · ${SIZING_LABEL[sizing].toLowerCase()} sizing${scope === 'closed' ? ' · closed legs' : ''}`,
      title: 'The deepest fall of the equity line from a high, in account units, with every leg marked daily at the settled close and FX held constant.',
    },
    {
      label: 'Positions open', value: m.avgOpen == null ? '–' : m.avgOpen.toFixed(1),
      sub: m.peakOpen ? `on average · ${m.peakOpen} at the most, at once` : 'none',
      title: 'Legs held per day, over the days on which at least one was held; the exit day counts.',
    },
    {
      label: 'Capital in use', value: money(m.peakExposure, label),
      sub: 'at the most, at once',
      title: 'The most account units held in open legs on one day under this sizing.',
    },
  ];
}

/** The words for an exit, as the trade list prints them. */
export const REASON_WORDS: Record<NonNullable<Leg['exit']>['reason'], string> = {
  stop: 'stopped', negation: 'negation touched', target: 'target', reached: 'reached, per source', removed: 'removed by the source',
};

const basisWords = (b: Leg['entry']['basis']): string => (b === 'open' ? 'at the open' : b === 'close' ? 'at the close' : 'at the level');

export interface TradeCells {
  entry: Cell;
  exit: Cell;
  ret: Cell;
  r: Cell;
  days: Cell;
  type: Cell;
  stop: Cell;
  size: Cell;
}

/** A leg's figures, each a value with its unit and a line saying how it came about. */
export function tradeCells(l: Leg, size: number, label: string): TradeCells {
  const ccy = l.currency ? ' ' + l.currency : '';
  const exitStop = l.exit && l.exit.reason === 'stop' ? ` (${l.exit.stopKind ?? 'stop'})` : '';
  return {
    entry: { value: fmtD(l.entry.when), sub: `${fmt(l.entry.price)}${ccy} ${basisWords(l.entry.basis)}` },
    exit: l.exit
      ? { value: fmtD(l.exit.when), sub: `${fmt(l.exit.price)}${ccy} · ${REASON_WORDS[l.exit.reason]}${exitStop}, ${basisWords(l.exit.basis)}` }
      : { value: 'open', sub: `marked ${fmt(l.mark.price)}${ccy} on ${fmtD(l.mark.when)}`, tone: 'warn' },
    ret: { value: signedPct(l.netPct), tone: tone(l.netPct) as Cell['tone'], sub: `${signedPct(l.grossPct)} before costs` },
    r: { value: signedR(l.r), sub: l.riskPct != null ? `risk ${l.riskPct.toFixed(1)}% to the ${l.stopKind === 'none' ? 'negation' : l.stopKind}` : 'no level on the losing side' },
    days: { value: String(l.days), sub: l.days === 1 ? 'day' : 'days' },
    type: l.tag ? { value: l.tag, badge: { text: l.tag, cls: l.tag.toLowerCase() } } : { value: '–', sub: 'no type' },
    stop: stopCell(l, ccy),
    size: { value: money(size, label), sub: l.n > 1 ? `re-entry ${l.n - 1}` : 'first entry' },
  };
}

/** The stop the leg ran on at its entry: the last full day and where it came from, a new one read for a re-entry, or the
    negation where there was no tight stop. */
function stopCell(l: Leg, ccy: string): Cell {
  if (l.stopKind === 'last full day' && l.stop != null) {
    return { value: fmt(l.stop) + ccy, sub: 'last full day, ' + (l.stopSource === 'report' ? 'from the report' : 'read from the bars') };
  }
  if (l.stopKind === 'new last full day' && l.stop != null) return { value: fmt(l.stop) + ccy, sub: 'new last full day, read from the re-entry run' };
  if (l.c.negation != null) {
    return { value: fmt(l.c.negation) + ccy, sub: l.stopKind === 'negation' ? 'the negation' : l.n > 1 ? 'the negation: no new last full day could be read' : 'the negation: no tight stop' };
  }
  return { value: 'none', sub: 'no level on the losing side' };
}

export function sortTrades(legs: readonly Leg[], sizes: readonly number[], sort: TradeSort): { leg: Leg; size: number }[] {
  const rows = legs.map((leg, i) => ({ leg, size: sizes[i] }));
  const byDate = (a: string, b: string) => (a < b ? 1 : a > b ? -1 : 0);
  const nullsLast = (a: number | null, b: number | null, desc: boolean) =>
    a == null && b == null ? 0 : a == null ? 1 : b == null ? -1 : desc ? b - a : a - b;
  const cmp: Record<TradeSort, (x: { leg: Leg }, y: { leg: Leg }) => number> = {
    entry: (x, y) => byDate(x.leg.entry.when, y.leg.entry.when) || y.leg.n - x.leg.n,
    exit: (x, y) => byDate(x.leg.mark.when, y.leg.mark.when) || Number(y.leg.open) - Number(x.leg.open),
    best: (x, y) => y.leg.netPct - x.leg.netPct,
    worst: (x, y) => x.leg.netPct - y.leg.netPct,
    r: (x, y) => nullsLast(x.leg.r, y.leg.r, true),
    days: (x, y) => y.leg.days - x.leg.days,
  };
  return rows.sort((x, y) => cmp[sort](x, y) || x.leg.key.localeCompare(y.leg.key) || x.leg.n - y.leg.n);
}

export const SORT_LABEL: Record<TradeSort, string> = { entry: 'Newest', exit: 'Last out', best: 'Best', worst: 'Worst', r: 'Most R', days: 'Longest' };

export interface TypeRow { tag: string; legs: number; setups: number; winRate: string; expectancy: string; sum: string }

const TYPE_WORDS: Record<string, string> = { B1: 'B1 · no pullback', B2: 'B2 · pulled back', B3: 'B3 · took the stop', B4: 'B4 · failed', none: 'no type' };

export function typeRows(st: Stats): TypeRow[] {
  return st.byType.filter(t => t.legs > 0).map(t => ({
    tag: TYPE_WORDS[t.tag] ?? t.tag, legs: t.legs, setups: t.setups,
    winRate: t.winRate == null ? '–' : Math.round(t.winRate) + '%',
    expectancy: signedPct(t.expectancyPct), sum: signedPct(t.sumPct),
  }));
}

/** "52 stopped, 11 open, 6 target, 5 reached": how the legs ended, most common first. */
export function reasonLine(st: Stats): string {
  const words: Record<string, string> = { ...REASON_WORDS, open: 'still open' };
  return Object.entries(st.byReason).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} ${words[k] ?? k}`).join(' · ');
}

export interface RatioRow { id: StrategyId; label: string; equalRisk: string; equalDrawdown: string; equalCapital: string; behind: string }

const ratioText = (v: number | null) => (v == null ? '–' : v.toFixed(2));

/** The ratio question, one row per S2 depth against S1. */
export function ratioRows(result: ModelResult): RatioRow[] {
  return S2_IDS.map(id => {
    const r = result.ratios[id] as Ratios | undefined;
    return {
      id, label: STRATEGY_LABEL[id],
      equalRisk: r ? ratioText(r.equalRisk.ratio) : '–', equalDrawdown: r ? ratioText(r.equalDrawdown.ratio) : '–', equalCapital: r ? ratioText(r.equalCapital.ratio) : '–',
      behind: r ? `${r.equalRisk.a} and ${r.equalRisk.b} setups with a stop; ${r.equalDrawdown.a} and ${r.equalDrawdown.b} legs` : 'not run',
    };
  });
}

export interface GridRow { id: StrategyId; label: string; cells: (GridCell & { text: string; dd: string })[] }

export function gridRows(result: ModelResult, label: string): GridRow[] {
  return STRATEGY_IDS.map(id => ({
    id, label: STRATEGY_SHORT[id],
    cells: SIZINGS.map(sz => {
      const g = result.grid.find(c => c.strategy === id && c.sizing === sz) as GridCell;
      return { ...g, text: g.weightedPct == null ? '–' : signedPct(g.weightedPct), dd: money(-g.maxDrawdown, label) };
    }),
  }));
}

const monthWords = (ym: string): string => new Date(ym + '-15T12:00:00Z').toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** The caveats, each with its number from the day's list (plan B5), and the bias the list carries (plan B1). */
export function caveatText(c: Caveats, u: ModelResult['universe'], fromListBegan: boolean): string {
  const parts: string[] = [];
  parts.push(`Counted from the trade list: ${plural(c.setups, 'setup', 'setups')} of the ${plural(u.breakouts, 'breakout', 'breakouts')}` +
    (c.busiestMonth ? `, ${c.busiestMonth.count} of them from ${monthWords(c.busiestMonth.month)}` : '') +
    `; ${plural(c.shorts, 'short', 'shorts')}; ${c.open} still open; ${c.derivedStops} with a stop read from the bars rather than the report; ${c.noTightStop} without a tight stop (in S3 only); ${c.imported} imported already confirmed; ${c.reached} closed on the day the source counted the target; ${c.removed} closed on removal.`);
  parts.push(fromListBegan
    ? `Only breakouts from ${fmtD(c.listBegan)} on, the day the list began: the ${plural(c.beforeListBegan, 'breakout', 'breakouts')} before it ${c.beforeListBegan === 1 ? 'is' : 'are'} left out.`
    : `The list began on ${fmtD(c.listBegan)} with setups already confirmed, so the ${plural(c.beforeListBegan, 'breakout', 'breakouts')} before it are the ones the source still listed then: winners and open trades are over-represented there. The From dial leaves them out.`);
  return parts.join(' ');
}

/** The lines under "Left out": the universe's exclusions, then the strategy's own, each with its reason. */
export function exclusionLines(result: ModelResult, run: StrategyRun): { heading: string; items: Excluded[] }[] {
  const out: { heading: string; items: Excluded[] }[] = [];
  if (result.universe.excluded.length) out.push({ heading: 'Not in the trade list', items: result.universe.excluded });
  if (run.excluded.length) out.push({ heading: `Not in ${STRATEGY_SHORT[run.id]}`, items: run.excluded });
  if (run.pending.length) out.push({ heading: 'Waiting for a fill', items: run.pending });
  if (run.waitingReentries.length) out.push({ heading: 'Waiting to re-enter', items: run.waitingReentries });
  if (run.refused.length) out.push({ heading: 'Re-entries refused at the open', items: run.refused.map(x => ({ key: x.key, sym: x.key.split('|')[0], dir: x.key.split('|')[1] as 'long' | 'short', reason: x.days.map(fmtD).join(', ') })) });
  return out;
}

/** The sentence that states the money assumption (plan B4), with the label in use. */
export const fxWords = (label: string): string =>
  `Every price is in its own listing currency and nothing is converted. A sum of money is the position in ${label} times the leg's % return, with FX held constant over each trade; the % and R figures need no currency.`;

/** The one-line rule for each dial, for the Method page and the controls' help. */
export const DIAL_WORDS = {
  entry: 'The entry is the next session\'s open where the bars have it, or the confirming close itself.',
  importedEntry: 'A setup imported already confirmed enters from the report that listed it (its first session after the report\'s date), or at the confirming close the lookback found.',
  targetOn: 'The target counts on a settled close at or past it, the board\'s rule, or on an intraday touch.',
  reentryStop: 'After a re-entry the stop is the original last full day, or a new one read from the re-entry run as the first was.',
  removed: 'A setup the source removed after it broke out is closed at the last close on or before the removal date, or left out.',
  from: 'All breakouts, or only those from the day the list began.',
  costs: 'Commission and slippage per side, in % of the position, taken off every leg\'s return, open ones included.',
  sizing: `Flat puts the same amount on every entry; per strategy scales S2 by its equal-risk ratio against S1; payoff scales by the setup's payoff against the median, between ${PAYOFF_SCALE.min}× and ${PAYOFF_SCALE.max}×; risk puts a fixed sum between the entry and the stop, up to a cap.`,
  trail: `S4's trail is ${TRAIL.atrs} ATRs (Wilder's ${TRAIL.period}-day) under the best close since the entry; it only ever tightens, and the stop is the higher of it and the last full day.`,
} as const;

/** What the money figures are built on, for the line under the charts. */
export const moneyWords = (m: MoneyStats, label: string): string =>
  m.curve.dates.length ? `${m.curve.dates.length} trading days from ${fmtD(m.curve.dates[0])} to ${fmtD(m.curve.dates[m.curve.dates.length - 1])}, in ${label}; the line is every leg's profit and loss added up, marked daily at the settled close.` : 'No leg to draw.';

export { whole };
