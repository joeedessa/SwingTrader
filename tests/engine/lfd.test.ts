import { describe, expect, it } from 'vitest';
import { lfdOf } from '../../src/engine/lfd';
import { replay } from '../../src/engine/replay';
import { LONG, series, SHORT } from './helpers';
import type { Day } from './helpers';
import type { Setup } from '../../src/engine/types';

const run = (p: Setup, days: Day[]) => {
  const { bars, hist } = series(days);
  const st = replay(p, hist, bars);
  return { st, lfd: lfdOf(p, st, hist, bars) };
};

// Boundary 97, trigger 100: the run past the boundary starts on 01-06 and carries into the 01-08 confirmation.
const CLEAN: Day[] = [
  ['2026-01-05', 94, 96, 95],
  ['2026-01-06', 95, 98, 97.5],
  ['2026-01-07', 96, 99, 98],
  ['2026-01-08', 97.5, 101, 100.5],
  ['2026-01-09', 98, 104, 103],
];

describe('last full day: derived from the boundary', () => {
  it('is the low of the bar before the first close of the run past the boundary', () => {
    const { lfd } = run(LONG, CLEAN);
    expect(lfd).toEqual({
      at: 94, src: 'derived', kind: 'boundary', pending: false,
      conf: '2026-01-08', anchor: '2026-01-06', bar: '2026-01-05',
      alt: { bar: '2026-01-07', at: 96 },     // the confirmation-anchored reading, where it differs
      hit: null,
    });
  });

  it('a close back inside the pattern ends the run; the next close through starts a new one', () => {
    const { lfd } = run(LONG, [
      ['2026-01-05', 94, 96, 95],
      ['2026-01-06', 95, 98, 97.5],
      ['2026-01-07', 95.5, 98, 96],       // back inside
      ['2026-01-08', 96.5, 99, 98],       // new run
      ['2026-01-09', 97.5, 101, 100.5],   // confirmed
    ]);
    expect(lfd).toMatchObject({ at: 95.5, anchor: '2026-01-08', bar: '2026-01-07', conf: '2026-01-09' });
  });

  it('a gap through boundary and trigger reads the same bar for both, so there is no alt', () => {
    const { lfd } = run(LONG, [
      ['2026-01-05', 94, 96, 95],
      ['2026-01-06', 101, 105, 104],
    ]);
    expect(lfd).toMatchObject({ at: 94, anchor: '2026-01-06', conf: '2026-01-06', bar: '2026-01-05', alt: null });
  });

  it('for a short is the high of the bar before the run below the boundary', () => {
    const { lfd } = run(SHORT, [
      ['2026-01-05', 103, 107, 104],
      ['2026-01-06', 101, 105, 102.5],    // close below the boundary 103
      ['2026-01-07', 98, 103, 99.5],      // confirmed below 100
    ]);
    expect(lfd).toMatchObject({ at: 107, anchor: '2026-01-06', bar: '2026-01-05', conf: '2026-01-07' });
  });

  it('without a boundary the trigger is the anchor', () => {
    const { lfd } = run({ ...LONG, boundary: null }, CLEAN);
    expect(lfd).toMatchObject({ at: 96, kind: 'trigger', anchor: '2026-01-08', bar: '2026-01-07', alt: null });
  });
});

describe('last full day: the report wins', () => {
  it('a report level replaces the derived one and keeps the derivation for the tooltip', () => {
    const { lfd } = run({ ...LONG, lfd: 93 }, CLEAN);
    expect(lfd).toMatchObject({ at: 93, src: 'report', bar: '2026-01-05', anchor: '2026-01-06' });
  });

  it('lfd: 0 means the sheet gives none', () => {
    const { lfd } = run({ ...LONG, lfd: 0 }, CLEAN);
    expect(lfd).toMatchObject({ at: null, src: 'none', bar: null, alt: null, conf: '2026-01-08' });
  });
});

describe('last full day: waiting rows', () => {
  it('is recorded, pending, once a close is past the boundary but not the trigger', () => {
    const { st, lfd } = run(LONG, CLEAN.slice(0, 3));
    expect(st.state).toBe('watch');
    expect(lfd).toMatchObject({ at: 94, src: 'derived', pending: true, conf: null, anchor: '2026-01-06' });
  });

  it('is empty while the last close is inside the pattern', () => {
    const { lfd } = run(LONG, [['2026-01-05', 94, 96, 95], ['2026-01-06', 95, 98, 96.5]]);
    expect(lfd).toMatchObject({ at: null, src: null, pending: true, anchor: null });
  });

  it('is null for a waiting row with no boundary', () => {
    expect(run({ ...LONG, boundary: null }, CLEAN.slice(0, 3)).lfd).toBeNull();
  });
});

describe('last full day: beyond the negation', () => {
  it('a derived stop at or beyond the negation is no stop at all, and is not tested', () => {
    const { lfd } = run({ ...LONG, negation: 94 }, [...CLEAN, ['2026-01-12', 91, 99, 98]]);
    expect(lfd).toMatchObject({ at: 94, looser: true, hit: null });
  });

  it('a report stop beyond the negation is kept as given', () => {
    const { lfd } = run({ ...LONG, negation: 94, lfd: 93 }, CLEAN);
    expect(lfd?.looser).toBeUndefined();
    expect(lfd?.at).toBe(93);
  });
});

describe('last full day: the breach', () => {
  it('is the first touch after the confirming close', () => {
    const { lfd } = run(LONG, [...CLEAN,
      ['2026-01-12', 93.9, 99, 98],
      ['2026-01-13', 92, 97, 96],
    ]);
    expect(lfd?.hit).toEqual({ when: '2026-01-12', at: 93.9 });
  });

  it('ignores touches on or before the confirmation and bars past the last settled close', () => {
    const { bars, hist } = series([...CLEAN, ['2026-01-12', 93, 99, 98]]);
    hist.settled = hist.settled.slice(0, -1);        // 01-12 is still forming
    const st = replay(LONG, hist, bars);
    expect(lfdOf(LONG, st, hist, bars)?.hit).toBeNull();
  });
});

describe('last full day: imported confirmations', () => {
  it('a confirmed date from the report (a Saturday) resolves to the latest trigger cross before it', () => {
    const p = { ...LONG, confirmed: '2026-01-10', created: '2026-01-10' };
    const { lfd } = run(p, CLEAN);
    expect(lfd).toMatchObject({ conf: '2026-01-08', anchor: '2026-01-06', bar: '2026-01-05', at: 94 });
  });

  it('a manual promotion counts as confirmed for the stop', () => {
    const p: Setup = { ...LONG, manualState: 'breakout' };
    const { st, lfd } = run(p, CLEAN.slice(0, 3));
    expect(st.state).toBe('watch');
    expect(lfd?.pending).toBe(false);
  });
});
