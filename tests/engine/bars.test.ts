import { describe, expect, it } from 'vitest';
import { allHistories, derivedPeriod, historyOf, localDate, tipSettled } from '../../src/engine/bars';
import type { BarsFile, LatestFile, SessionHours } from '../../src/engine/bars';
import barsFile from '../../public/data/bars.json';
import latestFile from '../fixtures/prices-latest-2026-11-01.json';

const T = (iso: string) => Date.parse(iso);
const S = (iso: string) => Date.parse(iso) / 1000;

const TOKYO: SessionHours = ['Asia/Tokyo', 540, 930];          // 09:00–15:30 JST
const NYSE: SessionHours = ['America/New_York', 570, 960];     // 09:30–16:00
const DUBAI: SessionHours = ['Asia/Dubai', 600, 900];
const SYDNEY: SessionHours = ['Australia/Sydney', 600, 972];

describe('sessions rebuilt from the exchange\'s local hours', () => {
  it('Tokyo, Monday morning: the session running now', () => {
    expect(derivedPeriod(TOKYO, T('2026-11-02T02:00:00Z'))).toEqual({ start: S('2026-11-02T00:00:00Z'), end: S('2026-11-02T06:30:00Z') });
  });

  it('Tokyo, after the close: the next session', () => {
    expect(derivedPeriod(TOKYO, T('2026-11-02T07:00:00Z'))).toEqual({ start: S('2026-11-03T00:00:00Z'), end: S('2026-11-03T06:30:00Z') });
  });

  it('a weekend rolls to Monday', () => {
    expect(derivedPeriod(TOKYO, T('2026-11-01T12:00:00Z'))!.start).toBe(S('2026-11-02T00:00:00Z'));
  });

  it('New York the day after the clocks went back', () => {
    expect(derivedPeriod(NYSE, T('2026-11-02T15:00:00Z'))).toEqual({ start: S('2026-11-02T14:30:00Z'), end: S('2026-11-02T21:00:00Z') });
    expect(derivedPeriod(NYSE, T('2026-10-30T15:00:00Z'))).toEqual({ start: S('2026-10-30T13:30:00Z'), end: S('2026-10-30T20:00:00Z') });
  });

  it('the Gulf weekend is Friday and Saturday', () => {
    expect(derivedPeriod(DUBAI, T('2026-11-06T08:00:00Z'))!.start).toBe(S('2026-11-08T06:00:00Z'));
  });

  it('nothing without hours', () => {
    expect(derivedPeriod(null, T('2026-11-02T08:00:00Z'))).toBeNull();
  });
});

describe('a tip is live only inside the session running now', () => {
  it('Tokyo open: a print from a minute ago is live, Friday\'s close is settled', () => {
    const now = T('2026-11-02T02:00:00Z');
    expect(tipSettled(S('2026-11-02T01:59:00Z'), TOKYO, now)).toBe(false);
    expect(tipSettled(S('2026-10-30T06:30:00Z'), TOKYO, now)).toBe(true);
  });

  it('Tokyo shut: the closing print is settled', () => {
    expect(tipSettled(S('2026-11-02T06:30:00Z'), TOKYO, T('2026-11-02T07:00:00Z'))).toBe(true);
  });

  it('New York open and shut', () => {
    expect(tipSettled(S('2026-11-02T15:00:00Z'), NYSE, T('2026-11-02T15:05:00Z'))).toBe(false);
    expect(tipSettled(S('2026-11-02T21:00:00Z'), NYSE, T('2026-11-02T22:00:00Z'))).toBe(true);
  });

  it('without hours, six hours old counts as settled', () => {
    expect(tipSettled(S('2026-11-02T01:00:00Z'), null, T('2026-11-02T02:00:00Z'))).toBe(false);
    expect(tipSettled(S('2026-11-01T19:00:00Z'), null, T('2026-11-02T02:00:00Z'))).toBe(true);
  });
});

