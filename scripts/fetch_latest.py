#!/usr/bin/env python3
"""Latest price and the exchange's previous close for every symbol, to public/data/prices-latest.json.

This is the only file the quarter-hourly job writes, so it stays small. Symbols
the quote call misses fall back to the last two daily closes, which are right
for anything whose session matches the calendar day.

Run: python3 scripts/fetch_latest.py
"""

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fetch_bars  # noqa: E402 - the shared universe
import quality  # noqa: E402
import yahoo  # noqa: E402

OUT = Path(__file__).resolve().parent.parent / "public" / "data" / "prices-latest.json"


def main():
    syms = fetch_bars.universe()
    tip = yahoo.fetch_quotes(syms)

    missing = [s for s in syms if s not in tip]
    if missing:
        print(f"  {len(missing)} without a quote; falling back to the last daily closes")
        for sym in missing:
            got = yahoo.chart(sym, "5d", "1d")
            if not got:
                continue
            closes = got["bars"]
            tip[sym] = {"c": closes[-1][4], "ccy": got["ccy"], "t": closes[-1][0]}
            if len(closes) > 1:
                tip[sym]["p"] = closes[-2][4]

    if not tip:
        sys.exit("aborting: no prices fetched")

    # Session hours are shared by a few dozen exchanges, so they are stored once
    # in a table and each symbol keeps an index into it.
    table, index = [], {}
    for rec in tip.values():
        h = rec.pop("z", None)
        if not h:
            continue
        key = "|".join(map(str, h))
        if key not in index:
            index[key] = len(table)
            table.append(h)
        rec["z"] = index[key]

    cov = len(tip) / max(1, len(syms))
    # Counted over this universe only: the file copied from macro-compass lists more symbols than this repo tracks.
    old_cov = lambda old: len(set(old.get("latest") or {}) & set(syms)) / max(1, len(syms))
    if not quality.safe_to_write(OUT, cov, old_cov, "prices-latest.json"):
        sys.exit(1)

    out = {"generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
           "source": "Yahoo Finance, fetched server-side",
           "sessions": table,
           "latest": tip}
    OUT.write_text(json.dumps(out, separators=(",", ":")))
    print(f"wrote {OUT} ({OUT.stat().st_size // 1024} KB): {len(tip)}/{len(syms)} symbols ({cov:.0%})")


if __name__ == "__main__":
    main()
