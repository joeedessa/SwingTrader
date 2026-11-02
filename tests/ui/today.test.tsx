import { beforeAll, describe, expect, it } from 'vitest';
import { render } from 'preact-render-to-string';
import { ackStore, acknowledge, unacknowledge } from '../../src/data/acks';
import { app } from '../../src/data/app';
import { todayOf } from '../../src/data/selectors';
import { visits } from '../../src/data/visit';
import { setupEvents, weekLog, weekWindow } from '../../src/engine/events';
import type { LogItem } from '../../src/engine/events';
import { ackable, badgeCount, boardFlags, setupFlags } from '../../src/engine/flags';
import type { Flag } from '../../src/engine/flags';
import { TabBar, TopNav } from '../../src/ui/nav';
import { FlagRow, GROUP_OPEN_UP_TO, LiveNow, TapeLine, TodayPage, todayUi, WeeklyLog } from '../../src/ui/today';
import { tapeOf } from '../../src/engine/tape';
import { frozenBoard, frozenHist, frozenInputs, TODAY } from './frozen';

/* The Today page, rendered to a string and read. Every number a test expects is read back from the engine's own view of
   the same data, so the weekly additions and removals to the list cannot break one. */

const NOW = Date.parse('2026-11-01T18:00:00Z');
const noop = () => {};
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const count = (html: string, re: RegExp) => (html.match(re) || []).length;

/** The groups on the page, as they were drawn: which kind, whether open, and how many rows it shows. */
const drawn = (html: string) => html.split('<section class="flaggroup"').slice(1).map(chunk => ({
  kind: /aria-controls="today-flags-(?:act|watch)-([^"]+)"/.exec(chunk)![1],
  expanded: /aria-expanded="(true|false)"/.exec(chunk)![1] === 'true',
  rows: count(chunk, /<li class="flag/g),
}));

beforeAll(() => {
  const { shared, bars, hist } = frozenInputs();
  app.set({
    phase: 'ready', shared: { watchlist: shared, benchmarks: [] }, hist, now: NOW, liveStatus: 'ok', events: {},
    barsFile: { generated_at: '2026-11-01T17:00:00Z', ccy: {}, bars },
    snapshot: { generated_at: '2026-11-01T17:30:00Z', sessions: [], latest: {} },
  });
});

const view = (seen: ReadonlySet<string> | null = null) => todayOf(app.get(), 'watchlist', seen);
const page = () => render(<TodayPage />);

describe('a flag row', () => {
  const f = (over: Partial<Flag> = {}): Flag => ({
    id: 'AME|long|breakout|2026-10-30', tier: 'act', kind: 'breakout', sym: 'AME', dir: 'long', when: '2026-10-30',
    text: 'AME long — BREAKOUT CONFIRMED: closed above the trigger at 251.8 (trigger 250)', route: '#/setups/AME/long',
    clears: 'ack', surfaces: ['today', 'setups'],
    figure: { read: 'close', price: 251.8, vs: 'trigger', level: 250, ccy: 'USD' }, ...over,
  });

  it('says who, what, the sentence without its opening pair, the number it turns on and the day', () => {
    const t = text(render(<ul><FlagRow f={f()} today={TODAY} isNew={false} onOpen={noop} onAck={noop} /></ul>));
    expect(t).toContain('AME long Breakout');
    expect(t).toContain('BREAKOUT CONFIRMED: closed above the trigger at 251.8 (trigger 250)');
    expect(t).not.toContain('AME long —');
    expect(t).toContain('251.8 USD close vs trigger 250');
    expect(t).toContain('Fri 30 Oct');
  });

  it('opens its setup from the whole row, and can be acknowledged from a button that names the flag', () => {
    const html = render(<ul><FlagRow f={f()} today={TODAY} isNew={false} onOpen={noop} onAck={noop} /></ul>);
    expect(html).toContain('aria-label="AME long, Breakout: open details"');
    expect(html).toContain('aria-label="Acknowledge AME long, Breakout"');
  });

  it('marks what is new with a dot that has a name for assistive tech', () => {
    expect(render(<ul><FlagRow f={f()} today={TODAY} isNew onOpen={noop} onAck={noop} /></ul>)).toContain('aria-label="New since your last visit"');
    expect(render(<ul><FlagRow f={f()} today={TODAY} isNew={false} onOpen={noop} onAck={noop} /></ul>)).not.toContain('newdot');
  });

  it('a live flag has no acknowledge button: it is a condition, and ends when it ends', () => {
    const live = f({ id: 'AME|long|live-stop|live', kind: 'live-stop', when: 'live', clears: 'itself', text: 'AME long — trading below its last full day low (93 vs 94): a touch is exit 1' });
    expect(ackable(live)).toBe(false);
    const html = render(<ul><FlagRow f={live} today={TODAY} isNew={false} onOpen={noop} onAck={noop} /></ul>);
    expect(html).not.toContain('Acknowledge');
    expect(text(html)).toContain('Live');
  });

  it('an acknowledged one offers Undo instead', () => {
    const html = render(<ul><FlagRow f={f()} today={TODAY} isNew={false} onOpen={noop} onUndo={noop} /></ul>);
    expect(text(html)).toContain('Undo');
    expect(html).not.toContain('aria-label="Acknowledge');
    expect(html).toContain('flag done');
  });

  it('a calendar flag says how far off its date is, and a flag without a figure leaves that out', () => {
    const e = f({ kind: 'earnings-7d', tier: 'watch', when: '2026-11-04', figure: undefined, text: 'AME long — reports in 3 days (04-11-26), with the trade on' });
    const t = text(render(<ul><FlagRow f={e} today={TODAY} isNew={false} onOpen={noop} onAck={noop} /></ul>));
    expect(t).toContain('Wed 4 Nov in 3 days');
    expect(t).not.toContain(' vs ');
  });
});

