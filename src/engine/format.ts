/* How numbers and dates are printed. Prices stay in each listing's own currency and are never converted;
   the currency code is shown next to a price wherever it is not obvious. */

export const MINUS = '−';

/** One decimal from 100 up, two below: the same rule the old page used, so a level reads the same in both. */
export const fmt = (v: number | null | undefined): string =>
  v == null || !isFinite(v) ? '–'
  : v.toLocaleString('en-US', { maximumFractionDigits: Math.abs(v) >= 100 ? 1 : 2 });

/** A ratio such as reward : risk, one decimal. */
export const fmtRatio = (v: number | null | undefined): string =>
  v == null || !isFinite(v) ? '–' : v.toLocaleString('en-US', { maximumFractionDigits: 1, minimumFractionDigits: 1 });

/** ISO date as DD-MM-YY, the board's date format. */
export const fmtD = (iso: string | null | undefined): string => {
  if (!iso || iso.length < 10) return iso || '–';
  return iso.slice(8, 10) + '-' + iso.slice(5, 7) + '-' + iso.slice(2, 4);
};

/** An ISO date the way a person says it: "Fri 30 Oct". Read at noon UTC so no time zone can move the day. */
export const fmtDay = (iso: string): string =>
  new Date(iso + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

/** A signed percentage: "+1.2%", "−0.4%" (a real minus), "0.0%". One decimal, so a move under a tenth is not "+0%". */
export const signedPct = (v: number | null | undefined): string => {
  if (v == null || !isFinite(v)) return '–';
  const d1 = Math.round(v * 10) / 10;
  return (d1 > 0 ? '+' : d1 < 0 ? MINUS : '') + Math.abs(d1).toFixed(1) + '%';
};

/** Same, with the board's number rule, for amounts that are not day moves ("+18.5% to go"). */
export const signedFmt = (v: number | null | undefined, suffix = ''): string =>
  v == null || !isFinite(v) ? '–' : (v > 0 ? '+' : v < 0 ? MINUS : '') + fmt(Math.abs(v)) + suffix;

export const direction = (v: number | null | undefined): 'up' | 'down' | 'flat' => {
  const d1 = v == null ? 0 : Math.round(v * 10) / 10;
  return d1 > 0 ? 'up' : d1 < 0 ? 'down' : 'flat';
};

/** Whole days from `today` to an ISO date, UTC midnight to UTC midnight; null without a date. */
export const daysUntil = (iso: string | null | undefined, today: string): number | null =>
  iso ? Math.round((Date.parse(iso) - Date.parse(today)) / 864e5) : null;

/** "in 3 days" with an urgency class: red inside a week, amber inside two, muted beyond. Past dates have no tag. */
export function daysTag(iso: string | null | undefined, today: string): { text: string; cls: 'd7' | 'd14' | 'dfar' } | null {
  const d = daysUntil(iso, today);
  if (d == null || d < 0) return null;
  return { text: d === 0 ? 'today' : 'in ' + d + ' day' + (d > 1 ? 's' : ''), cls: d <= 7 ? 'd7' : d <= 14 ? 'd14' : 'dfar' };
}

/** How long ago, for "added 12 days ago". */
export const agoText = (days: number): string => days === 0 ? 'today' : days === 1 ? '1 day ago' : days + ' days ago';

/** Plural for a count: n("breach", 2) → "2 breaches". */
export function count(noun: string, k: number): string {
  const plural = noun.endsWith('ch') || noun.endsWith('s') ? noun + 'es' : noun + 's';
  return k + ' ' + (k === 1 ? noun : plural);
}

/** Every ISO date inside a sentence, written the board's way (DD-MM-YY). */
export const humanDates = (text: string): string =>
  text.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (_m, y: string, mo: string, d: string) => d + '-' + mo + '-' + y.slice(2));

/** How long ago, for a file's timestamp: "just now", "12 minutes ago", "3 hours ago", "2 days ago". */
export function ageText(ms: number): string {
  if (!isFinite(ms) || ms < 0) return 'just now';
  const min = Math.floor(ms / 6e4);
  if (min < 1) return 'just now';
  if (min < 60) return min + (min === 1 ? ' minute ago' : ' minutes ago');
  const h = Math.floor(min / 60);
  if (h < 48) return h + (h === 1 ? ' hour ago' : ' hours ago');
  const d = Math.floor(h / 24);
  return d + ' days ago';
}
