import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseSeries } from '../../src/data/schema';
import { maRead, MIN_BARS, TAGGED, TIMEFRAMES } from '../../src/engine/ma';
import type { Timeframe } from '../../src/engine/ma';
import type { Row } from '../../src/engine/row';
import {
  closeSource, INDEX_MAP, indexOf, isLive, ladderOf, MIN_SECTOR_PEERS, relatives, scanOf, scanRows, seriesCloses, structureEvents,
} from '../../src/engine/signals';
import type { SeriesEntry, SeriesFile } from '../../src/engine/signals';
import type { History, ReplayStatus, Section } from '../../src/engine/types';
import signals from '../fixtures/signals-old-page.json';

/* The Signals page's engine against the old site's own code: the structure alerts and the day-against-index block of
   watch.html, run out of their source on the same closes (tests/fixtures/signals-old-page.json, docs/PARITY.md), and the
   phantom-bar rule on the real tails of series.json for exchanges on both sides of UTC. */

const raw = (name: string) => JSON.parse(readFileSync(new URL('../../public/data/' + name, import.meta.url), 'utf8'));

type Closes = Record<Timeframe, { closes: number[] }>;
const sample = signals.symbols as unknown as Record<string, Closes>;

/** A row with only what these functions read. */
const stub = (o: { sym: string; dir?: 'long' | 'short'; section?: Section; state?: ReplayStatus; country?: string; sector?: string | null; dayPct?: number | null }): Row =>
  ({
    p: { sym: o.sym, dir: o.dir ?? 'long', country: o.country },
    section: o.section ?? 'watch', st: { state: o.state ?? 'watch' },
    ev: o.sector ? { sector: o.sector } : {}, dayPct: o.dayPct ?? null,
  }) as unknown as Row;

/* ------------------------------------------------------------------ fresh level changes, against watch.html */

