/* Yahoo sends prices as 32-bit floats widened to doubles: a 5.43 close arrives as 5.429999828338623. Compared with a
   level as it stands, a close exactly on the level would be decided by which side of it that noise falls, not by the
   rule. So every comparison of a price with a level rounds both to 7 significant digits first (Joe, revision 3 of the
   plan). A float32 carries about 7.2 significant digits, so this recovers the price the exchange printed, and the
   written rule (strictly past, at or past, a touch) decides the tie.

   The four comparisons below are all made the setup's way: "past" is above for a long and below for a short;
   "against" is the other side. */

/** A price or level rounded to 7 significant digits. */
export const sig7 = (x: number): number => Number(x.toPrecision(7));

/** Strictly past the level, the setup's way: a breakout close, a re-entry close, a close past the boundary. */
export const past = (long: boolean, price: number, level: number): boolean =>
  long ? sig7(price) > sig7(level) : sig7(price) < sig7(level);

/** At or past the level, the setup's way: a target close; and the search for an imported setup's confirming close. */
export const atOrPast = (long: boolean, price: number, level: number): boolean =>
  long ? sig7(price) >= sig7(level) : sig7(price) <= sig7(level);

/** Strictly beyond the level against the setup: a touch of the negation or of the last full day. */
export const against = (long: boolean, price: number, level: number): boolean =>
  long ? sig7(price) < sig7(level) : sig7(price) > sig7(level);

/** At or beyond the level against the setup: a touch of the trigger from above (a pullback), a stop no tighter than the negation. */
export const atOrAgainst = (long: boolean, price: number, level: number): boolean =>
  long ? sig7(price) <= sig7(level) : sig7(price) >= sig7(level);
