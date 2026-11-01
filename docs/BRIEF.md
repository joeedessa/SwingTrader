# Prompt: build a standalone Watchlist dashboard

Paste everything below the line into a new Claude Code session, started in an empty folder.
Fill in the "What I want different" section first, or delete it.

---

## What I'm building

A standalone dashboard for my **breakout watchlist**: classical chart-pattern setups from the Tech Charts research service (Aksel Kibar), tracked through their whole life from "waiting to trigger" to "reached target" or "failed". I'm a swing trader. I read it every morning on desktop and phone, and I use it to decide what to enter, what to hold and what to exit.

A version of this already exists as one page (`watch.html`) inside my Macro Compass site (repo `github.com/joeedessa/macro-compass`, live at https://joeedessa.github.io/macro-compass/watch.html). Open it and use it as the functional reference. That page is a 3,500-line single file, so I want this rebuilt as a proper project: the trading engine as pure, tested functions, and the UI on top.

## What I want different

<!-- e.g. "a portfolio-level summary at the top", "a chart per setup", "faster on phone" — or delete this section -->

## Hard constraints

- **Free, with no API keys or tokens, ever.** Public, keyless data only.
- **Static site.** It must deploy to GitHub Pages; no server of my own. Use Vite + TypeScript with no heavy UI framework (plain DOM or Preact), and Vitest for tests.
- **Prices stay in the instrument's own listing currency. Never convert.** GBp stays GBp, ILA stays ILA.
- **State units wherever they aren't obvious.**
- **Desktop and phone are equally first-class**, and light and dark mode both work. The current page's design is Apple-like: segmented control, cards on the phone, ⋯ row menus. Match it or better it.
- **Don't modify the macro-compass repo.** One exception is listed under Data. That repo stays the single source of truth for the watchlist data; my weekly update process lives there.

## Data (read-only, from the existing site; GitHub Pages sends `Access-Control-Allow-Origin: *`)

| URL (prefix `https://joeedessa.github.io/macro-compass/data/`) | What |
|---|---|
| `watchlist.json` | The setups: an array, one object per setup (schema below). |
| `prices.json` | Snapshot, refreshed daily: `{generated_at, prices: {SYM: {ccy, t:[epoch s], c:[close], w, m}}}`, 1y daily closes plus weekly and monthly series. |
| `prices-latest.json` | Last tick, every ~15 min: `{generated_at, sessions:[[tz, openMin, closeMin]…], latest: {SYM: {c, p, t, ccy, z}}}`. Here `c` is the last close, `p` the previous close, `t` the time, and `z` an index into `sessions`. |
| `watch-events.json` | `{symbols: {SYM: {sector, ccy, earnings, atr, atr_pct, div_amount, ex_div, last_eps…, target_avg, ratings}}}`. |

**Live prices and daily OHLC** come from Yahoo:
- Batch closes: `query1.finance.yahoo.com/v7/finance/spark?symbols=A,B&range=1y&interval=1d`, at most 10 symbols per request.
- Daily high/low/close: `/v8/finance/chart/SYM?range=2y&interval=1d`, one symbol per request.

The touch rules below need the daily highs and lows. Yahoo sends no CORS header, so the browser goes through my Cloudflare Worker, `https://macro-compass-proxy.joe-edessa.workers.dev/?url=<encoded Yahoo URL>`. It answers only allow-listed origins. **Ask me to add this project's origin** (its Pages URL and its local dev port) to `ALLOWED_ORIGINS` in `macro-compass/cloudflare/src/index.js`. That's the one permitted change to that repo; I'll deploy it with wrangler. Until then, fall back to `prices.json` and `prices-latest.json`, and say on the page that the data is a snapshot.

### `watchlist.json` fields

| Field | Meaning |
|---|---|
| `sym`, `dir` | Yahoo symbol and `long` or `short`. **A setup is identified by sym + dir**: one stock can have both sides. |
| `breakthrough` | **The trigger**: the close that confirms the breakout, usually the boundary plus a ~3% filter. For setups imported already confirmed, it can be the actual confirming close. |
| `boundary` | The pattern boundary (neckline or rectangle edge). Missing on older rows. |
| `target`, `negation` | The price objective, and the level that invalidates the pattern. |
| `lfd` | The **last full day** level (tight stop) as published by the source. It wins over any derived value. `0` means the source publishes none (breakouts before June 2026); show "none in report". |
| `confirmed` | The source confirmed this breakout on this date. Start the setup in breakout state from that date. |
| `created`, `note`, `pattern`, `duration_m`, `exchange`, `country` | Descriptive. |
| `removed`, `removed_reason` | The source dropped the setup (e.g. "pattern morphing"). It goes to Removed and outranks everything. |
| `reached` | The source counts the target as met where our closes fell just short. It's dated by the closest approach; show "per source". |
| `source_open` | The weekly sheet dates on which the source still listed a setup as ongoing after it had hit its negation. |
| `hold`, `state`, `alert`, `alertOp` | Legacy; ignore. |

## The engine (pure functions, the heart of the project; unit-test every rule)

All rules run on **settled daily bars only**. A bar becomes settled when its exchange session has ended (use `prices-latest.json` `sessions` or Yahoo's `currentTradingPeriod`). Never act on the in-progress bar, except for the live flags described below.

1. **Breakout.** The first settled close strictly past the trigger, after `created`, marks the breakout. A row with `confirmed` starts in breakout state on that date.
2. **Negation is a touch.** A day's low below the negation (a long) or high above it (a short) fails the setup. This is tested only after the breakout; a setup still waiting can't fail. **Failed (B4) is terminal**: stop reading bars, and allow no re-entries ever after.
3. **Target is a close** at or past the target, after the breakout, or a `reached` date. It isn't terminal for the negation test.
4. **Last full day, where the source gives none:** the low (long) or high (short) of the **bar before the first close strictly past the boundary**.
   - **Which close counts:** the first one of the run of closes past the boundary that carries into the confirmation. A close back inside the pattern resets the run.
   - **No boundary:** use the bar before the trigger close.
   - **A derived stop beyond the negation is no stop.** Show that, and don't test it.
   - **A setup still waiting** that has closed past its boundary already has its stop recorded. It stays in Watching.
   - **This matches the source about 12–15 times in 20.** The analyst uses judgement, so `lfd` from the source always wins.
5. **Breakout type, followed day by day after the confirming close** (stop counting at target; the type is then final):
   - **B1:** no pullback through the trigger yet.
   - **B2:** pulled back through the trigger, last full day intact. Count the **pullbacks**: one starts on the first day whose low touches the trigger, and ends on the first day that trades entirely past the trigger. The next touch is the next pullback.
     - Not the boundary: the source's own type-2 examples, WAWI and PRK, gave back the trigger but never reached the boundary.
   - **B3:** a touch of the last full day is an **exit (breach)**. The setup is out until a settled close back past the trigger, the **re-entry**. It's then back in with the **same original last full day as its stop**, so the next touch is breach 2, and so on. Count the breaches.
     - The original stop is my rule for now. Keep the stop logic in one place, because I may switch to a new stop on each re-entry.
6. **Sections** (one shown at a time, via a segmented control with counts):

   | Section | What's in it |
   |---|---|
   | Watching | Not yet triggered |
   | Confirmed | B1 or B2, open |
   | Re-entered | B3, currently back in |
   | Stopped out | B3, out, not negated |
   | At target | Final type shown |
   | Failed | B4 |
   | Removed | Dropped by the source, with reason |

7. **Derived columns:**
   - **To trigger:** % and money from the last close.
   - **Payoff:** trigger → target.
   - **Reward : risk** at the trigger, against the tight stop or else the negation.
   - **Run-up:** % past the trigger, share of the trigger → target move used (amber from 50%, red past 100%), and reward : risk if entering now. It tells me whether a breakout is still worth entering a few days late.
   - **Pullbacks** (count and last date), **Breaches**, and **Status** ("Re-entered dd-mm @ x · stop y (−z%)" or "Out · x% to trigger").
   - **Trailing stop:** 2× ATR below live, widened by the dividend for a long whose ex-date is ahead.
   - **Still listed by source** (Failed only): "Kept · N sheets" from 2 sheets on, "Listed once" otherwise.
8. **Column order:** Symbol · Dir · Pattern · Live · Last close · **Trigger · Target**, then the section-specific columns.
   - On a phone, each row is a card, like the Stocks app: symbol and Long/Short on the left; price and a green/red day-move pill on the right; the section's key numbers under that; "More" for the rest.
9. **Setup events are a weekly log,** Monday to Sunday in local time, newest first, each dated, with a "Last week" toggle. Rebuild them from the bars on every load.
   - **Events:** breakout, target, failure (touched or closed), close past the boundary with the stop recorded, pullback N, exit N, re-entry N.
   - **Live intraday flags** go on top of the current week, marked "Live": trading through a trigger, a stop or a negation.
   - **Dividend flags:** a long in a trade, ex-date within 7 days, dividend ≥ 0.25 × ATR.

## Traps already hit (don't rediscover them)

- **Yahoo closes vs the source's closes can differ by a tick.** Yahoo uses the closing auction. MNKS printed 1,682 on Yahoo where the source closed 1,686 over a 1,684 trigger. Trust `confirmed` and `reached` from the data.
- **Imported confirmed breakouts are dated by the report,** which is often a Saturday. Find the actual confirming close within the 40 sessions on or before that date.
- **Symbols:**
  - Hong Kong drops leading zeros in reports (`135` is `0135.HK`).
  - Share classes: `ROKO_B` is `ROKO-B.ST`, `GIB.A` is `GIB-A.TO`.
  - London prices are in GBp; Tel Aviv in ILA.
- **Yahoo pads weekly and monthly series with a phantom bar** for the period in progress. If you use them, drop it by comparing periods, not values.
- **A syntax error in one script kills the whole page silently.** Verify in the browser console, not by grepping the HTML.
- **Phones keep old pages for days** (Home Screen app). The page should check for a newer deploy when shown again and reload once.

## Verification (write these as tests; levels as of late October 2026)

- **PRK:** boundary 178.65, trigger 184.11. The last full day must be **175.96** (the 22 Jun 2026 bar, which traded above the boundary but closed below it at 176.55; the first close past was 23 Jun).
- **WAWI.OL:** with `lfd` 132.6 and `boundary` 137.5 it must classify **B2** (pulled back through the 145.3 trigger and never touched 132.6).
- **7936.T:** touched its 4,593 negation on 26 Aug 2026 at 4,463, so it's **Failed**. No later re-entry may appear, even though price recovered.
- **ICLR:** `removed` with reason "breakout candle reached the price objective", so it's in Removed, not At target.
- Engine edge cases:
  - a short (every rule mirrored);
  - a gap through both boundary and trigger;
  - a setup with no boundary;
  - `lfd: 0`;
  - a derived stop beyond the negation;
  - a re-entry followed by a second breach.

## Deliverables

1. The repo: README (how to run, test, deploy, and where the data comes from) and the engine with tests passing.
2. Deployed to GitHub Pages, with the URL.
3. A short note of anything where your result differs from the current `watch.html` for the same setup, and which one is right.

Ask me before anything outward-facing: creating the GitHub repo, enabling Pages, or the Worker origin change.