describe('fresh level changes, against the old page\'s structure alerts', () => {
  const cases = signals.structure.rows as { sym: string; dir: 'long' | 'short'; section: Section; state: ReplayStatus; cutBars: Record<Timeframe, number>; stale?: { tf: Timeframe; period: number } }[];
  const want = signals.structure.events as { sym: string; dir: string; state: string; tf: string; period: number; ago: number; helps: boolean; stateTag: string }[];

  // Each case is a setup of its own, so it gets an id of its own; the closes are the sample's, less the bars the case cuts off.
  const idOf = (i: number) => cases[i].sym + '#' + i;
  const rows = cases.map((c, i) => stub({ sym: idOf(i), dir: c.dir, section: c.section, state: c.state }));
  const extra = signals.structure.extra as unknown as Record<string, Record<Timeframe, number[]>>;
  const vals = (id: string, tf: Timeframe) => {
    const i = +id.split('#')[1];
    const sym = cases[i].sym;
    const full = sample[sym] ? sample[sym][tf].closes : extra[sym][tf];
    return full.slice(0, full.length - cases[i].cutBars[tf]);
  };
  const got = structureEvents(rows, vals).map(e => ({
    sym: e.row.p.sym.split('#')[0], dir: e.row.p.dir, state: e.state, tf: e.tf, period: e.period, ago: e.ago, helps: e.helps, stateTag: e.row.st.state,
  }));

  it('finds the same changes of sides, in the same order, with the same reading of whether it helps', () => {
    expect(want.length).toBeGreaterThan(5);
    expect(got).toEqual(want.map(({ sym, dir, state, tf, period, ago, helps, stateTag }) => ({ sym, dir, state, tf, period, ago, helps, stateTag })));
  });

  it('reaches monthly, weekly and daily, reclaimed and lost, the 200 and the 150, for longs and shorts', () => {
    expect(new Set(want.map(e => e.tf))).toEqual(new Set(['monthly', 'weekly', 'daily']));
    expect(new Set(want.map(e => e.state))).toEqual(new Set(['reclaimed', 'lost']));
    expect(new Set(want.map(e => e.period))).toEqual(new Set([150, 200]));
    expect(new Set(want.map(e => e.dir))).toEqual(new Set(['long', 'short']));
    expect(want.some(e => e.helps) && want.some(e => !e.helps)).toBe(true);
  });

  it('leaves failed and removed setups out, as the old page did', () => {
    const left = cases.map((c, i) => [c, i] as const).filter(([c]) => c.section === 'failed' || c.section === 'removed');
    expect(left.length).toBeGreaterThan(0);
    // The same closes, as setups still being watched, do have changes of sides to report: it is the section that leaves them out.
    expect(structureEvents(left.map(([c, i]) => stub({ sym: idOf(i), dir: c.dir, section: 'watch', state: 'watch' })), vals).length).toBeGreaterThan(0);
    expect(structureEvents(left.map(([c, i]) => stub({ sym: idOf(i), dir: c.dir, section: c.section, state: c.state })), vals)).toEqual([]);
  });

  it('leaves out a change a bar too old to be fresh: two bars ago on a weekly or monthly average, three sessions ago on a daily one', () => {
    const old = cases.map((c, i) => [c, i] as const).filter(([c]) => c.stale);
    expect(old.map(([c]) => c.stale!.tf).sort()).toEqual(['daily', 'monthly', 'weekly']);
    const maxAgo = { monthly: 1, weekly: 1, daily: 2 };
    for (const [c, i] of old) {
      const { tf, period } = c.stale!;
      // It is a change of sides, one bar past the window...
      const m = maRead(vals(idOf(i), tf), period)!;
      expect(['reclaimed', 'lost']).toContain(m.state);
      expect(m.crossedAgo).toBe(maxAgo[tf] + 1);
      // ...and the page does not report it.
      expect(structureEvents([rows[i]], vals).filter(e => e.tf === tf && e.period === period), `${c.sym} ${tf} ${period}`).toEqual([]);
    }
  });

  it('puts monthly before weekly before daily, the 200 before the 150, then what is already in trade', () => {
    const rank = { monthly: 0, weekly: 1, daily: 2 } as const;
    const state = { breakout: 0, target: 1, watch: 2, failed: 9 } as const;
    for (let i = 1; i < got.length; i++) {
      const a = got[i - 1], b = got[i];
      const ka = [rank[a.tf], a.period === 200 ? 0 : 1, state[a.stateTag as ReplayStatus]], kb = [rank[b.tf], b.period === 200 ? 0 : 1, state[b.stateTag as ReplayStatus]];
      const cmp = ka[0] - kb[0] || ka[1] - kb[1] || ka[2] - kb[2];
      expect(cmp, `${a.sym} ${a.tf} ${a.period} before ${b.sym} ${b.tf} ${b.period}`).toBeLessThanOrEqual(0);
    }
  });

  it('counts a long that reclaims, or a short that loses, an average as helped, and the other two as against', () => {
    for (const e of got) expect(e.helps, `${e.sym} ${e.dir} ${e.state}`).toBe(e.dir === 'long' ? e.state === 'reclaimed' : e.state === 'lost');
  });
});

/* ------------------------------------------------------------------ the day against the index and the sector */

