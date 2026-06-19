"""
Fetch real Antam gold price history (sell + buyback) from rohmats/antam-gold-price GitHub repo.

Source: https://github.com/rohmats/antam-gold-price
- File: data/sell/gold-sell-YYYY-MM-DD.json
- File: data/buy/gold-buy-YYYY-MM-DD.json
- Format: [[timestamp_ms, price_idr], ...]
- Daily Antam 1g sell + buyback prices
- 1g reference price; other sizes calculated via Antam pricing ratios

Note: Buyback history starts 2015-11-25 (sell starts 2010-01-04).
For pre-2015 dates, buyback is left blank (or interpolated forward from earliest).
"""

import requests
import json
import csv
import os
import sys
import time
from datetime import datetime

TODAY = datetime.now().strftime("%Y-%m-%d")
ROHMATS_SELL_URL = f"https://raw.githubusercontent.com/rohmats/antam-gold-price/main/data/sell/gold-sell-{TODAY}.json"
ROHMATS_BUY_URL = f"https://raw.githubusercontent.com/rohmats/antam-gold-price/main/data/buy/gold-buy-{TODAY}.json"

# Real Antam pricing ratios (1g base) — captured 2026-06-14 from logam-mulia-api
# Per-gram price decreases as size increases (volume discount)
# 0.5g: +3.69% premium, 1000g: -2.19% discount
RATIOS = {
    0.5:   0.5184,
    1:     1.0000,
    2:     1.9779,
    3:     2.9576,
    5:     4.9170,
    10:    9.8137,
    25:    24.4880,
    50:    48.9469,
    100:   97.8650,
    250:   244.5647,
    500:   489.0520,
    1000:  978.0893,
}

SIZES = sorted(RATIOS.keys())
COL_NAMES = {
    0.5: "antam_0_5g_idr",
    1: "antam_1g_idr",
    2: "antam_2g_idr",
    3: "antam_3g_idr",
    5: "antam_5g_idr",
    10: "antam_10g_idr",
    25: "antam_25g_idr",
    50: "antam_50g_idr",
    100: "antam_100g_idr",
    250: "antam_250g_idr",
    500: "antam_500g_idr",
    1000: "antam_1000g_idr",
}
BUY_COL_NAMES = {s: c.replace("_idr", "_buyback_idr") for s, c in COL_NAMES.items()}


def fetch_rohmats_history(url, max_retries=3, retry_delay=1800):
    """
    Download and parse the full daily history from rohmats repo.

    Retries on HTTP 404 (upstream file not yet published — common on cron
    runs that beat rohmats's 05:00 WIB scrape + GitHub propagation).
    - 200: returns {date: price_1g} dict
    - 404 after all retries: returns {} (caller should skip the update cleanly)
    - other HTTP error / network: raises (cron should fail loud)
    """
    filename = url.split('/')[-1]
    for attempt in range(1, max_retries + 1):
        try:
            print(f"📥 [attempt {attempt}/{max_retries}] Downloading {filename}...")
            r = requests.get(url, timeout=30)
            if r.status_code == 200:
                data = json.loads(r.text)
                print(f"✅ Got {len(data):,} data points")
                daily = {}
                for ts, price in data:
                    date = datetime.fromtimestamp(ts / 1000).strftime("%Y-%m-%d")
                    daily[date] = price
                print(f"📅 Date range: {min(daily.keys())} → {max(daily.keys())} ({len(daily)} days)")
                return daily
            elif r.status_code == 404:
                if attempt < max_retries:
                    wait_min = retry_delay // 60
                    print(f"⏳ 404 — upstream not yet published, sleeping {wait_min} min before retry...")
                    time.sleep(retry_delay)
                else:
                    print(f"⚠️  404 after {max_retries} attempts — upstream still not published.")
                    return {}
            else:
                # 5xx, 403, etc. — treat as fatal
                r.raise_for_status()
        except requests.exceptions.RequestException as e:
            if attempt < max_retries:
                wait_min = retry_delay // 60
                print(f"❌ Network error: {e}. Retrying in {wait_min} min...")
                time.sleep(retry_delay)
            else:
                print(f"❌ Network error after {max_retries} attempts: {e}")
                raise

    # Should never reach here, but keep mypy/linter happy
    return {}