describe('dates are the exchange\'s own', () => {
  it('Sydney\'s open in daylight time is the evening before in UTC', () => {
    expect(localDate(S('2026-11-02T23:00:00Z'), 'Australia/Sydney')).toBe('2026-11-03');
    expect(localDate(S('2026-11-02T23:00:00Z'), null)).toBe('2026-11-02');
    expect(derivedPeriod(SYDNEY, T('2026-11-02T23:30:00Z'))!.start).toBe(S('2026-11-02T23:00:00Z'));
  });
});

describe('history from the two files', () => {
  const files = (tip: Partial<LatestFile['latest']['X']>): { bars: BarsFile; latest: LatestFile } => ({
    bars: { generated_at: '', ccy: { X: 'JPY' }, bars: { X: { '2026-10-30': [100, 104, 103], '2026-10-29': [98, 102, 101] } } },
    latest: { generated_at: '', sessions: [TOKYO], latest: { X: { c: 105, z: 0, ...tip } } },
  });

  it('a live tip is the live price and is not a settled close', () => {
    const { bars, latest } = files({ t: S('2026-11-02T01:59:00Z') });
    const h = historyOf('X', bars, latest, T('2026-11-02T02:00:00Z'))!;
    expect(h.settled).toEqual([['2026-10-29', 101], ['2026-10-30', 103]]);
    expect(h).toMatchObject({ live: 105, liveDate: '2026-11-02', currency: 'JPY' });
  });

  it('a settled tip for a day not yet on file is appended as that day\'s close', () => {
    const { bars, latest } = files({ t: S('2026-11-02T06:30:00Z') });
    const h = historyOf('X', bars, latest, T('2026-11-02T07:00:00Z'))!;
    expect(h.settled).toEqual([['2026-10-29', 101], ['2026-10-30', 103], ['2026-11-02', 105]]);
    expect(h).toMatchObject({ live: 105, liveDate: '2026-11-02' });
  });

  it('a tip for the last day on file is that day\'s latest print', () => {
    const { bars, latest } = files({ t: S('2026-10-30T06:30:00Z'), c: 103.5 });
    const h = historyOf('X', bars, latest, T('2026-11-01T12:00:00Z'))!;
    expect(h.settled).toHaveLength(2);
    expect(h).toMatchObject({ live: 103.5, liveDate: '2026-10-30' });
  });

  it('a stale tip is ignored; no tip at all leaves the last close as the live price', () => {
    const { bars, latest } = files({ t: S('2024-07-23T12:00:00Z'), c: 50 });
    expect(historyOf('X', bars, latest, T('2026-11-01T12:00:00Z'))).toMatchObject({ live: 103, liveDate: '2026-10-30' });
    expect(historyOf('X', bars, null, T('2026-11-01T12:00:00Z'))).toMatchObject({ live: 103, liveDate: '2026-10-30' });
    expect(historyOf('Z', bars, latest, T('2026-11-01T12:00:00Z'))).toBeNull();
  });
});

describe('the real files on the Sunday the parity dump was taken', () => {
  const now = T('2026-11-01T17:49:00Z');
  // The data job keeps committing to public/data, so these use that Sunday's files: the last tick
  // as it stood (a fixture), and bars.json cut at the Friday, which is the same file because it is append-only.
  const live = barsFile as unknown as BarsFile;
  const sunday: BarsFile = { ...live, bars: Object.fromEntries(Object.entries(live.bars).map(([sym, days]) =>
    [sym, Object.fromEntries(Object.entries(days).filter(([d]) => d <= '2026-10-31'))])) };
  const hist = allHistories(sunday, latestFile as unknown as LatestFile, now);

  it('every market is shut, so no symbol is live', () => {
    const live = Object.entries(hist).filter(([, h]) => h.liveDate !== h.settled[h.settled.length - 1][0]);
    expect(live).toEqual([]);
  });

  it('every bar day ends on or before the Friday close, and the tip never predates the last bar', () => {
    for (const [sym, h] of Object.entries(hist)) {
      const last = h.settled[h.settled.length - 1][0];
      expect(last <= '2026-10-31', sym).toBe(true);
      expect(h.liveDate, sym).toBe(last);
    }
  });

  it('reads 7936.T as a settled Friday close in yen', () => {
    expect(hist['7936.T']).toMatchObject({ live: 4838, liveDate: '2026-10-30', currency: 'JPY' });
  });
});