describe('the day against the index and the sector, against the old page', () => {
  const j = signals.relative;
  const hist = Object.fromEntries(Object.entries(j.index).map(([k, v]) => [k, { settled: v.settled, live: v.live, liveDate: v.liveDate, currency: '' } as unknown as History]));
  const rows = j.rows.map(r => stub({ sym: r.sym, dir: r.dir as 'long' | 'short', country: r.country, sector: r.sector, dayPct: r.dayPct }));
  const rel = relatives(rows, hist);

  it('is what the old page worked out for each name: points ahead of the index, points ahead of the sector\'s median', () => {
    // A move of 0.04 points is -0 after rounding, in the old code too; a fixture written as JSON cannot say which zero.
    const zero = (v: number | null) => (v == null ? v : v + 0);
    expect(rows.map((r, i) => ({ sym: j.rows[i].sym, relm: zero(rel.get(r)!.vsIndex), rels: zero(rel.get(r)!.vsSector) }))).toEqual(j.expected);
  });

  it('reaches every case: ahead and behind, a missing index, a sector of two, no sector, no day move, an unknown country', () => {
    const e = j.expected;
    expect(e.some(x => x.relm != null && x.relm > 0) && e.some(x => x.relm != null && x.relm < 0)).toBe(true);
    expect(e.some(x => x.relm == null) && e.some(x => x.rels == null) && e.some(x => x.rels != null)).toBe(true);
  });

  it('compares with a sector only when it has three names, itself included', () => {
    expect(MIN_SECTOR_PEERS).toBe(3);
    const two = relatives([stub({ sym: 'A', sector: 'S', dayPct: 1 }), stub({ sym: 'B', sector: 'S', dayPct: 3 })], {});
    expect([...two.values()].every(r => r.vsSector == null && r.peers === 2)).toBe(true);
    const three = [stub({ sym: 'A', sector: 'S', dayPct: 1 }), stub({ sym: 'B', sector: 'S', dayPct: 3 }), stub({ sym: 'C', sector: 'S', dayPct: 2 })];
    const r3 = relatives(three, {});
    expect(r3.get(three[0])).toMatchObject({ peers: 3, sectorDay: 2, vsSector: -1 });
    expect(r3.get(three[1])!.vsSector).toBe(1);
  });

  it('counts a name with no day move out of its sector\'s median, and gives it no comparison', () => {
    const rows3 = [stub({ sym: 'A', sector: 'S', dayPct: 1 }), stub({ sym: 'B', sector: 'S', dayPct: null }), stub({ sym: 'C', sector: 'S', dayPct: 3 }), stub({ sym: 'D', sector: 'S', dayPct: 2 })];
    const r = relatives(rows3, {});
    expect(r.get(rows3[0])!.peers).toBe(3);
    expect(r.get(rows3[1])).toMatchObject({ day: null, vsSector: null, vsIndex: null });
  });

  it('names the index each listing is read against, and has none for a country without one', () => {
    const r = relatives([stub({ sym: 'A', country: 'Japan', dayPct: 1 }), stub({ sym: 'B', country: 'UAE', dayPct: 1 })], {});
    const [a, b] = [...r.values()];
    expect(a.index).toBe('^N225');
    expect(b.index).toBeNull();
  });
});

describe('the index map', () => {
  it('names an index for each listing country the old page did, and none for the UAE', () => {
    expect(indexOf('US')).toBe('^GSPC');
    expect(indexOf('Hong Kong')).toBe('^HSI');
    expect(indexOf('UAE')).toBeNull();
    expect(indexOf(undefined)).toBeNull();
    expect(indexOf('')).toBeNull();
  });

  it('is the map the data job fetches the index bars with: scripts/fetch_bars.py, entry for entry', () => {
    const py = readFileSync(new URL('../../scripts/fetch_bars.py', import.meta.url), 'utf8');
    const block = /INDEX_MAP = \{([\s\S]*?)\n\}/.exec(py);
    expect(block).not.toBeNull();
    const fromPython = Object.fromEntries([...block![1].matchAll(/"([^"]+)":\s*"([^"]+)"/g)].map(m => [m[1], m[2]]));
    expect(Object.keys(fromPython).length).toBeGreaterThan(5);
    expect(INDEX_MAP).toEqual(fromPython);
  });

  it('is the old page\'s own, run out of its source', () => {
    expect(INDEX_MAP).toEqual(signals.indexMap);
  });
});

/* ------------------------------------------------------------------ the phantom bar */

/* The real last bars of series.json, as stamped for exchanges on both sides of UTC: two genuine bars at the start of their
   weeks (or months) in the exchange's own time, and Yahoo's padded bar at the last trade. */
const iso = (s: string) => Date.parse(s + 'Z') / 1000;
const tail = (stamps: string[], closes: number[]): SeriesEntry => ({ ccy: null, t: stamps.map(iso), c: closes });

