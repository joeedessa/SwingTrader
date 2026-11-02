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

**Conclusion.** The journal's order, pairing and summary, and the daily 150/200 read, agree with the old site's own code to the last digit on fixtures. Seven small differences are by design.

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
6. An open position in a symbol that is on neither list shows its latest settled close (fetched once, with its currency) under Now and in Unrealised. The old page showed one only in the session in which a fill for that symbol had been logged, and a dash after any reload.
7. A new fill's date starts as the date on the person's own clock; the old page started it at the UTC date. The price for a symbol that is not on a list is read from Yahoo's chart endpoint (two years of daily bars) rather than the old page's spark call; both give the settled close on or before the date.

**The stop ladder against the Confirmed section.** The plan's check, "stop ladder order matches today's Confirmed sort", holds for every Confirmed row that has a tight stop, on the frozen capture and on the live files, whatever the count (`tests/engine/positions.test.ts`): the ladder is sorted by the same give-back to the stop, with the same tie order. It does not hold for a row that has only a negation: the Confirmed section puts such rows last (it has no tight-stop distance to sort by), and the ladder places them by their distance to the negation, since that is the stop they actually have. The same goes for Re-entered rows against their section.

## After Phase 6b: the Signals page against the old site's code (2 Nov 2026)

**Conclusion.** The weekly and monthly reads, the exponential averages, the five-tier crosses, the structure alerts and the day against the index and sector agree with the old site's own code to the last digit, on twelve symbols and three timeframes. One difference is not by design but a fault in the old site, now corrected here: the test that drops Yahoo's padded bar fails for every exchange ahead of UTC, so the old weekly and monthly averages for about half the universe count the period in progress twice.

**How it was checked.** The old code was run, not re-read. `tests/fixtures/make-signals-old-page.mjs` loads macro-compass's `ma.js` (sha256 `b20dc2ec…`, the same file as the Phase 6 fixture) with a stub window, cuts the structure alert block (`watch.html` lines 2822-2855), `maReadFor` (1198-1239) and `smaSeries` (1152-1161), and the day-against-index block (3374-3384, with `INDEX_MAP`, `median`, `dayPctOf` and `pct1`) out of `watch.html` by their first and last line, checks each cut and records its line range and sha256 in the fixture, and runs all of it on:

- the daily closes of the frozen 1 Nov capture (the old page's own `HIST`), and
- the weekly and monthly closes of `series.json` as written 1 Nov 17:03 UTC (`git show 19eb821:public/data/series.json`), the same day as the capture.

The symbols were chosen by a greedy search for coverage, not by hand: 0135.HK, FSS, DVN, ^FCHI, GIB-A.TO, THYAO.IS, UNM, SAB.MC, 3401.T, 7956.T, CBK.DE and 0002.HK reach all four level tests on every timeframe, seven slope states on every timeframe, and bullish and bearish crosses, held and whipsawed, on every tier (81 distinct outcomes; the test asserts the coverage so a thinner sample would fail it). The structure block was run on sixteen constructed setups, each a real symbol's closes with some trailing bars cut off so that a change of sides falls inside the window: twelve that between them reach every timeframe, reclaimed and lost, the 150 and the 200, long and short, in every section; one more listing a symbol both long and short; and three each carrying one change a bar too old to be fresh, which the old code leaves out and a wider window would not.

| Checked | Result |
|---|---|
| `read` (where the close sits, level test, last change of sides) at every period of every timeframe | same, to the last digit |
| `slope` at every period of every timeframe | same |
| `emaSeries` at 5 and 21 | same |
| `crosses` on all three timeframes: tiers, direction, bars ago, whipsaw mark, order | same |
| Structure alerts: which changes are fresh, their order (timeframe, then 200 before 150, then in trade before waiting), whether each helps the setup | same, 16 events |
| Day against the index and against the sector's median (a sector of three, a missing index, no day move, the UAE) | same |
| The index map | same, entry for entry; `scripts/fetch_bars.py` holds it too and a test keeps the two equal |

A one-off fuzz went further than the fixture: 90,526 answers (the read and the slope at eleven periods, both exponential averages, the crosses at three look-back windows) on 159 symbols, three timeframes and ten truncations of each series (23,864 crosses found), and the structure block on 3,180 setups in ten passes (158 events), all equal to the old code's. It ran as a throwaway test and is not kept.

**The fault in the old site.** Yahoo pads every weekly and monthly series with one more bar, stamped at the last trade and repeating the period in progress. The old site drops it when the UTC week (or month) of its stamp is the one the bar before it fell in. A genuine bar sits on its period's start in the exchange's own time, which for an exchange ahead of UTC is the Sunday (or the last day of the month) before in UTC, so the two keys differ and the padded bar stays in. On the stored series of 1 Nov the old test left it in for **93 of 176 weekly and 100 of 178 monthly series**: every symbol listed in Japan, Hong Kong, Singapore, India, Australia, Turkey, the Gulf, South Africa and continental Europe, and 13 of the 25 indices (London's monthly bars too, and its weekly ones in summer time). New York and Toronto were right. The effect is always toward the latest price: on those series the old 10-week average sat a median 0.7% (at most 6.6%) away from the right one, the 30- and 40-week about 0.3%, the monthly 10, 12 and 20 a median 1.2 to 1.5% (at most 5.6%); 14 of the averages were on the other side of the price, and 3 to 22 level tests per average read differently.

Signals tests whether the last bar falls inside the period the bar before it opened, measured from that bar's own stamp (a week, or the days of its month, with an hour allowed for the clocks changing), so no time zone is needed. A bar that opens a new period is never inside the last one, so a genuine last bar is kept, and so is a padded bar that is the only one for a month whose own bar is not written yet. On the stored series it drops the padded bar from 174 of 176 weekly and 173 of 178 monthly series; the rest have a single bar, carry no padded bar, or (OBX.OL's monthly, which Yahoo has with a gap of three and a half years) a padded bar after a gap the rule cannot tell from a new period. `tests/engine/signals.test.ts` holds it to real tails (New York, Tokyo, Frankfurt as the clocks change, Sydney, Hong Kong), shows what the old test did to each, and to the whole history of fourteen real series (`tests/fixtures/series-stamps.json`: the rule must keep every earlier pair of bars, about 6,900 of them, across clock changes in both hemispheres). Run once over all 354 stored series (about 86,000 pairs) it keeps every genuine bar. Two limits, neither reached by an equity list: a padded bar stamped in the last hour of a week or month (a market that trades round the clock) is kept, and a zone beyond UTC+14 would name its month wrong.

**Checked live, the same afternoon (Mon 2 Nov, 17:04 UTC).** With the old page open, its own `MA.load` was asked for the weekly and monthly bars of sixteen US and Canadian symbols, and what it holds was compared with what this site reads:

- *The closes.* For AME, FSS, DVN, UNM, ICLR, GIB-A.TO, KRO and BYD (16 series): 13 are the same bar for bar (within a basis point on every bar: spark rounds a little differently from the chart feed), once the old page's last bar, the week or month that began after `series.json` was written, is set aside. The averages read on them agree to seven digits, with the same distance and the same level test. Three weekly series (DVN, KRO, GIB-A.TO) differ by one week that the old feed (Yahoo's spark) leaves out and the chart feed has, which moves only the averages whose window spans it: DVN's 200-week reads +19.9% here and +19.8% there, KRO's −11.9% and −12.0%; the shorter averages are equal.
- *What each page shows.* For 12 symbols in play on both lists (AME, BYD, FSS, UNM, LB, NGVT, FCX, BLBD, FAST, STLD, ULTA, PEB) on the three timeframes (36 sets of averages): 33 are identical in side, distance to a tenth, level test and slope arrow for every period. The other three (FAST, LB and PEB, the daily 200) differ in one thing: the old page shows no slope arrow, because its one year of daily closes is 248 or 249 and the slope of a 200 needs 250, where this site has two years of bars.