describe('the page', () => {
  it('leads with the day and what is waiting, in the engine\'s own numbers', () => {
    const v = view();
    const t = text(page());
    expect(t).toContain('Today');
    expect(t).toContain('Sun 1 Nov');
    if (v.act.count) expect(t).toContain(v.act.count + ' to decide');
    if (v.watch.count) expect(t).toContain(v.watch.count + ' to look at');
  });

  it('shows the tape: how much of the active list is down on the day', () => {
    const tape = tapeOf(frozenBoard().rows)!;
    expect(text(render(<TapeLine tape={tape} />))).toContain(`${tape.down} of ${tape.known} down today`);
  });

  it('the two tiers carry the counts their lists add up to, and the lists carry every flag the view has', () => {
    todayUi.set({ tier: null, folds: {}, week: 'this' });
    const v = view();
    const html = page();
    const seg = [...html.matchAll(/data-id="(act|watch)"[^>]*>.*?<span class="n">(\d+)<\/span>/g)].map(m => [m[1], +m[2]]);
    expect(seg).toEqual([['act', v.act.count], ['watch', v.watch.count]]);
    // The tier it opens on is the most urgent one with anything in it.
    const open = v.act.count || !v.watch.count ? v.act : v.watch;
    expect(html).toContain(open.tier === 'act' ? 'aria-label="Needs a decision"' : 'aria-label="Worth a look"');
    const headers = [...html.matchAll(/<section class="flaggroup" aria-label="([^"]+)"/g)].length;
    expect(headers).toBe(open.groups.length);
  });

  it('opens the small groups and folds the long ones behind their first names', () => {
    todayUi.set({ tier: 'watch', folds: {}, week: 'this' });
    const v = view();
    const groups = drawn(page());
    expect(groups.map(g => g.kind)).toEqual(v.watch.groups.map(g => g.kind));
    for (const [i, g] of v.watch.groups.entries()) {
      const open = g.flags.length <= GROUP_OPEN_UP_TO;
      expect(groups[i], g.kind).toEqual({ kind: g.kind, expanded: open, rows: open ? g.flags.length : 0 });
    }
    todayUi.set({ tier: null, folds: {} });
  });

  it('a group the person opened by hand stays as they left it, and one they folded stays folded', () => {
    todayUi.set({ tier: 'watch', folds: {}, week: 'this' });
    const v = view();
    const long = v.watch.groups.find(x => x.flags.length > GROUP_OPEN_UP_TO);
    const small = v.watch.groups.find(x => x.flags.length <= GROUP_OPEN_UP_TO);
    todayUi.set({ folds: { ...(long ? { ['watch:' + long.kind]: true } : {}), ...(small ? { ['watch:' + small.kind]: false } : {}) } });
    const groups = drawn(page());
    if (long) expect(groups.find(g => g.kind === long.kind)).toMatchObject({ expanded: true, rows: long.flags.length });
    if (small) expect(groups.find(g => g.kind === small.kind)).toMatchObject({ expanded: false, rows: 0 });
    expect(long || small).toBeTruthy();
    todayUi.set({ tier: null, folds: {} });
  });

  it('says it is a first look when there was no visit before, and what is new when there was', () => {
    visits.state.set({ since: null });
    expect(text(page())).toContain('First look on this device');
    const v = view();
    const ids = v.ids.slice(1);                         // the first one was not on screen last time
    visits.state.set({ since: { at: Date.parse('2026-10-31T21:14:00'), seen: ids } });
    const html = page();
    const t = text(html);
    const now = view(new Set(ids));
    expect(now.fresh).toBeGreaterThan(0);
    expect(t).toContain('since Sat 31 Oct, 21:14');
    // A dot on each tier that has something new, and on each new row that is on screen.
    expect(count(html, /class="segdot"/g)).toBe([now.act.fresh, now.watch.fresh].filter(n => n > 0).length);
    visits.state.set({ since: null });
  });

  it('lists what was acknowledged today in a group of its own, and takes it off the tier', () => {
    todayUi.set({ tier: 'act', folds: {}, week: 'this' });
    const before = view();
    const first = before.act.groups[0]?.flags[0];
    if (!first) return;
    acknowledge('watchlist', [first.id], NOW + 1000);
    const after = view();
    expect(after.act.count).toBe(before.act.count - 1);
    expect(after.acked.map(f => f.id)).toContain(first.id);
    const html = page();
    expect(html).toContain('Acknowledged today');
    expect(text(html)).toContain(`Acknowledged today ${after.acked.length}`);
    unacknowledge('watchlist', [first.id]);
    expect(view().act.count).toBe(before.act.count);
    todayUi.set({ tier: null });
  });

  it('says so, with a way to the other tier, when a tier is empty', () => {
    const ids = [...view().act.groups.flatMap(g => g.flags.map(f => f.id))];
    if (!ids.length) return;
    for (const id of ids) acknowledge('watchlist', [id], NOW + 1000);
    todayUi.set({ tier: 'act', folds: {}, week: 'this' });
    const t = text(page());
    expect(t).toContain('Nothing needs a decision.');
    unacknowledge('watchlist', ids);
    todayUi.set({ tier: null });
  });
});

