"""Train time series models on Antam gold prices and export predictions.

For each of 12 Antam sizes, fits a Holt-Winters Exponential Smoothing model
(additive trend, no seasonality — daily gold prices are dominated by macro
trend, not intra-week/seasonal patterns). Forecasts 10 years out at
predefined horizons and exports:

  data/predictions.json
    {
      generated_at, model, training_range,
      sizes: {
        "1": { current_price, current_date, yoy_growth_pct,
               cagr_1y/3y/5y/10y/all,
               predictions: [
                 { horizon, date, base, p25, p75, p5, p95 }
               ] },
        ...
      },
      buyback_spread_pct
    }

Buyback predictions are derived: predicted_sell * (1 - current_spread_pct).
"""
from __future__ import annotations

import json
import sys
import warnings
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

# Suppress statsmodels warnings (convergence etc.)
warnings.filterwarnings("ignore")

# ---------- Config ----------
PROJECT_DIR = Path(__file__).resolve().parent
DATA_CSV = PROJECT_DIR / "data.csv"
OUT_JSON = PROJECT_DIR / "data" / "predictions.json"
OUT_JSON.parent.mkdir(parents=True, exist_ok=True)

# (label, days_from_today)
HORIZONS = [
    ("1m", 30),
    ("3m", 90),
    ("6m", 180),
    ("1y", 365),
    ("2y", 730),
    ("3y", 1095),
    ("5y", 1825),
    ("10y", 3650),
]

SIZES = [0.5, 1, 2, 3, 5, 10, 25, 50, 100, 250, 500, 1000]

# Z-scores for normal distribution percentiles
Z = {
    "p5": -1.645,
    "p25": -0.674,
    "p50": 0.0,
    "p75": 0.674,
    "p95": 1.645,
}


def log(msg: str) -> None:
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


def cagr(start: float, end: float, years: float) -> float | None:
    if start is None or end is None or start <= 0 or years <= 0:
        return None
    return ((end / start) ** (1 / years) - 1) * 100


def fit_holt_winters(series: pd.Series) -> tuple:
    """Fit Holt-Winters with additive trend.

    Returns (fitted_model, residual_std, last_value, last_index).
    """
    from statsmodels.tsa.holtwinters import ExponentialSmoothing

    # Drop leading NaN; fill any internal NaN with ffill
    s = series.dropna()
    if len(s) < 365:
        raise ValueError(f"need >= 365 points, got {len(s)}")

    # Use log-prices so growth is multiplicative (better for gold)
    log_s = np.log(s)

    model = ExponentialSmoothing(
        log_s,
        trend="add",
        seasonal=None,
        initialization_method="estimated",
    ).fit(optimized=True)

    # Compute residual std on original (non-log) scale
    fitted = np.exp(model.fittedvalues)
    residuals = (s - fitted).dropna()
    residual_std = float(residuals.std())

    return model, residual_std, float(s.iloc[-1]), s.index[-1]


def forecast_with_intervals(model, last_value: float, residual_std: float,
                            steps: int) -> dict[int, dict]:
    """Forecast `steps` days ahead; return dict {day_offset: {base, p5, p25, p75, p95}}.

    Uncertainty scales with sqrt(forecast horizon) — standard time-series assumption.
    """
    forecast = model.forecast(steps)
    # forecast is in log-space
    out = {}
    for h in range(1, steps + 1):
        base = float(np.exp(forecast.iloc[h - 1]))
        # Sigma grows with sqrt(horizon)
        sigma_h = residual_std * np.sqrt(h)
        out[h] = {
            "base": base,
            "p5": base * np.exp(Z["p5"] * sigma_h / base),
            "p25": base * np.exp(Z["p25"] * sigma_h / base),
            "p75": base * np.exp(Z["p75"] * sigma_h / base),
            "p95": base * np.exp(Z["p95"] * sigma_h / base),
        }
    return out


