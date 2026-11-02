# Parity: the new engine against the old `watch.html`

The plan's D3 check. The old page (macro-compass `604ec2a7`) dumped its inputs and every row's outcome through `window.__parity()` on **2026-11-01 17:49Z**, a Sunday with every market shut and no browser overlay. That dump is frozen in `tests/parity/old-page-2026-11-01.json` with the watchlist as it was (`watchlist-2026-11-01.json`). The new engine runs on the frozen inputs and must reproduce every field.

## Result: zero engine differences

`npm test` → `tests/parity/parity.test.ts`: for all 148 rows, **section, type (with its pullback, breach and re-entry lists), last full day (level, source, anchor, bar, alt reading, breach), breakout, target and failure** are equal to the old page's, field by field. Section counts match: 31 watching, 18 confirmed, 11 re-entered, 6 stopped out, 15 at target, 30 failed, 37 removed.

The port is literal: `replay`, `lfdOf`, `typeOf`, the section split and the derived values were carried over statement by statement, with the page's own comments. Nothing was "improved" in Phase 2; the rules are Joe's and change only with him.

## Data differences (inputs, not rules)

`tests/parity/data.test.ts` compares the bars this repo fetched (`public/data/bars.json`, Yahoo chart, 2 years, OHLC) with the bars the old page fetched from the same endpoint.

