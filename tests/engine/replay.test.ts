import { describe, expect, it } from 'vitest';
import { replay } from '../../src/engine/replay';
import { closesOnly, LONG, series, SHORT } from './helpers';

describe('replay: breakout', () => {
  it('is the first settled close strictly past the trigger', () => {
    const { bars, hist } = series([
      ['2026-01-05', 95, 99, 98],
      ['2026-01-06', 97, 101, 100],   // at the trigger, not past it
      ['2026-01-07', 99, 103, 101],
    ]);
    const st = replay(LONG, hist, bars);
    expect(st.state).toBe('breakout');
    expect(st.breakout).toEqual({ when: '2026-01-07', close: 101 });
  });

  it('for a short is a close strictly below', () => {
    const { bars, hist } = series([
      ['2026-01-05', 99, 104, 100],
      ['2026-01-06', 97, 101, 99.5],
    ]);
    expect(replay(SHORT, hist, bars).breakout).toEqual({ when: '2026-01-06', close: 99.5 });
  });

  it('ignores bars before created, and a confirmed import starts in breakout on that date', () => {
    const { bars, hist } = series([
      ['2025-12-30', 80, 85, 84],      // below the negation, before the row existed
      ['2026-01-05', 95, 99, 98],
    ]);
    expect(replay(LONG, hist, bars).state).toBe('watch');
    const st = replay({ ...LONG, confirmed: '2026-01-03' }, hist, bars);
    expect(st.state).toBe('breakout');
    expect(st.breakout).toEqual({ when: '2026-01-03', close: null });
  });

  it('without history only the confirmed date counts', () => {
    expect(replay(LONG, null, null).state).toBe('watch');
    expect(replay({ ...LONG, confirmed: '2026-01-03' }, null, null).state).toBe('breakout');
  });
});

describe('replay: negation', () => {
  it('is tested only after the breakout', () => {
    const { bars, hist } = series([
      ['2026-01-05', 85, 95, 94],      // low below the negation while still waiting
      ['2026-01-06', 99, 103, 101],
    ]);
    const st = replay(LONG, hist, bars);
    expect(st.state).toBe('breakout');
    expect(st.failed).toBeNull();
  });

  it('is an intraday touch: the low for a long', () => {
    const { bars, hist } = series([
      ['2026-01-05', 99, 103, 101],
      ['2026-01-06', 89, 98, 95],      // wick through 90, close back above
    ]);
    const st = replay(LONG, hist, bars);
    expect(st.state).toBe('failed');
    expect(st.failed).toEqual({ when: '2026-01-06', close: 95, at: 89, byTouch: true, reason: 'failed breakout' });
  });

  it('is the high for a short', () => {
    const { bars, hist } = series([
      ['2026-01-05', 97, 101, 99],
      ['2026-01-06', 98, 111, 105],
    ]);
    expect(replay(SHORT, hist, bars).failed).toMatchObject({ when: '2026-01-06', at: 111, byTouch: true });
  });

  it('falls back to the close where the bar is missing, and says so', () => {
    const days: Parameters<typeof closesOnly>[0] = [
      ['2026-01-05', 99, 103, 101],
      ['2026-01-06', 89, 98, 95],
      ['2026-01-07', 88, 92, 89.5],
    ];
    const st = replay(LONG, closesOnly(days), null);
    expect(st.failed).toEqual({ when: '2026-01-07', close: 89.5, at: 89.5, byTouch: false, reason: 'failed breakout' });
  });

  it('a touch at the level exactly is not a fail (strictly beyond)', () => {
    const { bars, hist } = series([
      ['2026-01-05', 99, 103, 101],
      ['2026-01-06', 90, 98, 95],
    ]);
    expect(replay(LONG, hist, bars).state).toBe('breakout');
  });

  it('a null negation never fails a trade', () => {
    const { bars, hist } = series([
      ['2026-01-05', 99, 103, 101],
      ['2026-01-06', 50, 98, 60],
    ]);
    expect(replay({ ...LONG, negation: null }, hist, bars).state).toBe('breakout');
  });

  it('a held position records the first touch and keeps its state', () => {
    const { bars, hist } = series([
      ['2026-01-05', 99, 103, 101],
      ['2026-01-06', 89, 98, 95],
      ['2026-01-07', 87, 98, 96],
    ]);
    const st = replay({ ...LONG, hold: true }, hist, bars);
    expect(st.state).toBe('breakout');
    expect(st.failed).toBeNull();
    expect(st.touched).toEqual({ when: '2026-01-06', at: 89, byTouch: true });
  });
});

describe('replay: target', () => {
  it('is a settled close at or past the target, and is not terminal', () => {
    const { bars, hist } = series([
      ['2026-01-05', 99, 103, 101],
      ['2026-01-06', 110, 121, 120],   // at the target counts
      ['2026-01-07', 89, 118, 100],    // then the negation: failed, with the reason
    ]);
    const st = replay(LONG, hist, bars);
    expect(st.targetHit).toEqual({ when: '2026-01-06', close: 120 });
    expect(st.state).toBe('failed');
    expect(st.failed?.reason).toBe('negated after reaching target');
  });

  it('counts the source\'s `reached` date when our closes fell short', () => {
    const { bars, hist } = series([
      ['2026-01-05', 99, 103, 101],
      ['2026-01-06', 110, 119.9, 119.8],
    ]);
    const st = replay({ ...LONG, reached: '2026-01-06' }, hist, bars);
    expect(st.state).toBe('target');
    expect(st.targetHit).toEqual({ when: '2026-01-06', close: null, bySource: true });
  });

  it('`reached` does not revive a failed trade', () => {
    const { bars, hist } = series([
      ['2026-01-05', 99, 103, 101],
      ['2026-01-06', 85, 98, 95],
    ]);
    expect(replay({ ...LONG, reached: '2026-01-06' }, hist, bars).state).toBe('failed');
  });

  it('for a short is a close at or below', () => {
    const { bars, hist } = series([
      ['2026-01-05', 97, 101, 99],
      ['2026-01-06', 79, 90, 80],
    ]);
    expect(replay(SHORT, hist, bars).targetHit).toEqual({ when: '2026-01-06', close: 80 });
  });
});
