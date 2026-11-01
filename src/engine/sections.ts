import type { BreakoutType, ReplayState, Section, Setup } from './types';

/* Which section a setup sits in.

   Three manual overrides, and they do not all work the same way. Failed and
   removed outrank the replay outright: the reader has decided the setup is
   done. A manual breakout does not: it only lifts a setup out of "waiting",
   and the moment the replay has something real to say (a breakout close, a
   target, a negation) the replay wins.

   A B3 is out of the trade (the tight stop is gone) but the pattern stands
   until the negation, so it is split by where the trade stands: back in on a
   re-entry close, or out. */
export function sectionOf(p: Setup, st: ReplayState, btype: BreakoutType | null): Section {
  let state: Section = (p.manualState === 'failed' || p.manualState === 'removed')
    ? p.manualState
    : (p.manualState === 'breakout' && st.state === 'watch') ? 'breakout'
    : st.state;
  if (state === 'breakout' && btype && btype.tag === 'B3') state = btype.out ? 'stopped' : 'reentered';
  return state;
}

/** `removed` in the shared file lands in Removed on every browser; a per-browser choice wins. */
export function manualStateOf(p: { removed?: string | null; manualState?: Setup['manualState'] },
                              override?: { manualState?: Setup['manualState'] }): Setup['manualState'] {
  if (override && 'manualState' in override) return override.manualState ?? null;
  if (p.manualState !== undefined) return p.manualState;
  return p.removed ? 'removed' : null;
}
