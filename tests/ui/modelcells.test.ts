import { describe, expect, it } from 'vitest';
import { runModel } from '../../src/engine/backtest/model';
import { DEFAULT_SETTINGS, S2_IDS, SIZINGS, STRATEGY_IDS } from '../../src/engine/backtest/settings';
import type { Leg } from '../../src/engine/backtest/simulate';
import { caveatText, exclusionLines, gridRows, modelTiles, money, ratioRows, reasonLine, signedR, sortTrades, strategyWords, tradeCells, typeRows } from '../../src/ui/modelcells';
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

describe('the tiles', () => {
  it('carry the strategy\'s own counts and means, each with its unit', () => {
    const run = result.runs['S2-u'];
    const tiles = modelTiles(run, 'flat', 'all', 'units');
    const by = Object.fromEntries(tiles.map(t => [t.label, t]));
    expect(by.Trades.value).toBe(String(run.stats.all.legs));
    expect(by.Trades.sub).toContain(`${run.setups} setups`);
    expect(by['Win rate'].value).toBe(Math.round(run.stats.all.winRate!) + '%');
    expect(by.Expectancy.value).toMatch(/^[+−]?\d+\.\d%$/);
    expect(by.Expectancy.sub).toContain('90% interval');
    expect(by['In R'].value).toMatch(/ R$/);
    expect(by['Max drawdown'].value).toBe(money(-run.money.flat.maxDrawdown, 'units'));
    expect(by['Capital in use'].value).toBe(money(run.money.flat.peakExposure, 'units'));
    expect(by['Positions open'].sub).toContain(`${run.money.flat.peakOpen} at the most`);
    expect(tiles).toHaveLength(8);
  });

  it('switch to the closed trades, and to another sizing\'s money, when asked', () => {
    const run = result.runs.S1;
    const closed = modelTiles(run, 'risk', 'closed', 'USD');
    expect(closed[0].value).toBe(String(run.stats.closed.legs));
    expect(closed[0].sub).toContain('closed trades only');
    expect(closed[5].value).toBe(money(-run.money.risk.maxDrawdown, 'USD'));
    expect(closed[5].sub).toContain('risk-based sizing');
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

  it('answer the ratio question for every S2 depth against S1, with what is behind each number', () => {
    const rows = ratioRows(result);
    expect(rows.map(r => r.id)).toEqual(S2_IDS);
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
    expect(t).toContain(`${result.caveats.beforeListBegan} breakouts before it`);
    expect(t).toContain('08-08-26');
    expect(caveatText(result.caveats, result.universe, true)).toContain('Only breakouts from 08-08-26 on');
  });

  it('list what is left out with its reason, the universe\'s first', () => {
    const groups = exclusionLines(result, result.runs.S1);
    expect(groups[0].heading).toBe('Not in the trade list');
    expect(groups[0].items).toEqual(result.universe.excluded);
    const s1 = groups.find(g => g.heading === 'Not in S1')!;
    expect(s1.items.length).toBe(result.runs.S1.excluded.length);
    for (const g of groups) for (const e of g.items) expect(e.reason).toBeTruthy();
  });

  it('say what each strategy does in one line', () => {
    expect(strategyWords('S1')).toContain('In at the confirming close');
    expect(strategyWords('S2-3')).toContain('again at a settled close back past the trigger');
    expect(strategyWords('S4')).toContain('ATRs');
  });
});
