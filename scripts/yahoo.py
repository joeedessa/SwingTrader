"""Yahoo Finance access shared by the data jobs.

Runs only inside GitHub Actions or on this Mac: no key, no proxy, no paid
feed. A static page cannot call Yahoo directly (no CORS header), so the page
reads the committed files and these jobs do the fetching.
"""

import json
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime
from zoneinfo import ZoneInfo

UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"}
SPARK = "https://query1.finance.yahoo.com/v7/finance/spark?symbols="
CHART = "https://query1.finance.yahoo.com/v8/finance/chart/"


def get_json(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
        return json.loads(r.read())


def session_hours(meta):
    """The exchange's regular session as [timezone, open, close] in local minutes.

    The local clock and the zone name are stored rather than Yahoo's epochs, so
    the session can be rebuilt on any later day, across clock changes.
    Returns None when Yahoo does not give enough to be sure.
    """
    tz = meta.get("exchangeTimezoneName")
    reg = (meta.get("currentTradingPeriod") or {}).get("regular") or {}
    start, end = reg.get("start"), reg.get("end")
    if not tz or start is None or end is None:
        return None
    try:
        zone = ZoneInfo(tz)
    except Exception:                         # noqa: BLE001 - unknown zone name
        return None
    lo = datetime.fromtimestamp(start, zone)
    hi = datetime.fromtimestamp(end, zone)
    o, c = lo.hour * 60 + lo.minute, hi.hour * 60 + hi.minute
    if c <= o:
        return None
    return [tz, o, c]


def fetch_quotes(symbols):
    """Live price and the exchange's own previous close, ten symbols at a time.

    The previous close comes from the intraday endpoint's metadata because it
    is the reference the exchange uses. For round-the-clock instruments (gold,
    bitcoin) the previous daily bar is not the same number.
    """
    out = {}
    for i in range(0, len(symbols), 10):
        chunk = symbols[i:i + 10]
        url = (SPARK + ",".join(urllib.parse.quote(s) for s in chunk)
               + "&range=1d&interval=5m")
        try:
            j = get_json(url)
        except Exception as e:                    # noqa: BLE001 - one bad chunk is not fatal
            print(f"  ! quotes chunk {i // 10}: {type(e).__name__} {e}", file=sys.stderr)
            time.sleep(1.0)
            continue
        for row in (j.get("spark", {}).get("result") or []):
            m = (row.get("response") or [{}])[0].get("meta") or {}
            px, prev = m.get("regularMarketPrice"), m.get("previousClose")
            if px is None:
                continue
            rec = {"c": px, "ccy": m.get("currency")}
            if prev is not None:
                rec["p"] = prev
            if m.get("regularMarketTime"):
                rec["t"] = m["regularMarketTime"]
            hours = session_hours(m)
            if hours:
                rec["z"] = hours
            out[row["symbol"]] = rec
        time.sleep(0.35)
    return out


def chart(symbol, rng, interval):
    """One symbol's bars from the chart endpoint.

    Returns {"ccy", "tz", "session_end", "bars": [(epoch, open, high, low, close), ...]}
    with incomplete bars (any null field) dropped, or None when Yahoo answers
    with nothing usable. session_end is the epoch at which the current
    trading day's regular session ends, so a caller can tell a bar that is
    still forming from one that has settled.
    """
    url = CHART + urllib.parse.quote(symbol) + f"?range={rng}&interval={interval}"
    try:
        j = get_json(url)
    except Exception as e:                        # noqa: BLE001
        print(f"  ! chart {symbol}: {type(e).__name__} {e}", file=sys.stderr)
        return None
    res = ((j.get("chart") or {}).get("result") or [None])[0]
    if not res:
        return None
    meta = res.get("meta") or {}
    q = ((res.get("indicators") or {}).get("quote") or [{}])[0]
    ts = res.get("timestamp") or []
    cols = [q.get(k) or [] for k in ("open", "high", "low", "close")]
    bars = []
    for t, o, h, l, c in zip(ts, *cols):
        if None in (o, h, l, c):
            continue
        # Kept exactly as Yahoo sends them. They are float32 values widened to doubles (5.429999828338623 for a
        # 5.43 close), and the engine compares a close with a level exactly, so a tie at the level falls on
        # whichever side that noise does. Rounding to "clean" decimals would move ties relative to the old page.
        bars.append((t, o, h, l, c))
    if not bars:
        return None
    reg = (meta.get("currentTradingPeriod") or {}).get("regular") or {}
    return {"ccy": meta.get("currency"), "tz": meta.get("exchangeTimezoneName"),
            "session_end": reg.get("end"), "bars": bars}


def local_date(epoch, tz):
    """The exchange's calendar date for a bar's epoch, so a bar keys on the day it traded."""
    zone = ZoneInfo(tz) if tz else ZoneInfo("UTC")
    return datetime.fromtimestamp(epoch, zone).date().isoformat()
