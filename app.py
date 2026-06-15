"""Streamlit dashboard for logam antam (precious metals) prices in IDR.

Run: streamlit run app.py
"""
from __future__ import annotations

from pathlib import Path
from datetime import date, timedelta

import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
import streamlit as st

# ---------------------------------------------------------------------------
# Page config
# ---------------------------------------------------------------------------
st.set_page_config(
    page_title="Logam Dashboard",
    page_icon="🪙",
    layout="wide",
    initial_sidebar_state="expanded",
)

DATA_PATH = Path(__file__).parent / "data.csv"


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------
@st.cache_data
def load_data() -> pd.DataFrame:
    df = pd.read_csv(DATA_PATH, parse_dates=["date"])
    df = df.sort_values("date").reset_index(drop=True)
    return df


def compute_metrics(df: pd.DataFrame) -> dict:
    if df.empty:
        return {}
    latest = df.iloc[-1]
    earliest = df.iloc[0]
    period_high = df["antam_1g_idr"].max()
    period_low = df["antam_1g_idr"].min()
    change = latest["antam_1g_idr"] - earliest["antam_1g_idr"]
    pct = (change / earliest["antam_1g_idr"]) * 100
    return {
        "latest_date": latest["date"].date(),
        "latest_price": int(latest["antam_1g_idr"]),
        "earliest_price": int(earliest["antam_1g_idr"]),
        "change_idr": int(change),
        "change_pct": round(pct, 2),
        "period_high": int(period_high),
        "period_low": int(period_low),
        "avg_price": int(df["antam_1g_idr"].mean()),
        "usd_idr": float(latest["usd_idr"]),
        "world_gold_usd": float(latest["world_gold_usd_oz"]),
        "silver_usd": float(latest["world_silver_usd_oz"]),
    }


def idr_format(n: float) -> str:
    return f"Rp {n:,.0f}".replace(",", ".")


# ---------------------------------------------------------------------------
# Sidebar
# ---------------------------------------------------------------------------
df = load_data()
m = compute_metrics(df)

st.sidebar.title("⚙️ Pengaturan")
st.sidebar.markdown("**Periode data**")
min_date = df["date"].min().date()
max_date = df["date"].max().date()
date_range = st.sidebar.date_input(
    "Rentang tanggal",
    value=(min_date, max_date),
    min_value=min_date,
    max_value=max_date,
)

if isinstance(date_range, tuple) and len(date_range) == 2:
    start_date, end_date = date_range
else:
    start_date, end_date = min_date, max_date

mask = (df["date"].dt.date >= start_date) & (df["date"].dt.date <= end_date)
fdf = df.loc[mask].copy()
fm = compute_metrics(fdf) if not fdf.empty else {}

st.sidebar.markdown("---")
st.sidebar.markdown("**Logam yang ditampilkan**")
show_antam = st.sidebar.checkbox("Antam (batangan)", value=True)
show_world_gold = st.sidebar.checkbox("Emas Dunia (XAU/IDR)", value=True)
show_silver = st.sidebar.checkbox("Perak (XAG/IDR)", value=True)
show_usdidr = st.sidebar.checkbox("Kurs USD/IDR", value=False)

st.sidebar.markdown("---")
st.sidebar.markdown("**Ukuran Antam**")
antam_sizes = st.sidebar.multiselect(
    "Pilih ukuran (gram)",
    options=[1, 5, 10, 25, 50, 100, 250, 500, 1000],
    default=[1, 5, 10, 100],
    format_func=lambda x: f"{x} gram",
)

st.sidebar.markdown("---")
st.sidebar.caption(
    f"📊 Total: {len(df)} hari data\n"
    f"📅 {min_date} → {max_date}"
)


# ---------------------------------------------------------------------------
# Header
# ---------------------------------------------------------------------------
st.title("🪙 Dashboard Logam Mulia")
st.markdown(
    f"**Harga harian logam mulia dalam Rupiah** · "
    f"Sumber: Sample data realistis (lihat README) · "
    f"Update terakhir: **{m.get('latest_date', '-')}**"
)


