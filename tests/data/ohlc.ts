/* The data guard for bars.json: a close must sit within its own day's low-high.

   Yahoo does not always send a day that way. It widens a day's low and high to the closing auction some hours after the
   bar first appears (SL.MI, 13 Nov 2026: a close of 38.44 under a low of 38.58, corrected the next day), and
   scripts/fetch_bars.py takes the newest REVISE_DAYS days on file from Yahoo again on every run for that reason.

   So a close outside its range on one of a symbol's newest REVISE_DAYS bars is a bar a later run may still correct, and it
   passes. On an older bar no run will touch it again: it is a permanent quirk, and a person has to look at it. */

/** One symbol's days: date key to [low, high, close, open?]. */
export type Days = Record<string, number[]>;

/** The dates, oldest first, whose close lies outside the day's low-high, leaving out the newest `reviseDays` days on file.
    The window counts days on file, as the data job does (`sorted(day)[-REVISE_DAYS:]`), not calendar days: a holiday does
    not shorten it. A symbol with no more days than the window has nothing older, so nothing fails. */
export function closesOutsideRange(days: Days, reviseDays: number): string[] {
  // A window that is not a whole number would slice nothing off, or everything, and let every quirk through unseen.
  if (!Number.isInteger(reviseDays) || reviseDays < 0) throw new RangeError(`the revision window must be a whole number of days, not ${reviseDays}`);
  const dates = Object.keys(days).sort();
  return dates.slice(0, Math.max(0, dates.length - reviseDays)).filter((d) => {
    const [low, high, close] = days[d];
    return !(low <= close && close <= high);
  });
}

/** REVISE_DAYS as scripts/fetch_bars.py sets it, read from the script's source so this guard cannot drift from the job.
    Throws where the script no longer has a plain `REVISE_DAYS = <whole number>` line. */
export function reviseDaysOf(source: string): number {
  const m = /^REVISE_DAYS\s*=\s*(\d+)\s*(?:#.*)?$/m.exec(source);
  if (!m) throw new Error('scripts/fetch_bars.py has no line "REVISE_DAYS = <whole number>" at the start of a line: the data guard reads its window from there');
  return Number(m[1]);
}
