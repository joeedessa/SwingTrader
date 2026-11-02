import { describe, expect, it } from 'vitest';
import { ageText, agoText, count, daysTag, localISODate, daysUntil, direction, fmt, fmtD, fmtRatio, humanDates, MINUS, signedFmt, signedPct } from '../../src/engine/format';

describe('numbers', () => {
  it('print one decimal from 100 up and two below, with thousands separators, and a dash for nothing', () => {
    expect(fmt(1234.567)).toBe('1,234.6');
    expect(fmt(99.456)).toBe('99.46');
    expect(fmt(0.6975)).toBe('0.7');
    expect(fmt(4.5)).toBe('4.5');
    expect(fmt(0)).toBe('0');
    expect(fmt(null)).toBe('–');
    expect(fmt(NaN)).toBe('–');
    expect(fmt(Infinity)).toBe('–');
  });

  it('ratios keep one decimal, always', () => {
    expect(fmtRatio(2)).toBe('2.0');
    expect(fmtRatio(1.449)).toBe('1.4');
    expect(fmtRatio(null)).toBe('–');
  });

  it('signs a day move with a real minus and one decimal, so a tiny move is not "+0%"', () => {
    expect(signedPct(1.234)).toBe('+1.2%');
    expect(signedPct(-0.44)).toBe('−0.4%');
    expect(signedPct(0.04)).toBe('0.0%');
    expect(signedPct(-0.04)).toBe('0.0%');
    expect(signedPct(null)).toBe('–');
    expect(MINUS).toBe('−');
  });

  it('signs any amount by the board\'s own rule', () => {
    expect(signedFmt(4.91)).toBe('+4.91');
    expect(signedFmt(-2, '%')).toBe('−2%');
    expect(signedFmt(1234.5, ' JPY')).toBe('+1,234.5 JPY');
    expect(signedFmt(0)).toBe('0');
  });

  it('classifies a move the way it is printed', () => {
    expect([direction(0.2), direction(-0.2), direction(0.04), direction(null)]).toEqual(['up', 'down', 'flat', 'flat']);
  });
});

describe('dates', () => {
  it('print as DD-MM-YY, and pass through what is not a date', () => {
    expect(fmtD('2026-10-30')).toBe('30-10-26');
    expect(fmtD('')).toBe('–');
    expect(fmtD(null)).toBe('–');
    expect(fmtD('soon')).toBe('soon');
  });

  it('are rewritten inside a sentence', () => {
    expect(humanDates('first on 2026-10-19, last 2026-10-29 (14.2) and 12345-67-89')).toBe('first on 19-10-26, last 29-10-26 (14.2) and 12345-67-89');
  });

  it('count days from today and tag the urgency', () => {
    expect(daysUntil('2026-11-04', '2026-11-01')).toBe(3);
    expect(daysUntil(null, '2026-11-01')).toBeNull();
    expect(daysTag('2026-11-01', '2026-11-01')).toEqual({ text: 'today', cls: 'd7' });
    expect(daysTag('2026-11-02', '2026-11-01')).toEqual({ text: 'in 1 day', cls: 'd7' });
    expect(daysTag('2026-11-15', '2026-11-01')).toEqual({ text: 'in 14 days', cls: 'd14' });
    expect(daysTag('2027-03-03', '2026-11-01')).toEqual({ text: 'in 122 days', cls: 'dfar' });
    expect(daysTag('2026-10-31', '2026-11-01')).toBeNull();
    expect(agoText(0)).toBe('today');
    expect(agoText(1)).toBe('1 day ago');
    expect(agoText(42)).toBe('42 days ago');
  });
});

describe('plurals', () => {
  it('agree with the count, and "breach" takes -es', () => {
    expect(count('breach', 1)).toBe('1 breach');
    expect(count('breach', 2)).toBe('2 breaches');
    expect(count('pullback', 0)).toBe('0 pullbacks');
    expect(count('time', 2)).toBe('2 times');
  });
});

describe('how long ago a file was written', () => {
  it('says just now under a minute, then minutes, hours up to two days, then days', () => {
    expect(ageText(0)).toBe('just now');
    expect(ageText(59_000)).toBe('just now');
    expect(ageText(60_000)).toBe('1 minute ago');
    expect(ageText(12 * 60_000)).toBe('12 minutes ago');
    expect(ageText(59 * 60_000)).toBe('59 minutes ago');
    expect(ageText(60 * 60_000)).toBe('1 hour ago');
    expect(ageText(19 * 3_600_000)).toBe('19 hours ago');
    expect(ageText(47 * 3_600_000)).toBe('47 hours ago');
    expect(ageText(48 * 3_600_000)).toBe('2 days ago');
    expect(ageText(5 * 86_400_000)).toBe('5 days ago');
  });

  it('reads a clock that is a little behind the file, or no number at all, as just now', () => {
    expect(ageText(-5000)).toBe('just now');
    expect(ageText(NaN)).toBe('just now');
  });
});

describe('the date on the person\'s own clock', () => {
  it('is the local calendar date, not the UTC one, and pads month and day', () => {
    expect(localISODate(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
    expect(localISODate(new Date(2026, 10, 2, 0, 5))).toBe('2026-11-02');
    expect(localISODate(new Date(2026, 11, 31, 12))).toBe('2026-12-31');
  });
});