describe('the live strip', () => {
  const live = (): Flag => ({
    id: 'AME|long|live-stop|live', tier: 'act', kind: 'live-stop', sym: 'AME', dir: 'long', when: 'live',
    text: 'AME long — trading below its last full day low (93 vs 94): a touch is exit 1', route: '#/setups/AME/long',
    clears: 'itself', surfaces: ['today', 'positions'], figure: { read: 'live', price: 93, vs: 'last full day', level: 94, ccy: 'USD' },
  });
  const strip = (over: Partial<Parameters<typeof LiveNow>[0]> = {}) =>
    text(render(<LiveNow flags={[]} today={TODAY} fresh={new Set()} status="ok" marketsOpen={false} onOpen={noop} {...over} />));

  it('says there is nothing live, and why: shut markets, open markets, a quote feed that failed, or one still loading', () => {
    expect(strip()).toBe('No live flags; markets shut.');
    expect(strip({ marketsOpen: true })).toBe('Markets are open; nothing live needs you.');
    expect(strip({ status: 'failed' })).toContain('Live prices are unavailable');
    expect(strip({ status: 'loading' })).toBe('Checking live prices…');
  });

  it('lists the live flags with their count, and gives them no acknowledge button', () => {
    const html = render(<LiveNow flags={[live()]} today={TODAY} fresh={new Set()} status="ok" marketsOpen onOpen={noop} />);
    const t = text(html);
    expect(t).toContain('Live now 1');
    expect(t).toContain('trading below its last full day low (93 vs 94)');
    expect(t).toContain('93 USD live vs last full day 94');
    expect(html).not.toContain('Acknowledge');
  });
});