def fill_missing_dates(daily, start_date="2025-01-01", end_date="2026-06-14"):
    """
    Fill any missing dates in the range by interpolating from neighbors.
    Antam gold isn't traded on weekends/holidays but our dashboard should
    show a value for every day in range.
    """
    from datetime import datetime, timedelta

    start = datetime.strptime(start_date, "%Y-%m-%d")
    end = datetime.strptime(end_date, "%Y-%m-%d")

    current = start
    missing = []
    while current <= end:
        d = current.strftime("%Y-%m-%d")
        if d not in daily:
            missing.append(d)
        current += timedelta(days=1)

    if not missing:
        print(f"✅ No missing dates in range")
        return daily

    print(f"⚠️  {len(missing)} missing dates — interpolating from neighbors")
    for d in missing:
        dt = datetime.strptime(d, "%Y-%m-%d")
        # Find nearest previous and next dates with data
        prev_d = None
        for offset in range(1, 10):
            check = (dt - timedelta(days=offset)).strftime("%Y-%m-%d")
            if check in daily:
                prev_d = check
                break
        next_d = None
        for offset in range(1, 10):
            check = (dt + timedelta(days=offset)).strftime("%Y-%m-%d")
            if check in daily:
                next_d = check
                break

        if prev_d and next_d:
            prev_p = daily[prev_d]
            next_p = daily[next_d]
            prev_dt = datetime.strptime(prev_d, "%Y-%m-%d")
            next_dt = datetime.strptime(next_d, "%Y-%m-%d")
            total_days = (next_dt - prev_dt).days
            days_from_prev = (dt - prev_dt).days
            ratio = days_from_prev / total_days
            daily[d] = round(prev_p + (next_p - prev_p) * ratio)
            print(f"   {d}: interpolated (between {prev_d}={prev_p:,} and {next_d}={next_p:,}) = {daily[d]:,}")
        elif prev_d:
            daily[d] = daily[prev_d]
            print(f"   {d}: forward-filled from {prev_d} = {daily[d]:,}")
        elif next_d:
            daily[d] = daily[next_d]
            print(f"   {d}: backward-filled from {next_d} = {daily[d]:,}")
        else:
            print(f"   {d}: ❌ no neighbor data, skipping")

    return daily


def apply_ratios(daily_1g, name="sell"):
    """Convert 1g prices to all 12 sizes using Antam pricing ratios."""
    col_map = COL_NAMES if name == "sell" else BUY_COL_NAMES
    rows = []
    for date in sorted(daily_1g.keys()):
        p1g = daily_1g[date]
        row = {"date": date}
        for size in SIZES:
            col = col_map[size]
            row[col] = round(p1g * RATIOS[size])
        rows.append(row)
    return rows


def merge_sell_buy(sell_rows, buy_daily):
    """
    Merge sell rows with buyback data.
    For dates with no buyback (pre-2015-11-25), use sell × 0.92 (typical ~8% spread).
    """
    print(f"\n🔗 Merging buyback data...")
    buyback_1g_earliest = min(buy_daily.keys()) if buy_daily else None
    print(f"   Buyback data starts: {buyback_1g_earliest}")

    # Build buy rows
    buy_rows = apply_ratios(buy_daily, name="buyback")
    buy_by_date = {r["date"]: r for r in buy_rows}

    # For dates without buyback, calculate from sell × 0.92 (assumed 8% spread)
    DEFAULT_SPREAD = 0.92  # buyback = sell * 0.92 (typical Antam spread)

    merged = []
    fallback_count = 0
    for sell_row in sell_rows:
        d = sell_row["date"]
        merged_row = dict(sell_row)
        if d in buy_by_date:
            # Use real buyback data
            for col in BUY_COL_NAMES.values():
                merged_row[col] = buy_by_date[d][col]
        else:
            # Fallback: estimate from sell
            fallback_count += 1
            for size in SIZES:
                merged_row[BUY_COL_NAMES[size]] = round(int(sell_row[COL_NAMES[size]]) * DEFAULT_SPREAD)
        merged.append(merged_row)

    print(f"   Real buyback rows: {len(merged) - fallback_count}")
    print(f"   Estimated buyback (sell × 0.92): {fallback_count}")
    return merged