# ---------------------------------------------------------------------------
# Top KPIs
# ---------------------------------------------------------------------------
if fm:
    c1, c2, c3, c4, c5 = st.columns(5)
    c1.metric(
        "Antam 1g (periode ini)",
        idr_format(fm["latest_price"]),
        f"{fm['change_pct']:+.2f}%",
        delta_color="normal",
    )
    c2.metric(
        "Perubahan (Rp)",
        f"{fm['change_idr']:+,}".replace(",", "."),
    )
    c3.metric(
        "Tertinggi",
        idr_format(fm["period_high"]),
    )
    c4.metric(
        "Terendah",
        idr_format(fm["period_low"]),
    )
    c5.metric(
        "Rata-rata",
        idr_format(fm["avg_price"]),
    )


# ---------------------------------------------------------------------------
# Main chart
# ---------------------------------------------------------------------------
st.markdown("### 📈 Tren Harga")

if not fdf.empty:
    fig = go.Figure()

    if show_antam:
        for size in antam_sizes:
            col = f"antam_{size}g_idr"
            if col in fdf.columns:
                fig.add_trace(go.Scatter(
                    x=fdf["date"], y=fdf[col],
                    mode="lines",
                    name=f"Antam {size}g",
                    hovertemplate=f"<b>Antam {size}g</b><br>%{{x|%d %b %Y}}<br>" + idr_format(0).replace("0", "%{y:,.0f}").replace(",", ".") + "<extra></extra>",
                ))

    if show_world_gold:
        fig.add_trace(go.Scatter(
            x=fdf["date"], y=fdf["world_gold_idr_gram"],
            mode="lines",
            name="Emas Dunia /gram (IDR)",
            line=dict(dash="dot"),
            yaxis="y2",
            hovertemplate="<b>Emas Dunia/gram</b><br>%{x|%d %b %Y}<br>Rp %{y:,.0f}<extra></extra>",
        ))

    if show_silver:
        # Silver per gram in IDR
        silver_idr_g = fdf["world_silver_usd_oz"] * fdf["usd_idr"] / 31.1035
        fig.add_trace(go.Scatter(
            x=fdf["date"], y=silver_idr_g,
            mode="lines",
            name="Perak /gram (IDR)",
            line=dict(dash="dash"),
            yaxis="y2",
            hovertemplate="<b>Perak/gram</b><br>%{x|%d %b %Y}<br>Rp %{y:,.0f}<extra></extra>",
        ))

    if show_usdidr:
        fig.add_trace(go.Scatter(
            x=fdf["date"], y=fdf["usd_idr"],
            mode="lines",
            name="USD/IDR",
            line=dict(color="gray", dash="dot"),
            yaxis="y2",
            hovertemplate="<b>USD/IDR</b><br>%{x|%d %b %Y}<br>%{y:,.2f}<extra></extra>",
        ))

    fig.update_layout(
        height=500,
        hovermode="x unified",
        legend=dict(orientation="h", y=-0.15),
        xaxis_title="Tanggal",
        yaxis=dict(
            title="Harga Antam (IDR)",
            tickformat=",.0f",
        ),
        yaxis2=dict(
            title="Harga/gram & Kurs",
            overlaying="y",
            side="right",
            tickformat=",.0f",
        ),
        template="plotly_white",
    )
    st.plotly_chart(fig, use_container_width=True)
else:
    st.warning("Tidak ada data untuk rentang yang dipilih.")


# ---------------------------------------------------------------------------
# Secondary chart: World gold price USD
# ---------------------------------------------------------------------------
st.markdown("### 🌍 Harga Emas Dunia (USD/oz)")

if not fdf.empty:
    col1, col2 = st.columns([3, 1])
    with col1:
        fig2 = go.Figure()
        fig2.add_trace(go.Candlestick(
            x=fdf["date"],
            open=fdf["world_gold_usd_oz"].rolling(1).mean(),
            high=fdf["world_gold_usd_oz"] * 1.005,
            low=fdf["world_gold_usd_oz"] * 0.995,
            close=fdf["world_gold_usd_oz"],
            name="XAU/USD",
        ))
        fig2.update_layout(
            height=350,
            xaxis_rangeslider_visible=False,
            template="plotly_white",
            yaxis_title="USD per troy ounce",
        )
        st.plotly_chart(fig2, use_container_width=True)
    with col2:
        st.metric("XAU/USD saat ini", f"${m['world_gold_usd']:,.2f}")
        st.metric("XAG/USD saat ini", f"${m['silver_usd']:,.2f}")
        st.metric("USD/IDR saat ini", f"Rp {m['usd_idr']:,.2f}")


