# Plan: standalone Watchlist dashboard (new repo), with migration, redesign and backtest

*Written by Fable 5.1 (planning agent), 1 Nov 2026. **Approved 1 Nov 2026, revision 2 after review** (changes listed in "Revision 2" at the end).*

**Summary**
1. **What:** a new repo (`joeedessa/SwingTrader`: Vite + TypeScript + Vitest, on GitHub Pages) holds its own copy of five things from macro-compass: the watchlist, the benchmarks, the trade log, the weekly report sync and the two data jobs. The engine becomes pure, tested modules. The macro-compass page stays live and separate: it does not read this repo's data, and this repo never edits macro-compass (revision 3).
2. **Pages:** 8 routes in one single-page app (hash routes): Today, Setups, Positions, History, Model, Signals, Benchmarks, Method. Today is the landing page and the flag inbox. Repo **`joeedessa/SwingTrader`**, local folder `~/Desktop/ClaudeProjects/SwingTrader`, live at `https://joeedessa.github.io/SwingTrader/`.
3. **Flags:** three tiers (Act / Watch / Info) and 19 flag rules. Every settled engine event becomes a flag by construction. Acknowledgements are kept per browser, flags auto-expire after 5 sessions, and the Today tab carries a badge.
4. **Backtest:** runs in the browser on an append-only daily price snapshot (`bars.json`) that the new repo's CI writes. It covers 5 strategies you could actually have followed, × re-entry depth × 4 sizing schemes. Results are in % and R-multiples; money appears only as an overlay in one account currency, with FX held constant.
5. **Phases:** phase 0 (this plan) plus execution phases 1–3 and 5–9 (Phase 4, the cut-over, was dropped in revision 3; Phase 5 is split into 5a and 5b). Models:

   | Model | Phases | What |
   |---|---|---|
   | Fable 5.1 | 2, 7 | engine port, backtest semantics |
   | Opus 5.5 | 5a | flag rules, rounding decision |
   | Sonnet 5.5 | 3, 5b, 6, 6b, 8 | UI |
   | Haiku 4.5 | 1, 9 | scaffold, docs |

**Grounding facts** used throughout (measured from the data on 1 Nov 2026, not estimated; the lists change every week, so no page, test or script types any of these numbers in, and everything a page prints is counted from the data of the day):
- **Setups:** 148 in total. **82 have broken out** by the engine's own rule, replayed over the committed closes: 48 imported via `confirmed`, 34 found by the replay; 72 long, 10 short; 2 removed after breaking out.
- **Outcomes on a close basis:** 39 open, 27 failed, 16 at target. 25 of the 82 broke out in Aug 2026.
- **Currencies:** 11 listing currencies (USD 28, EUR 15, CAD 12, JPY 10, TRY 5, INR 4, AUD 2, HKD 2, NOK 2, GBp 1, SEK 1).
- **Stops:** 34 of the 82 have no `lfd` field (derived stop), and 4 have `lfd: 0` (no tight stop possible).
- **Gaps:** 4 symbols have no history in `prices.json` (BSM, PNDORA.CO, FLS.CO, H78.SI). The earliest bar in the snapshot is 2025-10-29; the earliest `created` is 2026-01-24.

---

## A. Product design

### A1. Page architecture and why

The current page answers seven different questions on one scroll: brief, calendar, 7 segments, log, scan, earnings. Your three asks are lead with the conclusion, miss nothing, stop hunting. They map onto a split by *question*, not by data:

| Route | Question it answers | Replaces in `watch.html` |
|---|---|---|
| `#/today` (default) | What needs a decision this morning, and what changed since I last looked? | `#brief` (gauge, setup events, dividend flags), calendar, live flags inside `renderAlerts()` |
| `#/setups` | Where does every setup stand? (the board) | the 7 segments, `buildTable()`, filters, ⋯ menus |
| `#/positions` | Am I still right, and where do I get out? | Confirmed + Re-entered + Stopped out read as a stop ladder; `stopFor()` trailing stop; ex-div/earnings |
| `#/history` | What happened, and what does my record look like? | At target, Failed, Removed, trade log (`renderLog()`), outcome stats |
| `#/model` | What should I play, and how much per trade? | new |
| `#/signals` | Which setups are changing structure on their moving averages? | weekly/monthly MA columns, the cross scan (`renderScan()`), and vs index / vs sector (Q9: kept, on their own page) |
| `#/benchmarks` | The same board on `benchmarks.json` | `watch.html?set=benchmarks` (`SETS`) |
| `#/method` | What are the rules, where does the data come from, how fresh is it? | footer prose, README "Watchlist conventions", tooltips |

**Navigation:**
- **Desktop:** a top segmented tab bar (Today · Setups · Positions · History · Model), with Benchmarks and Method under a trailing "More".
- **Phone:** an iOS bottom tab bar with the same five, padded for the safe area.
- **Badge:** the Today tab shows the number of unacknowledged Act + Watch flags.

**Why one app rather than separate pages:** a board load is about 50 proxied requests (batches of 10, plus one daily-bar call per exposed symbol). Refetching that on every tab change would make the phone slow again. Hash routes avoid GitHub Pages' lack of an SPA fallback. `#/benchmarks` keeps the old `?set=` behaviour as a route.

**Moved to their own page, `#/signals`** (Q9): weekly/monthly MA columns, the cross scan panel, and the vs index / vs sector columns. They're context, not the entry/exit decision. They're the reason the table once put the levels twenty columns to the right, so they leave the board but stay one tab away. The page has:
- an MA ladder per setup (daily 5/21/50/150/200, weekly 10/30/40/200, monthly 10/12/20), with the slope arrows from `ma.js`;
- the cross scan (bullish and bearish, earliest to slowest);
- the day's move vs the local index and vs the sector median.

The daily 150/200 read and the earnings/news card also stay inside the per-setup Details drawer.

### A2. The flagging system

**Principle:** every settled event the engine already produces becomes a flag object, `{id, tier, kind, sym, dir, when|'live', text, route}` with `id = sym|dir|kind|when`. Those events are breakout, target, failed, boundary close, pullback N, exit N and re-entry N. The engine rebuilds them from bars on every load, so the list is complete by construction: "nothing missed" is a property of the data, not of a notification queue. New rules are added for proximity and calendar.

