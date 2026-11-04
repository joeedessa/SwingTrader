import { describe, expect, it } from 'vitest';
import { runModel } from '../../src/engine/backtest/model';
import { DEFAULT_SETTINGS, RATIO_IDS, SIZINGS, STRATEGY_IDS } from '../../src/engine/backtest/settings';
import { moneyStatsOf } from '../../src/engine/backtest/stats';
import type { StrategyRun } from '../../src/engine/backtest/model';
import type { SizingId } from '../../src/engine/backtest/settings';
import type { Leg } from '../../src/engine/backtest/simulate';
import { caveatText, exclusionLines, gridRows, legsInScope, modelTiles, money, noStopWords, ratioRows, reasonLine, SCOPE_HEAD, signedR, sortTrades, strategyWords, tradeCells, typeRows } from '../../src/ui/modelcells';
import { frozenBoard, frozenInputs } from './frozen';

/* What the Model page says, read back against the engine's own result on the frozen board. Every count comes from the
   result; nothing here knows how many trades there are. */

const result = (() => { const { bars, hist } = frozenInputs(); return runModel({ rows: frozenBoard().rows, hist, bars }, DEFAULT_SETTINGS); })();

describe('units', () => {
  it('prints money whole, with a real minus and the currency\'s name', () => {
    expect(money(1234.56, 'units')).toBe('1,235 units');
    expect(money(-940, 'USD')).toBe('−940 USD');
    expect(money(0, 'units')).toBe('0 units');
    expect(money(null, 'units')).toBe('–');
  });

  it('prints R with two decimals and its letter', () => {
    expect(signedR(1.3254)).toBe('+1.33 R');
    expect(signedR(-0.5)).toBe('−0.50 R');
    expect(signedR(0)).toBe('0.00 R');
    expect(signedR(null)).toBe('–');
  });
});

/** The money of a run under a sizing, over every leg and over the closed legs alone, as the page hands it to the tiles. */
const moneyOf = (run: StrategyRun, sizing: SizingId) => {
  const closed = legsInScope(run, sizing, 'closed');
  return { all: run.money[sizing], closed: moneyStatsOf(closed.legs, closed.sizes) };
};

describe('the tiles', () => {
  it('carry the strategy\'s own counts and means, every leg beside the closed ones, each with its unit', () => {
    const run = result.runs['S2-u'];
    const m = moneyOf(run, 'flat');
    const tiles = modelTiles(run, 'flat', 'units', m);
    const by = Object.fromEntries(tiles.map(t => [t.label, t]));
    expect(tiles).toHaveLength(8);
    for (const t of tiles) {
      expect(t.cols!.map(c => c.head), t.label).toEqual([SCOPE_HEAD.all, SCOPE_HEAD.closed]);
      expect(t.value, t.label).toBe(t.cols![0].value);
    }
    expect(by.Trades.cols![0].value).toBe(String(run.stats.all.legs));
    expect(by.Trades.cols![1].value).toBe(String(run.stats.closed.legs));
    expect(by.Trades.cols![0].sub).toBe(`${run.setups} setups · ${run.stats.all.open} still open`);
    expect(by.Trades.cols![1].sub).toBe(`${run.stats.closed.setups} setups`);
    expect(by['Win rate'].cols![0].value).toBe(Math.round(run.stats.all.winRate!) + '%');
    expect(by['Win rate'].cols![1].value).toBe(Math.round(run.stats.closed.winRate!) + '%');
    for (const c of by.Expectancy.cols!) { expect(c.value).toMatch(/^[+−]?\d+\.\d%$/); expect(c.sub).toContain('90% interval'); }
    for (const c of by['In R'].cols!) { expect(c.value).toMatch(/ R$/); expect(c.sub).toContain('with risk to measure'); }
    expect(by['Max drawdown'].cols![0].value).toBe(money(-m.all.maxDrawdown, 'units'));
    expect(by['Max drawdown'].cols![1].value).toBe(money(-m.closed.maxDrawdown, 'units'));
    expect(by['Capital in use'].cols![0].value).toBe(money(m.all.peakExposure, 'units'));
    expect(by['Capital in use'].cols![1].value).toBe(money(m.closed.peakExposure, 'units'));
    expect(by['Positions open'].cols![0].sub).toContain(`${m.all.peakOpen} at the most`);
    // The open legs are the difference between the columns.
    expect(run.stats.all.legs - run.stats.closed.legs).toBe(run.stats.all.open);
  });

  it('take another sizing\'s money and currency label', () => {
    const run = result.runs.S1;
    const m = moneyOf(run, 'risk');
    const tiles = modelTiles(run, 'risk', 'USD', m);
    expect(tiles[5].cols![0].value).toBe(money(-run.money.risk.maxDrawdown, 'USD'));
    expect(tiles[5].cols![1].value).toBe(money(-m.closed.maxDrawdown, 'USD'));
    expect(tiles[6].title).toContain('Risk-based sizing');
    expect(tiles[7].title).toContain('risk-based sizing');
  });
});