const WEEKLY: Record<string, SeriesEntry> = {
  'AME (New York)': tail(['2026-10-12T04:00:00', '2026-10-19T04:00:00', '2026-10-26T04:00:00', '2026-10-30T20:00:03'], [248.17, 240.03, 241.12, 241.12]),
  '7956.T (Tokyo)': tail(['2026-10-11T15:00:00', '2026-10-18T15:00:00', '2026-10-25T15:00:00', '2026-10-30T06:30:00'], [2180, 2091, 2101.5, 2101.5]),
  'CBK.DE (Frankfurt, the clocks change)': tail(['2026-10-11T22:00:00', '2026-10-18T22:00:00', '2026-10-25T23:00:00', '2026-10-30T16:35:19'], [37.88, 36.27, 37.78, 37.78]),
  'COL.AX (Sydney)': tail(['2026-10-11T13:00:00', '2026-10-18T13:00:00', '2026-10-25T13:00:00', '2026-10-30T05:20:38'], [23.9, 24.55, 21.66, 21.66]),
  '0002.HK (Hong Kong)': tail(['2026-10-11T16:00:00', '2026-10-18T16:00:00', '2026-10-25T16:00:00', '2026-10-30T08:08:06'], [77.15, 76.05, 77.4, 77.4]),
};
const MONTHLY: Record<string, SeriesEntry> = {
  'AME (New York)': tail(['2026-08-01T04:00:00', '2026-09-01T04:00:00', '2026-10-01T04:00:00', '2026-10-30T20:00:03'], [235.17, 247.73, 241.12, 241.12]),
  '7956.T (Tokyo)': tail(['2026-07-31T15:00:00', '2026-08-31T15:00:00', '2026-09-30T15:00:00', '2026-10-30T06:30:00'], [2115, 2040.5, 2101.5, 2101.5]),
  'CBK.DE (Frankfurt)': tail(['2026-07-31T22:00:00', '2026-08-31T22:00:00', '2026-09-30T22:00:00', '2026-10-30T16:35:19'], [40.19, 40.31, 37.78, 37.78]),
  'COL.AX (Sydney)': tail(['2026-07-31T14:00:00', '2026-08-31T14:00:00', '2026-09-30T14:00:00', '2026-10-30T05:20:38'], [24.04, 23.36, 21.66, 21.66]),
  '0002.HK (Hong Kong)': tail(['2026-07-31T16:00:00', '2026-08-31T16:00:00', '2026-09-30T16:00:00', '2026-10-30T08:08:06'], [78.7, 76.7, 77.4, 77.4]),
};

/** The old site's test, from ma.js: the tail bar goes when the UTC week (or month) of its stamp is the one the bar before
    it fell in. Kept here only to show what it did on these stamps. */
function oldRuleDrops(e: SeriesEntry, interval: '1wk' | '1mo'): boolean {
  const key = (t: number) => {
    const d = new Date(t * 1000);
    if (interval === '1wk') {
      const monday = new Date(d);
      monday.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
      return monday.toISOString().slice(0, 10);
    }
    return d.toISOString().slice(0, 7);
  };
  const n = e.t.length;
  return n >= 2 && key(e.t[n - 1]) === key(e.t[n - 2]);
}

