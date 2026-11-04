import { describe, expect, it } from 'vitest';
import { runModel } from '../../../src/engine/backtest/model';
import type { ModelResult } from '../../../src/engine/backtest/model';
import { DEFAULT_SETTINGS, S2_IDS, SIZINGS, STRATEGY_IDS } from '../../../src/engine/backtest/settings';
import { brokeOut, keyOf, STOP_WORDS } from '../../../src/engine/backtest/universe';
import { evaluate } from '../../../src/engine/row';
import type { Row } from '../../../src/engine/row';
import type { Setup } from '../../../src/engine/types';
import { LONG, series } from '../helpers';
import type { Day } from '../helpers';
import { frozenBoard, frozenInputs } from '../../ui/frozen';

/* The whole model on the frozen board of 2026-11-01: what must hold on any day's data, with every count read from the
   capture, and the one check phase 7 is held to: the universe the page prints is the engine's own breakout count. */

let cached: ModelResult | null = null;
const model = (): ModelResult => {
  if (cached) return cached;
  const { bars, hist } = frozenInputs();
  cached = runModel({ rows: frozenBoard().rows, hist, bars }, DEFAULT_SETTINGS);
  return cached;
};

const rowByKey = (): Map<string, Row> => new Map(frozenBoard().rows.map(r => [keyOf(r.p.sym, r.p.dir), r]));

describe('the universe on the frozen board', () => {
  it('counts exactly the rows the engine says broke out, and every one of them is a candidate or listed as excluded', () => {
    const m = model();
    const broke = frozenBoard().rows.filter(brokeOut);
    expect(broke.length).toBeGreaterThan(0);
    expect(m.universe.breakouts).toBe(broke.length);
    expect(m.universe.candidates.length + m.universe.excluded.length).toBe(broke.length);
    const keys = [...m.universe.candidates.map(c => c.key), ...m.universe.excluded.map(e => e.key)].sort();
    expect(keys).toEqual(broke.map(r => keyOf(r.p.sym, r.p.dir)).sort());
  });

  it('every candidate is signalled from the close the board reads the breakout from, or, imported, from the last close before the report', () => {
    const rows = rowByKey();
    let fromReport = 0;
    for (const c of model().universe.candidates) {
      const r = rows.get(c.key)!;
      expect(c.imported, c.key).toBe(r.st.breakout!.close == null);
      if (!c.imported) {
        expect(c.signal.when, c.key).toBe(r.st.breakout!.when);
        expect(c.signalKind, c.key).toBe('close');
        expect(c.confirming, c.key).toBeNull();
      } else {
        expect(c.confirming!.when, c.key).toBe(r.lfd!.conf);
        expect(c.signalKind, c.key).toBe('report');
        expect(c.signal.when <= r.p.confirmed!, c.key).toBe(true);
        expect(c.days.some(d => d.when > c.signal.when && d.when <= r.p.confirmed!), c.key).toBe(false);
        fromReport++;
      }
      // The capture's closes came from the old page's rounded feed and its bars from the chart feed, so a tick apart.
      expect(c.days[c.signal.index].c, c.key).toBeCloseTo(c.signal.price, 3);
    }
    expect(fromReport).toBeGreaterThan(0);
  });

  it('with the confirming-close entry, an imported candidate is signalled from the close the lookback found', () => {
    const { bars, hist } = frozenInputs();
    const m = runModel({ rows: frozenBoard().rows, hist, bars }, { ...DEFAULT_SETTINGS, importedEntry: 'close' });
    const rows = rowByKey();
    for (const c of m.universe.candidates.filter(x => x.imported)) {
      expect(c.signal.when, c.key).toBe(rows.get(c.key)!.lfd!.conf);
      expect(c.signalKind, c.key).toBe('close');
    }
  });

  it('a candidate\'s stop is the board\'s tight stop, and only a stop that is a stop', () => {
    const rows = rowByKey();
    for (const c of model().universe.candidates) {
      const L = rows.get(c.key)!.lfd!;
      const expected = L.at != null && !L.looser ? L.at : null;
      expect(c.stop, c.key).toBe(expected);
    }
  });
});