def load_existing_csv(path="data.csv"):
    """Load existing CSV to preserve any non-Antam columns (usd_idr, etc.)."""
    if not os.path.exists(path):
        return {}
    existing = {}
    with open(path) as f:
        reader = csv.DictReader(f)
        for row in reader:
            existing[row["date"]] = row
    return existing


def write_csv(rows, path="data.csv"):
    """Write the new CSV, preserving non-Antam columns from existing data."""
    existing = load_existing_csv(path)

    # Detect extra columns not in Antam set
    antam_cols = set(COL_NAMES.values()) | set(BUY_COL_NAMES.values())
    extra_cols = []
    if existing:
        first = next(iter(existing.values()))
        extra_cols = [c for c in first.keys() if c != "date" and c not in antam_cols]

    print(f"📝 Extra columns to preserve: {extra_cols}")

    # Field order: date, sell columns, buyback columns, extras
    fieldnames = ["date"]
    fieldnames += [COL_NAMES[s] for s in SIZES]
    fieldnames += [BUY_COL_NAMES[s] for s in SIZES]
    fieldnames += extra_cols

    with open(path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            d = row["date"]
            if d in existing:
                for c in extra_cols:
                    row[c] = existing[d].get(c, "")
            writer.writerow(row)

    print(f"✅ Wrote {len(rows)} rows to {path}")


def main():
    print("=" * 60)
    print("🪙 Antam Gold Real Data Fetcher (Sell + Buyback)")
    print("=" * 60)

    # 1. Download sell history
    sell_daily = fetch_rohmats_history(ROHMATS_SELL_URL)

    # 2. Download buyback history (independent retry; if also 404, fallback to sell×0.92)
    buy_daily = fetch_rohmats_history(ROHMATS_BUY_URL)

    # 2a. If sell is empty, exit cleanly so cron skips today's update without error
    if not sell_daily:
        print("\n🛑 No new sell data after all retries. Skipping today's update (will retry on next cron).")
        sys.exit(0)

    # 2b. If buyback is empty but sell succeeded, fallback to sell×0.92 (already handled in merge_sell_buy)
    if not buy_daily:
        print("\n⚠️  No new buyback data — will estimate from sell × 0.92 for missing dates.")

    # 3. Fill missing dates in our range
    sell_end = max(sell_daily.keys()) if sell_daily else TODAY
    sell_daily = fill_missing_dates(sell_daily, start_date="2025-01-01", end_date=sell_end)
    # Buyback: fill from its own start date
    if buy_daily:
        buy_earliest = min(buy_daily.keys())
        buy_end = max(buy_daily.keys())
        buy_daily = fill_missing_dates(buy_daily, start_date=buy_earliest, end_date=buy_end)

    # 4. Apply sell ratios
    sell_rows = apply_ratios(sell_daily, name="sell")

    # 5. Merge with buyback
    rows = merge_sell_buy(sell_rows, buy_daily)

    # 6. Sanity check
    last_record = rows[-1] if rows else None
    if last_record:
        print(f"\n📊 Sample data (latest: {last_record['date']}):")
        print(f"   1g sell:    Rp {int(last_record['antam_1g_idr']):,}")
        print(f"   1g buyback: Rp {int(last_record['antam_1g_buyback_idr']):,}")
        print(f"   Spread:     Rp {int(last_record['antam_1g_idr']) - int(last_record['antam_1g_buyback_idr']):,} "
              f"({(int(last_record['antam_1g_idr']) - int(last_record['antam_1g_buyback_idr']))/int(last_record['antam_1g_buyback_idr'])*100:.2f}%)")

    # 7. Write CSV
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    write_csv(rows)

    print(f"\n🎉 Done! Total: {len(rows)} days of real Antam data (sell + buyback)")


if __name__ == "__main__":
    main()
