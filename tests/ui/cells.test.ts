import { describe, expect, it } from 'vitest';
import {
  addedText, breachesCell, failedCell, lfdCell, liveCell, negationCell, pullbacksText, reachedCell, reasonText, removedCell,
  rrCell, sinceTargetCell, sortValue, srcOpenCell, statusCell, symbolCell, targetCell, trailingStopCell, triggerCell, typeCell,
} from '../../src/ui/cells';
import type { Cell } from '../../src/ui/cells';
import { frozenBoard, rowOf, TODAY } from './frozen';

/* The wording is the old page's, so these pin real rows from the frozen board (Sunday 2026-11-01, every market
   shut). If a rule or a sentence changes, one of these says so. */

const line = (c: Cell) => [c.value, c.sub ?? ''].join(' | ');

describe('the two fixed columns', () => {
  it('symbol: the symbol, direction, name and currency', () => {
    expect(symbolCell(rowOf('TVE.TO'))).toEqual({ sym: 'TVE.TO', dir: 'long', name: 'Tamarack Valley Energy Ltd.', ccy: 'CAD' });
  });

  it('live: price, currency, the day move with its direction, and no "live" flag while the market is shut', () => {
    expect(liveCell(rowOf('TVE.TO'))).toEqual({ price: '14.09', ccy: 'CAD', day: { text: '−1.7%', dir: 'down' }, live: false, liveDate: '2026-10-30' });
    expect(liveCell(rowOf('7936.T')).price).toBe('4,838');
    expect(liveCell(rowOf('MKS.L')).ccy).toBe('GBp');
  });
});

describe('a waiting row', () => {
  const r = rowOf('FBIZ');
  it('trigger says how far away it is, as a percentage and in money', () => {
    expect(line(triggerCell(r, 'watch'))).toBe('75.7 | +0.4% to trigger · +0.3 USD');
    expect(triggerCell(r, 'watch').title).toBe('Needs to move 0.3 USD to reach the trigger');
  });
  it('target says what the pattern pays', () => expect(line(targetCell(r, 'watch'))).toBe('79 | +4.4% payoff'));
  it('reward : risk is red under 1, and says which stop it is measured to', () => {
    expect(rrCell(r)).toMatchObject({ value: '0.9 : 1', sub: 'vs tight stop', tone: 'bad' });
    expect(rrCell(r).title).toBe('Payoff 3.3 (trigger 75.7 → target 79) against 3.77 of risk to the tight stop at 71.93.');
  });
  it('the stop is recorded at the boundary close but is not a trade yet', () => {
    expect(line(lfdCell(r, 'watch'))).toBe('71.93 | past boundary 29-10-26 · not confirmed');
    expect(lfdCell(r, 'watch').title).toContain('Not a trade yet: a close above 75.7 confirms it, and the stop is tested from then.');
  });
  it('negation is "not set", not a gap: the source publishes it only after a breakout', () => {
    expect(negationCell(r, 'watch')).toMatchObject({ value: '–', sub: 'not set' });
    expect(negationCell(rowOf('NGVT'), 'watch').title).toBe('The source publishes a negation only once a setup has broken out.');
  });
  it('no stop yet means no reward : risk, and says when it will fill in', () => {
    expect(rrCell(rowOf('NGVT'))).toMatchObject({ value: '–', sub: 'no stop yet' });
    expect(rrCell(rowOf('NGVT')).title).toContain('Fills in once the stock closes past its boundary');
    expect(lfdCell(rowOf('NGVT'), 'watch').title).toBe('Recorded on the first close above the boundary at 77.7.');
  });
});