| Tier | Flag kind | Rule (settled unless marked live) | Surfaces | Clears |
|---|---|---|---|---|
| Act | `breakout` | first settled close strictly past the trigger | Today top, Setups row chip | ack |
| Act | `reentry` | settled close back past the trigger while out | Today, Positions | ack |
| Act | `exit` | touch of the last full day | Today, Positions | ack |
| Act | `failed` | negation touched (B4) | Today, History | ack |
| Act | `target` | settled close at/past target, or `reached` | Today, History | ack |
| Act | `live-negation` | live price beyond the negation, in trade | Today "Live" strip, Positions | itself, when the condition ends or the day settles into `failed` |
| Act | `live-stop` | live price beyond the last full day, in trade | same | itself |
| Act | `exdiv-2d` | long in trade, ex-date ≤ 2 days, dividend ≥ 0.25 ATR (tightened from the 7-day rule) | Today, Positions | itself at the ex-date |
| Watch | `live-trigger` | watching row trading past its trigger | Today Live strip, Setups | itself |
| Watch | `near-trigger` | watching row, last close within 1.0 ATR of the trigger | Today, Setups | itself |
| Watch | `near-stop` | in trade, last close within 1.0 ATR of the last full day (or the negation where there's none) | Today, Positions ladder | itself |
| Watch | `pullback` | B2 pullback N started | Today, Setups | ack |
| Watch | `boundary` | closed past the boundary, stop recorded, not confirmed | Today, Setups | ack |
| Watch | `late-entry` | confirmed row still B1 with ≥ 50% of the trigger→target move used | Setups chip only | itself |
| Watch | `earnings-7d` | earnings within 7 days on an in-trade or near-trigger row | Today, Positions | itself |
| Watch | `exdiv-7d` | existing dividend rule, days 3–7 | Today, Positions | itself |
| Watch | `source-kept` | Failed row with `source_open.length ≥ 2` | History chip | itself |
| Info | `removed` | `removed` date present | Setups/History chip | ack |
| Info | `data` | no history / no bars / snapshot in use / tip older than 6h / symbol missing from events | Today footer line, Method | itself |

**Acknowledgement and no nagging:**
- **Ack** is a tap on the flag, or "Acknowledge all" per tier. The flag's id goes into a localStorage set with a timestamp.
- **Acked flags** move into a collapsed "Acknowledged" group for the rest of the day, then leave Today.
- **Settled flags never acked** drop off Today after 5 trading sessions, but stay in the per-setup timeline and on the History page.
- **Live flags** never need an ack: they're conditions, not events.
- **"Since your last visit":** Today draws a divider from a last-visit timestamp, so a skipped morning is visible.
- **Limitation:** ack state is per browser, so phone and desktop each ack separately. No server is permitted, so the only cross-device help is the last-visit divider. Export/Import carries the ack set.

### A3. Today page sections, in order
1. **Tape line:** the existing breadth gauge, as one sentence.
2. **Live now:** live flags (Act, then Watch), only during a session. When empty: "No live flags; markets shut".
3. **Needs a decision:** unacked Act flags, newest first. Each shows the one number that matters (level vs price) and an "Open" link to the row's drawer.
4. **Worth a look:** unacked Watch flags.
5. **Next 7 days:** earnings and ex-dividend dates on in-trade and near-trigger names only. This is the calendar, cut to what can hurt a position.
6. **This week / Last week:** the existing weekly log, folded, same rules as now.
7. **Data line:** which source served prices (Worker or snapshot), how old the latest price is, and symbols without history.

**As built (Phase 5b, revision 4).** One tier at a time, because about 48 flags at once was too much:
- **Header:** the day and what is waiting ("8 to decide · 40 to look at"), then the tape line.
- **Live now:** a strip of its own for the live flags, or "No live flags; markets shut".
- **Tiers:** a switch between *Needs a decision* (Act) and *Worth a look* (Watch), each with its count and a dot when something in it is new. It opens on Act, or on Watch when Act is empty.
- **Groups:** each tier's flags are grouped by kind, most pressing first. A group of three or fewer opens by itself; a longer one shows its first names and opens on a tap. Each group, and each tier, has an Acknowledge.
- **Next 7 days:** earnings and ex-dividend flags are groups inside Watch (soonest first), not a section of their own, so the tier count, the lists and the badge add up.
- **Folded at the foot:** Acknowledged today, the weekly log (This week / Last week, every event), then the data line.

### A4. Setups page: what replaces column-hunting
- **Sections:** a segmented control with counts, one section at a time as now, remembered per browser.
- **Columns:** cut to the decision. Everything else lives in a Details drawer: a right-hand panel on desktop, a full-height sheet on the phone, opened by tapping the row.
- **Width target:** every section fits a 1,100 px screen without horizontal scrolling, so the custom top scroller and the frozen-header workaround aren't needed.

| Section | Columns kept (sub-line in brackets) | Moved to drawer |
|---|---|---|
| Watching | Symbol+Dir, Live (day %), Trigger (to trigger % and money), Target (payoff %), R:R at trigger, Tight stop, Flags | pattern, boundary, earnings, ex-div, market, ccy, added |
| Confirmed | Symbol, Live, Trigger (run-up %, move used %), Target (to go %), Type (pullbacks), Tight stop (−%), Negation (−%), Flags | trailing stop, broke-out date, boundary, calendar, market |
| Re-entered | Symbol, Live, Trigger, Status (re-entered date @ price · stop −%), Breaches, Target, Flags | rest |
| Stopped out | Symbol, Live, Trigger (% to re-entry), Breaches (last exit date), Negation, Flags | rest |
| At target | Symbol, Live, Reached (per source tag), Type, Target, Since target % (new) | rest |
| Failed | Symbol, Live, Failed, Negation, Reason, Still listed by source | rest |
| Removed | Symbol, Live, Trigger, Removed (date · reason) | rest |

- **Flags column:** up to three small chips (red dot for Act, amber dot for Watch, a calendar glyph). The row says why it's interesting without a tooltip.
- **Drawer contents:**
  - every level, with the explanation of how the last full day was derived (today that's a tooltip);
  - the setup's own event timeline (every flag it has ever raised);
  - the earnings/news card and the daily 150/200 read;
  - the row actions: Edit levels, Log fill, Breakout/Fail/Remove/Restore, Chart.

  The phone keeps the "⋯" bottom sheet for actions.
- **Search** stays global. The filters inside each column header are replaced by two chips above the table: Direction and Market.
- **Phone:** cards as now, showing the same kept columns as the table so the two agree. "More" opens the drawer sheet instead of expanding the card.

**As built (Phase 6, revision 5).**
- **Flags column:** on Watching, Confirmed, Re-entered and Stopped out, on both boards. Up to three chips: a red dot and the name of the most pressing thing waiting for a decision, an amber dot and the most pressing thing worth a look, a calendar glyph and the nearest earnings or ex-dividend date ("Earnings in 3 days"). A chip says "+n" when more stand behind it. A phone card shows them under the symbol.
- **What a chip is:** a summary of the row's *open* Act and Watch flags, the same ones Today lists with the same acknowledgements (not acknowledged, not aged out), whatever the flag's `surfaces` say. So the board and Today cannot disagree, a row goes quiet when it has been dealt with, and `late-entry`, which has no other surface, shows here as "Late entry". `surfaces` still says where a flag is listed in full.
- **Width:** the board's sub-lines now wrap when the table is squeezed, so every section still fits a 1,100 px window with the extra column.
- **Drawer:** the plan's contents are all in: every level with how it was reached; "Flags and events" (every flag the setup has raised, newest first, open ones with an Acknowledge button, acknowledged ones with Undo, aged-out ones as plain lines); the daily 150/200 read; the earnings and news card; the calendar; the facts; and the actions, with "Log fill" next to Chart on the watchlist (the benchmarks have no journal).

### A5. Positions page
- **Stat tiles:** in trade (count), stopped out awaiting re-entry (count), nearest stop (symbol, −% and in ATRs), events in the next 7 days (count).
- **Stop ladder,** sorted by distance to the active stop (the last full day, else the negation). Columns:
  - Symbol and Live;
  - Stop level, with −% and ATRs;
  - Trailing stop (2×ATR);
  - R so far: from the confirming close, or from the re-entry close for a B3;
  - Days in trade and calendar chips.
- **Stopped out list,** with "% to re-entry".
- **Trade log link:** open fills in the trade log mark their rows as "held". This replaces the legacy `hold` field.

**As built (Phase 6).** Four tiles (in trade, stopped out, nearest stop, events in the next 7 days), the ladder, and the stopped-out list. The ladder is Confirmed plus Re-entered, nearest stop first, with columns Stop (give-back in % and ATRs, and whether it is the last full day or the negation), Trailing stop, R so far, In trade (days since the entry) and Flags. A row is marked "held" when the journal has a fill open on it; that mark is display only and never an input to the rules (the legacy `hold` field stays ignored). At target is not in the ladder: it is History's.

### A6. History page
Outcome tiles by final type (B1/B2/B3/B4 counts, hit rate, median days to target and to failure). Then compact At target, Failed and Removed tables. Then the journal: the entry form and the first-in-first-out pairing of fills, ported unchanged.

**As built (Phase 6).** Five tiles: the hit rate, then one tile for each type a setup ended as, with its count and median days (to target for B1 to B3, to failure for B4). A setup is *resolved* when it reached its target or had the negation touched, on settled closes; setups still in play and ones moved to Failed by hand are not counted, and the page says how many each is. Then a switch between At target, Failed, Removed (the Setups tables, unchanged) and the Journal, whose count is the fills. The journal is the old page's: the same storage key and shape (so fills logged there are here), the same first-in-first-out pairing, summary line, open positions, closed trades and every fill with Edit and Delete, and an entry form whose price starts as the settled close of the day traded until a price is typed by hand. "Log fill" in the drawer opens the same form. Export carries the journal and Import reads fills back.

### A7. Benchmarks
The same Setups component on `benchmarks.json`, with no journal, calendar, add form or model, exactly as today. It keeps its own saved edits and its own acknowledgements.

### A8. Phone vs desktop
Both are first-class:
- **Phone:** bottom tab bar, cards, sheets, large title.
- **Desktop:** top tabs, tables, drawer.
- **Both:** light and dark mode via the site's existing colour tokens, copied into the new repo. The fallback for iOS before 16.2 is kept.

---

## B. Backtest / sizing model (`#/model`)

### B1. Trade universe
- **What's included:** every watchlist setup (not benchmarks) with a breakout, either imported via `confirmed` or a first settled close strictly past the trigger after `created`. Today that's 82; the engine recounts it at build time and the page prints the number. Longs and shorts, all markets, from 2026-01-24.
- **Imported confirmed rows:** the entry date is the actual confirming close, found by the existing 40-session lookback. If it can't be found, the row is excluded and listed under "Excluded" with the reason.
- **`reached` rows (6):** closed at the settled close on the `reached` date, labelled "per source". A "Targets count on a touch" toggle re-evaluates every target against highs and lows (open question Q2).
- **Removed after breakout (2, including ICLR):** closed at the removal date's close, labelled, with a toggle to exclude them.
- **`lfd: 0` rows (4):** excluded from any strategy that uses the last full day, included in negation-only strategies.
- **Derived last full days (34):** used as-is, but the trade list marks them "derived", so you can see how much of the result rests on a rule that matches Tech Charts only 12–15 times in 20.
- **Symbols with no bars (4 today):** excluded and listed.
- **Survivorship bias:**
  - **On the source side, none.** The list keeps failed and removed rows; nothing is deleted, and `removed` is dated.
  - **The real bias:** your list began on 2026-08-08 with 34 positions already confirmed. So breakouts before August are only the ones the source still listed then, which over-represents winners and open trades for January to July.
  - **How the page handles it:** it states the bias and offers a "from 2026-08-08 only" toggle.
- **No hindsight:** every strategy is a rule you could have followed at the time. The final B-type only breaks the results down; it's never used to choose trades.

### B2. Strategies
All run on settled bars. Each day is processed low/high first, then the close, the same way the live tracking does it.

| Code | Your wording | Entry | Exit | Stop |
|---|---|---|---|---|
| S1 "B1/B2 only" | play only B1 and B2 | confirming close (or next open, Q6) | first touch of the last full day (fill at that level, or at the open if it gapped through), negation touch, target close | last full day; negation where there's none |
| S2-k "with re-entries" | B1, B2, B3; re-enter 1/2/3/unlimited times | as S1; re-enter at the settled close back past the trigger | as S1, up to k re-entries, then stop | original last full day (current rule) or a new one from the re-entry run (Q3) |
| S3 "negation only" | hold through breaches | confirming close | negation touch, target close | negation |
| S4 "trailing" | — | confirming close | the higher of the last full day and a 2×ATR14 stop trailing the highest close; negation; target | ATR computed from `bars.json` |
| S5 "trigger-close exit" | the "re-enter under B1/B2" reading | confirming close | a settled close back inside the trigger (a B2 pullback that closes through); re-enter on a close back past it, k times | the trigger, as a close-based stop (Q1) |

Trades still open are marked at the last settled close and flagged "open". Statistics are shown both for closed trades only and including open ones.

### B3. Sizing schemes
1. **Flat:** N per entry; each re-entry also gets N.
2. **Flat per strategy:** N_A for S1, N_B for S2. This is the ratio question.
3. **Payoff-scaled:** N × the setup's payoff relative to the median payoff (payoff = trigger→target %), capped between 0.5× and 2×.
4. **Risk-based:** fix the money at risk per entry (R). Position size = R ÷ the distance from entry to stop (risk%), capped at a maximum position size.

**"What ratio between A and B makes sense"** is answered three ways, with one primary:
- **Primary: equal risk per setup.** Ratio = (median total risk% per setup under S1) ÷ (median total risk% per setup under S2-k). Total risk adds up the entry-to-stop distance across all the entries one setup generates. This is the only ratio that follows from the rules rather than from the sample.
- **Secondary:** equal maximum drawdown (scale B until its drawdown equals A's), and equal capital in use (scale until peak simultaneous exposure matches).

All three are printed with the number of trades behind them.

### B4. Currency
- **Prices are never converted.** Each trade is modelled as a % return on its own price series, in its listing currency.
- **Money enters only through the position size:** you pick an account currency label and an amount (default 10,000 "account units").
- **The assumption,** stated on the page in one line: FX stays constant during each trade, and the position is placed in the local currency at entry.
- **What's currency-free:** the main statistics (expectancy, win rate, profit factor, R-multiples).
- **What uses account units:** the equity curve and drawdown, under that assumption.
- **The trade list** shows entry and exit in the listing currency, with the currency code in the cell.

### B5. Outputs
- **Charts:** a daily equity curve and a drawdown curve.
- **Trade list:**
  - symbol, direction, entry and exit date and price (with currency);
  - % return, R, exit reason, final type;
  - where the last full day came from, and whether the trade is open or closed.
- **Stat tiles:** number of trades, win rate, expectancy (in % and R), profit factor, max drawdown, average and peak positions open, capital in use.
- **Tables:** results by final type, and a sensitivity grid (strategy × re-entries × sizing; each cell shows expectancy, max drawdown and the ratio).
- **Confidence:** a bootstrap 90% interval on expectancy (1,000 resamples of the trade list), so the effect of the small sample is visible.
- **Caveats printed with numbers,** each counted from the trade list on the day (on 1 Nov 2026: 82 trades, 25 of them in one month, 10 shorts, 39 still open, 34 derived stops, 4 without a tight stop); none is typed into the page.

### B6. Fees and slippage
Configurable; the default is 0.10% commission + 0.10% slippage per side, taken off the % return. Settings are stored in the URL, so a scenario is a shareable link.

### B7. Where it runs and why
In the browser, from `bars.json`: a daily price snapshot (open, high, low, close) written by the new repo's CI.
- **How it's built:** one Yahoo call per symbol. It only ever grows, from a fixed start of 2025-10-01, so January breakouts never fall out of a rolling window.
- **Live data:** fresh bars from the Worker are layered on top when it answers.

Why it runs there:
- one engine for both the board and the model, avoiding the drift the README warns about;
- no dependence on Yahoo at build time;
- reproducible, since settled bars never change;
- testable offline with fixtures.

**Size:** about 175 symbols × 270 bars × 4 values is roughly 1.5 MB today (0.5 MB compressed), growing about 5 KB a day.

**Why the current site can't do it honestly:** `prices.json` holds closes only, and `pricefloor.js` refuses daily-bar requests.

---

## C. Architecture (new repo)

```
<new-repo>/
  index.html                 one entry; Vite hashes assets, so no ?v= rule exists
  src/engine/  bars.ts       settled/live split (from fetchHistory and pricefloor.js sessions)
               replay.ts  lfd.ts  btype.ts  derived.ts (runupOf, rrOf, stopFor, lfdRisk)
               events.ts (weekly log)  flags.ts (tier rules, A2)  sections.ts (state → section)
               backtest/ strategies.ts sizing.ts stats.ts bootstrap.ts
  src/data/    sources.ts (snapshot first, Worker upgrade — the pricefloor idea as a module)
               schema.ts (watchlist row type + runtime validation; state/hold/alert/alertOp ignored)
               overlay.ts (localStorage, keys unchanged so existing edits survive; new ack store)
  src/ui/      Preact + TSX; pages/ today setups positions history model benchmarks method;
               components/ tabbar segmented card table drawer flag
  src/app.tsx  hash router, one data load, self-update check
  public/data/ watchlist.json benchmarks.json tradelog.json bars.json prices-latest.json watch-events.json
  CLAUDE.md    standing rules for every session (see Revision 2)
  docs/PLAN.md (this plan)  docs/BRIEF.md (the original rebuild brief)
  public/data/series.json  weekly (5y) and monthly (25y) closes + index closes, for #/signals
  scripts/     fetch_bars.py (new; also writes series.json)  fetch_latest.py (from fetch_prices.py --latest)
               fetch_events.py (moved)  quality.py (copied)  report/ (moved)
  .github/workflows/ update-data.yml (hourly events; bars daily, age-gated)
                     update-prices.yml (15-min loop)  deploy.yml (build + deploy dist/)
  tests/       engine/*.test.ts, fixtures/{prk,wawi,7936t,iclr}.json, parity/*.json
```

- **Framework: Preact** (3 KB) rather than raw DOM. The drawer, tab badges and Today lists change with state. Rebuilding every table on every change by hand is what the current file does, and it shouldn't carry over.
- **Cache-busting:** asset names include a content hash, so the `?v=` bumping rule disappears. Data files are fetched without caching, as now.
- **"Update on return":** the current site's self-update is re-implemented. It compares the script and stylesheet files of a freshly fetched page against the running one, with the same 10-minute reload guard.
- **Testing:** the engine imports nothing from the page, and Vitest runs the TypeScript directly (`npm test`). Browser checks stay mandatory for the UI: the app exposes `window.__board = {counts, flags, errors}`, so a console check is one expression.
- **Worker:** the new repo lives under the same `https://joeedessa.github.io` address, which the Worker already allows. Local development forwards price requests through the dev server, so no dev-port entry is needed either. No Worker changes at all, unless you adopt a custom domain (Q11).
- **Secrets:** none. CI uses GitHub's built-in token, with the same deploy chaining already working in `deploy-pages.yml`.

---

## D. Relationship to macro-compass

The macro-compass watchlist page stays live and separate (revision 3). It does not read this repo's files, this repo never edits macro-compass, and from the next weekly report on the weekly sync happens here only, so macro-compass's own copy of the watchlist stops changing.

### D1. What this repo copied, what it builds, what macro-compass keeps
| Item | Decision |
|---|---|
| `watchlist.json`, `benchmarks.json`, `tradelog.json` | **Copied.** This repo is the source of truth. macro-compass keeps its own copy, which is no longer synced. |
| `scripts/report/` + README "Weekly report sync" | **Copied.** The parser reads `public/data/watchlist.json`. The sync runs here only. |
| `fetch_events.py` | **Copied.** macro-compass keeps producing its own `watch-events.json`; neither site reads the other's. |
| `fetch_prices.py` | **Stays** in macro-compass, untouched. This repo has `fetch_bars.py` (daily bars) and `fetch_latest.py` (latest price), covering its own lists only. |
| Automated jobs | This repo has its own trimmed copies. macro-compass keeps its own, unchanged. |
| Cloudflare Worker | **Stays**, with no change (same address). |
| `watch.html` / `?set=benchmarks` | **Stays live and separate.** No redirect. |
| Home Screen | The new site has its own self-update; it needs its own Home Screen icon (Phase 9). |
| Shared files (pricefloor, ma, links, styles, mobile.css) | **Not moved.** This repo copied the colour tokens and the chart-link format, and rebuilt the price fallback as a data module. |
| Saved edits and the trade log in your browser | **Shared:** same site address, same storage keys, so both pages read and write the same browser storage. |

### D2. Parity check
On one date, the old page dumps the following for every setup (Phase 1 adds one debug line to make this possible):
- section, type, and the counts of pullbacks, breaches and re-entries;
- the last full day, where it came from, and whether it's looser than the negation;
- the breakout, target and failure dates, and whether the failure was a touch;
- the price data it used.

Both are frozen as test files. The new engine, run on the frozen bars, must reproduce every field; each difference is adjudicated and written up in `docs/PARITY.md`, including the rows the 7-significant-digit rounding decision changed (revision 3).

---

## E. Phased execution

Effort is relative (1 ≈ half a day of agent work). Each phase ships and is verified on its own.

| # | Scope | Acceptance checks | Model (reason) | Effort |
|---|---|---|---|---|
| 0 | This plan, approved; open questions answered | your sign-off | — | — |
| 1 | Repo scaffold + data pipeline: Vite + TS + Preact + Vitest; data copied; `fetch_bars.py`, `fetch_latest.py`, `fetch_events.py`, `quality.py` and `report/` moved; three automated jobs; README. One debug line added to the old `watch.html` | jobs run green; `bars.json` has daily bars for every symbol with history; data readable from other sites; `npm test` runs; the Pages URL serves the shell; console clean | **Haiku 4.5** (mechanical; the patterns already exist) | 2 |
| 2 | Engine port with tests (bars, replay, last full day, types, derived values, events, sections); fixtures PRK, WAWI.OL, 7936.T, ICLR plus edge cases; parity test | `npm test` green, including parity; differences from the old page documented; settled/live split verified against a closed and an open exchange | **Fable 5.1** (correctness-critical; judgement on every discrepancy) | 4 |
| 3 | Setups board + Benchmarks route at parity: basic drawer, saved edits and actions, header line, self-update | section counts equal the old page's on the same day; no sideways scrolling at 390 px; dark and light; the bottom bar clears the iPhone home indicator; console clean | **Sonnet 5.5** (UI; the spec is explicit) | 4 |
| 5a | Flags engine: `src/engine/flags.ts`, the 19 rules of A2 with their tiers, surfaces and ids, five-session expiry, pure acknowledgement helpers | a unit test per flag rule (19); acknowledgement ids stable across reloads, new bars and price moves; the settled flags carry every event the old weekly log showed | **Opus 5.5** (rules and thresholds) | 1.5 |
| 5b | Today page + badges + acknowledgement store + last-visit divider | Today lists every settled event of the week that the old log shows; acks survive a reload; the badge equals unacked Act+Watch; phone layout | **Sonnet 5.5** | 1.5 |
| 6 | Positions, History (including the journal port) and Method pages; full drawer; the Flags column and chips on the Setups board (revision 5) | journal pairing matches today's on a fixture; stop ladder order matches today's Confirmed sort | **Sonnet 5.5** | 3 |
| 6b | Signals page (Q9): `series.json` from `fetch_bars.py` (weekly/monthly, phantom bar dropped by period), `src/engine/ma.ts` ported from `ma.js` (averages, slope, held/lost/reclaimed) with tests, index map, sector medians | MA values and slope states equal macro-compass's for 5 sample symbols on the same day; phantom-bar test; phone layout | **Sonnet 5.5** (well-specified port; tests guard it) | 2 |
| 7 | Backtest engine: S1–S5, re-entry depth, sizing schemes, stats, bootstrap, currency model; fixtures with hand-computed answers | fixtures pass (a gap through the stop, a short, two re-entries, an open trade, `reached`, removed after breakout); the printed universe count equals the engine's breakout count | **Fable 5.1** (the semantics are the whole value) | 4 |
| 8 | Model page UI: controls in the URL, sensitivity grid, equity and drawdown charts, trade list, caveats, excluded list | re-runs in under 200 ms for the day's whole trade list (82 on 1 Nov 2026); a scenario link reproduces the same numbers; phone layout; units on every number | **Sonnet 5.5** | 3 |
| 9 | Polish: Method page, weekly-process doc, performance, accessibility, final console and phone sweep | console clean on all 7 routes, phone and desktop | **Haiku 4.5** for docs; **Sonnet 5.5** for the sweep | 2 |

**Why this order:** phases 1–3 put the tested engine and the new foundation live before any redesign, so nothing gets built twice. Phases 5–6 deliver "miss nothing, stop hunting". Phases 7–8 don't depend on 5–6 and can run in parallel sessions once phase 2 is done.

---

## F. Open questions (answer before or during execution; recommended default in bold)

| # | Question | Default |
|---|---|---|
| Q1 | "Under B1/B2 where we re-enter": did you mean (a) re-entry after a B3 stop-out, or (b) exiting on a close back under the trigger (a B2 that closes through) and re-entering on a close back above? | **Model both; S2 headline, S5 labelled as the alternative reading** (needed before phase 7) |
| Q2 | Should a target count on an intraday touch? | **Board stays on close; model has a toggle, default close** |
| Q3 | Stop after a re-entry: the original last full day or a new one? | **Original on the board; model computes both** |
| Q4 | Account currency label and default amount per trade | **"account units", 10,000 per entry; FX constant, stated** |
| Q5 | Fees and slippage defaults | **0.10% + 0.10% per side, editable** |
| Q6 | Entry fill: confirming close, or next session's open? | **Next open where `bars.json` has it; close as a toggle** |
| Q7 | Repo name, and does Benchmarks move? | **Answered: `SwingTrader`** (folder `~/Desktop/ClaudeProjects/SwingTrader`, URL `/SwingTrader/`, case-sensitive); Benchmarks moves (default kept) |
| Q8 | macro-compass Lookup page: keep "related setups" (read from the new site) or drop it? | **Answered (revision 3): moot.** macro-compass stays separate and does not read this repo's data |
| Q9 | Drop weekly/monthly MA columns, the cross scan and the relative columns from the board? | **Answered: keep them, on a separate page** (`#/signals`, phase 6b) |
| Q10 | Acknowledgements per browser only (no sync)? | **Yes; the last-visit divider mitigates** |
| Q11 | Custom domain? | **No** |
| Q12 | Rows removed after breaking out, in the backtest | **Close at the removal date, labelled, toggle to exclude** |
| Q13 | `lfd: 0` rows (4) and derived last full days (34) in stop-based strategies | **Exclude `lfd: 0`; include derived, marked** |
| Q14 | Backtest start: all breakouts, or only from 2026-08-08? | **All, with a "from 2026-08-08" toggle and the bias stated** |
| Q15 | Grace period for the old `watch.html` after the redirect? | **Answered (revision 3): no redirect.** The old page stays live |

### Checkpoints that need you
0. Install Node.js once: `brew install node` (not on this Mac today; Phase 1 can't build or test without it).
1. Create the GitHub repo `joeedessa/SwingTrader` (public), or let Phase 1 create it with `gh` after you confirm.
2. Enable Pages with source "GitHub Actions".
3. From the next weekly report on, run the weekly sync in this repo only.
4. Sign off the parity report (D3).
5. Add the new site to the iPhone Home Screen.
6. Only if Q11 = yes: add the custom domain to the Worker and deploy it.

No secrets anywhere.

---

## Revision 2 (review, 1 Nov 2026)

Checked against the machine and the answers to Q7 and Q9:

1. **Node.js is not installed** (`node`/`npm` not found). The Vite + TypeScript + Vitest + Preact stack needs it locally, so it's added as checkpoint 0 (`brew install node`). GitHub Actions installs its own Node for CI.
2. **Repo and URL:** `joeedessa/SwingTrader` doesn't exist yet. Vite needs `base: "/SwingTrader/"`, and the path is case-sensitive. It's the same origin (`https://joeedessa.github.io`), so:
   - the Worker allow-list already covers it;
   - browser-saved edits (localStorage) carry over.
3. **Signals page (Q9)** is added as route `#/signals` and phase 6b. It needs weekly (5y) and monthly (25y) closes for watchlist symbols and their indices. This repo does not read macro-compass's files, so `fetch_bars.py` also writes `series.json`. The phantom weekly/monthly bar must be dropped by period (README trap).
4. **Context for future sessions:** Claude's memory is per project folder, so a session opened in SwingTrader starts blank. Phase 1 therefore writes a `CLAUDE.md` with:
   - the hard constraints and the trading rules;
   - the weekly report sync, including appending `source_open` dates and comparing LFDR for B3s week to week;
   - the answer style (lead with the conclusion);
   - the phase table and how to start a phase.

   The plan and the original brief are copied into `docs/`.
5. **Model switching is manual** (see `CLAUDE.md`): one session per phase, with the model set in the app's model picker before starting.

---

## Progress

- **Phase 6 (Positions, History with the journal, Method, the full drawer, and the Flags column): done 2 Nov 2026.** Joe signed off 5b and kept the engine fix `64e32f8` (revision 5). Nav is now Today, Setups, Positions, History and a More menu (Benchmarks, Method) in the top bar; on a phone the five tabs end with More, a page. `#/positions`, `#/history`, `#/method` and `#/more` are routes; the drawer opens over Positions and History too. Described under A4 to A6 ("As built"). 783 tests; checked in the browser at 1280, 1100 and 375 px, light and dark, console clean.
  - **Checked against the old page:** the journal's pairing, order and summary line against the old page's own `logRows`, `pairFills` and summary expression on a fixture (the functions were run out of its source; `tests/fixtures/journal-old-page.json`), and the daily 150/200 read against the old `ma.js` on seven symbols' closes (`tests/fixtures/ma-old-page.json`): equal to the last digit. Three small differences by design, in `docs/PARITY.md`. The stop ladder's order for the Confirmed rows that have a tight stop equals the Confirmed section's own sort, on the frozen capture and on the live files (tested).
  - **Method:** the rules as the engine states them (every number a threshold from the engine's own constants), every flag rule from the engine's table, and a freshness table of when each file was written and what is in it, all counted from what is loaded. Today's data lines now link to it.
  - **Choices made (say if any is wrong):** (1) Chips summarise every open Act and Watch flag of a row, not only the kinds whose plan table names Setups, so a row goes quiet when it is acknowledged; calendar flags (earnings, ex-dividend, including the Act one two days out) take the calendar chip rather than the red dot. (2) The Benchmarks board has chips too, and since it has no Today its flags are acknowledged from its drawer. (3) The ladder is Confirmed plus Re-entered, and a row with only a negation is placed by its distance to it; the Confirmed section puts such rows last, so for them the ladder differs, and for every row with a tight stop it is identical. (4) R is measured from the confirming close, or the re-entry close for a B3; for a row imported already confirmed, from the confirming close the stop derivation found, and "–" where the bars do not show it. (5) "Held" is display only. (6) History counts a setup as resolved only on the bars' say-so: at target, or negation touched; a hand-made Failed is left out. Medians are calendar days from the breakout date, which for an imported row is the report's. (7) Only the daily part of `ma.js` is ported here (average, read, slope); Phase 6b adds weekly and monthly and the cross scan on top of it. (8) A new fill's date starts as the date on the person's own clock (the old page used the UTC date). (9) The More page is for phones; a desktop opens the same pages from a menu.
  - **Left out on purpose:** the Model and Signals routes (Phases 8 and 6b), the Home Screen icon (Phase 9), a "held" mark on the Setups board (Positions only), and a chip for `source-kept` (the Failed table's "Still listed by source" column already says it).
  - **Not verified:** a real iPhone (this Mac still has no full Xcode). Phone layouts were checked at 375 px in light and dark, the form's bottom sheet by geometry only.
- **Phase 5b (Today page, acknowledgements, last-visit marks): done 2 Nov 2026.** `#/today` is the landing page, and the Today tab carries the badge (live + Act + Watch still to look at) on the desktop bar and the phone bar. Built as described under A3 "As built". 546 tests; checked in the browser at 1280 and 375 px, light and dark, console clean.
  - **Revision 4 (Joe): too many at once.** About 48 flags no longer show together. On the 2 Nov data Today opens on Act (8 flags in five groups); Watch (40) is five group lines until one is opened.
  - **Acknowledgements:** per flag, per group and per tier, with Undo for eight seconds and from the folded "Acknowledged today" group, which empties at local midnight. They are kept in this browser (`st-acks-v1`, and `st-acks-benchmarks-v1`), forgotten after 90 days, and Export and Import carry them. A reload keeps them (checked in the browser, and in `tests/data/acks.test.ts`).
  - **Since your last visit:** the page remembers which flag ids it had shown when it was last looked at (`st-visit-v1`): the live strip and the tier that was open. Everything else is marked new: a dot on the row, "n new" on the group and in the list header, a dot on the tier. A tier that was never opened stays new, so a visit that only looked at Act does not make Watch's flags old. Half an hour away is a new visit. A first visit marks nothing. Only a visit that looked at Today is remembered.
  - **Checked against the old page, live, on 2 Nov:** the weekly log lists the same 2 + 23 events as the old page's "Setup events", in the same order. Two lines read differently, both explained in `docs/PARITY.md`: REH.AX's boundary event (last full day low 16.58 here, 17.38 there) and NCX.V's failure ("closed 2.8" here, "touched 2.8" there).
  - **Engine bug found and fixed on the way** (separate commit): a breakout on the newest session, whose close is known from the tip but whose bar is not yet on file, took its last full day from a bar months earlier (REH.AX: an August low, and a stop "hit" before the breakout). It now anchors to that session and reads the full day before it. One row on 2 Nov changed (REH.AX: 16.87 → 16.58, no section or type change); the 148 frozen parity rows are unchanged. Details in `docs/PARITY.md`.
  - **Choices made (say if any is wrong):** (1) Today shows the watchlist only; the benchmarks raise flags and keep their own acknowledgements, but have no surface for them until the Benchmarks board gets its Flags chips. (2) Live flags are counted in the badge and sit above the tiers, not in them. (3) The drawer opens over Today (`#/today/AME/long`), so Back returns to the same tier and groups. (4) "New" is what was not on screen at the last visit, not what is dated after it, because bars arrive up to an hour after a close. (5) A group opens by itself at three flags or fewer (`GROUP_OPEN_UP_TO`). (6) The tape line is the old gauge as one sentence; its "check Market signals" became "weigh single names against it", since there is no such panel here. (7) A data flag is a plain line in the footer until the Method page exists (Phase 6), so it has no link yet.
  - **Left out on purpose:** the Flags column and chips on the Setups board, so `late-entry` (surface: Setups chip only) still has no place to show (built in Phase 6, revision 5); the History and Positions surfaces (Phase 6); the Home Screen icon (Phase 9).
- **Phase 5a (flags engine): done 1 Nov 2026.** `src/engine/flags.ts`: the 19 rules of A2 as data (tier, surfaces, how each clears, the rule's words) and as code; named thresholds; ids `sym|dir|kind|when` (`*|*|data.<topic>|<day>` for data flags); five-session expiry; pure acknowledgement helpers (`ackable`, `expired`, `badgeCount`) for 5b's store to use. 52 tests: at least one per rule, id stability (same inputs, any order, a new session, a price move, a level edit, a move to another section, long against short, either board), the old weekly log's settled events carried one for one with the same words, expiry, the badge. On today's data the watchlist raises 352 flags, 48 on Today, badge 47 (16 of them earnings this week).
  - **Choices made for the rules (say if any is wrong):** "in trade" is Confirmed, Re-entered or At target (not Stopped out). `live-negation` follows the plan's "in trade", so a stopped-out row no longer raises it (the old page did). `boundary` stays on the record after the confirmation, as the old log kept it; its text drops "not confirmed" then. A condition's id carries the day it was read (near-trigger, near-stop) or the event's date (earnings, ex-dividend), so an acknowledgement lasts that session or that event. Live flags cannot be acknowledged and count in the badge while they last. Expiry also has a backstop the plan did not name: ten weekdays on the board, for a symbol that stops trading (WBS has no bar after 19-08-26, so its flags would never age).
- **Revision 3 (1 Nov 2026):** Phase 4 and the cut-over are removed (macro-compass stays live and separate). Prices and levels are compared at 7 significant digits (`src/engine/precision.ts`). Fourteen watchlist rows changed a count, a stop or a date, none a section or a type, and no benchmark changed: listed in `docs/PARITY.md`.
- **Phase 3 (Setups board + Benchmarks at parity): done 1 Nov 2026.** Live at `#/setups` and `#/benchmarks` (a setup's drawer is `#/setups/AME/long`, and Back closes it). Section counts equal the old page's on the same settled day: **watchlist 148 of 148, benchmarks 23 of 23** (31 / 18 / 11 / 6 / 15 / 30 / 37 and 11 / 6 / 1 / 2 / 1 / 2 / 0); six rows differ in a date or in having a stop at all, all explained in `docs/PARITY.md`. 368 tests; console clean; no sideways scroll at 390 px; light and dark checked.
  - **Board:** seven sections with counts, search, Direction and Market filters, sortable headers (each section opens on its own question), a table on desktop and cards on a phone from the same column list. **Drawer:** every level with how it was reached (the old tooltips, written out), type and exits, the setup's own events, calendar, facts, actions (Mark as breakout, Remove, Mark as failed, Undo, Restore, Delete), Edit levels, and an "edited here · shared value X · Reset" marker so a stale override cannot hide the next report's level.
  - **Saved edits** use the old page's localStorage keys and shape unchanged, so edits made there are here (same origin) and the old page can still read what is written back. Add setup (prices fetched on demand through the Worker), Export (setups plus the journal, read-only) and Import (a list, or an export) are in. `hold`, `state` and `alert` fields are ignored, as planned.
  - **Prices:** the snapshot paints first; the Worker upgrade follows (on localhost the dev server forwards the same request). The header line says which one you are looking at. **Self-update:** compares the built script and stylesheet names, one reload per ten minutes; tested against real Vite output with a simulated deploy.
  - **Data pipeline:** bars are now written once the exchange's session has ended, keyed by the exchange's own date, and kept as Yahoo sends them (see PARITY.md: the first version rounded prices and moved ties). A run with nothing new leaves `bars.json` alone; before, a fresh timestamp alone committed the whole 5 MB every hour.
  - **Left for later phases, on purpose:** the Flags column and flag chips (Phase 5), "Log fill" and the journal itself (Phase 6), the weekly log, calendar, scan and trade log from the old page (Phases 5, 6, 6b), the Home Screen icon (Phase 9). Fail and Undo are offered on re-entered and stopped-out rows too; the old page offered them only on Confirmed and At target.
  - **Not verified:** the bottom bar against a real iPhone's home indicator. This Mac has no full Xcode, so the iOS Simulator tool cannot start. The layout was checked by simulating the insets (`--sab` 34 px portrait; 47 px at the sides in landscape): the bar grows by the inset, its labels sit above it, the page's bottom padding grows with it, and nothing overflows. Open the site on the phone once to confirm.

- **Phase 2 (engine port + tests + parity): done 1 Nov 2026.** `src/engine/`: `types`, `bars` (settled/live split from `bars.json` + the tip), `replay`, `lfd`, `btype`, `sections`, `derived`, `events` (weekly log as data), `row` (one evaluation per setup, the board). 249 tests green: unit tests per module, fixtures PRK (hand-built), WAWI.OL, 7936.T, ICLR, and the D3 parity test on a frozen dump of the old page (`tests/parity/`, 148 rows, **zero differences**). Write-up: `docs/PARITY.md`. One data finding: the old page dated Australian bars one day early in daylight-time months (UTC keying); the new repo uses the exchange's own date.
  - `fetch_bars.py` now writes a day once the exchange's session has ended (was: once the UTC date had passed), so the hourly job picks up a close within the hour.
  - Not ported in Phase 2, by scope: dividend flags and MA structure alerts (Phase 5 flags, Phase 6b Signals); the overlay store (Phase 3).
- **Repo live (1 Nov 2026):** https://github.com/joeedessa/SwingTrader (public, `main`). Pages source: GitHub Actions. Site: https://joeedessa.github.io/SwingTrader/ serves the Phase 1 shell; console clean; `window.__board` matches the local build.
- **Workflows:** Deploy Pages green (push). Update data green (first run). Update prices: the first pass committed `prices-latest.json`; the job is a 5.5-hour loop, so its overall status settles only when the loop ends.
- **Phase 1 (scaffold + data pipeline): done 1 Nov 2026.** Local checks: `npm test` 6/6, `tsc` and `vite build` clean, shell at `/SwingTrader/` shows 148 setups, 23 benchmarks and 180 bar symbols, console clean, `fetch_bars.py` and `fetch_latest.py` green.
  - Parity hook: macro-compass commit `604ec2a7` adds `window.__parity()` (inputs plus every row's outcome, keyed by sym + dir). The debug line from the original plan was superseded by this.
  - Data notes for Phase 2: `bars.json` has 180 symbols and 87,515 days from 2024-10 onward. BSM, PNDORA.CO, FLS.CO and H78.SI now have bars. Close sits outside low–high on a few bars (JPY=X ×33, FSR.JO, ZN=F); kept as received and listed in `tests/data.test.ts`.
  - Seven rows have no negation (NGVT, FSS, BWMX, SL.MI, HO.PA, MKS.L, 8012.T), all Watching. This is expected: the source publishes a negation only after a breakout. The engine must treat a null negation as "not yet set", not as a gap.

## Revision 3 (Joe, 1 Nov 2026)

1. **No cut-over.** Phase 4 and the cut-over checklist are removed. The macro-compass page stays live and separate; it does not read this repo's data, and this repo never edits macro-compass. From the next weekly report on, the weekly sync happens here only.
2. **Rounding.** Prices and levels are rounded to 7 significant digits before every level comparison, so a close exactly on a level follows the written rule instead of Yahoo's float noise. "At or past" stays only in the search for an imported setup's confirming close, because for those rows the stored trigger is often that close's exact price (KRO, 3107.T, UBER). The rows this changed are listed in `docs/PARITY.md`.
3. **Phase 5 split.** 5a is the flags engine (Opus 5.5); 5b is the Today page (Sonnet 5.5).

## Revision 4 (Joe, 2 Nov 2026)

1. **Today groups its flags by tier.** About 48 at once was too much. Today shows one tier at a time, with each tier's flags grouped by kind (see A3, "As built").
2. **Nothing hard-codes how many rows there are.** The lists change every week. Counts in code, page text and tests are derived from the data; a test on the live files asserts what is true of every row; a test on a frozen capture reads its counts from the capture. The rule is in `CLAUDE.md`. Tests changed for it: `tests/data.test.ts` (no row-count floor, no "23 benchmarks": the lists are checked with the same validation the page applies, and the live list is checked to still hold every row of the 1 Nov capture), `tests/parity/parity.test.ts` and `tests/ui/columns.test.ts` (counts read from the capture), `tests/engine/flags.test.ts` (no size floor).

## Revision 5 (Joe, 2 Nov 2026)

1. **Phase 5b is signed off, and the engine fix `64e32f8` stays** (the last full day of a breakout on the newest session, whose close is known from the tip before its bar is on file).
2. **Phase 6 includes the Flags column and chips on the Setups board, and gives `late-entry` a place to show.** It was left out of 5b; it is built here (A4, "As built"), on the Benchmarks board as well.