describe('the phantom bar on a weekly or monthly series', () => {
  it('is dropped on every exchange, whichever side of UTC it is on: the last bar falls inside the week the bar before it opened', () => {
    for (const [name, e] of Object.entries(WEEKLY)) expect(seriesCloses(e, 'weekly'), name).toEqual(e.c.slice(0, -1));
    for (const [name, e] of Object.entries(MONTHLY)) expect(seriesCloses(e, 'monthly'), name).toEqual(e.c.slice(0, -1));
  });

  it('was left in by the old site\'s UTC-date test for every exchange ahead of UTC, because their genuine bars fall on the Sunday before', () => {
    const left = (set: Record<string, SeriesEntry>, interval: '1wk' | '1mo') => Object.entries(set).filter(([, e]) => !oldRuleDrops(e, interval)).map(([n]) => n);
    expect(left(WEEKLY, '1wk')).toEqual(['7956.T (Tokyo)', 'CBK.DE (Frankfurt, the clocks change)', 'COL.AX (Sydney)', '0002.HK (Hong Kong)']);
    expect(left(MONTHLY, '1mo')).toEqual(['7956.T (Tokyo)', 'CBK.DE (Frankfurt)', 'COL.AX (Sydney)', '0002.HK (Hong Kong)']);
    // Where the exchange is behind UTC it agreed.
    expect(oldRuleDrops(WEEKLY['AME (New York)'], '1wk')).toBe(true);
    expect(oldRuleDrops(MONTHLY['AME (New York)'], '1mo')).toBe(true);
  });

  it('leaves the same closes as the old site\'s test for the US-style stamps the fixture records, and different ones for names ahead of UTC', () => {
    const same = signals.oldRuleSame as Record<string, { weekly: boolean; monthly: boolean }>;
    const us = Object.keys(same).filter(s => !/[.^]/.test(s) || s.endsWith('.TO'));
    expect(us.length).toBeGreaterThan(2);
    for (const s of us) expect(same[s], s).toEqual({ weekly: true, monthly: true });
    // And it differed for names listed ahead of UTC.
    expect(Object.values(same).some(v => !v.weekly && !v.monthly)).toBe(true);
  });

  it('keeps a last bar that opens a new period, with an hour allowed either way for the clocks changing', () => {
    // New York, a Monday a week on; Frankfurt as the clocks go back (a week and an hour); New York as they go forward (a week less an hour).
    expect(seriesCloses(tail(['2026-10-19T04:00:00', '2026-10-26T04:00:00'], [1, 2]), 'weekly')).toEqual([1, 2]);
    expect(seriesCloses(tail(['2026-10-18T22:00:00', '2026-10-25T23:00:00'], [1, 2]), 'weekly')).toEqual([1, 2]);
    expect(seriesCloses(tail(['2026-03-02T05:00:00', '2026-03-09T04:00:00'], [1, 2]), 'weekly')).toEqual([1, 2]);
    // Months of 28, 30 and 31 days: the first of the next month is a genuine bar, a day before it is not.
    expect(seriesCloses(tail(['2026-02-01T05:00:00', '2026-03-01T05:00:00'], [1, 2]), 'monthly')).toEqual([1, 2]);
    expect(seriesCloses(tail(['2026-02-01T05:00:00', '2026-02-28T21:00:00'], [1, 2]), 'monthly')).toEqual([1]);
    expect(seriesCloses(tail(['2026-04-01T04:00:00', '2026-05-01T04:00:00'], [1, 2]), 'monthly')).toEqual([1, 2]);
    expect(seriesCloses(tail(['2026-10-01T04:00:00', '2026-10-31T23:00:00'], [1, 2]), 'monthly')).toEqual([1]);
    expect(seriesCloses(tail(['2026-10-01T04:00:00', '2026-11-01T04:00:00'], [1, 2]), 'monthly')).toEqual([1, 2]);
  });

  it('drops a phantom stamped late in the period: a Sunday evening for a market that trades at the weekend, the last night of a month', () => {
    expect(seriesCloses(tail(['2026-10-19T04:00:00', '2026-10-26T04:00:00', '2026-11-01T20:00:00'], [1, 2, 2]), 'weekly')).toEqual([1, 2]);
    // Tokyo's October opened at 15:00 UTC on 30 September, so the month it is in is not the UTC month of its stamp.
    expect(seriesCloses(tail(['2026-09-30T15:00:00', '2026-10-31T13:30:00'], [1, 1]), 'monthly')).toEqual([1]);
    expect(seriesCloses(tail(['2026-09-30T15:00:00', '2026-10-31T15:00:00'], [1, 2]), 'monthly')).toEqual([1, 2]);
    // And a short month ahead of UTC: Tokyo's February is 28 days, from 31 January 15:00 UTC.
    expect(seriesCloses(tail(['2026-01-31T15:00:00', '2026-02-28T13:00:00'], [1, 1]), 'monthly')).toEqual([1]);
    expect(seriesCloses(tail(['2026-01-31T15:00:00', '2026-02-28T15:00:00'], [1, 2]), 'monthly')).toEqual([1, 2]);
  });

  it('keeps the series as it is when Yahoo wrote no phantom: the last bar is the genuine one for the week in progress', () => {
    const noPhantom = tail(['2026-10-04T21:00:00', '2026-10-11T21:00:00', '2026-10-18T21:00:00', '2026-10-25T21:00:00'], [122.7, 124.97, 122.03, 120.47]);
    expect(seriesCloses(noPhantom, 'weekly')).toEqual([122.7, 124.97, 122.03, 120.47]);
  });

  it('keeps a bar that is the only one for its period, where the genuine bar has not been written yet', () => {
    // The month's own bar is missing, and the padded one is stamped in the next month.
    expect(seriesCloses(tail(['2026-09-01T04:00:00', '2026-10-01T04:00:00', '2026-11-02T20:00:00'], [1, 2, 3]), 'monthly')).toEqual([1, 2, 3]);
  });

  it('keeps a series of one bar, and has nothing for no bar or none at all', () => {
    expect(seriesCloses(tail(['2026-08-19T20:00:00'], [77.57]), 'weekly')).toEqual([77.57]);
    expect(seriesCloses({ ccy: null, t: [], c: [] }, 'weekly')).toBeNull();
    expect(seriesCloses(null, 'weekly')).toBeNull();
    expect(seriesCloses(undefined, 'monthly')).toBeNull();
  });

  it('does not change what it is given', () => {
    const e = WEEKLY['AME (New York)'];
    const copy = JSON.parse(JSON.stringify(e));
    seriesCloses(e, 'weekly');
    expect(e).toEqual(copy);
  });
});