| What | Finding | Verdict |
|---|---|---|
| Every bar, 106 of 109 symbols | Identical values on identical dates (53,823 bars). | Same data. |
| Australia (S32.AX, NWH.AX, REH.AX; ^AXJO in closes) | The old page keyed a bar by the **UTC date** of its timestamp. Sydney opens at 10:00, which is 23:00 UTC the evening before during daylight time (October to April), so every Australian bar in those months sits one day early on the old page. Values are identical on the shifted date. | Old-page bug. The new repo keys bars by the **exchange's own calendar date**. Consequence: on the new site an Australian event (breakout, exit, failure) in daylight-time months is dated one trading day later than the old page would date it, which is the true date. Levels and counts are unaffected. |
| Closes (`HIST.settled`, from Yahoo spark) vs chart closes | Equal within rounding: spark rounds (105.99 vs 105.989998 on COMI.CA; 0.697 vs 0.6975 on LIN.AX), the chart feed does not. | No difference beyond a tenth of a percent. The new engine replays on the chart closes, so a trigger set exactly at a rounded close could in principle read differently; no row on the list is affected. |
| ^OMXC25 (Denmark's index) | Spark gave closes on five US holidays that the chart feed omits. | Indices only feed the "vs index" column (Signals, Phase 6b); not an engine input. Left for Phase 6b. |
| COMI.CA tip | Yahoo's latest print for COMI.CA is dated July 2024. | Stale tip, ignored by `bars.ts` (a tip older than the last bar adds nothing). |
| Close outside low–high | JPY=X (33 bars), FSR.JO and ZN=F (one each): Yahoo's own OHLC. | Kept as received; listed in `tests/data.test.ts` so a new case fails the test. |

## What the engine now does differently by design

- **Settled/live split** (`src/engine/bars.ts`): the old page asked Yahoo for the session each load; the new site rebuilds it from the exchange's stored local hours and timezone (the pricefloor rule) for the moment the page is read. A tip is live only inside the session running now; a settled tip for a day not yet in `bars.json` is appended as that day's close (low and high arrive with the next bars run, so a negation touch on that day is tested on the close until then, as the old page did before its bars arrived). Verified in `tests/engine/bars.test.ts` against Tokyo open and shut, New York the day after the clocks went back, a weekend, the Gulf weekend, and the real files on the dump's Sunday (no symbol live).
- **Dates** are the exchange's own (above).
- **Events** (`src/engine/events.ts`) are data (`kind`, `when`, `cls`, `text`), with the old page's wording kept verbatim so the weekly log reads the same. Dividend flags and moving-average structure alerts are not ported here; they belong to the flag rules (Phase 5) and Signals (Phase 6b).

## Not covered by the frozen check

- Live-session behaviour on a real open market (the dump was taken with every market shut). The unit tests cover it with injected times; Phase 3's browser checks on a weekday are the first live confirmation.
- Overlay edits (per-browser level overrides, manual states): the dump had none. `manualStateOf` mirrors the old `workingList` rule and is unit-tested.

## Phase 3: the board and Benchmarks against the old page, live

Checked on 2026-11-01 (Sunday, every market shut) by loading the old page and the new app side by side in the browser and comparing, row by row, the section, type, pullback / breach / re-entry counts, last full day (level and source), and the breakout, target, failure and stop-hit dates. The old page fetched its own prices from Yahoo through the Worker; the new app read `bars.json` and `prices-latest.json` and then upgraded to live quotes.

| List | Sections | Rows identical in every field | Rows that differ |
|---|---|---|---|
| Watchlist (148) | **148 of 148 the same**; 31 / 18 / 11 / 6 / 15 / 30 / 37 on both | 143 | 5, all explained below |
| Benchmarks (23) | **23 of 23 the same**; 11 / 6 / 1 / 2 / 1 / 2 / 0 on both | 22 | 1, explained below |

**The six rows that differ, and why**

| Row | Difference | Cause |
|---|---|---|
| S32.AX, NWH.AX | failure date (and stop-hit date for NWH.AX) one trading day later | The old page dated a bar by the UTC date of its timestamp, so every Sydney bar in daylight time sat one day early, even on a Sunday. The new data is keyed by the exchange's own date. The new date is the true one. |
| JPY=X (benchmarks) | breakout and stop-hit date one day later | The same, for the FX series: the old page put Monday's bar on the Sunday. The new data has no weekend-dated FX bars. |
| CANHLIFE.NS (short), TCS.NS, ICLR | the new app shows a derived stop and a type; the old page showed none | These are removed rows. The old page fetched bars only for rows that were still live, so a removed row never had a stop or a type. The new app has bars for every symbol, so the drawer can say what happened before it was removed. The section is the same (Removed). |

**Why the price file keeps Yahoo's raw numbers.** Yahoo sends prices as 32-bit floats widened to doubles (`5.429999828338623` for a 5.43 close). The engine compares a close with a level exactly, so a close that equals a level is decided by which side of the level that noise falls on. The first version of `bars.json` rounded to six decimals; that made a close of 5.43 exactly equal to a trigger of 5.43, which the old page (with 5.4299998) did not treat as a cross. Result: four more rows differed (GLYHO.IS, PGEN, PACS, DAKT). A confirming day or a stop-touch day moved by one, which changed GLYHO.IS's derived stop (17 → 16.48), PGEN's derived stop (5.43 → 5.26) and breach count (5 → 3), and PACS's pullback count (3 → 4). The file keeps the raw values (+0.14 MB gzipped: 1.1 MB on the wire, 5.4 MB parsed); since revision 3 the engine rounds at the moment it compares, not in the file.

**Decided since (revision 3).** Ties are no longer left to float noise: see the next section.

**Not part of the comparison.** Live-session behaviour (every market was shut), and the closes the old page used for its replay (Yahoo's `spark` feed, which rounds low-priced assets: 0.697 for LIN.AX where the chart feed has 0.6975) against the chart closes the new app uses. No row on either list sits close enough to a level for that to matter today.

## Revision 3: prices compared at 7 significant digits (Joe, 1 Nov 2026)

**The rule now.** Every comparison of a price with a level rounds both to 7 significant digits first (`src/engine/precision.ts`), so a price exactly on a level follows the written rule whichever way Yahoo's float32 noise points: a breakout and a re-entry must close strictly past the trigger, a target counts at or past, a touch of the negation or the last full day must go strictly beyond it, a pullback starts on a low at or through the trigger, and the run past the boundary starts on a close strictly past it. "At or past" is used in one place only: the search for an imported setup's confirming close, because the stored trigger is often that close's exact price (KRO, 3107.T, UBER).

**What it changed, on 1 Nov 2026** (today's data and the frozen dump give the same list): **no row changes section or type**, and the counts stay 31 / 18 / 11 / 6 / 15 / 30 / 37 and 11 / 6 / 1 / 2 / 1 / 2 / 0. No benchmark changes at all. Fourteen watchlist rows change something, each because a price sits exactly on a level (checked bar by bar):

*Counts or stop changed*

| Row | Section, type | Change | The tie |
|---|---|---|---|
| PGEN long | At target, B3 | stop 5.43 → **5.26** (derived); pullbacks 0 → 1; exits 5 → 3; re-entries 5 → 3 | the close of 25-06-26 is the 5.52 trigger, so the confirming close is a day earlier and the stop is the low of 24-06-26 |
| PACS long | Re-entered, B3 | pullbacks 3 → 4 | the close of 01-07-26 is the 44.32 trigger; the confirming close is a day earlier and the low of 02-07-26 counts |
| GEI.TO long | At target, B2 | pullbacks 3 → 2 | the low of 18-08-26 is the 32.11 trigger: a touch, not a day entirely past it, so the first pullback runs on |
| TCELL.IS long | Failed, B4 | stop 105.5 → **103.8** (derived) | the close of 22-01-26 is the 112.1 trigger |
| GLYHO.IS long | Failed, B4 | stop 17 → **16.48** (derived); first hit 14-07 → 27-07-26 | the close of 17-06-26 is the 17.48 trigger |
| UBER short | Failed, B4 | stop none → **71.08** (derived, the high of 23-07-26); first hit 29-07-26 | the 65.94 trigger is the close of 24-07-26 exactly, which "at or past" now finds |

*A date only*

| Row | Section | Change |
|---|---|---|
| KRO long | Confirmed | the confirming close is now found: 24-04-26 (its close is the 7.12 trigger). The stop stays "none in report". |
| GXI.DE long | Re-entered | confirming close found (06-07-26, close 29.72 = trigger); the pullback is dated 07-07 (was 13-07) |
| CBK.DE long | Stopped out | confirming close found (14-07-26, close 39.03 = trigger); the pullback is dated 15-07 (was 20-07) |
| VLY long | Failed | confirming close 11-06 (was 12-06) |
| DTG.DE long | Failed | confirming close 27-07 (was 28-07) |
| WAWI.OL long | At target | second pullback 03-08 (was 04-08): that low is the 145.3 trigger |
| DAKT short | Failed | stop first hit 23-10 (was 22-10): the high of 22-10 is the 19.52 stop, not beyond it |
| 1038.HK long | Confirmed | the run past the boundary starts 21-10 (was 13-10): the close of 20-10 is the 67.15 boundary. Its "closed above its pattern boundary" event moves to 21-10; the stop is from the report and does not move. |

**How it is held.** `tests/parity/parity.test.ts` still holds the other 134 rows to the old page field by field; these fourteen are held to the values in `tests/parity/adjudicated-2026-11-01.json`, each with its reason, and the test fails if any of them moves to another section or type. `tests/engine/precision.test.ts` pins the rule itself with float32 values on either side of a level. The old macro-compass page keeps its old behaviour, so it will disagree with this site on these rows; it is separate now and not compared again.

## After Phase 5b: the weekly log against the old page's, and a stop taken from the wrong bar (2 Nov 2026)

**Conclusion.** On the morning of Mon 2 Nov the Today page's weekly log and the old page's "Setup events" list the same 25 events (2 this week, 23 last), in the same order. Two read differently, and the comparison found one real bug in this site's engine, now fixed.

| Event | Old page | This site | Why |
|---|---|---|---|
| REH.AX boundary, Mon 2 Nov | last full day low **17.38** | low **16.58** (before the fix: 16.87, from an August bar) | The rule is the low of the bar before the first close past the boundary: the Fri 30 Oct bar, 16.58. 17.38 is the low of the 2 Nov session itself (Yahoo stamps it Sunday 23:00 UTC), so the old page took the breakout day's own bar. That is the Australian date keying explained above for S32.AX and NWH.AX. |
| NCX.V failure, Fri 30 Oct | "touched 2.8 vs negation 2.85" | "closed 2.8 vs negation 2.85" | The day closed at its low (low = close = 2.8). The old page compared a rounded close with a raw bar low, which differ by float noise, so it read as a touch. Here both are the same raw number, so it reads as a close. Same failure, same date, same level. |

**The bug.** For a setup that breaks out on the newest session, the close comes from the tip (the data job's latest print, or a live quote) and its bar is not on file until the next hourly run. The last-full-day derivation looked for the confirming close among the bars, did not find it, and fell back to the search made for setups imported already confirmed: the latest cross of the boundary before the row was listed. For REH.AX that was 12 Aug 2026, so the stop was 16.87 (the low of 11 Aug) and was "hit" on 5 Oct, before the breakout. It lasted until the day's bar arrived, up to an hour after each close, and would have fed false stops into the flags.

**The fix** (`src/engine/lfd.ts`). Settled closes newer than the newest bar join the series as close-only days. The confirming close then has a place, the run past the boundary is walked back through the real bars as usual, and the stop is read from the bar before the anchor. A close-only day is never taken as a full day: if the day before the anchor is itself close-only there is no stop yet, and no touch of a stop is looked for in a close-only day. Five new tests in `tests/engine/lfd.test.ts` fail on the old code and pass on the new.

**What it changed.** One row on the 2 Nov data: REH.AX (stop 16.87 → 16.58, anchor 12 Aug → 2 Nov, no "hit"; section and type unchanged). The 148 rows of the frozen 1 Nov capture are unchanged: `tests/parity/parity.test.ts` still passes with no new adjudication.

## After Phase 6: the journal and the moving averages against the old site's (2 Nov 2026)

**Conclusion.** The journal's order, pairing and summary, and the daily 150/200 read, agree with the old site's own code to the last digit on fixtures. Six small differences are by design.

**How it was checked.** The old functions were run, not re-read: `logRows`, `pairFills` and the summary expression were cut out of macro-compass's `watch.html` by line range (a check that each is where it should be, and a sha256 of the cut text, are in the fixture), and the whole of `ma.js` was loaded with a stub `window`. They were run over twelve synthetic shared fills plus an overlay (one deleted, one edited, two added; a short opened by a sell; two fills on one day; a duration of 0 months) and over the closes of the frozen 1 Nov capture for seven symbols, five periods each. What they answered is frozen in `tests/fixtures/journal-old-page.json` and `tests/fixtures/ma-old-page.json`; `tests/engine/journal.test.ts` and `tests/engine/ma.test.ts` hold the new code to it. Nothing reads the old site at test time, and macro-compass was not touched.

| Checked | Result |
|---|---|
| Fill order (day traded, then the moment logged; edits and deletes applied) | same |
| FIFO pairing, long and short, open fills | same |
| P&L, days held, pattern, duration, market carried onto a trade | same, to the last digit |
| Summary sentence | same, but for the minus sign |
| `read`, `slope`, `smaSeries` at 5, 21, 50, 150 and 200 | same, to the last digit, for all seven symbols |

A one-off fuzz run went further than the fixture: two thousand seeded random journals of up to thirty fills (eight symbols, both sides, random days and logged times, some deleted or edited, some added locally) went through the old `logRows` and `pairFills` and through the new code, and the fill order, the open positions and every closed trade (entry, exit, P&L, days, pattern, duration, market) were identical in all of them. The same was done for the moving averages: fifteen hundred seeded random walks of 20 to 400 closes, four volatilities, a drift each way and the odd zero print, read at 5, 21, 50, 150 and 200, gave identical `read`, `slope` and `smaSeries` in all 7,500 comparisons, with every level-test state reached. Neither run is a test in the repo, since each needs the old site's source to exist.

**Differences, by design.**

1. The summary writes a real minus ("avg loss −2.0%", the old page "-2.0%"), like every other number here.
2. A fill with no `logged_at` sorts first among its day's fills here, and last on the old page, because the old sort key concatenated the missing value in as the text "undefined". It cannot happen to a fill either page wrote: both always record `logged_at`.
3. Open positions are listed by symbol in the order each was first traded. The old page kept them in an object, which lists an integer-like key first; no symbol on the lists is one.
4. A fill added here and later published (an export committed as `tradelog.json`) is listed once, as the shared copy; the old page listed it twice, because it never looked for a fill in both lists.
5. A fill whose price was typed by hand keeps it when its date is edited. The old form re-derived the price from the new date, which its own table ("the date no longer sets it") says it does not.
6. A new fill's date starts as the date on the person's own clock; the old page started it at the UTC date. The price for a symbol that is not on a list is read from Yahoo's chart endpoint (two years of daily bars) rather than the old page's spark call; both give the settled close on or before the date.

**The stop ladder against the Confirmed section.** The plan's check, "stop ladder order matches today's Confirmed sort", holds for every Confirmed row that has a tight stop, on the frozen capture and on the live files, whatever the count (`tests/engine/positions.test.ts`): the ladder is sorted by the same give-back to the stop, with the same tie order. It does not hold for a row that has only a negation: the Confirmed section puts such rows last (it has no tight-stop distance to sort by), and the ladder places them by their distance to the negation, since that is the stop they actually have. The same goes for Re-entered rows against their section.

