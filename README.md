# SwingTrader

Breakout watchlist and trading dashboard: classical chart-pattern setups from the
Tech Charts research service, tracked from "waiting" to "target" or "failed".

Live site: https://joeedessa.github.io/SwingTrader/

Standing rules for every session are in [CLAUDE.md](CLAUDE.md). The plan is
[docs/PLAN.md](docs/PLAN.md); the original brief is [docs/BRIEF.md](docs/BRIEF.md).

## Layout

```
public/data/   watchlist.json, benchmarks.json, tradelog.json   (the data, published)
               bars.json (daily [low, high, close, open], append-only), series.json (weekly/monthly closes: Signals only)
               prices-latest.json, watch-events.json            (refreshed by jobs)
scripts/       fetch_bars.py, fetch_latest.py, fetch_events.py, yahoo.py, quality.py
scripts/report/  weekly Tech Charts report sync (the report itself is never committed)
src/engine/    the rules: bars (settled/live), replay, last full day, types, sections, events,
               flags (19 rules), chips (a row's Flags column), today (what the Today page shows), tape,
               positions (the stop ladder), outcomes (History's tiles), journal (fill pairing), ma (averages, level
               tests, crosses), signals (what the Signals page reads, and the weekly/monthly phantom-bar rule), earnings
src/data/      loading (series.json only when Signals opens), the browser overlay (saved edits), acknowledgements,
               last visit, the journal's storage, the Worker live upgrade, the one-time copy of the old page's keys
src/ui/        the pages (Today, Setups and Benchmarks, Positions, History, Signals, Method, More), the board
               (columns, cells, table and cards), the drawer and its sections, forms, the journal, styles
tests/         Vitest: engine, data layer, UI wording, and parity with the old page (tests/parity, and the fixtures
               made by running its code: tests/fixtures/make-signals-old-page.mjs)
.github/workflows/  update-data (hourly), update-prices (15-minute loop), deploy (Pages)
```

## Commands

```bash
npm install
npm run dev       # local server at http://localhost:5173/SwingTrader/ (forwards price requests itself: no Worker needed)
npm test          # Vitest
npm run build     # type-check and build to dist/
python3 scripts/fetch_bars.py    # refresh bars.json and series.json
python3 scripts/fetch_latest.py  # refresh prices-latest.json
python3 scripts/fetch_events.py  # refresh watch-events.json
```

## Rules that hold everywhere

- No API keys, tokens or paid data. Yahoo Finance and TradingView's public endpoints only.
- Prices stay in each instrument's listing currency. Never convert.
- Settled daily closes drive the rules; intraday data is only for "live" flags.
- Tech Charts reports and PDFs are licensed and never enter the repo.

## Weekly report sync

Every week (around Saturday) the Tech Charts report `GLOBAL EQUITY MARKETS - <date> Part II.pdf` lands in
`~/Downloads`, sometimes with a screenshot of the "Ongoing breakout ideas" sheet (its LFDR column is the last
full day). The report and its PDFs are licensed: they are never committed; only the levels are, by Joe's decision.

1. **Diff the report.** Text it, then compare it with last week's list:

   ```bash
   swift scripts/report/pdftext.swift "$HOME/Downloads/GLOBAL EQUITY MARKETS - <date> Part II.pdf" > /tmp/report.txt
   python3 scripts/report/watchlist.py /tmp/report.txt
   ```

   `watchlist.py` prints the additions, changes and removals against `public/data/watchlist.json` and changes
   nothing. Apply them by hand.
2. **Read the breakout levels off the charts.** The negation and the last full day are only on the chart: render the
   page with `swift scripts/report/pdfpage.swift` and read them. A "CHECK THE CHART" line means the write-up may be
   stale or describe the wrong side.
3. **New rows** need a Yahoo symbol that resolves (Hong Kong drops leading zeros: `135` is `0135.HK`; share classes
   use a hyphen: `ROKO-B.ST`, `GIB-A.TO`). The data job fetches their bars on its next run; the page fetches them
   through the Worker until then.
4. **With each sheet:** compare its LFDR, negation and target with ours, and note whether the source ever changes an
   older B3's last full day (an open question since 25 Oct 2026); for every Failed row the sheet still lists as
   ongoing, append the sheet's date to `source_open`.
5. **Dropped setups** get `removed: <report date>` and a `removed_reason`. Never delete a row: the engine and the
   tests count on every row staying.
6. `npm test` (the live-file tests check every row), commit `public/data/watchlist.json`, `git pull --rebase origin main`
   (the data jobs commit every few minutes), push. The deploy is automatic.