describe('the weekly log', () => {
  // Monday to Sunday, local time, the old page's rule: pick a "now" so that the frozen Friday and Saturday sit in last week.
  const MON = new Date(2026, 10, 2, 9, 0).getTime();

  const logs = (rows = frozenBoard().rows, now = MON) => {
    const items: LogItem[] = rows.flatMap(setupEvents);
    return { items, this: weekLog(items, 'this', new Date(now)), last: weekLog(items, 'last', new Date(now)) };
  };

  it('shows every event of the week it is asked for, newest first, with the board\'s own words', () => {
    const l = logs();
    expect(l.last.length).toBeGreaterThan(0);
    const html = render(<WeeklyLog rows={frozenBoard().rows} now={MON} week="last" onWeek={noop} onOpen={noop} />);
    const t = text(html);
    for (const it of l.last) expect(t, it.text).toContain(it.text);
    expect(count(html, /<li class="ev /g)).toBe(l.last.length);
    const dates = l.last.map(it => it.when);
    expect(dates).toEqual([...dates].sort().reverse());
  });

  it('folds by default, and says how much is in each week', () => {
    const l = logs();
    const html = render(<WeeklyLog rows={frozenBoard().rows} now={MON} week="this" onWeek={noop} onOpen={noop} />);
    expect(html).not.toMatch(/<details[^>]* open/);
    expect(text(html)).toContain(`${l.this.length} this week · ${l.last.length} last`);
  });

  it('carries every settled event the flags raise inside the week: nothing is on Today that the log lacks', () => {
    const ctx = { today: TODAY, nowMs: NOW, page: 'setups' as const };
    const W = weekWindow('last', new Date(MON));
    const eventKinds = ['breakout', 'target', 'failed', 'boundary', 'pullback', 'exit', 'reentry'];
    const inLog = new Set(logs().last.map(it => it.text));
    const flagged = frozenBoard().rows.flatMap(r => setupFlags(r, ctx))
      .filter(f => eventKinds.includes(f.kind) && f.when >= W.from && f.when <= W.to);
    expect(flagged.length).toBeGreaterThan(0);
    for (const f of flagged) {
      // The one flag the log never had: a target the source counted where our closes fell short.
      if (f.kind === 'target' && /per the source/.test(f.text)) continue;
      expect(inLog.has(f.text), f.id).toBe(true);
    }
  });

  it('puts live flags in this week only', () => {
    const items: LogItem[] = [{ kind: 'live-stop', cls: 'bad', when: 'live', sym: 'X', dir: 'long', text: 'X long — trading below' }];
    expect(weekLog(items, 'this', new Date(MON))).toHaveLength(1);
    expect(weekLog(items, 'last', new Date(MON))).toHaveLength(0);
  });

  it('a week with nothing in it says so', () => {
    const t = text(render(<WeeklyLog rows={[]} now={MON} week="this" onWeek={noop} onOpen={noop} />));
    expect(t).toContain('Nothing happened this week.');
  });
});

describe('the Today tab', () => {
  it('carries the number the page\'s lists add up to, on the desktop bar and on the phone bar', () => {
    const v = view();
    expect(v.badge).toBe(v.live.length + v.act.count + v.watch.count);
    expect(v.badge).toBeGreaterThan(0);
    for (const html of [render(<TopNav page="today" />), render(<TabBar page="today" />)]) {
      expect(html).toContain(`<span class="navbadge" aria-hidden="true">${v.badge}</span>`);
      expect(html).toContain(`aria-label="Today, ${v.badge} to review"`);
    }
  });

  it('is the engine\'s own badge, counted independently: unacknowledged Act and Watch flags that show on Today', () => {
    const flags = boardFlags(frozenBoard().rows, { today: TODAY, nowMs: NOW, page: 'setups' });
    const acks = ackStore.get().acks.watchlist;
    expect(badgeCount(flags, acks, frozenHist())).toBe(view().badge);
    const f = flags.find(x => (x.tier === 'act' || x.tier === 'watch') && x.surfaces.includes('today') && ackable(x) && !(x.id in acks));
    if (!f) return;
    acknowledge('watchlist', [f.id], NOW + 1000);
    expect(badgeCount(flags, ackStore.get().acks.watchlist, frozenHist())).toBe(view().badge);
    unacknowledge('watchlist', [f.id]);
  });

  it('follows an acknowledgement down by one, and an undo back up', () => {
    const v = view();
    const f = [...v.act.groups, ...v.watch.groups].flatMap(g => g.flags)[0];
    if (!f) return;
    acknowledge('watchlist', [f.id], NOW + 1000);
    expect(render(<TopNav page="today" />)).toContain(`aria-hidden="true">${v.badge - 1}</span>`);
    unacknowledge('watchlist', [f.id]);
    expect(render(<TopNav page="today" />)).toContain(`aria-hidden="true">${v.badge}</span>`);
  });

  it('shows no badge at all when nothing is waiting, and caps a long one', () => {
    const everyId = view().ids;
    for (const id of everyId) acknowledge('watchlist', [id], NOW + 1000);
    const live = view().live.length;
    const html = render(<TopNav page="today" />);
    if (!live) { expect(html).not.toContain('navbadge'); expect(html).toContain('>Today<'); }
    unacknowledge('watchlist', everyId);
    expect(ackStore.get().acks.watchlist).toEqual({});
  });

  it('marks the page it is on, and the order is Today, Setups, Positions, History, then More', () => {
    const html = render(<TopNav page="setups" />);
    expect(text(html.replace(/<span class="navbadge"[^>]*>\d+<\/span>/, ''))).toContain('SwingTrader Today Setups Positions History More');
    expect(html).toMatch(/<a href="#\/setups" aria-current="page"/);
    expect(render(<TabBar page="positions" />)).toMatch(/<a href="#\/positions" aria-current="page"/);
  });

  it('keeps Benchmarks and Method under More: the top bar\'s menu and a phone\'s last tab are current on them', () => {
    for (const page of ['benchmarks', 'method', 'more'] as const) {
      expect(render(<TopNav page={page} />), page).toMatch(/<button[^>]*class="navmore"[^>]*aria-current="page"/);
      expect(render(<TabBar page={page} />), page).toMatch(/<a href="#\/more" aria-current="page"/);
    }
    expect(render(<TopNav page="setups" />)).not.toMatch(/class="navmore"[^>]*aria-current/);
    expect(render(<TabBar page="setups" />)).not.toMatch(/<a href="#\/more" aria-current/);
  });
});