**Differences, by design.**

1. **The week and the month in progress end at the latest settled close.** The old page asked Yahoo for weekly and monthly bars when a toggle was pressed, so its last bar was the period in progress at that moment, mid-session included. Here the data job writes `series.json` about once a day (GitHub's schedule makes that irregular), and Signals closes the file's last genuine bar at the last settled daily close inside its period, and adds any period the file has not caught up with (a new week or month since the job ran) from the daily closes, one bar per period that has a close. Every figure on the page therefore ends at the latest settled close, as the rules do, and is as current as the daily bars. The daily closes are the chart feed's raw values where the file's are rounded to six decimals; the same close, as the bar's own. A date is put in its period by reading its local midnight as 10:00 UTC, which lands inside the right week or month for every zone from UTC-10 to UTC+13 without knowing the exchange's zone (`tests/engine/signals.test.ts` holds it to New York, Tokyo, Sydney in summer time and Egypt's Sunday trading).
2. **The scan's groups.** The old page's "Breakouts" was the Confirmed section only; Signals' "In trade" is Confirmed and Re-entered, the same set as the stop ladder, since a B3 that is back in has money in it. "Watching" and "All in play" are the old "Watchlist" and "All".
3. **Level changes: the age, the window and the near-the-line rule.** The same changes are listed as on the old page, in the same order. Their age is counted from the bar they happened on (0 is the latest bar, "on the latest close"), where the old page's `crossedAgo` counted from the last bar on the other side, so it said 1 for the latest bar and never 0 (its comment took 0 for the latest bar, so "1 bar ago" on its alerts meant "just now"). The window is the old page's, in the same effect: a weekly or monthly change must be on the latest bar and a daily one on the latest two sessions, which is narrower than its comments suggest ("the latest bar or the one before"). A change is listed only while the level test calls it reclaimed or lost, as on the old page: a close that jumps from far under an average to far over it is a cross (the scan lists it under price × 200) but not a level change.
4. **Words.** A change of sides shows the timeframe's own last close against its average, where the old line compared the last daily close with a weekly or monthly average, and says how long ago in the timeframe's own unit.
5. **The sector's median counts names.** A name listed both long and short is one stock and counts once; the old page counted setups, so it counted such a name twice (six sectors on 2 Nov have one). The change moves 33 of 133 "vs sector" figures by a tenth of a point or more. Nothing in the fixture has a name twice, so the parity check is unchanged.
6. **Index quotes.** The live upgrade also asks for the local index of each country on the list, as the old page did (all 22 are on the benchmarks list already, so today it asks for nothing more), so a name's day and its index's day are from the same moment. The old page's ^OMXC25 closes included five US holidays that the chart feed omits; the daily bars here are the chart feed's.
7. **What is left out.** Failed and removed setups are not on Signals (the old page's alerts and scan also skipped them, but its average columns were on every row).
8. **Narrow windows.** Below 1,100 px the averages are cards, as on a phone: ten columns need about 1,030 px, and the old page's table scrolled sideways in a narrower window.