describe('the phantom bar on the live series file', () => {
  const file = raw('series.json') as SeriesFile;
  const DAY = 86400;

  it('is a file the page accepts whole: matching stamps and closes for every symbol', () => {
    const parsed = parseSeries(file);
    expect(parsed.problems).toEqual([]);
    expect(Object.keys(parsed.file!.weekly).length).toBeGreaterThan(0);
    expect(Object.keys(parsed.file!.monthly).length).toBeGreaterThan(0);
  });

  it('has stamps in order, and for every series at most one bar dropped, which then lies inside the period before it', () => {
    for (const tf of ['weekly', 'monthly'] as const) {
      const period = tf === 'weekly' ? 7 : 31;
      for (const [sym, e] of Object.entries(file[tf])) {
        for (let i = 1; i < e.t.length; i++) expect(e.t[i] > e.t[i - 1], `${tf} ${sym} stamp ${i}`).toBe(true);
        const closes = seriesCloses(e, tf);
        if (!closes) { expect(e.c.length, `${tf} ${sym}`).toBe(0); continue; }
        expect([e.c.length, e.c.length - 1], `${tf} ${sym}`).toContain(closes.length);
        const n = e.t.length;
        if (closes.length === n - 1) expect((e.t[n - 1] - e.t[n - 2]) / DAY, `${tf} ${sym} dropped`).toBeLessThan(period);
        else if (n >= 2) expect((e.t[n - 1] - e.t[n - 2]) / DAY, `${tf} ${sym} kept`).toBeGreaterThanOrEqual(tf === 'weekly' ? 7 - 1 / 24 : 28 - 1 / 24);
      }
    }
  });
});

describe('what the page reads each timeframe\'s closes from', () => {
  const hist = (closes: number[]): History => ({ settled: closes.map((c, i) => [`2026-01-${String(i + 1).padStart(2, '0')}`, c]), live: null, liveDate: '', currency: 'USD' });
  const series: SeriesFile = {
    generated_at: '2026-11-01T17:03:51Z',
    weekly: { X: tail(['2026-10-12T04:00:00', '2026-10-19T04:00:00', '2026-10-21T20:00:00'], [1, 2, 2]) },
    monthly: {},
  };
  const src = closeSource({ X: hist([5, 6, 7]) }, series);

  it('is the settled closes for the daily bars, and the series without its phantom for weekly and monthly', () => {
    expect(src('X', 'daily')).toEqual([5, 6, 7]);
    expect(src('X', 'weekly')).toEqual([1, 2]);
    expect(src('X', 'monthly')).toBeNull();
  });

  it('is nothing for a symbol it has no closes for, and for a series file that has not loaded', () => {
    expect(src('Y', 'daily')).toBeNull();
    expect(closeSource({ X: hist([]) }, series)('X', 'daily')).toBeNull();
    expect(closeSource({ X: hist([5, 6]) }, null)('X', 'weekly')).toBeNull();
  });

  it('works each out once', () => {
    expect(src('X', 'daily')).toBe(src('X', 'daily'));
    expect(src('X', 'weekly')).toBe(src('X', 'weekly'));
  });
});

/* ------------------------------------------------------------------ the scan, and the columns */

