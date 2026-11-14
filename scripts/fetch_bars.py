#!/usr/bin/env python3
"""Daily bars for every symbol the engine reads, and the long series for Signals.

Writes two files under public/data/:

  bars.json    append-only daily bars, keyed by exchange-local date:
               {"bars": {SYM: {"2026-10-30": [low, high, close, open], ...}}, "ccy": {SYM: "USD"}}
               Values are kept exactly as Yahoo sends them (see yahoo.chart): the engine compares closes
               with levels exactly, so rounding would move a tie.
               The order [low, high, close] is the one the old page used:
               a long reads index 0 (the low), a short reads index 1 (the high).
               The open (index 3) was added in November 2026 for the Model page,
               which fills at it; a day written before then has three values
               until a run with --backfill (two years of bars) adds its open. A
               day's low, high and close are never removed, and only the newest
               REVISE_DAYS days on file are rewritten, from Yahoo, on every run
               (see update_bars): an older day is not, so a later correction on
               Yahoo's side is not picked up.
               The first run pulls two years; later runs pull a month and add
               only the days not yet on file.

Run: python3 scripts/fetch_bars.py [--backfill]

  series.json  weekly (5 years) and monthly (25 years) closes, as Yahoo sends
               them. The phantom trailing bar is left in: the moving-average
               code drops it by its own rule, and stripping it here would remove
               a real one. Refreshed at most once a day.

Run: python3 scripts/fetch_bars.py
"""

import copy
import json
import sys
import time
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import quality  # noqa: E402
import yahoo  # noqa: E402

DATA = Path(__file__).resolve().parent.parent / "public" / "data"
BARS = DATA / "bars.json"
SERIES = DATA / "series.json"
# How many of the newest days on file each run takes again from Yahoo (see update_bars). tests/data.test.ts reads this
# line to decide which days may still hold a close outside their low-high, so it stays one `REVISE_DAYS = <whole number>`.
REVISE_DAYS = 5

# Index used as the benchmark for each listing country (same map the old page used).
INDEX_MAP = {
    "US": "^GSPC", "Canada": "^GSPTSE", "Japan": "^N225", "UK": "^FTSE",
    "France": "^FCHI", "Italy": "FTSEMIB.MI", "Spain": "^IBEX", "Germany": "^GDAXI",
    "Hong Kong": "^HSI", "India": "^NSEI", "Australia": "^AXJO", "Turkey": "XU100.IS",
    "South Africa": "^J203.JO", "Netherlands": "^AEX", "Belgium": "^BFX",
    "Finland": "^OMXH25", "Norway": "OBX.OL", "Sweden": "^OMX", "Denmark": "^OMXC25",
    "Singapore": "^STI", "Ireland": "^ISEQ", "Austria": "^ATX",
}


def universe():
    """Watchlist, benchmark and index symbols, sorted and de-duplicated."""
    syms = set(INDEX_MAP.values())
    for f in ("watchlist.json", "benchmarks.json"):
        for r in json.loads((DATA / f).read_text()):
            syms.add(r["sym"])
    return sorted(syms)


def load(path):
    return json.loads(path.read_text()) if path.exists() else {}


