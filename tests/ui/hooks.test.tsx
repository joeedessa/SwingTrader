import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'preact-render-to-string';
import * as hooks from 'preact/hooks';
import { CARDS_QUERY, NARROW_QUERY, useCards } from '../../src/ui/hooks';

/* A hook must run the same hooks on every render: Preact keeps their state by position, so a hook skipped once the
   screen changes shape (a tablet turned across 1,000 px) hands every later hook the wrong slot, and the page breaks.
   `useState` is spied on, and the probe's count must not move with the queries. */

vi.mock('preact/hooks', async (orig) => {
  const m = await orig<typeof import('preact/hooks')>();
  return { ...m, useState: vi.fn(m.useState) };
});

const screen = (...matching: string[]) => vi.stubGlobal('matchMedia', (q: string) => ({ matches: matching.includes(q), addEventListener() {}, removeEventListener() {} }));

afterEach(() => { vi.unstubAllGlobals(); });

describe('useCards', () => {
  it('runs the same hooks whether or not the cards query matches, so a resize across 1,000 px cannot shift the hook order', () => {
    const spy = vi.mocked(hooks.useState);
    const Probe = () => <span>{String(useCards())}</span>;
    const count = (...matching: string[]) => { screen(...matching); spy.mockClear(); const html = render(<Probe />); return { html, calls: spy.mock.calls.length }; };
    const wide = count();
    const mid = count(CARDS_QUERY);
    const phone = count(CARDS_QUERY, NARROW_QUERY);
    const narrowOnly = count(NARROW_QUERY);
    expect(wide.calls).toBeGreaterThan(0);
    expect(mid.calls).toBe(wide.calls);
    expect(phone.calls).toBe(wide.calls);
    expect(narrowOnly.calls).toBe(wide.calls);
    expect([wide.html, mid.html, phone.html, narrowOnly.html]).toEqual(['<span>false</span>', '<span>true</span>', '<span>true</span>', '<span>true</span>']);
  });
});
