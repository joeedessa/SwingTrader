import { describe, expect, it } from 'vitest';
import { atrSeries } from '../../../src/engine/backtest/atr';
import { runModel } from '../../../src/engine/backtest/model';
import { equalRiskRatio } from '../../../src/engine/backtest/ratio';
import { DEFAULT_SETTINGS, STRATEGIES, strategyId } from '../../../src/engine/backtest/settings';
import type { ModelSettings, StrategyId } from '../../../src/engine/backtest/settings';
import { simulate } from '../../../src/engine/backtest/simulate';
import type { Leg } from '../../../src/engine/backtest/simulate';
import { universeOf } from '../../../src/engine/backtest/universe';
import { evaluate } from '../../../src/engine/row';
import type { Bars, DayBar, History, Setup } from '../../../src/engine/types';
import gap from '../../fixtures/model-gap.json';
import short from '../../fixtures/model-short.json';
import reentries from '../../fixtures/model-reentries.json';
import open from '../../fixtures/model-open.json';
import reached from '../../fixtures/model-reached.json';
import removed from '../../fixtures/model-removed.json';
import trail from '../../fixtures/model-trail.json';

/* Seven hand-built setups, each with the legs every strategy must produce under the stated settings, worked out by
   hand in the fixture's `why` (plan E, phase 7): a gap through the stop, a short, two re-entries (with both stops of
   Q3), an open trade (and one waiting for its fill), a target the source counted, a setup removed after breaking out,
   and the S4 trail on bars whose ATR is exactly 2. Numbers are held to four decimals. */

interface Case {
  settings: Partial<ModelSettings>;
  strategy: StrategyId;
  pending: string | null;
  legs: Record<string, unknown>[];
}

interface Fixture {
  name: string;
  why: string;
  setup: Record<string, unknown>;
  bars: Record<string, number[]>;
  extraSettled?: [string, number][];
  today: string;
  row: { section: string; tag: string | null };
  universe: { breakouts: number; candidates: number; excluded: unknown[] };
  cases: Case[];
  cut?: { upTo: string; cases: Case[] };
  excludedWhen?: { settings: Partial<ModelSettings>; universe: { breakouts: number; candidates: number; excluded: unknown[] } };
  ratios?: Record<string, number>;
  atr?: number;
}

const FIXTURES = [gap, short, reentries, open, reached, removed, trail] as unknown as Fixture[];

function inputs(f: Fixture, upTo?: string) {
  const bars: Bars = {};
  for (const [d, b] of Object.entries(f.bars)) if (!upTo || d <= upTo) bars[d] = b as DayBar;
  const settled = Object.keys(bars).sort().map(d => [d, bars[d][2] as number] as [string, number]);
  if (!upTo) for (const e of f.extraSettled ?? []) settled.push(e);
  const last = settled[settled.length - 1];
  const hist: History = { settled, live: last[1], liveDate: last[0], currency: 'USD' };
  const p = { ...f.setup, manualState: f.setup.removed ? 'removed' : null } as unknown as Setup;
  const row = evaluate(p, hist, bars, null, f.today);
  return { row, hist: { [p.sym]: hist }, bars: { [p.sym]: bars } };
}

const settingsOf = (o: Partial<ModelSettings>): ModelSettings => ({ ...DEFAULT_SETTINGS, ...o });
const strategyOf = (id: StrategyId) => STRATEGIES.find(s => strategyId(s) === id)!;

const view = (l: Leg) => ({
  n: l.n,
  entry: { when: l.entry.when, price: l.entry.price, basis: l.entry.basis },
  exit: l.exit ? { when: l.exit.when, price: l.exit.price, basis: l.exit.basis, reason: l.exit.reason, level: l.exit.level, stopKind: l.exit.stopKind } : null,
  mark: l.mark, stop: l.stop, stopKind: l.stopKind, open: l.open,
  grossPct: l.grossPct, netPct: l.netPct, riskPct: l.riskPct, r: l.r, days: l.days, tag: l.tag,
});

function expectLegs(actual: Leg[], expected: Record<string, unknown>[]) {
  expect(actual.map(l => l.n)).toEqual(expected.map((_, i) => i + 1));
  actual.forEach((l, i) => {
    const got = view(l) as Record<string, unknown>;
    for (const [k, want] of Object.entries(expected[i])) {
      const label = `leg ${i + 1} ${k}`;
      if (typeof want === 'number') expect(got[k], label).toBeCloseTo(want, 4);
      else if (want && typeof want === 'object') {
        const g = got[k] as Record<string, unknown>;
        expect(g, label).toBeTruthy();
        for (const [kk, w] of Object.entries(want as Record<string, unknown>)) {
          if (typeof w === 'number') expect(g[kk], `${label}.${kk}`).toBeCloseTo(w, 4);
          else expect(g[kk], `${label}.${kk}`).toEqual(w);
        }
      } else expect(got[k], label).toEqual(want);
    }
  });
}