describe('a trade\'s cells', () => {
  const leg = result.runs.S1.legs.find(l => l.exit && l.exit.reason === 'stop') as Leg;
  const open = result.runs.S1.legs.find(l => l.open) as Leg;

  it('say the dates, the prices in the listing currency, how the fill came about, the return before and after costs, R and the stop', () => {
    const c = tradeCells(leg, 10000, 'units');
    expect(c.entry.sub).toContain(leg.currency);
    expect(c.entry.sub).toMatch(/at the (open|close)$/);
    expect(c.exit.value).toBe(leg.exit!.when.slice(8, 10) + '-' + leg.exit!.when.slice(5, 7) + '-' + leg.exit!.when.slice(2, 4));
    expect(c.exit.sub).toContain('stopped');
    expect(c.ret.sub).toContain('before costs');
    expect(c.r.value).toMatch(/ R$/);
    expect(c.r.sub).toContain('risk ');
    expect(c.size.value).toBe('10,000 units');
    expect(c.size.sub).toBe('first entry');
    expect(c.type.badge).toEqual({ text: leg.tag, cls: leg.tag!.toLowerCase() });
  });

  it('name the stop the leg ran on: the last full day and where it came from, the trigger under S0, or the negation where there was no tight stop', () => {
    const s1 = tradeCells(leg, 10000, 'units').stop;
    expect(s1.value).toContain(leg.currency);
    expect(s1.sub).toMatch(/^last full day, (from the report|read from the bars)$/);
    const s3 = result.runs.S3.legs.find(l => l.stopSource !== 'none')!;
    const c3 = tradeCells(s3, 10000, 'units').stop;
    expect(c3.value).toBe(String(s3.c.negation!.toLocaleString('en-US', { maximumFractionDigits: Math.abs(s3.c.negation!) >= 100 ? 1 : 2 })) + ' ' + s3.currency);
    expect(c3.sub).toBe('the negation');
    const s0 = result.runs.S0.legs[0];
    const c0 = tradeCells(s0, 10000, 'units').stop;
    expect(c0.value).toContain(s0.currency);
    expect(c0.sub).toBe('the trigger: out on its first touch');
    expect(tradeCells(s0, 10000, 'units').r.sub).toMatch(/to the trigger$/);
    const onNegation = result.runs.S1.legs.find(l => l.stopSource === 'none')!;
    expect(onNegation).toBeTruthy();
    expect(tradeCells(onNegation, 10000, 'units').stop.sub).toBe('the negation: no last full day in the report');
  });

  it('count the closed legs alone when asked, with their sizes', () => {
    const run = result.runs['S2-u'];
    const all = legsInScope(run, 'risk', 'all');
    expect(all.legs).toBe(run.legs);
    const closed = legsInScope(run, 'risk', 'closed');
    expect(closed.legs.every(l => !l.open)).toBe(true);
    expect(closed.legs.length).toBe(run.legs.filter(l => !l.open).length);
    expect(closed.sizes).toEqual(closed.legs.map(l => run.sizes.risk[run.legs.indexOf(l)]));
  });

  it('mark an open leg as open, at the latest close', () => {
    const c = tradeCells(open, 10000, 'units');
    expect(c.exit.value).toBe('open');
    expect(c.exit.sub).toContain('marked ');
    expect(c.exit.tone).toBe('warn');
  });

  it('sort newest first by default, best and worst by the net return, and most R with the unmeasured last', () => {
    const run = result.runs['S2-u'];
    const sizes = run.sizes.flat;
    const newest = sortTrades(run.legs, sizes, 'entry');
    for (let i = 1; i < newest.length; i++) expect(newest[i - 1].leg.entry.when >= newest[i].leg.entry.when).toBe(true);
    const best = sortTrades(run.legs, sizes, 'best');
    for (let i = 1; i < best.length; i++) expect(best[i - 1].leg.netPct).toBeGreaterThanOrEqual(best[i].leg.netPct);
    const worst = sortTrades(run.legs, sizes, 'worst');
    expect(worst[0].leg.netPct).toBe(best[best.length - 1].leg.netPct);
    const byR = sortTrades(run.legs, sizes, 'r');
    const withR = byR.filter(x => x.leg.r != null), without = byR.filter(x => x.leg.r == null);
    expect(byR.slice(0, withR.length).every(x => x.leg.r != null)).toBe(true);
    expect(without.length).toBe(run.legs.filter(l => l.r == null).length);
    expect(newest).toHaveLength(run.legs.length);
  });
});