describe('a confirmed row', () => {
  const r = rowOf('TVE.TO');
  it('trigger: back under it, with what entering now would pay', () => expect(line(triggerCell(r, 'breakout'))).toBe('14.45 | 2.5% back under · 4.4 : 1 now'));
  it('trigger: past it, with the share of the move used', () => expect(line(triggerCell(rowOf('BNOR.OL'), 'breakout'))).toBe('628 | +0.8% past · 4% of move · 3.0 : 1 now'));
  it('the used-move sentence is left out while price is back under the trigger', () => expect(triggerCell(r, 'breakout').title).not.toContain('is used'));
  it('trigger turns amber from half the move used, red from all of it', () => {
    expect(triggerCell(rowOf('PGEN'), 'breakout').subTone).toBe('warn');
    expect(triggerCell(rowOf('WAWI.OL'), 'breakout').subTone).toBe('bad');
  });
  it('target and negation say how far there is to go and how far away the exit is', () => {
    expect(line(targetCell(r, 'breakout'))).toBe('16.1 | +14.3% to go');
    expect(line(negationCell(r, 'breakout'))).toBe('12.81 | −9.1% away');
  });
  it('the tight stop reads as a give-back from live, and where it came from', () => {
    expect(line(lfdCell(r, 'breakout'))).toBe('13.63 | −3.3% · from report');
    expect(lfdCell(r, 'breakout').title).toBe("Entered from the report. Anchored to the confirming close instead (2026-10-16, Tech Charts' wording) it would be 13.84, the low of 2026-10-15.");
    expect(line(lfdCell(rowOf('UNM'), 'breakout'))).toBe('81.72 | −10.3% · bar 19-05-26 · no boundary');
  });
  it('a report that gives no stop says so (breakouts before June)', () => {
    expect(line(lfdCell(rowOf('BLBD'), 'breakout'))).toBe('– | none in report');
  });
  it('type: B2 with its pullbacks, "potential" until the target is reached', () => {
    expect(typeCell(r)).toMatchObject({ value: 'B2', badge: { text: 'B2', cls: 'b2' }, sub: 'potential · 2 pullbacks' });
    expect(typeCell(r).title).toBe('Pulled back through the trigger (14.45) 2 times, first on 2026-10-19, and has held its last full day.');
    expect(pullbacksText(r)).toBe('1. 2026-10-19 (14.42)\n2. 2026-10-29 (14.2)');
  });
  it('type: a B1 has had no pullback', () => {
    expect(typeCell(rowOf('GIB-A.TO'))).toMatchObject({ value: 'B1', sub: 'potential · no pullback' });
    expect(pullbacksText(rowOf('GIB-A.TO'))).toBe('No pullback through the trigger yet.');
  });
});

describe('a B3: out, and back in', () => {
  it('stopped out: how far to a re-entry, the exit count, and a stop that is gone', () => {
    const r = rowOf('NTGY.MC');
    expect(line(triggerCell(r, 'stopped'))).toBe('30.46 | +2.7% to re-entry');
    expect(triggerCell(r, 'stopped').title).toBe('Exited 2026-10-29. A close above 30.46 is the re-entry signal; the negation (28.66) ends it.');
    expect(line(breachesCell(r))).toBe('1 | last 29-10-26');
    expect(lfdCell(r, 'stopped')).toMatchObject({ value: '29.4', sub: 'hit 29.38 on 29-10-26', tone: 'bad', subTone: 'held' });
    expect(statusCell(r)).toMatchObject({ value: 'Out' });
  });
  it('re-entered: the date, the price, the original stop and what it is away', () => {
    const r = rowOf('AME');
    expect(statusCell(r)).toMatchObject({ value: 'Re-entered', tone: 'good', sub: '29-10-26 @ 251.8 · stop 236 (−2.1%)' });
    expect(statusCell(r).title).toBe('Re-entry 2: closed back above the trigger (250). Stop is the original last full day, 236 — a touch is exit 3.');
    expect(breachesCell(r).title).toContain('Exit 1: 2026-08-31 (234.4)');
  });
  it('re-entered: the old touch of the stop is history, not a warning', () => {
    const c = lfdCell(rowOf('AME'), 'reentered');
    expect(c).toMatchObject({ value: '236', sub: '−2.1% · first hit 31-08-26' });
    expect(c.tone).toBeUndefined();
    expect(c.subTone).toBeUndefined();
    expect(c.title).toContain('First taken out on 2026-08-31, then re-entered on 2026-10-29: the same level is the stop again, and a touch is exit 3.');
  });
});

