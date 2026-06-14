#!/usr/bin/env python3
"""
build_data.py — Convert data.csv → data.json for static deployment.

Output: data.json dengan struktur:
{
  "summary": { ... ringkasan total ... },
  "records": [ {date, antam_0_5g, antam_0_5g_buyback, ...}, ... ],
  "sizes": [0.5, 1, 2, 3, 5, 10, 25, 50, 100, 250, 500, 1000]
}

Filter (sizes, date range) dilakukan di browser oleh frontend, bukan di sini.
"""
import json
import sys
from pathlib import Path
import pandas as pd

ROOT = Path(__file__).parent
CSV_PATH = ROOT / "data.csv"
JSON_PATH = ROOT / "data" / "data.json"

ANTAM_SIZES = [0.5, 1, 2, 3, 5, 10, 25, 50, 100, 250, 500, 1000]


def size_to_key(s: float) -> str:
    """0.5 → 'antam_0_5g', 1 → 'antam_1g', 1000 → 'antam_1000g'"""
    if s == int(s):
        return f"antam_{int(s)}g"
    # For 0.5: '0.5' → '0_5' → 'antam_0_5g'
    return f"antam_{str(s).replace('.', '_')}g"


def size_to_buyback_key(s: float) -> str:
    return f"{size_to_key(s)}_buyback"


def size_to_csv_col(s: float, buyback: bool = False) -> str:
    """0.5 → 'antam_0_5g_idr', 1 → 'antam_1g_idr', 1000 → 'antam_1000g_idr'"""
    base = size_to_key(s)
    if buyback:
        return f"{base}_buyback_idr"
    return f"{base}_idr"


def main():
    if not CSV_PATH.exists():
        print(f"❌ CSV not found: {CSV_PATH}")
        sys.exit(1)

    print(f"📖 Reading {CSV_PATH}...")
    df = pd.read_csv(CSV_PATH)
    print(f"   {len(df)} rows, columns: {list(df.columns)[:5]}...")

    # Map CSV column names (antam_0_5g_idr) → JSON keys (antam_0_5g)
    size_columns = {}
    for s in ANTAM_SIZES:
        sell_col_csv = size_to_csv_col(s, buyback=False)
        buy_col_csv = size_to_csv_col(s, buyback=True)
        if sell_col_csv in df.columns:
            size_columns[sell_col_csv] = size_to_key(s)
        if buy_col_csv in df.columns:
            size_columns[buy_col_csv] = size_to_buyback_key(s)

    print(f"   Mapped {len(size_columns)} columns (sell + buyback)")

    # Build records — columnar format (way more compact than array of objects)
    dates = []
    columns = {}  # key → list of values (aligned with dates)
    for s in ANTAM_SIZES:
        columns[size_to_key(s)] = []
        columns[size_to_buyback_key(s)] = []

    for _, row in df.iterrows():
        dates.append(row["date"])
        for s in ANTAM_SIZES:
            sell_col_csv = size_to_csv_col(s, buyback=False)
            buy_col_csv = size_to_csv_col(s, buyback=True)
            sell_val = row[sell_col_csv] if sell_col_csv in df.columns else None
            buy_val = row[buy_col_csv] if buy_col_csv in df.columns else None
            columns[size_to_key(s)].append(None if pd.isna(sell_val) else int(sell_val))
            columns[size_to_buyback_key(s)].append(None if pd.isna(buy_val) else int(buy_val))

    # Compute overall summary (just first 1g for default view)
    sells_1g = [v for v in columns["antam_1g"] if v is not None]
    if sells_1g:
        # Find latest non-null buyback
        buyback_1g_latest = None
        for v in reversed(columns["antam_1g_buyback"]):
            if v is not None:
                buyback_1g_latest = v
                break
        summary = {
            "first_date": dates[0],
            "last_date": dates[-1],
            "first_price": sells_1g[0],
            "last_price": sells_1g[-1],
            "high": max(sells_1g),
            "low": min(sells_1g),
            "avg": round(sum(sells_1g) / len(sells_1g)),
            "total_days": len(dates),
            "change_idr": sells_1g[-1] - sells_1g[0],
            "change_pct": round((sells_1g[-1] - sells_1g[0]) / sells_1g[0] * 100, 2),
            "buyback_1g": buyback_1g_latest,
        }
        if summary["buyback_1g"]:
            summary["spread_idr"] = summary["last_price"] - summary["buyback_1g"]
            summary["spread_pct"] = round(summary["spread_idr"] / summary["buyback_1g"] * 100, 2)
    else:
        summary = {}

    payload = {
        "summary": summary,
        "sizes": ANTAM_SIZES,
        "date": dates,    # array of date strings, e.g. ["2010-01-04", ...]
        "data": columns,  # { "antam_1g": [...], "antam_1g_buyback": [...], ... }
    }

    # Write JSON
    JSON_PATH.parent.mkdir(parents=True, exist_ok=True)
    print(f"💾 Writing {JSON_PATH}...")
    with open(JSON_PATH, "w") as f:
        json.dump(payload, f, separators=(",", ":"))

    size_kb = JSON_PATH.stat().st_size / 1024
    print(f"✅ Done: {len(dates)} records, {size_kb:.1f} KB JSON (columnar)")
    print(f"   Date range: {dates[0]} → {dates[-1]}")


if __name__ == "__main__":
    main()
