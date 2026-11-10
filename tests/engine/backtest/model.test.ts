import { describe, expect, it } from 'vitest';
import { runModel } from '../../../src/engine/backtest/model';
import type { ModelResult } from '../../../src/engine/backtest/model';
import { DEFAULT_SETTINGS, RATIO_IDS, S2_IDS, SIZINGS, STRATEGY_IDS } from '../../../src/engine/backtest/settings';
import { atOrPast, past } from '../../../src/engine/precision';
import { brokeOut, keyOf } from '../../../src/engine/backtest/universe';
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
  it('leave out, by name and reason, exactly the candidates without a stop they can run on (S0 and S3 keep them) and S3 those without a negation', () => {
    const m = model();
    // A derived stop beyond the negation, or none readable: out of the stop strategies. None in the report: on the negation instead.
    const noStop = m.universe.candidates.filter(c => c.stop == null && !(c.stopSource === 'none' && c.negation != null)).map(c => c.key).sort();
    const noNegation = m.universe.candidates.filter(c => c.negation == null).map(c => c.key).sort();
    const stopWords = (r: string) => r.startsWith('no tight stop');
    for (const id of STRATEGY_IDS) {
      const run = m.runs[id];
      const forStop = run.excluded.filter(e => stopWords(e.reason)).map(e => e.key).sort();
      expect(forStop, id).toEqual(id === 'S0' || id === 'S3' ? [] : noStop);
      expect(run.excluded.filter(e => e.reason === 'no negation on file').map(e => e.key).sort(), id).toEqual(id === 'S3' ? noNegation : []);
      // Anything else left out is an entry the rules would not take.
      for (const e of run.excluded) {
        if (stopWords(e.reason) || e.reason === 'no negation on file') continue;
        expect(e.reason, `${id} ${e.key}`).toMatch(/^(at the target on the (confirming close|last close before the report)|the (next open|first close after the report|confirming close) was |removed by the source before the fill|stopped out before the report|pulled back to the trigger before the (report|fill))/);
      }
      expect(run.setups + run.pending.length + run.excluded.length, id).toBe(m.universe.candidates.length);
      for (const w of run.waitingReentries) expect(run.legs.some(l => l.key === w.key), `${id} ${w.key}`).toBe(true);
    }
  });

  it('a setup with no last full day in the report runs S1, S2 and S4 on the negation, and the caveats count it', () => {
    const m = model();
    const onNegation = m.universe.candidates.filter(c => c.stop == null && c.stopSource === 'none' && c.negation != null);
    expect(onNegation.length).toBeGreaterThan(0);
    expect(m.caveats.onNegation).toBe(onNegation.length);
    expect(m.caveats.noTightStop).toBeGreaterThanOrEqual(onNegation.length);
    for (const id of ['S1', 'S2-u', 'S4'] as const) {
      const run = m.runs[id];
      for (const c of onNegation) {
        const legs = run.legs.filter(l => l.key === c.key);
        if (!legs.length) {
          const why = [...run.excluded, ...run.pending].find(e => e.key === c.key);
          expect(why && !why.reason.startsWith('no tight stop'), `${id} ${c.key}`).toBe(true);
          continue;
        }
        expect(legs[0], `${id} ${c.key}`).toMatchObject({ stop: null, stopKind: 'negation', stopSource: 'none' });
        expect(legs[0].riskPct, `${id} ${c.key}`).toBeCloseTo(Math.abs(legs[0].entry.price - c.negation!) / legs[0].entry.price * 100, 3);
        for (const l of legs) if (l.exit && l.exit.reason === 'stop') expect(l.exit.stopKind, `${id} ${c.key}`).toBe('trailing stop');
      }
    }
    // S0 and S3 never needed one.
    for (const id of ['S0', 'S3'] as const) expect(m.runs[id].excluded.some(e => e.reason.startsWith('no tight stop')), id).toBe(false);
  });

  it('S0 runs on the trigger: every stop exit is a touch of it, and it is out no later than S1 on the same setup', () => {
    const m = model();
    const s0 = m.runs.S0, s1 = m.runs.S1;
    expect(s0.legs.length).toBeGreaterThan(0);
    let compared = 0;
    for (const l of s0.legs) {
      expect(l.n, l.key).toBe(1);
      expect(l, l.key).toMatchObject({ stop: l.c.trigger, stopKind: 'trigger' });
      if (l.exit && l.exit.reason === 'stop') {
        expect(l.exit.stopKind, l.key).toBe('trigger');
        expect(l.exit.level, l.key).toBe(l.c.trigger);
      }
      const other = s1.legs.find(x => x.key === l.key && x.n === 1);
      // The last full day is inside the trigger, so a touch of it is a touch of the trigger first: S0 is out by then.
      if (!other || !other.exit || other.exit.reason !== 'stop' || other.stop == null || atOrPast(l.dir === 'long', other.stop, l.c.trigger)) continue;
      expect(l.exit, l.key).not.toBeNull();
      expect(l.exit!.when <= other.exit.when, l.key).toBe(true);
      compared++;
    }
    expect(compared).toBeGreaterThan(0);
  });

  it('every entry is at a settled close or at the next open, and no intraday price chose one: either entry setting, every strategy', () => {
    const { bars, hist } = frozenInputs();
    let checked = 0, afterClose = 0;
    for (const entry of ['open', 'close'] as const) {
      const m = runModel({ rows: frozenBoard().rows, hist, bars }, { ...DEFAULT_SETTINGS, entry });
      for (const id of STRATEGY_IDS) {
        for (const l of m.runs[id].legs) {
          const long = l.dir === 'long';
          const d = l.c.days[l.entry.index];
          const at = `${entry} ${id} ${l.key} #${l.n}`;
          expect(['open', 'close'], at).toContain(l.entry.basis);
          expect(l.entry.price, at).toBe(l.entry.basis === 'open' ? d.o : d.c);
          // The close it came from: this day's under a fill at the close, the day before's under a fill at the open. An
          // imported setup's first leg comes from the report instead of from a close past the trigger.
          if (l.n === 1 && l.c.signalKind === 'report') continue;
          const signal = l.c.days[l.entry.basis === 'open' ? l.entry.index - 1 : l.entry.index];
          expect(past(long, signal.c as number, l.c.trigger), at).toBe(true);
          if (l.entry.basis === 'close') afterClose++;
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
    // The 1 Nov capture was written before opens were kept: its fills are all at a close.
    expect(afterClose).toBe(checked);
  });

  it('S0, S1, S3 and S4 take one leg a setup; S2 takes one plus its re-entries, no more than the depth allows', () => {
    const m = model();
    for (const id of ['S0', 'S1', 'S3', 'S4'] as const) {
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
      // An imported setup enters from the report: what the board counted before the model's first fill is not the model's.
      // A fill at an open is in for that day's low; one at a close is in from the day after.
      const first = legs[0];
      const inFrom = (w: string) => (first.entry.basis === 'open' ? w >= first.entry.when : w > first.entry.when);
      const exits = legs.filter(l => l.exit && l.exit.reason === 'stop').map(l => l.exit!.when);
      expect(exits, c.key).toEqual(T.breaches.map(b => b.when).filter(inFrom));
      // Re-entries: the model's legs after the first, or every leg when the setup was out at the report and the first leg
      // is itself a re-entry. The board counts a re-entry close that is also at the target; the model does not buy there.
      const signalDay = (l: typeof first) => c.days[l.entry.index - (l.entry.basis === 'open' ? 1 : 0)].when;
      const target = r.st.targetHit ? r.st.targetHit.when : null;
      const firstSignal = signalDay(first);
      const reentries = (T.reentries ?? []).map(x => x.when).filter(w => (!target || w < target) && (first.n > 1 ? w >= firstSignal : w > firstSignal));
      expect(legs.filter(l => l.n > 1).map(signalDay), c.key).toEqual(reentries);
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

  it('a setup with no last full day in the report runs in every strategy, on the negation in the stop ones; with no negation either it is left out of them', () => {
    const m = one({ ...LONG, lfd: 0 }, [...BREAK, ['2026-01-07', 99, 104, 103, 101]]);
    for (const id of STRATEGY_IDS) expect(m.runs[id].legs, id).toHaveLength(1);
    for (const id of ['S1', 'S2-u', 'S4'] as const) expect(m.runs[id].legs[0], id).toMatchObject({ stop: null, stopKind: 'negation', stopSource: 'none' });
    expect(m.runs.S0.legs[0]).toMatchObject({ stop: 100, stopKind: 'trigger' });
    expect(m.caveats).toMatchObject({ noTightStop: 1, onNegation: 1 });
    const bare = one({ ...LONG, lfd: 0, negation: null }, [...BREAK, ['2026-01-07', 99, 104, 103, 101]]);
    for (const id of ['S1', 'S2-u', 'S4'] as const) expect(bare.runs[id].excluded.map(e => e.reason), id).toEqual(['no tight stop: none in the report, and no negation on file']);
    expect(bare.runs.S3.excluded.map(e => e.reason)).toEqual(['no negation on file']);
    expect(bare.runs.S0.legs).toHaveLength(1);
    expect(bare.caveats).toMatchObject({ noTightStop: 1, onNegation: 0 });
  });

});

describe('the result', () => {
  it('has a grid cell for every strategy and sizing, a ratio for S0 and every S2 depth, and caveats counted from the list', () => {
    const m = model();
    expect(m.grid).toHaveLength(STRATEGY_IDS.length * SIZINGS.length);
    expect(RATIO_IDS).toEqual(['S0', ...S2_IDS]);
    for (const id of RATIO_IDS) {
      expect(m.ratios[id]).toBeTruthy();
      expect(m.runs[id].scale).toBe(m.ratios[id]!.equalRisk.ratio ?? 1);
      expect(m.grid.find(g => g.strategy === id && g.sizing === 'flat')!.ratio).toBe(m.ratios[id]!.equalRisk.ratio);
    }
    // S0's stop, the trigger, is nearer than the last full day: the equal-risk ratio puts more on an S0 entry.
    expect(m.ratios.S0!.equalRisk.ratio).toBeGreaterThan(1);
    for (const id of ['S1', 'S3', 'S4'] as const) { expect(m.ratios[id]).toBeUndefined(); expect(m.runs[id].scale).toBe(1); }
    const u = m.universe.candidates;
    expect(m.caveats).toMatchObject({
      setups: u.length,
      shorts: u.filter(c => c.dir === 'short').length,
      derivedStops: u.filter(c => c.stopSource === 'derived').length,
      noTightStop: u.filter(c => c.stop == null).length,
      onNegation: u.filter(c => c.stop == null && c.stopSource === 'none' && c.negation != null).length,
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
