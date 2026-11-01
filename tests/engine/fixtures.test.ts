import { describe, expect, it } from 'vitest';
import { rrOf, runupOf } from '../../src/engine/derived';
import { evaluate } from '../../src/engine/row';
import type { Bars, History, Setup } from '../../src/engine/types';
import prk from '../fixtures/prk.json';
import wawi from '../fixtures/wawi.json';
import t7936 from '../fixtures/7936t.json';
import iclr from '../fixtures/iclr.json';

/* Four setups, each a window of real (or, for PRK, hand-built) bars with the
   outcome the old page gave on 2026-11-01. The `why` in each file says what
   the case exercises. */

interface Fixture {
  name: string;
  why: string;
  setup: Record<string, unknown>;
  settled: [string, number][];
  live: number | null;
  liveDate: string;
  currency: string;
  bars: Bars | null;
  expect: Record<string, unknown>;
}

const strip = <T,>(x: T): T => JSON.parse(JSON.stringify(x === undefined ? null : x));

const load = (f: Fixture) => {
  const p = { ...f.setup, manualState: f.setup.removed ? 'removed' : null } as unknown as Setup;
  const hist: History = { settled: f.settled, live: f.live, liveDate: f.liveDate, currency: f.currency };
  return { p, hist, row: evaluate(p, hist, f.bars, null, '2026-11-01') };
};

describe('fixtures', () => {
  for (const f of [prk, wawi, t7936, iclr] as unknown as Fixture[]) {
    it(`${f.name}: ${f.expect.section}`, () => {
      const { row } = load(f);
      expect(strip({ section: row.section, btype: row.btype, lfd: row.lfd,
        breakout: row.st.breakout, targetHit: row.st.targetHit, failed: row.st.failed })).toEqual(f.expect);
    });
  }

  it('PRK: reward : risk at the trigger against the derived stop, and the run-up at the end', () => {
    const { p, row } = load(prk as unknown as Fixture);
    expect(rrOf(p, row.lfd)).toEqual({ ratio: 2.1, vs: 'tight stop', stop: 174 });
    const r = runupOf(p, row.live, row.prevClose, row.lfd)!;
    expect(r.used).toBeCloseTo(19 / 21, 6);
    expect(r.past).toBeCloseTo((203 / 184 - 1) * 100, 6);
  });

  it('WAWI.OL: the confirming close is the Thursday before the report\'s Saturday date', () => {
    const { row } = load(wawi as unknown as Fixture);
    expect(row.lfd).toMatchObject({ conf: '2026-07-23', src: 'report', at: 132.6, bar: '2026-07-10' });
    // The low of 2026-08-03 is exactly the 145.3 trigger: a touch, so that is where the second pullback starts.
    expect(row.btype!.pullbacks!.map(x => x.when)).toEqual(['2026-07-24', '2026-08-03']);
  });

  it('7936.T: the stop touched first, then the negation; a B3 exit does not fail the pattern', () => {
    const { row } = load(t7936 as unknown as Fixture);
    expect(row.lfd!.hit).toEqual({ when: '2026-08-21', at: 4618 });
    expect(row.st.failed).toMatchObject({ when: '2026-08-26', at: 4463, byTouch: true });
    expect(row.btype).toEqual({ tag: 'B4' });
  });

  it('ICLR: removed after breaking out and reaching its target, on closes alone', () => {
    const { row } = load(iclr as unknown as Fixture);
    expect(row.section).toBe('removed');
    expect(row.st.state).toBe('target');
    expect(row.btype).toEqual({ tag: null });
  });
});
