# SwingTrader — standing instructions for every session

Joe's breakout watchlist and trading dashboard: classical chart-pattern setups from the Tech Charts research service (Aksel Kibar), tracked from "waiting" to "target" or "failed". It started as a page in the `macro-compass` repo (`~/Macro Compass`, `docs/watch.html`); that page stays live and separate. **The plan is `docs/PLAN.md`**, approved 1 Nov 2026 (revision 3 the same day); the original brief is `docs/BRIEF.md`.

## How Joe works

- **Lead with the conclusion,** detail underneath. Short, plain answers. Use tables for comparisons.
- **Verify before claiming.** Recompute from raw data, and check in the browser console, not by grepping HTML. Show the evidence.
- **Ask before anything outward-facing:** creating the GitHub repo, enabling Pages, pushing for the first time, changing the Cloudflare Worker.

## Hard constraints

- Free: **no API keys, tokens or paid data, ever.** Static site on GitHub Pages; no server; no secrets.
- **Prices stay in each instrument's listing currency. Never convert.** State units wherever they aren't obvious.
- **Settled daily closes drive the rules;** intraday data is only for "live" flags.
- Desktop and phone are equally first-class, in light and dark mode, Apple-grade design.
- **Nothing hard-codes how many setups there are.** The lists change every week: names are added, and a dropped one is marked `removed`, never deleted. Code, page text and tests derive every count from the data. A test on the live files asserts what is true of every row, whatever the count; a test on a frozen capture reads its counts from that capture.
- Tech Charts' reports and PDFs are licensed: **never commit them.** The levels in `watchlist.json` are published by Joe's decision.
- **Never edit the macro-compass repo from here.** It stays live and separate, and it does not read this repo's data.

## Trading rules (the engine — do not change without Joe)

- **Comparisons:** prices and levels are rounded to 7 significant digits before every level comparison (Yahoo's prices carry float32 noise). "At or past" is used only to find an imported setup's confirming close, whose stored trigger is often that close's exact price.
- **Breakout:** the first settled close strictly past the trigger (`breakthrough`). A row with `confirmed` starts in breakout state on that date.
- **Negation is an intraday touch** (low below it for a long, high above it for a short), tested only after the breakout. **Failed (B4) is final: no re-entries after a failure.**
- **Target:** a settled close at or past it, or a `reached` date (the source counted it). Whether a touch should count is undecided (Q2).
- **Last full day (LFD), the tight stop:**
  - a source `lfd` value wins; `lfd: 0` means none published;
  - otherwise derive it: the low (long) or high (short) of the bar before the first close strictly past the boundary, in the run that carries into the confirmation;
  - with no boundary, use the bar before the trigger close;
  - a derived stop beyond the negation means no stop.
- **Types, tracked day by day: B1 → B2 → B3,** frozen at target.
  - **B1:** no pullback through the trigger yet.
  - **B2:** pulled back through the trigger, LFD intact. Count the pullbacks: one starts on a touch of the trigger and ends on the first day trading entirely past it.
  - **B3:** a touch of the LFD is an exit (a breach). A settled close back past the trigger is a re-entry, with the **original LFD** as the stop (Joe's rule for now). Count the breaches.
- **Sections:** Watching, Confirmed (B1/B2), Re-entered (B3, in), Stopped out (B3, out), At target, Failed, Removed (`removed` + `removed_reason`).

## Weekly report sync (here only, from the next report on)

Every week (around Saturday) Joe drops `GLOBAL EQUITY MARKETS - <date> Part II.pdf` in `~/Downloads`, sometimes with a screenshot of the "Ongoing breakout ideas" sheet. The LFDR column on that sheet is the last full day.

1. **Diff the report** with `scripts/report/` (text with `pdftext.swift`, then `watchlist.py` against last week's) and apply the additions, changes and removals.
2. **Read breakout levels off the charts.** The negation and last full day are only on the chart, so render the page with `pdfpage.swift` and read them.
   - A "CHECK THE CHART" line means the write-up may be stale or describe the wrong side (OM, 31 Oct, was a breakdown).
3. **New rows** need a Yahoo symbol that resolves. Hong Kong drops leading zeros (`135` is `0135.HK`); share classes use a hyphen (`ROKO-B.ST`, `GIB-A.TO`).
4. **With each sheet:**
   - compare its LFDR, negation and target with ours, and **report whether Tech Charts ever changes an older B3's LFD** (open monitoring task since 25 Oct; no change on 24 Oct or 31 Oct);
   - for every Failed name the sheet still lists as ongoing, **append the sheet date to `source_open`**.
5. **Dropped setups** get `removed: <report date>` plus a reason. Never delete them.

## Phases and models (switch manually: one session per phase)

**All phases are done (Phase 9 on 4 Nov 2026).** The table stays as the record of what ran where; from here on, say what to change and `docs/PLAN.md`'s Progress is the history.

Claude Code does not change models by itself. For each phase: set the model in the app's model picker, open a session in this folder, and say **"Do Phase N of docs/PLAN.md"**. Finish with the phase's acceptance checks and a short report, then stop for Joe's sign-off.

| Phase | Work | Model |
|---|---|---|
| 1 | Scaffold + data pipeline (needs `brew install node` first) | Haiku 4.5 |
| 2 | Engine port + tests + parity | Fable 5.1 |
| 3 | Setups board + Benchmarks at parity | Sonnet 5.5 |
| 5a | Flags engine + tests | Opus 5.5 |
| 5b | Today page | Sonnet 5.5 |
| 6 | Positions, History, Method | Sonnet 5.5 |
| 6b | Signals page (MAs, cross scan, vs index/sector) | Sonnet 5.5 |
| 7 | Backtest engine (answer Q1 first) | Fable 5.1 |
| 8 | Model page UI | Sonnet 5.5 |
| 9 | Polish | Haiku 4.5 / Sonnet 5.5 |

Keep `docs/PLAN.md` current: mark phases done and record answers to the open questions as they come.