describe('outcomes', () => {
  it('at target: when and at what, and "per source" where our closes fell short', () => {
    expect(line(reachedCell(rowOf('WAWI.OL')))).toBe('17-08-26 | @ 166.6');
    expect(line(reachedCell(rowOf('UNM')))).toBe('04-09-26 | per source');
  });
  it('since target: the move after it, signed the setup\'s way', () => {
    expect(sinceTargetCell(rowOf('WAWI.OL'))).toMatchObject({ value: '+1.4%', sub: 'after 17-08-26', tone: 'good' });
    expect(sinceTargetCell(rowOf('BYD', 'short'))).toMatchObject({ value: '−10.3%', tone: 'bad' });
    expect(sinceTargetCell(rowOf('FBIZ'))).toEqual({ value: '–' });
  });
  it('failed: the date, and whether it was a touch or a close', () => {
    expect(line(failedCell(rowOf('DAKT', 'short')))).toBe('23-10-26 | touched 20.63');
    expect(line(failedCell(rowOf('NCX.V')))).toBe('30-10-26 | touched 2.8');
    expect(line(failedCell(rowOf('3401.T')))).toBe('08-09-26 | closed 1,622');   // the one failure with no bar for the day: the close
  });
  it('failed: the reason, with the touch spelled out', () => {
    expect(reasonText(rowOf('DAKT', 'short'))).toBe('failed breakout (touched 20.63 intraday)');
    expect(reasonText(rowOf('NCX.V'))).toBe('negated after reaching target (touched 2.8 intraday)');
    expect(reasonText(rowOf('3401.T'))).toBe('failed breakout (close 1,622)');
  });
  it('still listed by the source: once may be a lag, twice means the analyst kept it', () => {
    expect(srcOpenCell(rowOf('DAKT', 'short'))).toMatchObject({ value: 'Kept · 2 sheets', tone: 'warn', sub: '24-10-26 → 31-10-26' });
    expect(srcOpenCell(rowOf('MAU.TO'))).toMatchObject({ value: 'Listed once', sub: '24-10-26' });
    expect(srcOpenCell(rowOf('SXGC.TO'))).toEqual({ value: '–' });
  });
  it('removed: dropped by the source, with its reason', () => {
    expect(line(removedCell(rowOf('ICLR')))).toBe('31-10-26 | dropped by source · breakout candle reached the price objective');
    expect(line(removedCell(rowOf('GPCR')))).toBe('03-10-26 | dropped by source');
  });
});

describe('what is only in the drawer', () => {
  it('trailing stop needs the events feed; with none there is none', () => {
    expect(trailingStopCell(rowOf('TVE.TO'), TODAY)).toBeNull();
  });
  it('added date is relative to today', () => {
    expect(addedText(rowOf('TVE.TO'), TODAY)).toBe('20-09-26 · 42 days ago');
  });
});

describe('sorting values', () => {
  it('give each column the number or text it should be ordered by, null where there is none', () => {
    const r = rowOf('TVE.TO');
    expect(sortValue(r, 'sym')).toBe('TVE.TO');
    expect(sortValue(r, 'live')).toBeCloseTo(-1.7, 1);
    expect(sortValue(r, 'lfd')).toBe(3.3);
    expect(sortValue(r, 'risk')).toBe(9.1);
    expect(sortValue(r, 'btype')).toBe('B2');
    expect(sortValue(r, 'breaches')).toBe(0);
    expect(sortValue(rowOf('FBIZ'), 'gap')).toBeCloseTo(0.4, 1);
    expect(sortValue(rowOf('FBIZ'), 'btype')).toBe('');
    expect(sortValue(rowOf('FBIZ'), 'breaches')).toBeNull();
    expect(sortValue(r, 'nonsense')).toBeNull();
  });
  it('re-entry order puts the ones already back in first, then the nearest to the trigger', () => {
    expect(sortValue(rowOf('AME'), 'reentry')).toBe(-1);
    expect(sortValue(rowOf('NTGY.MC'), 'reentry')).toBeCloseTo(0.0268, 3);
  });
});

describe('every row of every section has a cell, and none of them throws', () => {
  it('walks the whole frozen board', () => {
    for (const r of frozenBoard().rows) {
      for (const f of [triggerCell, targetCell, negationCell, lfdCell]) expect(typeof f(r, r.section).value).toBe('string');
      for (const f of [rrCell, typeCell, statusCell, breachesCell, reachedCell, sinceTargetCell, failedCell, srcOpenCell, removedCell]) expect(typeof f(r).value).toBe('string');
    }
  });
});