describe('the setups a scan runs over', () => {
  const rows = [
    stub({ sym: 'W1', section: 'watch' }), stub({ sym: 'B1', section: 'breakout', state: 'breakout' }), stub({ sym: 'R1', section: 'reentered', state: 'breakout' }),
    stub({ sym: 'S1', section: 'stopped', state: 'breakout' }), stub({ sym: 'T1', section: 'target', state: 'target' }),
    stub({ sym: 'F1', section: 'failed', state: 'failed' }), stub({ sym: 'D1', section: 'removed' }),
    stub({ sym: 'W1', dir: 'short', section: 'watch' }), stub({ sym: 'N1', section: 'watch' }),
  ];
  const hist = Object.fromEntries(['W1', 'B1', 'R1', 'S1', 'T1', 'F1', 'D1'].map(s => [s, { settled: [['2026-01-01', 1]], live: null, liveDate: '', currency: 'USD' } as History]));
  const names = (scope: 'watch' | 'trade' | 'all') => scanRows(rows, scope, hist).map(r => r.p.sym);

  it('is the waiting ones, the ones in trade (confirmed or back in), or every one still in play', () => {
    expect(names('watch')).toEqual(['W1']);
    expect(names('trade')).toEqual(['B1', 'R1']);
    expect(names('all')).toEqual(['W1', 'B1', 'R1', 'S1', 'T1']);
  });

  it('leaves out a setup that has failed or been removed, and one with no history at all', () => {
    expect(names('all')).not.toContain('F1');
    expect(names('all')).not.toContain('D1');
    expect(names('watch')).not.toContain('N1');
    expect(isLive(rows[5])).toBe(false);
    expect(isLive(rows[0])).toBe(true);
  });

  it('takes a name listed both long and short once: it is one chart', () => {
    expect(names('watch').filter(s => s === 'W1')).toHaveLength(1);
  });
});

describe('the cross scan on a timeframe', () => {
  const flat = Array<number>(225).fill(100);
  const up = [...flat, 95, 95, 95, 95, 106];
  const rows = [stub({ sym: 'UP' }), stub({ sym: 'SHORT' }), stub({ sym: 'NONE' })];
  const closes: Record<string, number[]> = { UP: up, SHORT: up.slice(-100), NONE: [...flat, 100, 100, 100, 100, 100] };
  const vals = (sym: string, tf: Timeframe) => (tf === 'daily' ? closes[sym] ?? null : null);

  it('finds each cross in the window, for each name, and says how many had enough history to be scanned', () => {
    const s = scanOf(rows, 'daily', vals);
    expect(s).toMatchObject({ tf: 'daily', lookback: 10, total: 3, covered: 2 });
    expect(s.hits.map(h => [h.row.p.sym, h.key, h.bullish, h.ago, h.whip])).toEqual([
      ['UP', 'e5x21', true, 0, false], ['UP', 'px50', true, 0, false], ['UP', 'px200', true, 0, false],
    ]);
    expect(MIN_BARS).toBe(220);
  });

  it('looks back as far as the timeframe says: ten sessions, thirteen weeks, twelve months', () => {
    expect(scanOf(rows, 'daily', vals).lookback).toBe(10);
    expect(scanOf(rows, 'weekly', vals).lookback).toBe(13);
    expect(scanOf(rows, 'monthly', vals).lookback).toBe(12);
  });

  it('covers nobody on a timeframe none of them have closes for, and finds nothing', () => {
    const s = scanOf(rows, 'weekly', vals);
    expect(s).toMatchObject({ covered: 0, total: 3, hits: [] });
  });
});

describe('the average columns', () => {
  const closes = Array.from({ length: 260 }, (_, i) => 100 + i * 0.3 + Math.sin(i / 7) * 2);

  it('is a column for each period the timeframe shows, with the slope only on the lines that carry a level test', () => {
    for (const tf of TIMEFRAMES) {
      const cols = ladderOf(closes, tf);
      expect(cols.map(c => c.period), tf).toEqual(
        tf === 'daily' ? [5, 21, 50, 150, 200] : tf === 'weekly' ? [10, 30, 40, 200] : [10, 12, 20]);
      for (const c of cols) {
        expect(c.tagged, `${tf} ${c.period}`).toBe(TAGGED[tf].includes(c.period));
        if (!c.tagged) expect(c.slope, `${tf} ${c.period}`).toBeNull();
      }
    }
    expect(ladderOf(closes, 'daily').filter(c => c.tagged).every(c => c.slope != null)).toBe(true);
  });

  it('has a read for each period with the bars for it, and none without', () => {
    const cols = ladderOf(closes.slice(0, 60), 'daily');
    expect(cols.map(c => c.read != null)).toEqual([true, true, true, false, false]);
    expect(ladderOf(null, 'weekly').every(c => c.read == null && c.slope == null)).toBe(true);
  });
});