def main() -> int:
    if not DATA_CSV.exists():
        log(f"❌ {DATA_CSV} not found")
        return 1

    log(f"Loading {DATA_CSV}...")
    df = pd.read_csv(DATA_CSV, parse_dates=["date"])
    df = df.sort_values("date").reset_index(drop=True)
    log(f"  {len(df)} rows, {df['date'].min().date()} → {df['date'].max().date()}")

    last_date = df["date"].iloc[-1]
    last_date_str = last_date.strftime("%Y-%m-%d")

    # Current buyback spread: average of last 30 days (sell - buyback) / sell
    recent = df.tail(30)
    spreads = []
    for sz in SIZES:
        sell_col = f"antam_{int(sz) if sz == int(sz) else str(sz).replace('.', '_')}_g_idr"
        buyback_col = f"{sell_col[:-4]}_buyback_idr"
        if sell_col in df.columns and buyback_col in df.columns:
            valid = recent[[sell_col, buyback_col]].dropna()
            if not valid.empty:
                sp = ((valid[sell_col] - valid[buyback_col]) / valid[sell_col]).mean()
                spreads.append(sp)
    avg_spread_pct = float(np.mean(spreads) * 100) if spreads else 4.0
    log(f"  Current buyback spread: {avg_spread_pct:.2f}%")

    result_sizes = {}

    for sz in SIZES:
        # CSV column name format: "0.5" → "0_5", "1" → "1", "10" → "10"
        size_key = str(sz).replace(".", "_")
        sell_col = f"antam_{size_key}g_idr"
        if sell_col not in df.columns:
            log(f"  ⚠️  skip {sz}g: column {sell_col} missing")
            continue

        log(f"  Training {sz}g ({sell_col})...")
        try:
            model, sigma, current_price, _ = fit_holt_winters(df[sell_col])

            # Max horizon days for this size
            max_days = max(d for _, d in HORIZONS)
            forecasts = forecast_with_intervals(model, current_price, sigma, max_days)

            # Sample at horizons
            preds = []
            for label, days in HORIZONS:
                target_date = (last_date + timedelta(days=days)).strftime("%Y-%m-%d")
                f = forecasts[days]
                preds.append({
                    "horizon": label,
                    "days": days,
                    "date": target_date,
                    "base": round(f["base"]),
                    "p5": round(f["p5"]),
                    "p25": round(f["p25"]),
                    "p75": round(f["p75"]),
                    "p95": round(f["p95"]),
                })

            # CAGR metrics
            def cagr_n_days(n: int) -> float | None:
                if len(df) < n + 1:
                    return None
                start = df[sell_col].iloc[-n - 1]
                end = df[sell_col].iloc[-1]
                if pd.isna(start) or pd.isna(end) or start <= 0:
                    return None
                return cagr(start, end, n / 365.25)

            yoy = cagr_n_days(365)
            cagr_3y = cagr_n_days(365 * 3)
            cagr_5y = cagr_n_days(365 * 5)
            cagr_10y = cagr_n_days(365 * 10)
            cagr_all = cagr_n_days(len(df) - 1)

            result_sizes[size_key] = {
                "size_gram": sz,
                "size_label": f"{sz}g".replace(".0g", "g"),
                "current_price": round(current_price),
                "current_date": last_date_str,
                "yoy_growth_pct": round(yoy, 2) if yoy is not None else None,
                "cagr_1y": round(yoy, 2) if yoy is not None else None,
                "cagr_3y": round(cagr_3y, 2) if cagr_3y is not None else None,
                "cagr_5y": round(cagr_5y, 2) if cagr_5y is not None else None,
                "cagr_10y": round(cagr_10y, 2) if cagr_10y is not None else None,
                "cagr_all": round(cagr_all, 2) if cagr_all is not None else None,
                "predictions": preds,
            }
            log(f"    {sz}g: current=Rp {current_price:,.0f}, "
                f"3y base=Rp {preds[5]['base']:,.0f}, "
                f"CAGR 5y={cagr_5y:.2f}%, sigma={sigma:.4f}")

        except Exception as e:
            log(f"    ❌ {sz}g failed: {e}")
            continue

    output = {
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "model": "HoltWinters(additive trend, log-space)",
        "library": "statsmodels",
        "training_range": {
            "start": df["date"].iloc[0].strftime("%Y-%m-%d"),
            "end": last_date_str,
            "n_days": len(df),
        },
        "buyback_spread_pct": round(avg_spread_pct, 2),
        "horizons": [h[0] for h in HORIZONS],
        "sizes": result_sizes,
    }

    OUT_JSON.write_text(json.dumps(output, indent=2))
    size_kb = OUT_JSON.stat().st_size / 1024
    log(f"✅ Wrote {OUT_JSON} ({size_kb:.1f} KB, {len(result_sizes)} sizes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
