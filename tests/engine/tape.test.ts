import { describe, expect, it } from 'vitest';
import { TAPE_BROAD_ABOVE, TAPE_MIXED_ABOVE, tapeOf } from '../../src/engine/tape';
import { evaluate } from '../../src/engine/row';
import type { Row } from '../../src/engine/row';
import type { Section } from '../../src/engine/types';
import { LONG, series } from './helpers';
import { frozenBoard } from '../ui/frozen';

/* The old page's gauge: "N of M down today", on the active list only. */

const base = evaluate(LONG, series([['2026-01-05', 94, 96, 95]]).hist, null, {}, '2026-01-20');
const row = (dayPct: number | null, section: Section = 'breakout'): Row => ({ ...base, dayPct, section });
const many = (down: number, up: number, section: Section = 'breakout') =>
  [...Array(down).fill(0).map(() => row(-1.2, section)), ...Array(up).fill(0).map(() => row(0.8, section))];

describe('the tape', () => {
  it('counts the names down on the day against the names with a move to count', () => {
    const t = tapeOf(many(3, 7))!;
    expect(t).toMatchObject({ down: 3, known: 10, pctDown: 30, tone: 'calm' });
    expect(t.read).toBe('tape supportive — moves are mostly stock-specific');
  });

  it('is mixed above 40% down and broadly risk-off above 60%, and not at the edges themselves', () => {
    expect(TAPE_MIXED_ABOVE).toBe(40);
    expect(TAPE_BROAD_ABOVE).toBe(60);
    expect(tapeOf(many(4, 6))!.tone).toBe('calm');        // exactly 40%
    expect(tapeOf(many(5, 5))!.tone).toBe('warn');
    expect(tapeOf(many(6, 4))!.tone).toBe('warn');        // exactly 60%
    expect(tapeOf(many(7, 3))!.tone).toBe('bad');
    expect(tapeOf(many(7, 3))!.read).toBe('broad risk-off — read individual weakness as market forces');
    expect(tapeOf(many(5, 5))!.read).toBe('mixed tape — weigh single names against it');
  });

  it('leaves out failed and removed setups, and names with no day move', () => {
    const t = tapeOf([...many(1, 1), ...many(5, 0, 'failed'), ...many(5, 0, 'removed'), row(null), row(0)])!;
    expect(t).toMatchObject({ down: 1, known: 3 });      // the flat name is a name that did not fall
  });

  it('has nothing to say when nothing has a move', () => {
    expect(tapeOf([])).toBeNull();
    expect(tapeOf([row(null), ...many(2, 0, 'failed')])).toBeNull();
  });

  it('reads whatever list it is given, whatever its size', () => {
    const rows = frozenBoard().rows;
    const t = tapeOf(rows)!;
    const active = rows.filter(r => r.section !== 'failed' && r.section !== 'removed' && r.dayPct != null);
    expect(t.known).toBe(active.length);
    expect(t.down).toBe(active.filter(r => (r.dayPct as number) < 0).length);
  });
});
