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