# ---------------------------------------------------------------------------
# Monthly summary
# ---------------------------------------------------------------------------
st.markdown("### 📊 Ringkasan Bulanan (Antam 1g)")

if not fdf.empty:
    monthly = (
        fdf.set_index("date")
        .resample("ME")
        .agg(
            open=("antam_1g_idr", "first"),
            high=("antam_1g_idr", "max"),
            low=("antam_1g_idr", "min"),
            close=("antam_1g_idr", "last"),
            avg=("antam_1g_idr", "mean"),
        )
    )
    monthly["change_pct"] = ((monthly["close"] - monthly["open"]) / monthly["open"] * 100).round(2)
    monthly_display = monthly.copy()
    monthly_display.index = monthly_display.index.strftime("%B %Y")
    monthly_display = monthly_display.style.format({
        "open": "{:,.0f}",
        "high": "{:,.0f}",
        "low": "{:,.0f}",
        "close": "{:,.0f}",
        "avg": "{:,.0f}",
        "change_pct": "{:+.2f}%",
    })
    st.dataframe(monthly_display, use_container_width=True)


# ---------------------------------------------------------------------------
# Distribution
# ---------------------------------------------------------------------------
st.markdown("### 📉 Distribusi Harga")

if not fdf.empty:
    c1, c2 = st.columns(2)
    with c1:
        fig3 = px.histogram(
            fdf, x="antam_1g_idr", nbins=40,
            title="Distribusi harga Antam 1g",
            labels={"antam_1g_idr": "Harga (IDR)"},
        )
        fig3.update_layout(height=350, template="plotly_white", showlegend=False)
        st.plotly_chart(fig3, use_container_width=True)
    with c2:
        # Day-of-week average
        fdf2 = fdf.copy()
        fdf2["weekday"] = fdf2["date"].dt.day_name()
        order = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
        weekday_avg = fdf2.groupby("weekday")["antam_1g_idr"].mean().reindex(order)
        fig4 = px.bar(
            x=weekday_avg.index, y=weekday_avg.values,
            title="Rata-rata harga per hari dalam seminggu",
            labels={"x": "Hari", "y": "Rata-rata (IDR)"},
        )
        fig4.update_layout(height=350, template="plotly_white", showlegend=False)
        st.plotly_chart(fig4, use_container_width=True)


# ---------------------------------------------------------------------------
# Data table
# ---------------------------------------------------------------------------
with st.expander("🗂️ Lihat data mentah"):
    st.dataframe(
        fdf.style.format({
            "antam_1g_idr": "{:,.0f}",
            "antam_5g_idr": "{:,.0f}",
            "antam_10g_idr": "{:,.0f}",
            "antam_25g_idr": "{:,.0f}",
            "antam_50g_idr": "{:,.0f}",
            "antam_100g_idr": "{:,.0f}",
            "antam_250g_idr": "{:,.0f}",
            "antam_500g_idr": "{:,.0f}",
            "antam_1000g_idr": "{:,.0f}",
            "world_gold_usd_oz": "{:,.2f}",
            "world_silver_usd_oz": "{:,.2f}",
            "usd_idr": "{:,.2f}",
            "world_gold_idr_gram": "{:,.0f}",
        }),
        use_container_width=True,
        height=400,
    )

    csv = fdf.to_csv(index=False).encode("utf-8")
    st.download_button(
        "⬇️ Download CSV",
        data=csv,
        file_name=f"logam_idr_{start_date}_{end_date}.csv",
        mime="text/csv",
    )


# ---------------------------------------------------------------------------
# Footer
# ---------------------------------------------------------------------------
st.markdown("---")
st.caption(
    "🪙 Logam Dashboard · Data sample (bukan real-time). "
    "Untuk data real Antam, upload CSV di [GitHub issue](https://github.com) atau "
    "konfigurasikan live API di `data.py`."
)
