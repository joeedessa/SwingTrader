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

**Why the price file keeps Yahoo's raw numbers.** Yahoo sends prices as 32-bit floats widened to doubles (`5.429999828338623` for a 5.43 close). The engine compares a close with a level exactly, so a close that equals a level is decided by which side of the level that noise falls on. The first version of `bars.json` rounded to six decimals; that made a close of 5.43 exactly equal to a trigger of 5.43, which the old page (with 5.4299998) did not treat as a cross. Result: four more rows differed (GLYHO.IS, PGEN, PACS, DAKT). A confirming day or a stop-touch day moved by one, which changed GLYHO.IS's derived stop (17 → 16.48), PGEN's derived stop (5.43 → 5.26) and breach count (5 → 3), and PACS's pullback count (3 → 4). The file now keeps the raw values (+0.14 MB gzipped: 1.1 MB on the wire, 5.4 MB parsed), so the engine decides every tie exactly as the old page does.

**A question for Joe, not a defect.** A close exactly on a level is rare but real (levels are round numbers), and today it is settled by float noise in both pages. The rules say a breakout is "strictly past" the trigger, while the code that finds the confirming close for a source-confirmed row (`crossBefore`) uses "at or past". Rounding prices to seven significant digits would make ties follow the rule you wrote, at the cost of moving derived stops on a handful of rows. That is a change to the engine's behaviour, so it waits for you.

**Not part of the comparison.** Live-session behaviour (every market was shut), and the closes the old page used for its replay (Yahoo's `spark` feed, which rounds low-priced assets: 0.697 for LIN.AX where the chart feed has 0.6975) against the chart closes the new app uses. No row on either list sits close enough to a level for that to matter today.