def update_bars(syms, backfill=False):
    old = load(BARS)
    # Copies, not views: the unchanged-file test and the coverage check below compare against `old`,
    # and editing it in place made every run read as "no new days" (nothing was written from 1 Nov to 3 Nov).
    bars = copy.deepcopy(old.get("bars") or {})
    ccy = dict(old.get("ccy") or {})
    first_run = not bars
    rng = "2y" if first_run or backfill else "1mo"
    failed = []
    added_total = opened_total = revised_total = 0
    # What came back, against what is on file, so a run that adds nothing says why in the log.
    newest_seen, newest_kept, forming = Counter(), Counter(), 0

    for n, sym in enumerate(syms, 1):
        got = yahoo.chart(sym, rng, "1d")
        time.sleep(0.35)
        if got is None:
            failed.append(sym)
            continue
        day = bars.setdefault(sym, {})
        ccy[sym] = got["ccy"] or ccy.get(sym)
        now = int(time.time())
        today_local = yahoo.local_date(now, got["tz"])
        # Settled once the session has ended: the bar dated today (exchange
        # time) is written only after the exchange's regular close, which is
        # what lets the hourly job pick up a close within the hour it lands.
        settled_today = bool(got["session_end"]) and now >= got["session_end"]
        added = 0
        # The newest few days on file are taken again: Yahoo widens a day's low and high to the closing auction
        # some hours after the bar first appears (FLS.CO and SL.MI, 4 Nov), and a first capture kept forever would
        # hold a close outside its own range and miss a touch. Older days are never rewritten.
        recent = set(sorted(day)[-REVISE_DAYS:])
        for epoch, o, h, l, c in got["bars"]:
            d = yahoo.local_date(epoch, got["tz"])
            if d > today_local or (d == today_local and not settled_today):
                forming += 1
                continue
            # Yahoo sends a zero where it has no price (^OMXC25 on 3 Nov 2026 came as low 0, high 0, open 0 with a
            # close): a bar like that is no day, and a low of zero would read as a touch of every negation.
            if min(o, h, l, c) <= 0:
                continue
            newest_seen[d] += 0  # a key for the tally below
            if d in recent and day[d][:3] != [l, h, c]:
                day[d] = [l, h, c, o]
                revised_total += 1
                continue
            if d in day:
                # A day written before opens were kept gains its open; its low, high and close stay as they were.
                if len(day[d]) < 4:
                    day[d] = list(day[d][:3]) + [o]
                    opened_total += 1
                continue
            day[d] = [l, h, c, o]
            added += 1
        seen = [yahoo.local_date(b[0], got["tz"]) for b in got["bars"]]
        if seen:
            newest_seen[max(seen)] += 1
        if day:
            newest_kept[max(day)] += 1
        added_total += added
        if n % 25 == 0:
            print(f"  bars: {n}/{len(syms)}")

    tally = lambda c: ", ".join(f"{d} x{k}" for d, k in sorted(c.items(), reverse=True)[:4] if k)
    print(f"  newest bar Yahoo sent (settled or not): {tally(newest_seen)}; newest on file after this run: {tally(newest_kept)}; "
          f"{forming} bars skipped as still forming; {opened_total} opens added to days already on file; {revised_total} recent days revised")

    # Symbols with no bars on file at all are dropped from the map rather than
    # carried as empty objects, so the reader can tell "no history" from "no entry yet".
    bars = {s: d for s, d in bars.items() if d}
    covered = [s for s in syms if s in bars]
    missing = [s for s in syms if s not in bars]
    if failed:
        print(f"  no answer this run for {', '.join(failed)}"
              f" ({sum(1 for s in failed if s in bars)} of them keep the bars already on file)")
    cov = len(covered) / max(1, len(syms))
    old_cov = lambda o: len(set(o.get("bars") or {}) & set(syms)) / max(1, len(syms))
    if not quality.safe_to_write(BARS, cov, old_cov, "bars.json"):
        sys.exit(1)

    out = {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "Yahoo Finance, fetched server-side",
        "fields": "[low, high, close, open] per exchange-local date (three values on a day written before opens were kept)",
        "missing": missing,
        "ccy": {s: ccy[s] for s in bars if ccy.get(s)},
        "bars": bars,
    }
    # A run that finds nothing new must not touch the file: it is five megabytes, and a fresh timestamp alone
    # would commit all of it every hour.
    if old and {k: v for k, v in old.items() if k != "generated_at"} == {k: v for k, v in out.items() if k != "generated_at"}:
        print(f"{BARS.name} unchanged: {len(covered)}/{len(syms)} symbols, no new days")
        return
    BARS.write_text(json.dumps(out, separators=(",", ":"), sort_keys=True))
    print(f"wrote {BARS} ({BARS.stat().st_size // 1024} KB): {len(covered)}/{len(syms)} symbols, "
          f"{added_total} new days; no history for: {', '.join(missing) or 'none'}")


def series_due():
    gen = load(SERIES).get("generated_at")
    if not gen:
        return True
    age = datetime.now(timezone.utc) - datetime.strptime(gen, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    return age >= timedelta(hours=20)


def update_series(syms):
    if not series_due():
        print("series.json is current; skipping")
        return
    weekly, monthly = {}, {}
    for sym in syms:
        for rng, interval, into in (("5y", "1wk", weekly), ("25y", "1mo", monthly)):
            got = yahoo.chart(sym, rng, interval)
            time.sleep(0.35)
            if got is None:
                continue
            # Averages do not care about the last digit, so the long series are rounded to keep the file small.
            into[sym] = {"ccy": got["ccy"],
                         "t": [b[0] for b in got["bars"]],
                         "c": [round(b[4], 6) for b in got["bars"]]}
    cov = len(weekly) / max(1, len(syms))
    old_cov = lambda o: len(set(o.get("weekly") or {}) & set(syms)) / max(1, len(syms))
    if not quality.safe_to_write(SERIES, cov, old_cov, "series.json"):
        sys.exit(1)
    out = {"generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
           "source": "Yahoo Finance, fetched server-side",
           "weekly": weekly, "monthly": monthly}
    SERIES.write_text(json.dumps(out, separators=(",", ":")))
    print(f"wrote {SERIES} ({SERIES.stat().st_size // 1024} KB): {len(weekly)}/{len(syms)} weekly, "
          f"{len(monthly)}/{len(syms)} monthly")


if __name__ == "__main__":
    syms = universe()
    print(f"universe: {len(syms)} symbols")
    update_bars(syms, backfill="--backfill" in sys.argv[1:])
    update_series(syms)