describe('the tables', () => {
  it('break the results down by the type at the first outcome, only the types that occur', () => {
    const rows = typeRows(result.runs.S1.stats.all);
    expect(rows.reduce((a, r) => a + r.legs, 0)).toBe(result.runs.S1.legs.length);
    for (const r of rows) expect(r.legs).toBeGreaterThan(0);
  });

  it('say how the legs ended, most common first', () => {
    const line = reasonLine(result.runs.S1.stats.all);
    const counts = Object.values(result.runs.S1.stats.all.byReason).sort((a, b) => b - a);
    expect(line.split(' · ').map(x => Number(x.split(' ')[0]))).toEqual(counts);
  });

  it('answer the ratio question for S0 and every S2 depth against S1, with what is behind each number', () => {
    const rows = ratioRows(result);
    expect(rows.map(r => r.id)).toEqual(RATIO_IDS);
    expect(rows[0].label).toBe('S0 · B1 only');
    for (const r of rows) {
      expect(r.equalRisk).toBe(result.ratios[r.id]!.equalRisk.ratio!.toFixed(2));
      expect(r.behind).toContain('setups with a stop');
    }
  });

  it('lay the grid out strategy by sizing, the money in the label asked for', () => {
    const rows = gridRows(result, 'EUR');
    expect(rows.map(r => r.id)).toEqual(STRATEGY_IDS);
    for (const r of rows) {
      expect(r.cells.map(c => c.sizing)).toEqual(SIZINGS);
      for (const c of r.cells) expect(c.dd).toMatch(/ EUR$/);
    }
  });
});

describe('the words', () => {
  it('count the caveats from the list, and state the bias the list carries', () => {
    const t = caveatText(result.caveats, result.universe, false);
    expect(t).toContain(`${result.caveats.setups} setups of the ${result.universe.breakouts} breakouts`);
    expect(t).toContain(`${result.caveats.shorts} shorts`);
    expect(t).toContain(`${result.caveats.derivedStops} with a stop read from the bars`);
    expect(t).toContain(noStopWords(result.caveats));
    expect(result.caveats.onNegation).toBeGreaterThan(0);
    expect(t).toContain(`${result.caveats.beforeListBegan} breakouts before it`);
    expect(t).toContain('08-08-26');
    expect(caveatText(result.caveats, result.universe, true)).toContain('Only breakouts from 08-08-26 on');
    // With the dial set, the breakouts left out are counted from what the universe excluded for it.
    const { bars, hist } = frozenInputs();
    const from = runModel({ rows: frozenBoard().rows, hist, bars }, { ...DEFAULT_SETTINGS, from: '2026-08-08' });
    expect(from.caveats.beforeListBegan).toBe(from.universe.excluded.filter(e => e.reason.startsWith('broke out before')).length);
    expect(from.caveats.beforeListBegan).toBe(result.caveats.beforeListBegan);
    expect(caveatText(from.caveats, from.universe, true)).toContain(`the ${from.caveats.beforeListBegan} breakouts before it are left out`);
  });

  it('list what is left out with its reason, the universe\'s first', () => {
    const groups = exclusionLines(result, result.runs.S1);
    expect(groups[0].heading).toBe('Not in the trade list');
    expect(groups[0].items).toEqual(result.universe.excluded);
    const s1 = groups.find(g => g.heading === 'Not in S1')!;
    expect(s1.items.length).toBe(result.runs.S1.excluded.length);
    for (const g of groups) for (const e of g.items) expect(e.reason).toBeTruthy();
  });

  it('count the setups without a tight stop, and say which run on the negation', () => {
    const c = (noTightStop: number, onNegation: number) => ({ ...result.caveats, noTightStop, onNegation });
    expect(noStopWords(c(0, 0))).toBe('0 without a tight stop');
    expect(noStopWords(c(2, 0))).toBe('2 without a tight stop (only where no tight stop is needed, in S0 and S3)');
    expect(noStopWords(c(4, 4))).toBe('4 without a tight stop (none in the report: on the negation in S1, S2 and S4)');
    expect(noStopWords(c(6, 4))).toBe('6 without a tight stop (4 with none in the report run on the negation in S1, S2 and S4; 2 only where no tight stop is needed, in S0 and S3)');
  });

  it('say what each strategy does in one line', () => {
    expect(strategyWords('S0')).toContain('out on the first touch of the trigger');
    expect(strategyWords('S0')).toContain('the stop is the trigger');
    expect(strategyWords('S1')).toContain('In at the confirming close');
    expect(strategyWords('S2-3')).toContain('again at a settled close back past the trigger');
    expect(strategyWords('S4')).toContain('ATRs');
  });
});
