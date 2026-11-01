#!/usr/bin/env python3
"""Daily bars for every symbol the engine reads, and the long series for Signals.

Writes two files under public/data/:

  bars.json    append-only daily bars, keyed by exchange-local date:
               {"bars": {SYM: {"2026-10-30": [low, high, close], ...}}, "ccy": {SYM: "USD"}}
               The order [low, high, close] is the one the old page used:
               a long reads index 0 (the low), a short reads index 1 (the high).
               A day is written once its session has ended and is never removed
               or rewritten, so a later correction on Yahoo's side is not picked up.
               The first run pulls two years; later runs pull a month and add
               only the days not yet on file.

  series.json  weekly (5 years) and monthly (25 years) closes, as Yahoo sends
               them. The phantom trailing bar is left in: the moving-average
               code drops it by its own rule, and stripping it here would remove
               a real one. Refreshed at most once a day.

Run: python3 scripts/fetch_bars.py
"""

import json
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import quality  # noqa: E402
import yahoo  # noqa: E402

DATA = Path(__file__).resolve().parent.parent / "public" / "data"
BARS = DATA / "bars.json"
SERIES = DATA / "series.json"

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


def update_bars(syms):
    old = load(BARS)
    bars = old.get("bars") or {}
    ccy = old.get("ccy") or {}
    first_run = not bars
    rng = "2y" if first_run else "1mo"
    failed = []
    added_total = 0

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
        for epoch, _o, h, l, c in got["bars"]:
            d = yahoo.local_date(epoch, got["tz"])
            if d > today_local or d in day or (d == today_local and not settled_today):
                continue
            day[d] = [l, h, c]
            added += 1
        added_total += added
        if n % 25 == 0:
            print(f"  bars: {n}/{len(syms)}")

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
        "fields": "[low, high, close] per exchange-local date",
        "missing": missing,
        "ccy": {s: ccy[s] for s in bars if ccy.get(s)},
        "bars": bars,
    }
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
            into[sym] = {"ccy": got["ccy"],
                         "t": [b[0] for b in got["bars"]],
                         "c": [b[4] for b in got["bars"]]}
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
    update_bars(syms)
    update_series(syms)