function runCase(f: Fixture, c: Case, upTo?: string) {
  const { row, hist, bars } = inputs(f, upTo);
  const settings = settingsOf(c.settings);
  const u = universeOf([row], hist, bars, settings);
  expect(u.candidates).toHaveLength(1);
  return simulate(u.candidates[0], strategyOf(c.strategy), settings);
}

for (const f of FIXTURES) {
  describe(`model fixture: ${f.name}`, () => {
    it(`the board reads it as ${f.row.section}, ${f.row.tag}`, () => {
      const { row } = inputs(f);
      expect(row.section).toBe(f.row.section);
      expect(row.btype ? row.btype.tag : null).toBe(f.row.tag);
    });

    it('is in the universe', () => {
      const { row, hist, bars } = inputs(f);
      const u = universeOf([row], hist, bars, DEFAULT_SETTINGS);
      expect({ breakouts: u.breakouts, candidates: u.candidates.length, excluded: u.excluded }).toEqual(f.universe);
    });

    for (const c of f.cases) {
      it(`${c.strategy}${Object.keys(c.settings).length ? ' with ' + JSON.stringify(c.settings) : ''}: ${c.legs.length} leg(s)`, () => {
        const sim = runCase(f, c);
        expect(sim.pending).toBe(c.pending);
        expectLegs(sim.legs, c.legs);
      });
    }

    if (f.cut) {
      for (const c of f.cut.cases) {
        it(`cut at ${f.cut.upTo}, ${c.strategy}${Object.keys(c.settings).length ? ' with ' + JSON.stringify(c.settings) : ''}: ${c.pending ?? c.legs.length + ' leg(s)'}`, () => {
          const sim = runCase(f, c, f.cut!.upTo);
          expect(sim.pending).toBe(c.pending);
          expectLegs(sim.legs, c.legs);
        });
      }
    }

    if (f.excludedWhen) {
      it(`is left out with ${JSON.stringify(f.excludedWhen.settings)}, and still counted as a breakout`, () => {
        const { row, hist, bars } = inputs(f);
        const u = universeOf([row], hist, bars, settingsOf(f.excludedWhen!.settings));
        expect({ breakouts: u.breakouts, candidates: u.candidates.length, excluded: u.excluded }).toEqual(f.excludedWhen!.universe);
      });
    }

    if (f.ratios) {
      it('the equal-risk ratio of each S2 depth against S1 is the total risk S1 takes over the total S2 takes', () => {
        const { row, hist, bars } = inputs(f);
        const settings = settingsOf({ entry: 'close' });
        const c = universeOf([row], hist, bars, settings).candidates[0];
        const s1 = simulate(c, strategyOf('S1'), settings).legs;
        for (const [id, want] of Object.entries(f.ratios!)) {
          const legs = simulate(c, strategyOf(id as StrategyId), settings).legs;
          const r = equalRiskRatio(s1, legs);
          expect(r.ratio, id).toBeCloseTo(want, 4);
          expect(r).toMatchObject({ a: 1, b: 1, basis: 'setups' });
        }
      });

      it('runModel carries the same legs and ratio through to the grid', () => {
        const { row, hist, bars } = inputs(f);
        const res = runModel({ rows: [row], hist, bars }, settingsOf({ entry: 'close' }));
        expect(res.universe.breakouts).toBe(1);
        expect(res.runs['S2-2'].legs).toHaveLength(3);
        expect(res.runs['S2-2'].scale).toBeCloseTo(f.ratios!['S2-2'], 4);
        expect(res.ratios['S2-2']!.equalRisk.ratio).toBeCloseTo(f.ratios!['S2-2'], 4);
        expect(res.grid.find(g => g.strategy === 'S2-2' && g.sizing === 'flat')!.ratio).toBeCloseTo(f.ratios!['S2-2'], 4);
        expect(res.grid.find(g => g.strategy === 'S1' && g.sizing === 'flat')!.ratio).toBeNull();
        // Per-strategy sizing puts the scaled amount on each S2 entry.
        for (const s of res.runs['S2-2'].sizes.perStrategy) expect(s).toBeCloseTo(DEFAULT_SETTINGS.size * f.ratios!['S2-2'], 1);
        expect(res.runs.S1.sizes.perStrategy).toEqual([DEFAULT_SETTINGS.size]);
      });
    }

    if (f.atr != null) {
      it(`has an ATR of exactly ${f.atr} on every day after the first`, () => {
        const { row, hist, bars } = inputs(f);
        const c = universeOf([row], hist, bars, DEFAULT_SETTINGS).candidates[0];
        const atr = atrSeries(c.days);
        expect(atr[0]).toBeNull();
        expect(atr.slice(1).every(a => a != null && Math.abs(a - f.atr!) < 1e-9)).toBe(true);
      });
    }
  });
}
