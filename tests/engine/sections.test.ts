import { describe, expect, it } from 'vitest';
import { manualStateOf, sectionOf } from '../../src/engine/sections';
import { breakoutAt, LONG } from './helpers';
import type { BreakoutType, ReplayState } from '../../src/engine/types';

const WATCH: ReplayState = { state: 'watch', breakout: null, targetHit: null, failed: null };
const B3_OUT: BreakoutType = { tag: 'B3', out: true };
const B3_IN: BreakoutType = { tag: 'B3', out: false };

describe('sections', () => {
  it('follow the replay state', () => {
    expect(sectionOf(LONG, WATCH, null)).toBe('watch');
    expect(sectionOf(LONG, breakoutAt('2026-01-08'), { tag: 'B1' })).toBe('breakout');
    expect(sectionOf(LONG, { ...WATCH, state: 'target' }, { tag: 'B2', final: true })).toBe('target');
    expect(sectionOf(LONG, { ...WATCH, state: 'failed' }, { tag: 'B4' })).toBe('failed');
  });

  it('split a B3 by whether the trade is back in', () => {
    expect(sectionOf(LONG, breakoutAt('2026-01-08'), B3_OUT)).toBe('stopped');
    expect(sectionOf(LONG, breakoutAt('2026-01-08'), B3_IN)).toBe('reentered');
    // Frozen at target: a B3 that reached its target stays in At target.
    expect(sectionOf(LONG, { ...WATCH, state: 'target' }, B3_OUT)).toBe('target');
  });

  it('let failed and removed overrides outrank the replay', () => {
    expect(sectionOf({ ...LONG, manualState: 'removed' }, breakoutAt('2026-01-08'), B3_IN)).toBe('removed');
    expect(sectionOf({ ...LONG, manualState: 'failed' }, breakoutAt('2026-01-08'), { tag: 'B1' })).toBe('failed');
  });

  it('let a manual breakout lift a waiting row only until the replay has something to say', () => {
    expect(sectionOf({ ...LONG, manualState: 'breakout' }, WATCH, null)).toBe('breakout');
    expect(sectionOf({ ...LONG, manualState: 'breakout' }, { ...WATCH, state: 'failed' }, { tag: 'B4' })).toBe('failed');
  });

  it('derive the manual state from `removed` unless the browser chose otherwise', () => {
    expect(manualStateOf({ removed: '2026-10-31' })).toBe('removed');
    expect(manualStateOf({ removed: null })).toBeNull();
    expect(manualStateOf({ removed: '2026-10-31' }, { manualState: null })).toBeNull();   // restored
    expect(manualStateOf({}, { manualState: 'failed' })).toBe('failed');
  });
});