describe('the strategies on the frozen board', () => {
  it('leave out, by name and reason, exactly the candidates without a tight stop (S3 keeps them) and S3 those without a negation', () => {
    const m = model();
    const noStop = m.universe.candidates.filter(c => c.stop == null).map(c => c.key).sort();
    const noNegation = m.universe.candidates.filter(c => c.negation == null).map(c => c.key).sort();
    const stopWords = new Set(Object.values(STOP_WORDS).filter(w => w.startsWith('no tight stop')));
    for (const id of STRATEGY_IDS) {
      const run = m.runs[id];
      const forStop = run.excluded.filter(e => stopWords.has(e.reason)).map(e => e.key).sort();
      expect(forStop, id).toEqual(id === 'S3' ? [] : noStop);
      expect(run.excluded.filter(e => e.reason === 'no negation on file').map(e => e.key).sort(), id).toEqual(id === 'S3' ? noNegation : []);
      // Anything else left out is an entry the rules would not take.
      for (const e of run.excluded) {
        if (stopWords.has(e.reason) || e.reason === 'no negation on file') continue;
        expect(e.reason, `${id} ${e.key}`).toMatch(/^(at the target on the confirming close|the next open was |removed by the source before the fill)/);
      }
      expect(run.setups + run.pending.length + run.excluded.length, id).toBe(m.universe.candidates.length);
      for (const w of run.waitingReentries) expect(run.legs.some(l => l.key === w.key), `${id} ${w.key}`).toBe(true);
    }
  });

  it('S1, S3 and S4 take one leg a setup; S2 takes one plus its re-entries, no more than the depth allows', () => {
    const m = model();
    for (const id of ['S1', 'S3', 'S4'] as const) {
      expect(m.runs[id].legs.every(l => l.n === 1), id).toBe(true);
      expect(m.runs[id].legs.length, id).toBe(m.runs[id].setups);
    }
    for (const id of S2_IDS) {
      const depth = m.runs[id].strategy.reentries;
      const perSetup = new Map<string, number>();
      for (const l of m.runs[id].legs) perSetup.set(l.key, Math.max(perSetup.get(l.key) || 0, l.n));
      for (const [k, n] of perSetup) expect(n - 1, `${id} ${k}`).toBeLessThanOrEqual(depth);
    }
    // Each depth takes at least as many legs as the one before it, and S2-u has every re-entry there is.
    const counts = S2_IDS.map(id => m.runs[id].legs.length);
    for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1]);
    expect(m.runs['S2-u'].legs.length).toBeGreaterThan(m.runs.S1.legs.length);
  });

  it('S2 unlimited leaves and re-enters on the days the board counts as breaches and re-entries', () => {
    const m = model();
    const rows = rowByKey();
    let compared = 0;
    const s2 = m.runs['S2-u'];
    for (const c of m.universe.candidates) {
      const r = rows.get(c.key)!;
      if (c.stop == null || c.removed || r.st.state === 'failed') continue;
      // An entry the rules would not take has no leg where the board counts a breach: nothing to compare.
      if (s2.excluded.some(e => e.key === c.key) || s2.refused.some(x => x.key === c.key)) continue;
      const T = r.hit ? r.hit.btype : r.btype;
      if (!T || !T.breaches) continue;
      const legs = s2.legs.filter(l => l.key === c.key);
      if (!legs.length) continue;
      // An imported setup enters from the report: what the board counted before that day is not the model's, and one the
      // board had already stopped out by then (out, waiting for a close back past the trigger) is a trade the board does
      // not have at all, so there is nothing to hold it to.
      const from = legs[0].entry.when;
      if (c.signalKind === 'report' && T.breaches.some(b => b.when < from)) continue;
      const exits = legs.filter(l => l.exit && l.exit.reason === 'stop').map(l => l.exit!.when);
      expect(exits, c.key).toEqual(T.breaches.map(b => b.when).filter(w => w >= from));
      // The board counts a re-entry close that is also at the target; the model does not buy there.
      const target = r.st.targetHit ? r.st.targetHit.when : null;
      const reentries = (T.reentries ?? []).map(x => x.when).filter(w => (!target || w < target) && w >= from);
      expect(legs.slice(1).map(l => c.days[l.entry.index - (l.entry.basis === 'open' ? 1 : 0)].when), c.key).toEqual(reentries);
      compared++;
    }
    expect(compared).toBeGreaterThan(0);
  });

  it('a failed setup is out by the day the negation was touched, under every strategy', () => {
    const m = model();
    const rows = rowByKey();
    let checked = 0;
    for (const id of STRATEGY_IDS) {
      for (const l of m.runs[id].legs) {
        const r = rows.get(l.key)!;
        if (r.st.state !== 'failed' || l.c.removed) continue;
        expect(l.open, `${id} ${l.key}`).toBe(false);
        expect(l.exit!.when <= r.st.failed!.when, `${id} ${l.key}`).toBe(true);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('a setup at its target has left at the target under every strategy, on the day the board says, or on the source\'s earlier reached date', () => {
    const m = model();
    const rows = rowByKey();
    let checked = 0, early = 0;
    for (const id of STRATEGY_IDS) {
      for (const l of m.runs[id].legs) {
        const r = rows.get(l.key)!;
        if (r.st.state !== 'target' || l.c.removed || l.open) continue;
        const last = m.runs[id].legs.filter(x => x.key === l.key).pop()!;
        if (last !== l) continue;
        if (l.exit!.reason === 'stop') continue;   // a B3 whose last leg was stopped before the target: not re-entered yet when the target came
        const hit = r.st.targetHit!;
        if (l.c.reached && l.c.reached <= hit.when) {
          // The source counted the target before (or on) the day a close reached it: with no hindsight, that is the exit.
          expect(l.exit!.reason, `${id} ${l.key}`).toBe('reached');
          expect(l.exit!.when >= l.c.reached && l.exit!.when <= hit.when, `${id} ${l.key}`).toBe(true);
          early++;
        } else {
          expect(l.exit!.reason, `${id} ${l.key}`).toBe('target');
          expect(l.exit!.when, `${id} ${l.key}`).toBe(hit.when);
        }
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(early);
  });
});

describe('one row through the whole model', () => {
  const WITH_LFD: Setup = { ...LONG, lfd: 94 };
  const one = (p: Setup, days: Day[]) => {
    const { bars, hist } = series(days);
    const row = evaluate(p, hist, bars, null, '2026-02-01');
    return runModel({ rows: [row], hist: { [p.sym]: hist }, bars: { [p.sym]: bars } }, DEFAULT_SETTINGS);
  };
  const BREAK: Day[] = [['2026-01-05', 95, 99, 98, 96], ['2026-01-06', 98, 102, 101, 99]];

  it('S3 leaves out a setup with no negation on file; the stop strategies keep it', () => {
    const m = one({ ...WITH_LFD, negation: null }, [...BREAK, ['2026-01-07', 99, 104, 103, 100]]);
    expect(m.runs.S3.excluded).toEqual([{ key: 'X|long', sym: 'X', dir: 'long', reason: 'no negation on file' }]);
    expect(m.runs.S3.legs).toHaveLength(0);
    expect(m.runs.S1.legs).toHaveLength(1);
    expect(m.runs.S1.excluded).toEqual([]);
  });

  it('a setup with a leg and a re-entry still to fill is a setup, not a pending one', () => {
    const m = one(WITH_LFD, [...BREAK, ['2026-01-07', 99, 104, 103, 100], ['2026-01-08', 93, 99, 96, 97], ['2026-01-09', 97, 103, 102, 98]]);
    const run = m.runs['S2-u'];
    expect(run).toMatchObject({ setups: 1, pending: [], waitingReentries: [{ key: 'X|long', reason: 'waiting for the next open to re-enter (1)' }] });
    expect(run.setups + run.pending.length + run.excluded.length).toBe(1);
  });

  it('a setup whose confirming close is at the target is in the universe and excluded from every strategy', () => {
    const m = one({ ...WITH_LFD, target: 101 }, [...BREAK, ['2026-01-07', 99, 104, 103, 100]]);
    expect(m.universe.breakouts).toBe(1);
    for (const id of STRATEGY_IDS) expect(m.runs[id].excluded.map(e => e.reason), id).toEqual(['at the target on the confirming close']);
  });
});

describe('the result', () => {
  it('has a grid cell for every strategy and sizing, a ratio for every S2 depth, and caveats counted from the list', () => {
    const m = model();
    expect(m.grid).toHaveLength(STRATEGY_IDS.length * SIZINGS.length);
    for (const id of S2_IDS) {
      expect(m.ratios[id]).toBeTruthy();
      expect(m.runs[id].scale).toBe(m.ratios[id]!.equalRisk.ratio ?? 1);
    }
    expect(m.ratios.S1).toBeUndefined();
    const u = m.universe.candidates;
    expect(m.caveats).toMatchObject({
      setups: u.length,
      shorts: u.filter(c => c.dir === 'short').length,
      derivedStops: u.filter(c => c.stopSource === 'derived').length,
      noTightStop: u.filter(c => c.stop == null).length,
      imported: u.filter(c => c.imported).length,
      removed: u.filter(c => c.removed).length,
      open: m.runs.S3.legs.filter(l => l.open).length,
      listBegan: '2026-08-08',
    });
    expect(m.caveats.busiestMonth!.count).toBeGreaterThan(0);
    expect(m.caveats.beforeListBegan).toBe(u.filter(c => c.signal.when < '2026-08-08').length);
  });

  it('every run has its statistics closed and open, its interval, and money under each sizing', () => {
    const m = model();
    for (const id of STRATEGY_IDS) {
      const run = m.runs[id];
      expect(run.stats.all.legs, id).toBe(run.legs.length);
      expect(run.stats.closed.legs, id).toBe(run.legs.filter(l => !l.open).length);
      expect(run.bootstrap.pct.all, id).toBeTruthy();
      expect(run.bootstrap.pct.all!.resamples, id).toBe(DEFAULT_SETTINGS.resamples);
      for (const sz of SIZINGS) {
        expect(run.sizes[sz], `${id} ${sz}`).toHaveLength(run.legs.length);
        expect(run.money[sz].curve.dates.length, `${id} ${sz}`).toBeGreaterThan(0);
      }
    }
  });

  it('is the same again for the same settings, and the interval moves with the seed', () => {
    const { bars, hist } = frozenInputs();
    const again = runModel({ rows: frozenBoard().rows, hist, bars }, DEFAULT_SETTINGS);
    const strip = (m: ModelResult) => JSON.stringify({ ...m, ms: 0, universe: m.universe.breakouts, runs: Object.values(m.runs).map(r => ({ id: r.id, legs: r.legs.map(l => ({ ...l, c: l.key })), boot: r.bootstrap, money: r.money })) });
    expect(strip(again)).toBe(strip(model()));
    const other = runModel({ rows: frozenBoard().rows, hist, bars }, { ...DEFAULT_SETTINGS, seed: 2 });
    expect(other.runs.S1.bootstrap.pct.all).not.toEqual(model().runs.S1.bootstrap.pct.all);
    expect(other.runs.S1.legs.length).toBe(model().runs.S1.legs.length);
  });

  it('runs fast enough to answer a changed dial as it is turned', () => {
    const { bars, hist } = frozenInputs();
    const t0 = performance.now();
    runModel({ rows: frozenBoard().rows, hist, bars }, DEFAULT_SETTINGS);
    expect(performance.now() - t0).toBeLessThan(2000);
  });

  it('the entry at the close moves every fill to the confirming close and keeps the exits', () => {
    const { bars, hist } = frozenInputs();
    const atOpen = runModel({ rows: frozenBoard().rows, hist, bars }, { ...DEFAULT_SETTINGS, importedEntry: 'close' });
    const atClose = runModel({ rows: frozenBoard().rows, hist, bars }, { ...DEFAULT_SETTINGS, entry: 'close', importedEntry: 'close' });
    expect(atClose.runs.S1.legs.every(l => l.entry.basis === 'close')).toBe(true);
    expect(atClose.runs.S1.pending).toEqual([]);
    const byKey = new Map(atOpen.runs.S1.legs.map(l => [l.key, l]));
    for (const l of atClose.runs.S1.legs) {
      const o = byKey.get(l.key);
      if (!o || !o.exit || !l.exit) continue;
      // An exit read on the open-fill day itself is the one difference the entry can make.
      if (o.exit.when === o.entry.when) continue;
      expect(l.exit.when, l.key).toBe(o.exit.when);
    }
  });
});
