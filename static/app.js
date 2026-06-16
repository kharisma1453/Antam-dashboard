// Antam Gold Dashboard - frontend logic (with buyback support)
const SIZES = [0.5, 1, 2, 3, 5, 10, 25, 50, 100, 250, 500, 1000];
const DEFAULT_SIZES = [1];

let chart = null;
let monthlyChart = null;
let fullData = null;
let allRecords = null;
let showBuyback = true;
let showSpreadFill = true;
let availableYears = [];
let currentYear = null;
// Columnar data (raw from data.json) — converted to row records on demand
let rawDates = [];
let rawColumns = {};

const idr = (n) => 'Rp ' + Math.round(n).toLocaleString('id-ID');
const idrCompact = (n) => {
  if (n >= 1_000_000) return 'Rp ' + (n / 1_000_000).toFixed(2) + 'jt';
  if (n >= 1_000) return 'Rp ' + (n / 1_000).toFixed(0) + 'rb';
  return 'Rp ' + n;
};

const sellKey = (s) => `antam_${s == Math.floor(s) ? s : s}g`;
const buybackKey = (s) => `antam_${s == Math.floor(s) ? s : s}g_buyback`;

// ----- Init -----
// Force scroll to top on every page load/refresh
if ('scrollRestoration' in history) {
  history.scrollRestoration = 'manual';
}
window.scrollTo(0, 0);

document.addEventListener('DOMContentLoaded', () => {
  // Re-apply on DOMContentLoaded in case content shifted during load
  window.scrollTo(0, 0);
  buildSizeToggles();
  attachListeners();
  loadData();
  loadPredictions();
});

function buildSizeToggles() {
  const wrap = document.getElementById('size-toggles');
  SIZES.forEach((s) => {
    const btn = document.createElement('button');
    btn.className = 'size-toggle' + (DEFAULT_SIZES.includes(s) ? ' active' : '');
    btn.textContent = formatSize(s) + 'g';
    btn.dataset.size = s;
    btn.addEventListener('click', () => {
      btn.classList.toggle('active');
      applyFilter();
    });
    wrap.appendChild(btn);
  });
}

function formatSize(s) {
  return s.toString();
}

function getActiveSizes() {
  return Array.from(document.querySelectorAll('.size-toggle.active'))
    .map((b) => parseFloat(b.dataset.size))
    .sort((a, b) => a - b);
}

function attachListeners() {
  document.getElementById('start-date').addEventListener('change', applyFilter);
  document.getElementById('end-date').addEventListener('change', applyFilter);
  document.getElementById('show-buyback').addEventListener('change', (e) => {
    showBuyback = e.target.checked;
    renderChart(allRecords, getActiveSizes());
  });
  document.getElementById('show-spread-fill').addEventListener('change', (e) => {
    showSpreadFill = e.target.checked;
    renderChart(allRecords, getActiveSizes());
  });
  document.querySelectorAll('.quick-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.quick-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const range = btn.dataset.range;
      applyQuickRange(range);
    });
  });

  // Spread modal
  document.getElementById('show-spread-explain').addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('spread-modal').classList.add('show');
  });
  document.getElementById('close-modal').addEventListener('click', () => {
    document.getElementById('spread-modal').classList.remove('show');
  });
  document.getElementById('spread-modal').addEventListener('click', (e) => {
    if (e.target.id === 'spread-modal') {
      document.getElementById('spread-modal').classList.remove('show');
    }
  });

  // Year selector
  document.getElementById('year-selector').addEventListener('change', (e) => {
    currentYear = e.target.value;
    renderMonthly(allRecords);
  });

  // Calculator listeners
  attachCalculatorListeners();

  // ROI calculator listeners
  attachROICalculatorListeners();
  // Initial ROI compute (after data load)
  computeROI();

  // Export Excel buttons
  document.getElementById('export-excel').addEventListener('click', exportToExcel);
  document.getElementById('export-monthly').addEventListener('click', exportMonthlyToExcel);

  // Snake Xenzia game
  initSnakeGame();

  // Trend Builder
  initTrendBuilder();
}

function applyQuickRange(range) {
  if (range === 'all') {
    document.getElementById('start-date').value = '';
    document.getElementById('end-date').value = '';
  } else {
    const days = parseInt(range);
    const end = new Date(fullData.summary.last_date);
    const start = new Date(end);
    start.setDate(start.getDate() - days + 1);
    document.getElementById('start-date').value = start.toISOString().slice(0, 10);
    document.getElementById('end-date').value = end.toISOString().slice(0, 10);
  }
  applyFilter();
}

function getDateRange() {
  return {
    start: document.getElementById('start-date').value,
    end: document.getElementById('end-date').value,
  };
}

// Convert columnar data → array of row records, filtered by date range
function getFilteredRecords(start, end) {
  const startIdx = start ? rawDates.findIndex((d) => d >= start) : 0;
  const endIdx = end ? rawDates.findIndex((d) => d > end) : rawDates.length;
  const lo = Math.max(0, startIdx);
  const hi = endIdx === -1 ? rawDates.length : endIdx;

  const records = [];
  for (let i = lo; i < hi; i++) {
    const rec = { date: rawDates[i] };
    for (const k in rawColumns) {
      rec[k] = rawColumns[k][i];
    }
    records.push(rec);
  }
  return records;
}

// Compute summary stats from a list of records
function computeSummary(records) {
  if (records.length === 0) return null;
  const sells = records.map((r) => r.antam_1g).filter((v) => v != null);
  const buybacks = records.map((r) => r.antam_1g_buyback).filter((v) => v != null);
  if (sells.length === 0) return null;

  let buybackLatest = null;
  for (let i = records.length - 1; i >= 0; i--) {
    if (records[i].antam_1g_buyback != null) {
      buybackLatest = records[i].antam_1g_buyback;
      break;
    }
  }

  return {
    first_date: records[0].date,
    last_date: records[records.length - 1].date,
    first_price: sells[0],
    last_price: sells[sells.length - 1],
    high: Math.max(...sells),
    low: Math.min(...sells),
    avg: Math.round(sells.reduce((a, b) => a + b, 0) / sells.length),
    total_days: records.length,
    change_idr: sells[sells.length - 1] - sells[0],
    change_pct: parseFloat(((sells[sells.length - 1] - sells[0]) / sells[0] * 100).toFixed(2)),
    buyback_1g: buybackLatest,
    spread_idr: buybackLatest ? sells[sells.length - 1] - buybackLatest : null,
    spread_pct: buybackLatest ? parseFloat(((sells[sells.length - 1] - buybackLatest) / buybackLatest * 100).toFixed(2)) : null,
  };
}

async function loadData() {
  try {
    const r = await fetch('/data/data.json');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const json = await r.json();

    rawDates = json.date;
    rawColumns = json.data;
    fullData = json;

    // Initial render: last 1 year (from latest date)
    allRecords = getFilteredRecords(null, null);
    const fullSummary = computeSummary(allRecords);
    const endDate = new Date(fullSummary.last_date);
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - 365);
    const startStr = startDate.toISOString().slice(0, 10);

    // Set date inputs to 1-year window
    document.getElementById('start-date').value = startStr;
    document.getElementById('end-date').value = fullSummary.last_date;

    // Filter to 1 year and render
    const records = getFilteredRecords(startStr, fullSummary.last_date);
    const summary = computeSummary(records);

    document.getElementById('last-update').textContent = summary.last_date;
    document.getElementById('data-range').textContent =
      `${summary.first_date} → ${summary.last_date} (${summary.total_days} hari)`;
    updateKPIs(summary);
    renderChart(records, getActiveSizes());
    renderMonthly(allRecords);

    // Highlight 1T button as active
    document.querySelectorAll('.quick-btn').forEach((b) => b.classList.remove('active'));
    document.querySelector('.quick-btn[data-range="365"]')?.classList.add('active');

    // Calculator: refresh with latest data
    recalcCalculator();

    // Trend Builder: load saved windows now that data is ready
    loadTrendLayout();
  } catch (e) {
    console.error('Load failed', e);
  }
}

function applyFilter() {
  const { start, end } = getDateRange();
  const sizes = getActiveSizes();
  if (sizes.length === 0) return;
  const records = getFilteredRecords(start || null, end || null);
  const summary = computeSummary(records);
  updateKPIs(summary);
  renderChart(records, sizes);
  // Monthly table uses allRecords (year selector still works on full dataset)
  renderMonthly(allRecords);
}

function updateKPIs(s) {
  if (!s) return;
  // Sell (1g)
  document.getElementById('kpi-latest').textContent = idr(s.last_price);
  const deltaEl = document.getElementById('kpi-delta');
  deltaEl.textContent = (s.change_idr >= 0 ? '+' : '') + s.change_pct.toFixed(2) + '%';
  deltaEl.className = 'kpi-delta ' + (s.change_idr >= 0 ? 'positive' : 'negative');

  // Buyback (1g)
  document.getElementById('kpi-buyback').textContent = s.buyback_1g != null ? idr(s.buyback_1g) : '—';
  document.getElementById('kpi-buyback-sub').textContent = 'harga beli balik';

  // Spread
  document.getElementById('kpi-spread').textContent = s.spread_idr != null ? idr(s.spread_idr) : '—';
  document.getElementById('kpi-spread-pct').textContent = s.spread_pct != null ? (s.spread_pct >= 0 ? '+' : '') + s.spread_pct.toFixed(2) + '% dari buyback' : '—';
  document.getElementById('kpi-spread-pct').className = 'kpi-delta muted';

  // Generic KPIs
  const changeEl = document.getElementById('kpi-change');
  changeEl.textContent = (s.change_idr >= 0 ? '+' : '') + Math.round(s.change_idr).toLocaleString('id-ID');
  const pctEl = document.getElementById('kpi-change-pct');
  pctEl.textContent = (s.change_pct >= 0 ? '+' : '') + s.change_pct.toFixed(2) + '% dari awal';
  pctEl.className = 'kpi-delta ' + (s.change_pct >= 0 ? 'positive' : 'negative');

  document.getElementById('kpi-high').textContent = idr(s.high);
  document.getElementById('kpi-low').textContent = idr(s.low);
  document.getElementById('kpi-avg').textContent = idr(s.avg);

  document.getElementById('last-update').textContent = s.last_date || '—';
  document.getElementById('data-range').textContent =
    `${s.first_date} → ${s.last_date} (${s.total_days} hari)`;
}

const SIZE_COLORS = {
  0.5: '#fbbf24',
  1: '#d4af37',
  2: '#ff6b6b',
  3: '#4ecdc4',
  5: '#a78bfa',
  10: '#f472b6',
  25: '#fb923c',
  50: '#60a5fa',
  100: '#34d399',
  250: '#c084fc',
  500: '#facc15',
  1000: '#f87171',
};

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function renderChart(records, sizes) {
  const ctx = document.getElementById('price-chart').getContext('2d');

  if (chart) {
    chart.destroy();
  }

  const smallSizes = sizes.filter((s) => s <= 50);
  const largeSizes = sizes.filter((s) => s > 50);

  const datasets = [];

  // Spread area fill (only for primary 1g if buyback is shown)
  if (showBuyback && showSpreadFill) {
    // For each selected size, add a fill between sell and buyback (using line.fill)
    sizes.forEach((s) => {
      const sellPts = records.map((r) => {
        const v = r[sellKey(s)];
        return v != null ? { x: r.date, y: v } : null;
      }).filter(Boolean);
      const buyPts = records.map((r) => {
        const v = r[buybackKey(s)];
        return v != null ? { x: r.date, y: v } : null;
      }).filter(Boolean);

      // Use a "spread band" dataset — invisible line that defines the top of fill
      // Actually, simpler: make sell lines have `fill: '-1'` and buyback above them
      // We'll attach fill to the sell lines below instead
    });
  }

  // Sell lines
  smallSizes.forEach((s) => {
    const isPrimary = s === 1;
    const color = SIZE_COLORS[s] || '#d4af37';
    const sellPts = records.map((r) => {
      const v = r[sellKey(s)];
      return v != null ? { x: r.date, y: v } : null;
    }).filter(Boolean);

    datasets.push({
      label: `Jual ${formatSize(s)}g`,
      data: sellPts,
      borderColor: color,
      backgroundColor: color,
      borderWidth: isPrimary ? 2.5 : 1.5,
      pointRadius: 0,
      pointHoverRadius: 4,
      tension: 0.15,
      yAxisID: 'ySmall',
      fill: false,
      order: 2,
    });
  });

  // Sell lines (large sizes)
  largeSizes.forEach((s) => {
    const color = SIZE_COLORS[s] || '#a8861d';
    const sellPts = records.map((r) => {
      const v = r[sellKey(s)];
      return v != null ? { x: r.date, y: v } : null;
    }).filter(Boolean);

    datasets.push({
      label: `Jual ${formatSize(s)}g`,
      data: sellPts,
      borderColor: color,
      backgroundColor: color,
      borderWidth: 1.5,
      pointRadius: 0,
      pointHoverRadius: 4,
      tension: 0.15,
      yAxisID: 'yLarge',
      fill: false,
      order: 2,
    });
  });

  // Buyback lines (dashed) - only first size in each axis for clarity
  if (showBuyback) {
    smallSizes.forEach((s) => {
      const isPrimary = s === 1;
      const color = SIZE_COLORS[s] || '#d4af37';
      const buyPts = records.map((r) => {
        const v = r[buybackKey(s)];
        return v != null ? { x: r.date, y: v } : null;
      }).filter(Boolean);

      if (buyPts.length === 0) return;

      datasets.push({
        label: `Buyback ${formatSize(s)}g`,
        data: buyPts,
        borderColor: hexToRgba(color, 0.5),
        backgroundColor: hexToRgba(color, 0.1),
        borderWidth: isPrimary ? 1.5 : 1,
        borderDash: [4, 3],
        pointRadius: 0,
        pointHoverRadius: 3,
        tension: 0.15,
        yAxisID: 'ySmall',
        fill: showSpreadFill && isPrimary ? '-1' : false,
        order: 1,
      });
    });

    largeSizes.forEach((s) => {
      const color = SIZE_COLORS[s] || '#a8861d';
      const buyPts = records.map((r) => {
        const v = r[buybackKey(s)];
        return v != null ? { x: r.date, y: v } : null;
      }).filter(Boolean);

      if (buyPts.length === 0) return;

      datasets.push({
        label: `Buyback ${formatSize(s)}g`,
        data: buyPts,
        borderColor: hexToRgba(color, 0.5),
        backgroundColor: hexToRgba(color, 0.1),
        borderWidth: 1,
        borderDash: [4, 3],
        pointRadius: 0,
        pointHoverRadius: 3,
        tension: 0.15,
        yAxisID: 'yLarge',
        fill: false,
        order: 1,
      });
    });
  }

  const showLargeAxis = largeSizes.length > 0;

  chart = new Chart(ctx, {
    type: 'line',
    data: { datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          position: 'top',
          labels: {
            color: '#e8eaed',
            usePointStyle: true,
            padding: 16,
            font: { size: 12 },
            filter: (item) => {
              // Hide duplicate "Jual Xg" labels (small/large) if no buyback
              return true;
            },
          },
        },
        tooltip: {
          backgroundColor: '#1a1f2e',
          borderColor: '#d4af37',
          borderWidth: 1,
          titleColor: '#d4af37',
          bodyColor: '#e8eaed',
          padding: 12,
          callbacks: {
            label: (ctx) => {
              const v = ctx.parsed.y;
              return `${ctx.dataset.label}: ${idr(v)}`;
            },
            title: (items) => {
              if (!items.length) return '';
              return new Date(items[0].parsed.x).toLocaleDateString('id-ID', {
                day: 'numeric', month: 'long', year: 'numeric'
              });
            },
          },
        },
      },
      scales: {
        x: {
          type: 'time',
          time: { unit: 'month', displayFormats: { month: 'MMM yyyy' } },
          grid: { color: 'rgba(255,255,255,0.04)' },
          ticks: { color: '#9aa0a6', font: { size: 11 } },
        },
        ySmall: {
          position: 'left',
          grid: { color: 'rgba(255,255,255,0.06)' },
          ticks: {
            color: '#9aa0a6',
            font: { size: 11 },
            callback: (v) => idrCompact(v),
          },
          title: {
            display: true,
            text: '1-50 gram (IDR)',
            color: '#d4af37',
            font: { size: 12, weight: 'bold' },
          },
        },
        yLarge: {
          position: 'right',
          display: showLargeAxis,
          grid: { drawOnChartArea: false },
          ticks: {
            color: '#9aa0a6',
            font: { size: 11 },
            callback: (v) => idrCompact(v),
          },
          title: {
            display: showLargeAxis,
            text: '100-1000 gram (IDR)',
            color: '#a8861d',
            font: { size: 12, weight: 'bold' },
          },
        },
      },
    },
  });

  document.getElementById('chart-info').textContent =
    `${records.length} hari data · ${sizes.length} ukuran${showBuyback ? ' (+ buyback)' : ''}`;
}

function renderMonthly(records) {
  if (!records || records.length === 0) return;

  // Group records by year, then by month within each year
  const byYearMonth = {};
  records.forEach((r) => {
    const d = new Date(r.date);
    const year = String(d.getFullYear());
    const month = String(d.getMonth() + 1).padStart(2, '0');
    if (!byYearMonth[year]) byYearMonth[year] = {};
    if (!byYearMonth[year][month]) byYearMonth[year][month] = [];
    byYearMonth[year][month].push(r);
  });

  // Update available years + selector
  availableYears = Object.keys(byYearMonth).sort().reverse();
  const selector = document.getElementById('year-selector');

  if (availableYears.length === 0) {
    selector.innerHTML = '<option>— tidak ada data —</option>';
    return;
  }

  // Build selector options (preserve current selection if still valid)
  const currentSelection = currentYear && availableYears.includes(currentYear)
    ? currentYear
    : availableYears[0]; // default to latest
  currentYear = currentSelection;

  selector.innerHTML = availableYears.map((y) => {
    return `<option value="${y}" ${y === currentSelection ? 'selected' : ''}>${y}</option>`;
  }).join('');

  // Get months for selected year
  const yearMonths = byYearMonth[currentYear];
  const sortedMonths = Object.keys(yearMonths).sort(); // '01' to '12'

  // Compute per-month averages
  const monthlyAverages = sortedMonths.map((m) => {
    const recs = yearMonths[m];
    const sells = recs.map((r) => r.antam_1g).filter((v) => v != null);
    const buybacks = recs.map((r) => r.antam_1g_buyback).filter((v) => v != null);
    return {
      month: m,
      avgSell: sells.length ? Math.round(sells.reduce((a, b) => a + b, 0) / sells.length) : null,
      avgBuyback: buybacks.length ? Math.round(buybacks.reduce((a, b) => a + b, 0) / buybacks.length) : null,
      days: recs.length,
    };
  });

  // Compute year-level stats from daily data
  const allSells = sortedMonths.flatMap((m) => yearMonths[m].map((r) => r.antam_1g).filter((v) => v != null));
  const allBuybacks = sortedMonths.flatMap((m) => yearMonths[m].map((r) => r.antam_1g_buyback).filter((v) => v != null));

  const yearHigh = allSells.length ? Math.max(...allSells) : 0;
  const yearLow = allSells.length ? Math.min(...allSells) : 0;
  const yearAvg = allSells.length ? Math.round(allSells.reduce((a, b) => a + b, 0) / allSells.length) : 0;
  const yearAvgBuyback = allBuybacks.length ? Math.round(allBuybacks.reduce((a, b) => a + b, 0) / allBuybacks.length) : 0;
  // Use first and last daily values for "open" and "close" of the year
  const firstMonth = sortedMonths[0];
  const lastMonth = sortedMonths[sortedMonths.length - 1];
  const yearOpen = yearMonths[firstMonth][0].antam_1g;
  const yearClose = yearMonths[lastMonth][yearMonths[lastMonth].length - 1].antam_1g;
  const yearChange = yearClose - yearOpen;
  const yearChangePct = yearOpen ? (yearChange / yearOpen) * 100 : 0;
  const yearSpreadAvg = (yearAvg && yearAvgBuyback) ? yearAvg - yearAvgBuyback : 0;

  // Update subtitle
  const totalDays = sortedMonths.reduce((sum, m) => sum + yearMonths[m].length, 0);
  document.getElementById('month-summary').textContent =
    `Tahun ${currentYear} · ${sortedMonths.length} bulan dengan data · ${totalDays} hari trading`;

  // Update year stats panel
  const statsEl = document.getElementById('month-stats');
  statsEl.innerHTML = `
    <div class="month-stat">
      <span class="month-stat-label">Awal Tahun</span>
      <span class="month-stat-value gold">${yearOpen ? idr(yearOpen) : '—'}</span>
    </div>
    <div class="month-stat">
      <span class="month-stat-label">Akhir Tahun</span>
      <span class="month-stat-value gold">${yearClose ? idr(yearClose) : '—'}</span>
    </div>
    <div class="month-stat">
      <span class="month-stat-label">Perubahan</span>
      <span class="month-stat-value ${yearChange >= 0 ? 'positive' : 'negative'}">
        ${yearChange >= 0 ? '+' : ''}${idr(yearChange)} (${yearChangePct >= 0 ? '+' : ''}${yearChangePct.toFixed(2)}%)
      </span>
    </div>
    <div class="month-stat">
      <span class="month-stat-label">Tertinggi</span>
      <span class="month-stat-value muted">${yearHigh ? idr(yearHigh) : '—'}</span>
    </div>
    <div class="month-stat">
      <span class="month-stat-label">Terendah</span>
      <span class="month-stat-value muted">${yearLow ? idr(yearLow) : '—'}</span>
    </div>
    <div class="month-stat">
      <span class="month-stat-label">Rata-rata Jual</span>
      <span class="month-stat-value muted">${yearAvg ? idr(yearAvg) : '—'}</span>
    </div>
    <div class="month-stat">
      <span class="month-stat-label">Rata-rata Buyback</span>
      <span class="month-stat-value muted">${yearAvgBuyback ? idr(yearAvgBuyback) : '—'}</span>
    </div>
    <div class="month-stat">
      <span class="month-stat-label">Spread Rata-rata</span>
      <span class="month-stat-value muted">${yearSpreadAvg ? idr(yearSpreadAvg) : '—'}</span>
    </div>
  `;

  // Render monthly averages table (1 row per month = 1 data point)
  const tbody = document.querySelector('#monthly-table tbody');
  tbody.innerHTML = '';

  monthlyAverages.forEach((m, idx) => {
    const prev = idx > 0 ? monthlyAverages[idx - 1] : null;
    let changePct = null;
    if (prev && prev.avgSell && m.avgSell) {
      changePct = ((m.avgSell - prev.avgSell) / prev.avgSell) * 100;
    }

    const monthName = new Date(parseInt(currentYear), parseInt(m.month) - 1, 1)
      .toLocaleDateString('id-ID', { month: 'long' });

    let changeCell;
    if (changePct == null) {
      changeCell = `<span class="change-pill muted">—</span>`;
    } else if (changePct >= 0) {
      changeCell = `<span class="change-pill positive">▲ +${changePct.toFixed(2)}%</span>`;
    } else {
      changeCell = `<span class="change-pill negative">▼ ${changePct.toFixed(2)}%</span>`;
    }

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${monthName}</strong></td>
      <td style="color:var(--gold); font-weight:600;">${m.avgSell != null ? idr(m.avgSell) : '—'}</td>
      <td>${m.avgBuyback != null ? idr(m.avgBuyback) : '—'}</td>
      <td>${changeCell}</td>
    `;
    tbody.appendChild(tr);
  });

  // Render monthly trend chart (line chart of monthly averages)
  renderMonthlyTrend(monthlyAverages, currentYear);
}

function renderMonthlyTrend(monthlyAverages, year) {
  const canvas = document.getElementById('monthly-trend-chart');
  if (!canvas) return;

  // Build 12-month arrays (Jan=01..Dec=12), null for missing months
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const sellData = new Array(12).fill(null);
  const buybackData = new Array(12).fill(null);
  monthlyAverages.forEach((m) => {
    const idx = parseInt(m.month, 10) - 1;
    if (idx >= 0 && idx < 12) {
      sellData[idx] = m.avgSell;
      buybackData[idx] = m.avgBuyback;
    }
  });

  const labels = monthNames.map((n, i) => `${n} ${year}`);
  const datasets = [
    {
      label: `Rata-rata Jual 1g`,
      data: sellData,
      borderColor: '#d4af37',
      backgroundColor: 'rgba(212, 175, 55, 0.12)',
      borderWidth: 2.5,
      pointBackgroundColor: '#f4d03f',
      pointBorderColor: '#d4af37',
      pointRadius: 4,
      pointHoverRadius: 6,
      tension: 0.35,
      fill: true,
      spanGaps: false,
    },
    {
      label: `Rata-rata Buyback 1g`,
      data: buybackData,
      borderColor: '#94a3b8',
      backgroundColor: 'rgba(148, 163, 184, 0.08)',
      borderWidth: 2,
      pointBackgroundColor: '#cbd5e1',
      pointBorderColor: '#94a3b8',
      pointRadius: 3,
      pointHoverRadius: 5,
      tension: 0.35,
      fill: false,
      spanGaps: false,
      borderDash: [4, 3],
    },
  ];

  if (monthlyChart) {
    monthlyChart.data.labels = labels;
    monthlyChart.data.datasets = datasets;
    monthlyChart.update();
    return;
  }

  monthlyChart = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          position: 'top',
          align: 'end',
          labels: {
            color: '#e8eaed',
            usePointStyle: true,
            pointStyle: 'circle',
            padding: 12,
            font: { size: 11 },
            boxWidth: 8,
          },
        },
        tooltip: {
          backgroundColor: '#1a1f2e',
          borderColor: '#d4af37',
          borderWidth: 1,
          titleColor: '#d4af37',
          bodyColor: '#e8eaed',
          padding: 10,
          callbacks: {
            label: (ctx) => {
              const v = ctx.parsed.y;
              return v == null ? `${ctx.dataset.label}: —` : `${ctx.dataset.label}: ${idr(v)}`;
            },
          },
        },
      },
      scales: {
        x: {
          grid: { color: 'rgba(255,255,255,0.04)' },
          ticks: { color: '#9aa0a6', font: { size: 11 } },
        },
        y: {
          beginAtZero: false,
          grid: { color: 'rgba(255,255,255,0.06)' },
          ticks: {
            color: '#9aa0a6',
            font: { size: 11 },
            callback: (v) => idrCompact(v),
          },
        },
      },
    },
  });
}

// ====== Calculator Section ======
let calcMode = 'buyback'; // 'sell' | 'buyback'

function getLatestPrice(field) {
  // field: 'antam_1g' (sell) or 'antam_1g_buyback' (buyback)
  if (!allRecords || allRecords.length === 0) return null;
  for (let i = allRecords.length - 1; i >= 0; i--) {
    const v = allRecords[i][field];
    if (v != null) return v;
  }
  return null;
}

function recalcCalculator() {
  const gramsInput = document.getElementById('calc-grams');
  const valueEl = document.getElementById('calc-result-value');
  const formulaEl = document.getElementById('calc-result-formula');
  const spreadEl = document.getElementById('calc-result-spread');
  const modeLabelEl = document.getElementById('calc-mode-label');

  const grams = parseFloat(gramsInput.value);
  const sell = getLatestPrice('antam_1g');
  const buyback = getLatestPrice('antam_1g_buyback');

  // Update mode-dependent UI
  valueEl.classList.toggle('sell-mode', calcMode === 'sell');
  modeLabelEl.textContent = calcMode === 'buyback'
    ? 'Estimasi nilai buyback berdasarkan harga per gram 1g'
    : 'Estimasi nilai jual berdasarkan harga per gram 1g';

  // Validation
  if (!grams || grams <= 0 || isNaN(grams)) {
    valueEl.textContent = '—';
    formulaEl.textContent = 'Masukkan gramasi yang valid (min 0.1g)';
    spreadEl.textContent = '';
    spreadEl.classList.remove('has-spread');
    return;
  }
  if (grams > 10000) {
    valueEl.textContent = '—';
    formulaEl.textContent = 'Maksimal 10.000 gram';
    spreadEl.textContent = '';
    spreadEl.classList.remove('has-spread');
    return;
  }

  const pricePerGram = calcMode === 'sell' ? sell : buyback;
  const otherPrice = calcMode === 'sell' ? buyback : sell;
  const modeLabel = calcMode === 'sell' ? 'Jual' : 'Buyback';
  const otherLabel = calcMode === 'sell' ? 'buyback' : 'jual';

  if (pricePerGram == null) {
    valueEl.textContent = '—';
    formulaEl.textContent = `Data harga ${modeLabel.toLowerCase()} belum tersedia`;
    spreadEl.textContent = '';
    spreadEl.classList.remove('has-spread');
    return;
  }

  // Main calculation
  const total = grams * pricePerGram;
  valueEl.textContent = idr(total);
  formulaEl.textContent = `${formatGrams(grams)} × ${idr(pricePerGram)}/g (${modeLabel} 1g terakhir)`;

  // Spread info (only show the other side for context)
  if (otherPrice != null) {
    const diff = pricePerGram - otherPrice;
    const diffPct = (diff / otherPrice * 100);
    const sign = diff >= 0 ? '+' : '';
    const emoji = calcMode === 'buyback' ? '⚠️' : '📈';
    spreadEl.innerHTML = `${emoji} Selisih <strong>${idr(Math.abs(diff))}</strong> (${sign}${diffPct.toFixed(2)}%) per gram dari harga ${otherLabel} 1g`;
    spreadEl.classList.add('has-spread');
  } else {
    spreadEl.textContent = '';
    spreadEl.classList.remove('has-spread');
  }
}

function formatGrams(g) {
  // Show as integer if whole, else 1 decimal
  if (g == Math.floor(g)) return g.toString() + 'g';
  return g.toFixed(1) + 'g';
}

function setCalcMode(mode) {
  calcMode = mode;
  document.querySelectorAll('.calc-mode-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });
  recalcCalculator();
}

function attachCalculatorListeners() {
  const gramsInput = document.getElementById('calc-grams');
  if (!gramsInput) return;

  gramsInput.addEventListener('input', () => {
    // Sync quick-buttons active state
    const v = parseFloat(gramsInput.value);
    document.querySelectorAll('.calc-quick-btn').forEach((b) => {
      b.classList.toggle('active', parseFloat(b.dataset.gram) === v);
    });
    recalcCalculator();
  });

  document.querySelectorAll('.calc-quick-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const g = parseFloat(btn.dataset.gram);
      gramsInput.value = g;
      document.querySelectorAll('.calc-quick-btn').forEach((b) => {
        b.classList.toggle('active', b === btn);
      });
      recalcCalculator();
    });
  });

  document.querySelectorAll('.calc-mode-btn').forEach((btn) => {
    btn.addEventListener('click', () => setCalcMode(btn.dataset.mode));
  });

  // Initial render
  recalcCalculator();
}

// ====== Excel Export ======
function exportToExcel() {
  // Sanity checks
  if (!allRecords || allRecords.length === 0) {
    alert('Belum ada data untuk di-export. Tunggu data selesai dimuat.');
    return;
  }
  if (typeof XLSX === 'undefined') {
    alert('Library Excel belum dimuat. Refresh halaman dan coba lagi.');
    return;
  }

  // Use current filter (date range + sizes from chart)
  const { start, end } = getDateRange();
  const records = getFilteredRecords(start || null, end || null);
  const sizes = getActiveSizes().sort((a, b) => a - b);

  if (records.length === 0) {
    alert('Tidak ada data dalam rentang tanggal ini.');
    return;
  }
  if (sizes.length === 0) {
    alert('Pilih minimal satu ukuran Antam (1g/5g/dst) di filter chart.');
    return;
  }

  // Build header row
  const headers = ['Date'];
  sizes.forEach((s) => {
    const sizeLabel = `${formatSize(s)}g`;
    headers.push(`Antam ${sizeLabel} Jual (IDR)`);
    headers.push(`Antam ${sizeLabel} Buyback (IDR)`);
  });

  // Build data rows
  const rows = records.map((r) => {
    const row = [r.date];
    sizes.forEach((s) => {
      const sk = sellKey(s);
      const bk = buybackKey(s);
      row.push(r[sk] != null ? r[sk] : '');
      row.push(r[bk] != null ? r[bk] : '');
    });
    return row;
  });

  // Create worksheet + workbook
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);

  // Set column widths
  ws['!cols'] = headers.map((h) => ({ wch: Math.max(h.length + 2, 14) }));

  // Format IDR columns as number (Excel will display as integer)
  const idrFmt = '#,##0';
  for (let c = 1; c < headers.length; c++) {
    for (let r = 1; r <= rows.length; r++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      if (ws[addr] && typeof ws[addr].v === 'number') {
        ws[addr].z = idrFmt;
      }
    }
  }

  // Freeze header row
  ws['!freeze'] = { xSplit: 0, ySplit: 1 };

  const wb = XLSX.utils.book_new();
  const sheetName = (start && end) ? `${start}_to_${end}`.slice(0, 31) : 'Antam Data';
  XLSX.utils.book_append_sheet(wb, ws, sheetName);

  // Build filename
  const today = new Date().toISOString().slice(0, 10);
  let filename;
  if (start && end) {
    filename = `antam-${start}-to-${end}.xlsx`;
  } else {
    filename = `antam-data-all-${today}.xlsx`;
  }

  // Trigger download
  XLSX.writeFile(wb, filename);
}

// ====== Excel Export (Monthly Summary) ======
function exportMonthlyToExcel() {
  if (typeof XLSX === 'undefined') {
    alert('Library Excel belum dimuat. Refresh halaman dan coba lagi.');
    return;
  }
  if (!currentYear || !allRecords || allRecords.length === 0) {
    alert('Belum ada data bulanan untuk di-export. Pilih tahun di dropdown.');
    return;
  }

  // Re-compute monthly averages for current year
  const yearRecords = allRecords.filter((r) => r.date.startsWith(currentYear));
  if (yearRecords.length === 0) {
    alert(`Tidak ada data untuk tahun ${currentYear}.`);
    return;
  }

  const byMonth = {};
  yearRecords.forEach((r) => {
    const m = r.date.slice(5, 7); // '01'..'12'
    if (!byMonth[m]) byMonth[m] = [];
    byMonth[m].push(r);
  });

  const sortedMonths = Object.keys(byMonth).sort();
  const monthNameId = ['', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

  // Build summary sheet rows
  const summaryHeaders = ['Bulan', 'Tahun', 'Hari Trading', 'Rata-rata Jual 1g (IDR)', 'Rata-rata Buyback 1g (IDR)', 'Spread Rata-rata (IDR)', 'Δ% Jual'];
  const summaryRows = sortedMonths.map((m, idx) => {
    const recs = byMonth[m];
    const sells = recs.map((r) => r.antam_1g).filter((v) => v != null);
    const buybacks = recs.map((r) => r.antam_1g_buyback).filter((v) => v != null);
    const avgSell = sells.length ? Math.round(sells.reduce((a, b) => a + b, 0) / sells.length) : null;
    const avgBuyback = buybacks.length ? Math.round(buybacks.reduce((a, b) => a + b, 0) / buybacks.length) : null;
    const spread = (avgSell != null && avgBuyback != null) ? avgSell - avgBuyback : null;

    let changePct = null;
    if (idx > 0) {
      const prevRecs = byMonth[sortedMonths[idx - 1]];
      const prevSells = prevRecs.map((r) => r.antam_1g).filter((v) => v != null);
      const prevAvg = prevSells.length ? Math.round(prevSells.reduce((a, b) => a + b, 0) / prevSells.length) : null;
      if (prevAvg && avgSell) changePct = ((avgSell - prevAvg) / prevAvg) * 100;
    }

    return [
      monthNameId[parseInt(m, 10)],
      currentYear,
      recs.length,
      avgSell != null ? avgSell : '',
      avgBuyback != null ? avgBuyback : '',
      spread != null ? spread : '',
      changePct != null ? parseFloat(changePct.toFixed(2)) : '',
    ];
  });

  // Build year-level stats sheet
  const allSells = yearRecords.map((r) => r.antam_1g).filter((v) => v != null);
  const allBuybacks = yearRecords.map((r) => r.antam_1g_buyback).filter((v) => v != null);
  const yearHigh = allSells.length ? Math.max(...allSells) : null;
  const yearLow = allSells.length ? Math.min(...allSells) : null;
  const yearAvg = allSells.length ? Math.round(allSells.reduce((a, b) => a + b, 0) / allSells.length) : null;
  const yearAvgBuyback = allBuybacks.length ? Math.round(allBuybacks.reduce((a, b) => a + b, 0) / allBuybacks.length) : null;
  const yearOpen = yearRecords[0].antam_1g;
  const yearClose = yearRecords[yearRecords.length - 1].antam_1g;
  const yearChange = yearClose - yearOpen;
  const yearChangePct = (yearChange / yearOpen) * 100;
  const yearSpread = (yearAvg != null && yearAvgBuyback != null) ? yearAvg - yearAvgBuyback : null;

  const statsRows = [
    ['Statistik', 'Nilai'],
    ['Tahun', currentYear],
    ['Hari Trading', yearRecords.length],
    ['Awal Tahun (IDR)', yearOpen],
    ['Akhir Tahun (IDR)', yearClose],
    ['Perubahan (IDR)', yearChange],
    ['Perubahan (%)', parseFloat(yearChangePct.toFixed(2))],
    ['Tertinggi (IDR)', yearHigh != null ? yearHigh : ''],
    ['Terendah (IDR)', yearLow != null ? yearLow : ''],
    ['Rata-rata Jual 1g (IDR)', yearAvg != null ? yearAvg : ''],
    ['Rata-rata Buyback 1g (IDR)', yearAvgBuyback != null ? yearAvgBuyback : ''],
    ['Spread Rata-rata (IDR)', yearSpread != null ? yearSpread : ''],
  ];

  // Build workbook
  const wb = XLSX.utils.book_new();

  // Sheet 1: Summary bulanan
  const ws1 = XLSX.utils.aoa_to_sheet([summaryHeaders, ...summaryRows]);
  ws1['!cols'] = summaryHeaders.map((h) => ({ wch: Math.max(h.length + 2, 14) }));
  // Format IDR columns
  for (let r = 1; r <= summaryRows.length; r++) {
    [3, 4, 5].forEach((c) => {
      const addr = XLSX.utils.encode_cell({ r, c });
      if (ws1[addr] && typeof ws1[addr].v === 'number') ws1[addr].z = '#,##0';
    });
    // Δ% column
    const addrPct = XLSX.utils.encode_cell({ r, c: 6 });
    if (ws1[addrPct] && typeof ws1[addrPct].v === 'number') ws1[addrPct].z = '0.00"%"';
  }
  ws1['!freeze'] = { xSplit: 0, ySplit: 1 };
  XLSX.utils.book_append_sheet(wb, ws1, 'Summary Bulanan');

  // Sheet 2: Ringkasan tahunan
  const ws2 = XLSX.utils.aoa_to_sheet(statsRows);
  ws2['!cols'] = [{ wch: 28 }, { wch: 18 }];
  // Format IDR/number cells
  for (let r = 1; r < statsRows.length; r++) {
    const addr = XLSX.utils.encode_cell({ r, c: 1 });
    if (ws2[addr] && typeof ws2[addr].v === 'number') {
      ws2[addr].z = statsRows[r][0].includes('(%)') ? '0.00"%"' : '#,##0';
    }
  }
  ws2['!freeze'] = { xSplit: 0, ySplit: 1 };
  XLSX.utils.book_append_sheet(wb, ws2, 'Ringkasan Tahunan');

  // Filename
  const filename = `antam-monthly-${currentYear}.xlsx`;
  XLSX.writeFile(wb, filename);
}

// ====== ROI Calculator (multi-row) ======
let roiMode = 'buyback'; // 'sell' | 'buyback'
let roiRowCounter = 0;

function buildSizeKey(sizeStr, mode) {
  // 0.5 -> 0_5, 1 -> 1, 1000 -> 1000
  const s = String(sizeStr).replace('.', '_');
  return `antam_${s}g${mode === 'buyback' ? '_buyback' : ''}`;
}

function lookupPrice(sizeKey, dateStr) {
  if (!rawDates || !rawColumns || !rawColumns[sizeKey]) return null;
  // binary search (rawDates is sorted ascending)
  let lo = 0, hi = rawDates.length - 1, idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (rawDates[mid] === dateStr) { idx = mid; break; }
    if (rawDates[mid] < dateStr) lo = mid + 1;
    else hi = mid - 1;
  }
  if (idx === -1) return null;
  return rawColumns[sizeKey][idx];
}

function findClosestDateIndex(dateStr) {
  // If exact date not found, return the latest index <= dateStr
  if (!rawDates || rawDates.length === 0) return -1;
  if (dateStr >= rawDates[rawDates.length - 1]) return rawDates.length - 1;
  if (dateStr < rawDates[0]) return -1;
  let lo = 0, hi = rawDates.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (rawDates[mid] <= dateStr) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function formatHoldingPeriod(days) {
  if (days < 0) return '—';
  const years = Math.floor(days / 365);
  const remainingAfterYears = days - years * 365;
  const months = Math.floor(remainingAfterYears / 30.4375);
  const d = Math.round(remainingAfterYears - months * 30.4375);
  const parts = [];
  if (years > 0) parts.push(`${years} tahun`);
  if (months > 0) parts.push(`${months} bulan`);
  parts.push(`${d} hari`);
  return parts.join(' ');
}

function formatDateID(dateStr) {
  // 2020-03-15 -> "15 Mar 2020"
  const [y, m, d] = dateStr.split('-');
  const monthName = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'][parseInt(m, 10)];
  return `${parseInt(d, 10)} ${monthName} ${y}`;
}

function getROIRows() {
  // Read all visible rows; return array of {id, buyDate, sizeRef, pieces, valid}
  const rows = document.querySelectorAll('#roi-rows .roi-row');
  return Array.from(rows).map((row) => {
    const id = row.dataset.rowId;
    const buyDate = row.querySelector('.roi-buy-date').value;
    const sizeRef = row.querySelector('.roi-size-ref').value;
    const pieces = parseInt(row.querySelector('.roi-grams').value, 10);
    return { id, buyDate, sizeRef, pieces, valid: !!(buyDate && sizeRef && pieces && pieces > 0) };
  });
}

function setROIRowDefaults(row) {
  if (!rawDates || rawDates.length === 0) return;
  const dateInput = row.querySelector('.roi-buy-date');
  dateInput.min = rawDates[0];
  dateInput.max = rawDates[rawDates.length - 1];
  // Default: a year ago, only if empty
  if (!dateInput.value) {
    const last = new Date(rawDates[rawDates.length - 1]);
    last.setMonth(last.getMonth() - 6);
    const def = last.toISOString().slice(0, 10);
    dateInput.value = def >= rawDates[0] ? def : rawDates[0];
  }
}

function addROIRow() {
  roiRowCounter += 1;
  const newId = String(roiRowCounter);
  const template = document.querySelector('#roi-rows .roi-row');
  const clone = template.cloneNode(true);
  clone.dataset.rowId = newId;
  // Reset values
  clone.querySelector('.roi-buy-date').value = '';
  clone.querySelector('.roi-size-ref').value = '1';
  clone.querySelector('.roi-grams').value = '';
  setROIRowDefaults(clone);
  document.getElementById('roi-rows').appendChild(clone);
  computeROI();
}

function removeROIRow(id) {
  const rows = document.querySelectorAll('#roi-rows .roi-row');
  if (rows.length <= 1) return; // keep at least one row
  const row = document.querySelector(`#roi-rows .roi-row[data-row-id="${id}"]`);
  if (row) {
    row.remove();
    computeROI();
  }
}

function computeROI() {
  if (!rawDates || rawDates.length === 0) return;

  const labelEl = document.getElementById('roi-mode-label');
  labelEl.textContent = roiMode === 'buyback'
    ? 'Nilai sekarang = harga Buyback Antam × gram (realistis kalau Anda jual balik ke Antam)'
    : 'Nilai sekarang = harga Jual Antam × gram (harga retail kalau Anda beli hari ini)';

  // Color the result cards & headline panel based on active mode (mirrors Kalkulator Nilai Emas)
  const gridEl = document.getElementById('roi-result-grid');
  if (gridEl) {
    gridEl.classList.toggle('mode-buyback', roiMode === 'buyback');
    gridEl.classList.toggle('mode-sell', roiMode === 'sell');
  }
  const headlineEl = document.getElementById('roi-headline-panel');
  if (headlineEl) {
    headlineEl.classList.toggle('mode-buyback', roiMode === 'buyback');
    headlineEl.classList.toggle('mode-sell', roiMode === 'sell');
  }

  // Initialize defaults on first row if not yet
  const firstRow = document.querySelector('#roi-rows .roi-row');
  if (firstRow) setROIRowDefaults(firstRow);

  const rows = getROIRows();
  const validRows = rows.filter((r) => r.valid);

  // Reset outputs
  const reset = () => {
    ['roi-grams', 'roi-modal', 'roi-current', 'roi-pnl', 'roi-cagr'].forEach((id) => {
      const el = document.getElementById(id);
      el.textContent = '—';
      el.className = 'roi-result-value neutral';
    });
    ['roi-grams-detail', 'roi-modal-detail', 'roi-current-detail', 'roi-pnl-detail', 'roi-cagr-detail'].forEach((id) => {
      document.getElementById(id).textContent = '—';
    });
    document.getElementById('roi-period').textContent = '—';
    // Reset headline panel too
    const hv = document.getElementById('roi-headline-value');
    if (hv) { hv.textContent = '—'; hv.className = 'roi-headline-value neutral'; }
    const hf = document.getElementById('roi-headline-formula');
    if (hf) { hf.textContent = 'Pilih tanggal & berat pembelian untuk melihat hasil'; }
  };

  if (validRows.length === 0) {
    LAST_COMPUTED = [];
    reset();
    return;
  }

  const lastIdx = rawDates.length - 1;
  const lastDate = rawDates[lastIdx];
  const lastDateObj = new Date(lastDate);

  // Per-row computation
  const computed = validRows.map((r) => {
    const buyIdx = findClosestDateIndex(r.buyDate);
    if (buyIdx < 0) return null;
    const actualBuyDate = rawDates[buyIdx];
    const sizeRefGrams = parseFloat(r.sizeRef);  // e.g., 1, 5, 10 (grams per piece)
    const rowGrams = r.pieces * sizeRefGrams;    // total grams for this row
    const sizeKeyBuy = buildSizeKey(r.sizeRef, 'sell');
    const sizeKeyNow = buildSizeKey(r.sizeRef, roiMode);
    const buyPrice = rawColumns[sizeKeyBuy] ? rawColumns[sizeKeyBuy][buyIdx] : null;
    const currentPrice = rawColumns[sizeKeyNow] ? rawColumns[sizeKeyNow][lastIdx] : null;
    if (buyPrice == null || currentPrice == null) return null;
    return {
      ...r,
      actualBuyDate,
      buyPrice,
      currentPrice,
      sizeRefGrams,
      rowGrams,
      modal: buyPrice * r.pieces,
      current: currentPrice * r.pieces,
      pnl: (currentPrice - buyPrice) * r.pieces,
    };
  }).filter(Boolean);

  if (computed.length === 0) {
    LAST_COMPUTED = [];
    reset();
    document.getElementById('roi-modal-detail').textContent = 'Tidak ada data valid untuk kombinasi input yang dimasukkan';
    return;
  }

  // Aggregate
  const totalGrams = computed.reduce((s, r) => s + r.rowGrams, 0);
  const totalModal = computed.reduce((s, r) => s + r.modal, 0);
  const totalCurrent = computed.reduce((s, r) => s + r.current, 0);
  const totalPnl = totalCurrent - totalModal;
  const totalPnlPct = (totalPnl / totalModal) * 100;

  // Earliest buy date for period & CAGR
  const earliest = computed.reduce((min, r) => (r.actualBuyDate < min ? r.actualBuyDate : min), computed[0].actualBuyDate);
  const earliestObj = new Date(earliest);
  const totalDays = Math.max(1, Math.round((lastDateObj - earliestObj) / (1000 * 60 * 60 * 24)));
  const years = totalDays / 365.25;
  let cagr = null;
  if (years > 0 && totalModal > 0) {
    cagr = (Math.pow(totalCurrent / totalModal, 1 / years) - 1) * 100;
  }

  // Detail breakdowns
  const breakdown = computed.map((r) => {
    const sizeLabel = r.sizeRef.replace('.', ',') + 'g';
    return `${r.pieces}× ${sizeLabel} = ${r.rowGrams}g @ ${formatDateID(r.actualBuyDate)}`;
  }).join(' + ');

  // Total Gramasi
  const gramsEl = document.getElementById('roi-grams');
  if (gramsEl) {
    gramsEl.textContent = `${totalGrams.toLocaleString('id-ID', { maximumFractionDigits: 2 })} g`;
    gramsEl.className = 'roi-result-value';
  }
  const gramsDetailEl = document.getElementById('roi-grams-detail');
  if (gramsDetailEl) {
    gramsDetailEl.textContent = `${computed.length} pembelian · ${breakdown}`;
  }

  // Modal
  document.getElementById('roi-modal').textContent = idr(totalModal);
  document.getElementById('roi-modal').className = 'roi-result-value';
  document.getElementById('roi-modal-detail').textContent =
    `${totalGrams.toFixed(1)}g total · ${computed.length} pembelian · ${breakdown}`;

  // Current
  document.getElementById('roi-current').textContent = idr(totalCurrent);
  document.getElementById('roi-current').className = 'roi-result-value';
  document.getElementById('roi-current-detail').textContent =
    `${totalGrams.toFixed(1)}g total · @ ${formatDateID(lastDate)} (${roiMode === 'buyback' ? 'buyback' : 'jual'})`;

  // PnL
  const pnlEl = document.getElementById('roi-pnl');
  const pnlPctStr = (totalPnlPct >= 0 ? '+' : '') + totalPnlPct.toFixed(2) + '%';
  const pnlSign = totalPnl >= 0 ? '+' : '−';
  pnlEl.textContent = `${pnlSign}${idr(Math.abs(totalPnl))} (${pnlPctStr})`;
  pnlEl.className = 'roi-result-value ' + (totalPnl >= 0 ? 'positive' : 'negative');
  document.getElementById('roi-pnl-detail').textContent = totalPnl >= 0 ? '📈 Untung' : '📉 Rugi';

  // Headline panel (hero result)
  const headlineVal = document.getElementById('roi-headline-value');
  const headlineForm = document.getElementById('roi-headline-formula');
  if (headlineVal) {
    headlineVal.textContent = `${pnlSign}${idr(Math.abs(totalPnl))}`;
    headlineVal.className = 'roi-headline-value ' + (totalPnl >= 0 ? 'positive' : 'negative');
  }
  if (headlineForm) {
    headlineForm.innerHTML = `<strong>${pnlPctStr}</strong> dari ${idr(totalModal)} modal · ${computed.length} pembelian · holding ${formatHoldingPeriod(totalDays)}`;
  }

  // CAGR
  const cagrEl = document.getElementById('roi-cagr');
  if (cagr != null && isFinite(cagr)) {
    const cagrStr = (cagr >= 0 ? '+' : '') + cagr.toFixed(2) + '%/thn';
    cagrEl.textContent = cagrStr;
    cagrEl.className = 'roi-result-value ' + (cagr >= 0 ? 'positive' : 'negative');
  } else {
    cagrEl.textContent = '—';
    cagrEl.className = 'roi-result-value neutral';
  }
  document.getElementById('roi-cagr-detail').textContent = years >= 1
    ? `Dari pembelian pertama ke hari ini`
    : `Holding < 1 tahun, CAGR kurang akurat`;

  // Period
  document.getElementById('roi-period').textContent =
    `⏱️ Holding period: ${formatHoldingPeriod(totalDays)} · dari ${formatDateID(earliest)} (pembelian pertama) sampai ${formatDateID(lastDate)}`;

  // Auto-sync prediction panel with current ROI rows
  LAST_COMPUTED = computed;
  if (typeof updatePrediction === 'function') updatePrediction();
}

function attachROICalculatorListeners() {
  const rowsContainer = document.getElementById('roi-rows');

  // Event delegation: any input/change inside a row triggers recompute
  rowsContainer.addEventListener('input', (e) => {
    if (e.target.matches('.roi-buy-date, .roi-size-ref, .roi-grams')) {
      computeROI();
    }
  });
  rowsContainer.addEventListener('change', (e) => {
    if (e.target.matches('.roi-buy-date, .roi-size-ref, .roi-grams')) {
      computeROI();
    }
  });

  // Delete button (delegated)
  rowsContainer.addEventListener('click', (e) => {
    const btn = e.target.closest('.roi-row-delete');
    if (!btn) return;
    const row = btn.closest('.roi-row');
    if (row) removeROIRow(row.dataset.rowId);
  });

  // Add button
  document.getElementById('roi-add-btn').addEventListener('click', addROIRow);

  // Mode toggle
  document.querySelectorAll('#roi-mode-toggle .roi-mode-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#roi-mode-toggle .roi-mode-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      roiMode = btn.dataset.mode;
      computeROI();
    });
  });
}

// ====== Snake Xenzia Game ======
const SnakeGame = {
  canvas: null,
  ctx: null,
  gridCols: 50,
  gridRows: 20,
  cellSize: 20,
  snake: [],
  direction: { x: 1, y: 0 },
  nextDirection: { x: 1, y: 0 },
  food: null,
  score: 0,
  goldCollected: 0,
  highScore: 0,
  speed: 300,
  minSpeed: 70,
  tickTimer: null,
  paused: true,
  gameOver: false,
  isReady: false,
  isVisible: true,

  goldTypes: {
    low:  { value: 1,  size: 0.65, color1: '#fde68a', color2: '#d4af37', fontSize: 9  },
    mid:  { value: 5,  size: 0.78, color1: '#fcd34d', color2: '#b8941f', fontSize: 10 },
    high: { value: 10, size: 0.92, color1: '#fbbf24', color2: '#7a6212', fontSize: 11 }
  },

  // Pick available gold tiers based on current score (progressive difficulty)
  getAvailableGold() {
    if (this.score < 5)  return [this.goldTypes.low];
    if (this.score < 20) return [this.goldTypes.low, this.goldTypes.mid];
    return [this.goldTypes.low, this.goldTypes.mid, this.goldTypes.high];
  },

  init() {
    this.canvas = document.getElementById('game-canvas');
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    this.cellSize = this.canvas.width / this.gridCols;
    this.highScore = parseInt(localStorage.getItem('snakeHighScore') || '0', 10);
    document.getElementById('game-highscore').textContent = this.highScore;

    document.getElementById('game-start-btn').addEventListener('click', () => {
      if (this.gameOver) this.reset();
      this.start();
    });

    document.addEventListener('keydown', (e) => this.handleKey(e));

    document.querySelectorAll('.game-mobile-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const d = btn.dataset.dir;
        if (d === 'up') this.tryChangeDir(0, -1);
        else if (d === 'down') this.tryChangeDir(0, 1);
        else if (d === 'left') this.tryChangeDir(-1, 0);
        else if (d === 'right') this.tryChangeDir(1, 0);
      });
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden && !this.paused) this.pause();
    });

    this.reset();
    this.render();
    this.isReady = true;
  },

  reset() {
    this.snake = [{ x: 25, y: 10 }, { x: 24, y: 10 }, { x: 23, y: 10 }];
    this.direction = { x: 1, y: 0 };
    this.nextDirection = { x: 1, y: 0 };
    this.score = 0;
    this.goldCollected = 0;
    this.speed = 300;
    this.paused = true;
    this.gameOver = false;
    this.spawnFood();
    this.updateStats();
  },

  start() {
    if (this.gameOver) this.reset();
    this.paused = false;
    this.hideOverlay();
    this.clearTick();
    this.tickTimer = setInterval(() => this.tick(), this.speed);
  },

  pause() {
    this.paused = true;
    this.clearTick();
    this.showOverlay('⏸️  Paused', 'Tekan Spasi atau Mulai untuk lanjut', 'Lanjut');
  },

  endGame() {
    this.gameOver = true;
    this.paused = true;
    this.clearTick();
    if (this.score > this.highScore) {
      this.highScore = this.score;
      localStorage.setItem('snakeHighScore', String(this.highScore));
      document.getElementById('game-highscore').textContent = this.highScore;
      this.showOverlay('🏆  High Score Baru!', `Skor: ${this.score}  ·  Emas: ${this.goldCollected}g  ·  Panjang: ${this.snake.length}`, 'Main Lagi');
    } else {
      this.showOverlay('💀  Game Over', `Skor: ${this.score}  ·  Emas: ${this.goldCollected}g  ·  High Score: ${this.highScore}`, 'Main Lagi');
    }
  },

  clearTick() {
    if (this.tickTimer) { clearInterval(this.tickTimer); this.tickTimer = null; }
  },

  tick() {
    if (this.paused || this.gameOver) return;
    this.direction = { ...this.nextDirection };

    const head = this.snake[0];
    const newHead = { x: head.x + this.direction.x, y: head.y + this.direction.y };

    // Wall collision
    if (newHead.x < 0 || newHead.x >= this.gridCols || newHead.y < 0 || newHead.y >= this.gridRows) {
      this.endGame();
      return;
    }

    // Self collision (check against body, excluding last segment which will move)
    for (let i = 0; i < this.snake.length - 1; i++) {
      if (this.snake[i].x === newHead.x && this.snake[i].y === newHead.y) {
        this.endGame();
        return;
      }
    }

    this.snake.unshift(newHead);

    // Food collision
    if (this.food && newHead.x === this.food.x && newHead.y === this.food.y) {
      this.score += this.food.value;
      this.goldCollected += this.food.value;
      // Speed up every 30 points (kelipatan 30)
      if (this.score > 0 && this.score % 30 === 0 && this.speed > this.minSpeed) {
        this.speed = Math.max(this.minSpeed, this.speed - 8);
        this.clearTick();
        this.tickTimer = setInterval(() => this.tick(), this.speed);
      }
      this.spawnFood();
      this.updateStats();
    } else {
      this.snake.pop();
    }

    this.render();
  },

  spawnFood() {
    const available = this.getAvailableGold();
    // Equal chance within available tiers (progressive = "more available" not "more likely")
    const tier = available[Math.floor(Math.random() * available.length)];

    // Find empty cell
    let pos, attempts = 0;
    do {
      pos = {
        x: Math.floor(Math.random() * this.gridCols),
        y: Math.floor(Math.random() * this.gridRows)
      };
      attempts++;
      if (attempts > 200) break;
    } while (this.snake.some(s => s.x === pos.x && s.y === pos.y));

    this.food = { ...pos, ...tier };
  },

  tryChangeDir(x, y) {
    // No 180° reversal
    if (this.direction.x === -x && this.direction.y === -y) return;
    if (this.direction.x === x && this.direction.y === y) return;
    this.nextDirection = { x, y };
    // First direction input auto-starts the game
    if (this.paused && !this.gameOver) this.start();
  },

  handleKey(e) {
    // Only react to game keys when the game section is in view
    if (!this.isReady) return;
    const key = e.key.toLowerCase();
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd', ' ', 'enter', 'r'].indexOf(key) === -1) return;

    if (key === 'arrowup' || key === 'w')    { e.preventDefault(); this.tryChangeDir(0, -1); }
    else if (key === 'arrowdown' || key === 's') { e.preventDefault(); this.tryChangeDir(0, 1); }
    else if (key === 'arrowleft' || key === 'a') { e.preventDefault(); this.tryChangeDir(-1, 0); }
    else if (key === 'arrowright' || key === 'd'){ e.preventDefault(); this.tryChangeDir(1, 0); }
    else if (key === ' ' || key === 'enter') {
      e.preventDefault();
      if (this.gameOver) this.start();
      else if (this.paused) this.start();
      else this.pause();
    }
    else if (key === 'r') {
      this.reset();
      this.start();
    }
  },

  updateStats() {
    document.getElementById('game-score').textContent = this.score;
    document.getElementById('game-gold').textContent = this.goldCollected + 'g';
    document.getElementById('game-length').textContent = this.snake.length;
  },

  showOverlay(title, subtitle, btnText) {
    const overlay = document.getElementById('game-overlay');
    document.getElementById('game-overlay-title').textContent = title;
    document.getElementById('game-overlay-subtitle').textContent = subtitle;
    document.getElementById('game-start-btn').textContent = btnText;
    overlay.classList.remove('hidden');
  },

  hideOverlay() {
    document.getElementById('game-overlay').classList.add('hidden');
  },

  render() {
    const ctx = this.ctx;
    const cs = this.cellSize;
    // Scale factor — all hardcoded visual details were tuned for 20px cells,
    // multiply by scale to keep proportions at any canvas size
    const scale = cs / 20;
    const px = (v) => v * scale;

    // Background
    ctx.fillStyle = '#0a0e1a';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // Subtle grid
    ctx.strokeStyle = 'rgba(212, 175, 55, 0.05)';
    ctx.lineWidth = Math.max(1, scale);
    for (let i = 0; i <= this.gridCols; i++) {
      ctx.beginPath();
      ctx.moveTo(i * cs + 0.5, 0);
      ctx.lineTo(i * cs + 0.5, this.canvas.height);
      ctx.stroke();
    }
    for (let i = 0; i <= this.gridRows; i++) {
      ctx.beginPath();
      ctx.moveTo(0, i * cs + 0.5);
      ctx.lineTo(this.canvas.width, i * cs + 0.5);
      ctx.stroke();
    }

    // Food (gold bar)
    if (this.food) {
      const fx = this.food.x * cs;
      const fy = this.food.y * cs;
      const sizeRatio = this.food.size;
      const w = cs * sizeRatio;
      const h = cs * sizeRatio;
      const ox = (cs - w) / 2;
      const oy = (cs - h) / 2;
      const goldR = px(3);
      const goldPad = px(2);

      // Subtle glow for high tier
      if (this.food.value === 10) {
        ctx.shadowColor = '#fbbf24';
        ctx.shadowBlur = px(8);
      }

      // Gold gradient
      const grad = ctx.createLinearGradient(fx + ox, fy + oy, fx + ox, fy + oy + h);
      grad.addColorStop(0, this.food.color1);
      grad.addColorStop(1, this.food.color2);
      ctx.fillStyle = grad;
      this.roundRect(ctx, fx + ox, fy + oy, w, h, goldR);
      ctx.fill();

      // Border
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(122, 98, 18, 0.6)';
      ctx.lineWidth = Math.max(1, scale);
      this.roundRect(ctx, fx + ox + 0.5, fy + oy + 0.5, w - 1, h - 1, goldR);
      ctx.stroke();

      // Top shine
      ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
      this.roundRect(ctx, fx + ox + goldPad, fy + oy + px(1.5), w - goldPad * 2, Math.max(px(2), h * 0.18), px(1.5));
      ctx.fill();

      // Text label
      const text = this.food.value + 'g';
      ctx.fillStyle = '#0a0e1a';
      ctx.font = `700 ${px(this.food.fontSize)}px -apple-system, system-ui, "Segoe UI", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, fx + cs / 2, fy + cs / 2 + px(0.5));
    }

    // Snake
    for (let i = this.snake.length - 1; i >= 0; i--) {
      const seg = this.snake[i];
      const x = seg.x * cs;
      const y = seg.y * cs;
      const isHead = i === 0;
      const pad = px(1);

      const grad = ctx.createLinearGradient(x, y, x, y + cs);
      if (isHead) {
        grad.addColorStop(0, '#6ee7b7');
        grad.addColorStop(1, '#10b981');
      } else {
        // Slight color variation along body
        const t = i / this.snake.length;
        const g = Math.floor(180 - t * 60);
        grad.addColorStop(0, `rgb(${52 + Math.floor(t * -20)}, ${g + 70}, ${110 - Math.floor(t * 30)})`);
        grad.addColorStop(1, `rgb(4, ${Math.floor(g * 0.5)}, ${Math.floor(70 * (1 - t * 0.4))})`);
      }
      ctx.fillStyle = grad;
      this.roundRect(ctx, x + pad, y + pad, cs - pad * 2, cs - pad * 2, isHead ? px(4) : px(3));
      ctx.fill();

      // Subtle border
      ctx.strokeStyle = isHead ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)';
      ctx.lineWidth = Math.max(1, scale);
      this.roundRect(ctx, x + pad + 0.5, y + pad + 0.5, cs - pad * 2 - 1, cs - pad * 2 - 1, isHead ? px(4) : px(3));
      ctx.stroke();

      // Head: draw eyes
      if (isHead) {
        ctx.fillStyle = '#0a0e1a';
        const eyeR = px(1.8);
        const eyeOff = px(5);
        let ex1, ey1, ex2, ey2;
        if (this.direction.x === 1)       { ex1 = x + cs - eyeOff; ey1 = y + eyeOff;         ex2 = x + cs - eyeOff; ey2 = y + cs - eyeOff;   }
        else if (this.direction.x === -1) { ex1 = x + eyeOff;      ey1 = y + eyeOff;         ex2 = x + eyeOff;      ey2 = y + cs - eyeOff;   }
        else if (this.direction.y === 1)  { ex1 = x + eyeOff;      ey1 = y + cs - eyeOff;    ex2 = x + cs - eyeOff; ey2 = y + cs - eyeOff;   }
        else                              { ex1 = x + eyeOff;      ey1 = y + eyeOff;         ex2 = x + cs - eyeOff; ey2 = y + eyeOff;        }
        ctx.beginPath();
        ctx.arc(ex1, ey1, eyeR, 0, Math.PI * 2);
        ctx.arc(ex2, ey2, eyeR, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  },

  roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    ctx.lineTo(x + rr, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
    ctx.lineTo(x, y + rr);
    ctx.quadraticCurveTo(x, y, x + rr, y);
    ctx.closePath();
  }
};

function initSnakeGame() {
  SnakeGame.init();
}

// =============================================================
// ML Prediction Panel
// =============================================================
let PRED = null;  // predictions.json cache
let PRED_DATA_LOADED = null;  // last_date from data.json for default dates
let LAST_COMPUTED = [];  // last successful per-row computation from computeROI (used by updatePrediction)

function loadPredictions() {
  return fetch('/data/predictions.json', { cache: 'no-cache' })
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .then((json) => {
      PRED = json;
      initPredictionPanel();
    })
    .catch((err) => {
      console.error('predictions.json load failed:', err);
      const status = document.getElementById('pred-status');
      if (status) {
        status.textContent = 'Predictions unavailable';
        status.classList.add('error');
      }
    });
}

function initPredictionPanel() {
  if (!PRED) return;

  // Set default sell date: today + 3y
  const today = new Date();
  const future = new Date(today);
  future.setFullYear(future.getFullYear() + 3);
  const futureStr = future.toISOString().slice(0, 10);
  document.getElementById('pred-sell-date').value = futureStr;

  // Status badge
  const status = document.getElementById('pred-status');
  if (status) {
    const lastDate = PRED.training_range.end;
    status.textContent = `Model trained ${lastDate}`;
    status.classList.add('ready');
  }
  const modelInfo = document.getElementById('pred-model-info');
  if (modelInfo) {
    const n = PRED.training_range.n_days;
    modelInfo.textContent = `${PRED.library || 'Prophet/ARIMA'} · ${n.toLocaleString('id-ID')} hari training`;
  }

  // Listener on sell date only (size + pieces are auto-synced from ROI)
  const sellEl = document.getElementById('pred-sell-date');
  if (sellEl) {
    sellEl.addEventListener('input', updatePrediction);
    sellEl.addEventListener('change', updatePrediction);
  }

  updatePrediction();
}

function idrP(n) {
  if (n == null || isNaN(n)) return '—';
  return 'Rp ' + Math.round(n).toLocaleString('id-ID');
}

function findClosestHorizon(sellDate, lastDateStr, horizons) {
  // Horizons array: [{label, days, date}]
  if (!sellDate || !horizons.length) return null;
  const target = new Date(sellDate).getTime();
  let best = null;
  let bestDiff = Infinity;
  for (const h of horizons) {
    const hd = new Date(h.date).getTime();
    const diff = Math.abs(hd - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = h;
    }
  }
  return best;
}

function updatePrediction() {
  if (!PRED) return;

  const validRows = LAST_COMPUTED || [];
  const sellDate = document.getElementById('pred-sell-date').value;
  const sizeChip = document.getElementById('pred-size-display');
  const piecesChip = document.getElementById('pred-pieces-display');
  const breakdownEl = document.getElementById('pred-breakdown');
  const breakdownBody = document.getElementById('pred-breakdown-body');

  const clearDisplay = () => {
    if (sizeChip) sizeChip.textContent = '—';
    if (piecesChip) piecesChip.textContent = '—';
    ['pred-bear-value', 'pred-base-value', 'pred-bull-value'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.textContent = '—';
    });
    ['pred-bear-pct', 'pred-base-pct', 'pred-bull-pct'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.textContent = '—';
    });
    if (breakdownBody) breakdownBody.innerHTML = '';
    if (breakdownEl) breakdownEl.style.display = 'none';
  };

  if (validRows.length === 0 || !sellDate) {
    clearDisplay();
    return;
  }

  // Aggregate across all valid rows
  let totalBuyCost = 0;
  let totalGrams = 0;
  let totalPieces = 0;
  const sellTotals = { bear: 0, base: 0, bull: 0 };
  const rowDetails = [];
  let horizonInfo = null; // for meta display (use first row)

  for (const row of validRows) {
    const sizeKey = row.sizeRef === '0.5' ? '0_5' : row.sizeRef;
    const sz = PRED.sizes[sizeKey];
    if (!sz) continue;
    const horizon = findClosestHorizon(sellDate, sz.current_date, sz.predictions);
    if (!horizon) continue;

    const rowSellBear = horizon.p25 * row.pieces;
    const rowSellBase = horizon.base * row.pieces;
    const rowSellBull = horizon.p75 * row.pieces;

    totalBuyCost += row.modal;
    totalGrams += row.rowGrams;
    totalPieces += row.pieces;
    sellTotals.bear += rowSellBear;
    sellTotals.base += rowSellBase;
    sellTotals.bull += rowSellBull;

    rowDetails.push({
      buyDate: row.actualBuyDate,
      sizeRef: row.sizeRef,
      pieces: row.pieces,
      modal: row.modal,
      buyPrice: row.buyPrice,
      sellBase: rowSellBase,
      sizeLabel: sz.size_label,
    });

    if (!horizonInfo) horizonInfo = { sz, horizon };
  }

  if (totalBuyCost === 0 || rowDetails.length === 0) {
    clearDisplay();
    return;
  }

  // Summary chips: single-row vs multi-row
  if (validRows.length === 1) {
    if (sizeChip) sizeChip.textContent = validRows[0].sizeRef + 'g';
    if (piecesChip) piecesChip.textContent = validRows[0].pieces + ' keping';
  } else {
    if (sizeChip) sizeChip.textContent = validRows.length + ' baris';
    if (piecesChip) piecesChip.textContent = totalGrams.toFixed(1) + 'g total';
  }

  // 3 scenario cards (aggregate PnL)
  const scenarios = [
    { key: 'bear', sellValue: sellTotals.bear },
    { key: 'base', sellValue: sellTotals.base },
    { key: 'bull', sellValue: sellTotals.bull },
  ];
  scenarios.forEach((sc) => {
    const pnl = sc.sellValue - totalBuyCost;
    const pct = (pnl / totalBuyCost) * 100;
    const sign = pnl >= 0 ? '+' : '−';
    const valEl = document.getElementById(`pred-${sc.key}-value`);
    const pctEl = document.getElementById(`pred-${sc.key}-pct`);
    const noteEl = document.getElementById(`pred-${sc.key}-note`);
    if (valEl) valEl.textContent = sign + idrP(Math.abs(pnl));
    if (pctEl) pctEl.textContent = `${sign}${(Math.abs(pct)).toFixed(2)}% · ${sign}${idrP(Math.abs(pnl))}`;
    if (noteEl) {
      noteEl.innerHTML = `Jual: ${sign}${idrP(Math.abs(sc.sellValue))}<br>Modal: ${idrP(totalBuyCost)}`;
    }
  });

  // Meta (use first row's size for CAGR/horizon display)
  const setMeta = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };
  const displaySz = horizonInfo.sz;
  const displayHorizon = horizonInfo.horizon;
  const avgBuyPerPiece = totalBuyCost / totalPieces;
  setMeta('pred-buy-price', `Avg: ${idrP(avgBuyPerPiece)} / ${displaySz.size_label}`);
  setMeta('pred-cagr-5y', displaySz.cagr_5y != null ? `${displaySz.cagr_5y >= 0 ? '+' : ''}${displaySz.cagr_5y.toFixed(2)}%` : '—');
  setMeta('pred-cagr-10y', displaySz.cagr_10y != null ? `${displaySz.cagr_10y >= 0 ? '+' : ''}${displaySz.cagr_10y.toFixed(2)}%` : '—');
  setMeta('pred-horizon', `${displayHorizon.horizon} (${displayHorizon.date})`);
  setMeta('pred-ci', `${idrP(displayHorizon.p5)} – ${idrP(displayHorizon.p95)}`);

  // Per-row breakdown table
  if (breakdownBody && breakdownEl) {
    breakdownBody.innerHTML = rowDetails.map((rd) => {
      const sizeLabel = rd.sizeRef.replace('.', ',') + 'g';
      const pnl = rd.sellBase - rd.modal;
      const pnlSign = pnl >= 0 ? '+' : '−';
      return `<tr>
        <td>${formatDateID(rd.buyDate)}</td>
        <td>${sizeLabel} × ${rd.pieces}</td>
        <td>${idrP(rd.modal)}</td>
        <td>${idrP(rd.sellBase)}</td>
        <td class="pred-breakdown-pnl ${pnl >= 0 ? 'positive' : 'negative'}">${pnlSign}${idrP(Math.abs(pnl))}</td>
      </tr>`;
    }).join('') + `<tr class="pred-breakdown-total">
      <td><strong>Total</strong></td>
      <td><strong>${totalPieces} keping · ${totalGrams.toFixed(1)}g</strong></td>
      <td><strong>${idrP(totalBuyCost)}</strong></td>
      <td><strong>${idrP(sellTotals.base)}</strong></td>
      <td class="pred-breakdown-pnl ${(sellTotals.base - totalBuyCost) >= 0 ? 'positive' : 'negative'}"><strong>${(sellTotals.base - totalBuyCost) >= 0 ? '+' : '−'}${idrP(Math.abs(sellTotals.base - totalBuyCost))}</strong></td>
    </tr>`;
    breakdownEl.style.display = 'block';
  }
}

// ====== Trend Builder (Drag & Drop, PI Vision style) ======
let TRENDS = [];
let trendZIndex = 100;

const TREND_COLORS = {
  '0_5': '#a78bfa',
  '1':   '#3b82f6',
  '2':   '#06b6d4',
  '3':   '#14b8a6',
  '5':   '#10b981',
  '10':  '#84cc16',
  '25':  '#eab308',
  '50':  '#f59e0b',
  '100': '#f97316',
  '250': '#ef4444',
  '500': '#ec4899',
  '1000': '#d4af37',
};

const RANGE_DAYS = {
  '1m': 30, '3m': 90, '6m': 180, '1y': 365, '3y': 1095, '5y': 1825, 'all': null,
};

// ----- Date helpers (mm/dd/yyyy format) -----
function formatMMDDYYYY(yyyymmdd) {
  if (!yyyymmdd) return '';
  const parts = yyyymmdd.split('-');
  if (parts.length !== 3) return '';
  return `${parts[1]}/${parts[2]}/${parts[0]}`;
}

function parseMMDDYYYY(str) {
  if (!str) return null;
  const m = String(str).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const month = parseInt(m[1], 10);
  const day = parseInt(m[2], 10);
  const year = parseInt(m[3], 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  // Sanity: month/day ranges
  const daysInMonth = new Date(year, month, 0).getDate();
  if (day > daysInMonth) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function defaultStartDate() {
  // 1 month before the last data date
  if (!rawDates || rawDates.length === 0) return null;
  const lastDate = new Date(rawDates[rawDates.length - 1] + 'T00:00:00');
  lastDate.setMonth(lastDate.getMonth() - 1);
  return lastDate.toISOString().slice(0, 10);
}

function convertOldRangeToDateRange(oldRange) {
  if (!oldRange || oldRange === 'all') return { startDate: null, endDate: null };
  const days = RANGE_DAYS[oldRange];
  if (!days || !rawDates || rawDates.length === 0) return { startDate: null, endDate: null };
  const last = new Date(rawDates[rawDates.length - 1] + 'T00:00:00');
  last.setDate(last.getDate() - days + 1);
  return { startDate: last.toISOString().slice(0, 10), endDate: null };
}

// Auto-insert slashes as user types in a date input (mm/dd/yyyy mask)
function autoFormatDateInput(input) {
  input.addEventListener('input', () => {
    let v = input.value.replace(/[^\d]/g, '');
    if (v.length >= 3) v = v.slice(0, 2) + '/' + v.slice(2);
    if (v.length >= 6) v = v.slice(0, 5) + '/' + v.slice(5, 9);
    if (v.length > 10) v = v.slice(0, 10);
    input.value = v;
  });
}

// Wire up start/end date inputs in a trend window header.
// onChange callback fires when a valid date is entered (e.g. createTrendChart or rebuildCombinedChart)
function setupTrendDateInputs(trend, startInput, endInput, onChange) {
  function handleDateChange() {
    const startStr = startInput.value.trim();
    const endStr = endInput.value.trim();
    const newStart = startStr ? parseMMDDYYYY(startStr) : null;
    const newEnd = endStr ? parseMMDDYYYY(endStr) : null;
    if (startStr && !newStart) startInput.classList.add('invalid');
    else startInput.classList.remove('invalid');
    if (endStr && !newEnd) endInput.classList.add('invalid');
    else endInput.classList.remove('invalid');
    if ((startStr && !newStart) || (endStr && !newEnd)) return;
    trend.startDate = newStart;
    trend.endDate = newEnd;
    onChange();
    saveTrendLayout();
  }
  autoFormatDateInput(startInput);
  autoFormatDateInput(endInput);
  startInput.addEventListener('change', handleDateChange);
  endInput.addEventListener('change', handleDateChange);
  startInput.addEventListener('blur', () => {
    if (trend.startDate) startInput.value = formatMMDDYYYY(trend.startDate);
  });
  endInput.addEventListener('blur', () => {
    if (trend.endDate) endInput.value = formatMMDDYYYY(trend.endDate);
  });
}

function formatTrendSize(sizeKey) {
  const s = String(sizeKey).replace('_', '.');
  if (s === '1000') return '1kg';
  if (s.includes('.')) return s.replace('.', ',') + 'g';
  return s + 'g';
}

function getTrendColor(sizeKey) {
  return TREND_COLORS[sizeKey] || '#d4af37';
}

function getValidSizeKeys() {
  return SIZES.map(s => String(s).replace('.', '_'));
}

// Parse user input for y-axis value. Accepts: "0", "10000000", "10M", "1.5M",
// "100K", "1B", "1e7", "10.000.000" (ID thousand sep), "10jt" (ID jt = million).
// Returns number, or null if invalid.
function parseYAxisValue(str) {
  if (str == null) return null;
  str = String(str).trim();
  if (!str) return null;
  // Detect suffix FIRST (BEFORE stripping dots) — if suffix present, dot is a decimal point, not ID thousand sep
  let mult = 1;
  let hasSuffix = false;
  const lower = str.toLowerCase();
  if (lower.endsWith('jt')) { mult = 1e6; str = str.slice(0, -2); hasSuffix = true; }
  else if (lower.endsWith('b')) { mult = 1e9; str = str.slice(0, -1); hasSuffix = true; }
  else if (lower.endsWith('m')) { mult = 1e6; str = str.slice(0, -1); hasSuffix = true; }
  else if (lower.endsWith('k')) { mult = 1e3; str = str.slice(0, -1); hasSuffix = true; }
  // Strip ID thousand separators (dots/commas) — only if no suffix (otherwise dot = decimal)
  if (!hasSuffix && !/e/i.test(str)) {
    str = str.replace(/\./g, '').replace(/,/g, '');
  }
  const v = parseFloat(str);
  if (!isFinite(v) || v < 0) return null;
  return v * mult;
}

// Format raw value for compact display: 15000000 → "15M", 2500 → "2.5K"
function formatYAxisValueShort(v) {
  if (v == null) return 'auto';
  const abs = Math.abs(v);
  if (abs >= 1e9) return (v / 1e9).toFixed(abs % 1e9 === 0 ? 0 : 1).replace(/\.0$/, '') + 'B';
  if (abs >= 1e6) return (v / 1e6).toFixed(abs % 1e6 === 0 ? 0 : 1).replace(/\.0$/, '') + 'M';
  if (abs >= 1e3) return (v / 1e3).toFixed(abs % 1e3 === 0 ? 0 : 1).replace(/\.0$/, '') + 'K';
  return String(v);
}

// Format raw value with ID thousand separator for input field: 10000000 → "10.000.000"
function formatYAxisValueFull(v) {
  if (v == null) return '';
  return Math.round(v).toLocaleString('id-ID');
}

// Returns the current y-axis range display: "auto" or "0 - 10M"
function getYRangeLabel(trend) {
  if (trend.yMin == null && trend.yMax == null) return 'auto';
  const lo = trend.yMin != null ? formatYAxisValueShort(trend.yMin) : 'auto';
  const hi = trend.yMax != null ? formatYAxisValueShort(trend.yMax) : 'auto';
  return `${lo} - ${hi}`;
}

function initTrendBuilder() {
  // Setup catalog + canvas DnD + action buttons immediately (doesn't need data)
  setupTrendCatalog();
  setupTrendCanvas();
  setupTrendActionButtons();
  // Loading layout from storage happens after data loads (see loadData)
}

function setupTrendCatalog() {
  const catalog = document.getElementById('trends-catalog');
  if (!catalog) return;
  catalog.innerHTML = SIZES.map(s => {
    const sizeKey = String(s).replace('.', '_');
    const color = getTrendColor(sizeKey);
    return `<li class="trend-source" draggable="true" data-size="${sizeKey}" style="--size-color: ${color}">
      <span class="trend-source-dot"></span>
      <span class="trend-source-label">${formatTrendSize(sizeKey)}</span>
    </li>`;
  }).join('');
  catalog.querySelectorAll('.trend-source').forEach(el => {
    el.addEventListener('dragstart', e => {
      e.dataTransfer.setData('text/plain', el.dataset.size);
      e.dataTransfer.effectAllowed = 'copy';
    });
  });
}

function setupTrendCanvas() {
  const canvas = document.getElementById('trends-canvas');
  if (!canvas) return;
  canvas.addEventListener('dragover', e => {
    e.preventDefault();
    canvas.classList.add('drag-over');
  });
  canvas.addEventListener('dragleave', e => {
    if (e.target === canvas) canvas.classList.remove('drag-over');
  });
  canvas.addEventListener('drop', e => {
    e.preventDefault();
    canvas.classList.remove('drag-over');
    const sizeKey = e.dataTransfer.getData('text/plain');
    if (!sizeKey) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // If drop point is on an existing window → combine into it (add as new dataset)
    const target = getTrendAtPoint(x, y);
    if (target) {
      addSizeToTrend(target, sizeKey);
      return;
    }

    // Otherwise create new window centered on drop point
    // Cascade: if there are existing windows, offset by 24px to avoid perfect overlap
    const offset = TRENDS.length * 24;
    addTrendWindow(sizeKey, Math.max(8, x - 240 + offset), Math.max(8, y - 30 + offset));
  });
}

function getTrendAtPoint(x, y) {
  // Iterate in reverse so top-most window wins
  for (let i = TRENDS.length - 1; i >= 0; i--) {
    const t = TRENDS[i];
    if (x >= t.x && x <= t.x + t.w && y >= t.y && y <= t.y + t.h) {
      return t;
    }
  }
  return null;
}

function flashTrend(trend) {
  const el = trend.el;
  const color = getTrendColor(trend.sizeKey === 'combined' ? '1' : trend.sizeKey);
  el.style.transition = 'transform 0.2s, box-shadow 0.2s';
  el.style.transform = 'scale(1.04)';
  el.style.boxShadow = `0 0 0 3px ${color}, 0 6px 20px rgba(0, 0, 0, 0.45)`;
  setTimeout(() => {
    el.style.transform = '';
    el.style.boxShadow = '';
  }, 280);
}

function addSizeToTrend(targetTrend, newSizeKey) {
  // Collect existing sizes (combinedSizes for combined, else [sizeKey])
  let sizes = targetTrend.combinedSizes
    ? [...targetTrend.combinedSizes]
    : [targetTrend.sizeKey];

  // Duplicate: flash to indicate "udah ada" and skip
  if (sizes.includes(newSizeKey)) {
    flashTrend(targetTrend);
    return;
  }

  sizes.push(newSizeKey);

  // Save geometry + date range so the new combined window keeps the same position
  const x = targetTrend.x;
  const y = targetTrend.y;
  const w = targetTrend.w;
  const h = targetTrend.h;
  const startDate = targetTrend.startDate || null;
  const endDate = targetTrend.endDate || null;
  // Preserve y-ref if exists (combined only)
  const yRefSize = targetTrend.yRefSize || sizes[0];
  // Preserve y-axis custom range
  const yMin = targetTrend.yMin != null ? targetTrend.yMin : null;
  const yMax = targetTrend.yMax != null ? targetTrend.yMax : null;

  // Tear down old
  if (targetTrend.chart) targetTrend.chart.destroy();
  targetTrend.el.remove();
  TRENDS = TRENDS.filter(t => t.id !== targetTrend.id);

  // Spawn a new combined trend at the same spot
  const fakeTrends = sizes.map(sk => ({ sizeKey: sk, normalized: false }));
  combineTrends(fakeTrends, { x, y, w, h, startDate, endDate, yRefSize, yMin, yMax });
}

function removeSizeFromTrend(trend, sizeKeyToRemove) {
  if (!trend.combinedSizes) return; // not a combined window
  const sizes = trend.combinedSizes.filter(s => s !== sizeKeyToRemove);
  if (sizes.length === 0) return; // safety

  // Save geometry + date range
  const x = trend.x, y = trend.y, w = trend.w, h = trend.h;
  const startDate = trend.startDate || null;
  const endDate = trend.endDate || null;
  // Pick a new y-ref if current one is being removed
  const yRefSize = trend.yRefSize === sizeKeyToRemove ? sizes[0] : trend.yRefSize;
  // Preserve y-axis custom range
  const yMin = trend.yMin != null ? trend.yMin : null;
  const yMax = trend.yMax != null ? trend.yMax : null;

  // Tear down
  if (trend.chart) trend.chart.destroy();
  trend.el.remove();
  TRENDS = TRENDS.filter(t => t.id !== trend.id);

  if (sizes.length === 1) {
    // Convert to single trend at same position (no y-ref needed)
    addTrendWindow(sizes[0], x, y, { w, h, startDate, endDate, normalized: false, yMin, yMax });
  } else {
    // Re-spawn combined with remaining sizes
    const fakeTrends = sizes.map(sk => ({ sizeKey: sk, normalized: false }));
    combineTrends(fakeTrends, { x, y, w, h, startDate, endDate, yRefSize, yMin, yMax });
  }
}

function populateCombinedLegend(trend) {
  const legendEl = trend.el.querySelector('.trend-legend');
  if (!legendEl) return;
  legendEl.innerHTML = '';
  trend.combinedSizes.forEach(sk => {
    const color = getTrendColor(sk);
    const item = document.createElement('div');
    item.className = 'trend-legend-item';
    item.style.setProperty('--size-color', color);
    item.dataset.size = sk;
    item.innerHTML = `
      <span class="trend-legend-dot" style="background: ${color}"></span>
      <span class="trend-legend-label">${formatTrendSize(sk)}</span>
      <button class="trend-legend-remove" title="Remove ${formatTrendSize(sk)}">×</button>
    `;
    item.querySelector('.trend-legend-remove').addEventListener('click', (e) => {
      e.stopPropagation();
      removeSizeFromTrend(trend, sk);
    });
    legendEl.appendChild(item);
  });
}

function setupTrendActionButtons() {
  const combineBtn = document.getElementById('trend-combine-btn');
  const resetBtn = document.getElementById('trend-reset-btn');
  if (combineBtn) {
    combineBtn.addEventListener('click', () => {
      const selected = TRENDS.filter(t => t.selected && t.sizeKey !== 'combined');
      if (selected.length < 2) return;
      combineTrends(selected);
    });
  }
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      if (TRENDS.length === 0) return;
      if (!confirm('Reset semua trend windows? Layout yang kesimpan akan dihapus.')) return;
      TRENDS.forEach(t => {
        if (t.chart) t.chart.destroy();
        t.el.remove();
      });
      TRENDS = [];
      showTrendCanvasEmpty();
      updateTrendCombineButton();
      try { localStorage.removeItem('antam-trends-layout'); } catch (e) {}
    });
  }
}

function addTrendWindow(sizeKey, x, y, opts = {}) {
  const id = `trend-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const w = opts.w || 480;
  const h = opts.h || 320;
  // Date range: prefer explicit opts, else convert from old 'range', else default (1mo back to *)
  let startDate, endDate;
  if (opts.startDate !== undefined || opts.endDate !== undefined) {
    startDate = opts.startDate || null;
    endDate = opts.endDate !== undefined ? opts.endDate : null;
  } else if (opts.range) {
    const conv = convertOldRangeToDateRange(opts.range);
    startDate = conv.startDate;
    endDate = conv.endDate;
  } else {
    startDate = defaultStartDate();
    endDate = null;
  }
  const normalized = !!opts.normalized;
  const color = getTrendColor(sizeKey);

  const el = document.createElement('div');
  el.className = 'trend-window';
  el.dataset.trendId = id;
  el.dataset.size = sizeKey;
  el.style.left = x + 'px';
  el.style.top = y + 'px';
  el.style.width = w + 'px';
  el.style.height = h + 'px';
  el.style.zIndex = ++trendZIndex;
  el.style.setProperty('--size-color', color);
  el.innerHTML = `
    <div class="trend-window-header">
      <span class="trend-handle" title="Drag to move">⋮⋮</span>
      <span class="trend-title">${formatTrendSize(sizeKey)}</span>
      <label class="trend-select-wrap" title="Tick buat combine"><input type="checkbox" class="trend-select-checkbox"> pick</label>
      <span class="trend-date-range">
        <input type="text" class="trend-date-input trend-date-start" placeholder="mm/dd/yyyy" maxlength="10" title="Start date">
        <span class="trend-date-sep">→</span>
        <input type="text" class="trend-date-input trend-date-end" placeholder="*" maxlength="10" title="End date (kosong = latest)">
      </span>
      <label class="trend-norm-wrap" title="Re-base ke 100 dari titik pertama"><input type="checkbox" class="trend-norm-checkbox"> 100</label>
      <button class="trend-close-btn" title="Close">×</button>
    </div>
    <div class="trend-window-body">
      <div class="trend-chart-wrap">
        <canvas class="trend-canvas"></canvas>
      </div>
      <div class="trend-legend"></div>
    </div>
    <div class="trend-resize-handle" title="Drag to resize">⇲</div>
  `;
  // Set initial input values from startDate/endDate
  el.querySelector('.trend-date-start').value = startDate ? formatMMDDYYYY(startDate) : '';
  el.querySelector('.trend-date-end').value = endDate ? formatMMDDYYYY(endDate) : '';
  el.querySelector('.trend-norm-checkbox').checked = normalized;
  if (opts.selected) el.querySelector('.trend-select-checkbox').checked = true;

  document.getElementById('trends-canvas').appendChild(el);

  const trend = { id, sizeKey, x, y, w, h, startDate, endDate, normalized, yMin: opts.yMin != null ? opts.yMin : null, yMax: opts.yMax != null ? opts.yMax : null, chart: null, el, selected: !!opts.selected };
  TRENDS.push(trend);

  setupTrendWindowInteractions(trend);
  createTrendChart(trend);
  hideTrendCanvasEmpty();
  updateTrendCombineButton();
  if (!opts.skipSave) saveTrendLayout();
}

function setupTrendWindowInteractions(trend) {
  const el = trend.el;

  // Bring to front on any mousedown inside the window
  el.addEventListener('mousedown', () => {
    el.style.zIndex = ++trendZIndex;
  });

  // Drag window (mousedown on header, but skip on form controls)
  const header = el.querySelector('.trend-window-header');
  header.addEventListener('mousedown', e => {
    if (e.target.closest('button, select, input, label')) return;
    e.preventDefault();
    const startX = e.clientX, startY = e.clientY;
    const origX = trend.x, origY = trend.y;
    const onMove = e => {
      const dx = e.clientX - startX, dy = e.clientY - startY;
      trend.x = Math.max(0, origX + dx);
      trend.y = Math.max(0, origY + dy);
      el.style.left = trend.x + 'px';
      el.style.top = trend.y + 'px';
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      saveTrendLayout();
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  // Resize handle (bottom-right corner)
  const resizeHandle = el.querySelector('.trend-resize-handle');
  resizeHandle.addEventListener('mousedown', e => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX, startY = e.clientY;
    const origW = trend.w, origH = trend.h;
    const onMove = e => {
      const dw = e.clientX - startX, dh = e.clientY - startY;
      trend.w = Math.max(300, origW + dw);
      trend.h = Math.max(220, origH + dh);
      el.style.width = trend.w + 'px';
      el.style.height = trend.h + 'px';
      if (trend.chart) trend.chart.resize();
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      saveTrendLayout();
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  // Close button
  el.querySelector('.trend-close-btn').addEventListener('click', () => {
    if (trend.chart) trend.chart.destroy();
    el.remove();
    TRENDS = TRENDS.filter(t => t.id !== trend.id);
    showTrendCanvasEmpty();
    updateTrendCombineButton();
    saveTrendLayout();
  });

  // Start/end date inputs (single trend)
  const startInput = el.querySelector('.trend-date-start');
  const endInput = el.querySelector('.trend-date-end');
  setupTrendDateInputs(trend, startInput, endInput, () => createTrendChart(trend));

  // Normalize toggle
  el.querySelector('.trend-norm-checkbox').addEventListener('change', e => {
    trend.normalized = e.target.checked;
    createTrendChart(trend);
    saveTrendLayout();
  });

  // Select checkbox
  el.querySelector('.trend-select-checkbox').addEventListener('change', e => {
    trend.selected = e.target.checked;
    updateTrendCombineButton();
  });

  // Right-click context menu
  setupTrendContextMenu(trend);
}

function getRecordsForTrendDateRange(startDate, endDate) {
  if (!rawDates || !rawColumns || rawDates.length === 0) return [];
  let startIdx = 0;
  let endIdx = rawDates.length;
  if (startDate) {
    const i = rawDates.findIndex(d => d >= startDate);
    startIdx = i === -1 ? rawDates.length : i;
  }
  if (endDate) {
    const i = rawDates.findIndex(d => d > endDate);
    endIdx = i === -1 ? rawDates.length : i;
  }
  const records = [];
  for (let i = startIdx; i < endIdx; i++) {
    const rec = { date: rawDates[i] };
    for (const k in rawColumns) rec[k] = rawColumns[k][i];
    records.push(rec);
  }
  return records;
}

function createTrendChart(trend) {
  if (trend.chart) {
    trend.chart.destroy();
    trend.chart = null;
  }
  const records = getRecordsForTrendDateRange(trend.startDate, trend.endDate);
  if (!records.length) return;
  const sizeKey = buildSizeKey(trend.sizeKey, 'sell');
  const rawValues = records.map(r => r[sizeKey]).filter(v => v != null);
  if (!rawValues.length) return;
  const dates = records.map(r => r.date);

  let data, fillBg;
  if (trend.normalized) {
    const base = rawValues[0];
    data = rawValues.map(v => (v / base) * 100);
    fillBg = true;
  } else {
    data = rawValues;
    fillBg = false;
  }

  const color = getTrendColor(trend.sizeKey);
  const ctx = trend.el.querySelector('.trend-canvas');
  // Y-axis range: custom if set (and not normalized), else auto
  const useCustomY = !trend.normalized && trend.yMin != null && trend.yMax != null;
  const yScale = {
    min: trend.normalized ? 50 : (useCustomY ? trend.yMin : undefined),
    max: trend.normalized ? 200 : (useCustomY ? trend.yMax : undefined),
    ticks: {
      maxTicksLimit: 4,
      font: { size: 9 },
      callback: v => trend.normalized ? v.toFixed(0) : 'Rp ' + (v / 1000).toFixed(0) + 'k',
    },
    grid: { color: 'rgba(255,255,255,0.05)' },
    title: { display: false },
  };
  trend.chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: dates,
      datasets: [{
        label: formatTrendSize(trend.sizeKey),
        data: data,
        borderColor: color,
        backgroundColor: color + '20',
        borderWidth: 1.5,
        pointRadius: 0,
        pointHoverRadius: 3,
        tension: 0.1,
        fill: fillBg,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => trend.normalized
              ? `${ctx.parsed.y.toFixed(2)} (${ctx.parsed.y >= 100 ? '+' : ''}${(ctx.parsed.y - 100).toFixed(1)}%)`
              : 'Rp ' + ctx.parsed.y.toLocaleString('id-ID'),
          },
        },
      },
      scales: {
        x: { type: 'time', time: { unit: 'month' }, ticks: { maxTicksLimit: 5, font: { size: 9 } }, grid: { display: false } },
        y: yScale,
      },
    },
  });
}

function updateTrendCombineButton() {
  const selected = TRENDS.filter(t => t.selected && t.sizeKey !== 'combined');
  const btn = document.getElementById('trend-combine-btn');
  if (!btn) return;
  btn.disabled = selected.length < 2;
  btn.textContent = `🔗 Combine (${selected.length})`;
}

// Build the Chart.js config (labels, datasets, scales) for a combined trend window.
// All sizes share a single y-axis. yRefSize controls the y-axis range + label.
// Returns null if no records in range.
function buildCombinedChartConfig(startDate, endDate, combinedSizes, normalized, yRefSize, customYMin = null, customYMax = null) {
  const records = getRecordsForTrendDateRange(startDate, endDate);
  if (!records.length) return null;
  const dates = records.map(r => r.date);

  // Compute data per size
  const sizeData = {};
  combinedSizes.forEach(sk => {
    const sizeKey = buildSizeKey(sk, 'sell');
    let data = records.map(r => r[sizeKey]);
    if (normalized && data.length) {
      const firstValid = data.find(v => v != null);
      if (firstValid) {
        data = data.map(v => v != null ? (v / firstValid) * 100 : null);
      }
    }
    sizeData[sk] = data;
  });

  // Y-axis range: union of ALL sizes' data so every line is visible.
  // yRefSize is still passed in (kept in scope) for any future use; currently
  // the y-axis is unlabelled, so the only knob the user has is the range itself.
  let yMin, yMax;
  if (normalized) {
    yMin = 50; yMax = 200;
  } else if (customYMin != null && customYMax != null && customYMin < customYMax) {
    // User-set custom range
    yMin = customYMin;
    yMax = customYMax;
  } else {
    // Find global min/max across every size's data
    let globalMin = Infinity, globalMax = -Infinity;
    combinedSizes.forEach(sk => {
      const valid = (sizeData[sk] || []).filter(v => v != null);
      if (!valid.length) return;
      const lo = Math.min(...valid);
      const hi = Math.max(...valid);
      if (lo < globalMin) globalMin = lo;
      if (hi > globalMax) globalMax = hi;
    });
    if (isFinite(globalMin) && isFinite(globalMax)) {
      const pad = (globalMax - globalMin) * 0.05 || 1;
      yMin = globalMin - pad;
      yMax = globalMax + pad;
    } else {
      yMin = 0; yMax = 1;
    }
  }

  const datasets = combinedSizes.map(sk => {
    const color = getTrendColor(sk);
    return {
      label: formatTrendSize(sk),
      data: sizeData[sk],
      borderColor: color,
      backgroundColor: color + '15',
      borderWidth: 1.5,
      pointRadius: 0,
      pointHoverRadius: 3,
      tension: 0.1,
      yAxisID: 'y',
      fill: false,
    };
  });

  const scales = {
    x: { type: 'time', time: { unit: 'month' }, ticks: { maxTicksLimit: 6, font: { size: 9 } }, grid: { display: false } },
    y: {
      type: 'linear',
      position: 'left',
      min: yMin,
      max: yMax,
      title: { display: false },
      ticks: {
        maxTicksLimit: 5,
        font: { size: 9 },
        callback: v => normalized ? v.toFixed(0) : 'Rp ' + (v / 1000).toFixed(0) + 'k',
      },
      grid: { color: 'rgba(255,255,255,0.05)' },
    },
  };

  return { labels: dates, datasets, scales };
}

// Re-render a combined trend's chart (after date, normalize, or y-ref change)
function rebuildCombinedChart(trend) {
  const config = buildCombinedChartConfig(trend.startDate, trend.endDate, trend.combinedSizes, trend.normalized, trend.yRefSize, trend.yMin, trend.yMax);
  if (!config) {
    if (trend.chart) { trend.chart.destroy(); trend.chart = null; }
    return;
  }
  if (trend.chart) { trend.chart.destroy(); trend.chart = null; }
  const ctx = trend.el.querySelector('.trend-canvas');
  trend.chart = new Chart(ctx, {
    type: 'line',
    data: { labels: config.labels, datasets: config.datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => {
              const label = ctx.dataset.label || '';
              const v = ctx.parsed.y;
              if (trend.normalized) return `${label}: ${v.toFixed(2)} (${v >= 100 ? '+' : ''}${(v - 100).toFixed(1)}%)`;
              return `${label}: Rp ${v.toLocaleString('id-ID')}`;
            },
          },
        },
      },
      scales: config.scales,
    },
  });
  // Update title to reflect normalize + y-ref
  const titleEl = trend.el.querySelector('.trend-title');
  if (titleEl) {
    const mode = trend.normalized ? 'normalized' : `axis: ${formatTrendSize(trend.yRefSize)}`;
    titleEl.textContent = `🔗 Combined (${trend.combinedSizes.length} sizes · ${mode})`;
  }
}

function combineTrends(trends, opts = {}) {
  if (trends.length < 2) return;
  // Use the first trend's date range (could be expanded to intersection later)
  const startDate = opts.startDate !== undefined ? opts.startDate : (trends[0].startDate || null);
  const endDate = opts.endDate !== undefined ? opts.endDate : (trends[0].endDate || null);
  const allNormalized = trends.every(t => t.normalized);
  const combinedSizes = trends.map(t => t.sizeKey);
  // y-ref: from opts (e.g. preserve when re-spawning after remove), else default to first size
  const yRefSize = (opts.yRefSize && combinedSizes.includes(opts.yRefSize)) ? opts.yRefSize : combinedSizes[0];

  // Validate that we have data
  const testConfig = buildCombinedChartConfig(startDate, endDate, combinedSizes, allNormalized, yRefSize, opts.yMin, opts.yMax);
  if (!testConfig) return;

  const id = `trend-combined-${Date.now()}`;
  const x = opts.x ?? 40, y = opts.y ?? 40, w = opts.w ?? 640, h = opts.h ?? 400;
  // Y-axis custom range (null = auto)
  const yMin = (opts.yMin != null && isFinite(opts.yMin)) ? opts.yMin : null;
  const yMax = (opts.yMax != null && isFinite(opts.yMax)) ? opts.yMax : null;
  const el = document.createElement('div');
  el.className = 'trend-window trend-combined';
  el.dataset.trendId = id;
  el.style.left = x + 'px';
  el.style.top = y + 'px';
  el.style.width = w + 'px';
  el.style.height = h + 'px';
  el.style.zIndex = ++trendZIndex;
  el.style.setProperty('--size-color', '#d4af37');
  el.innerHTML = `
    <div class="trend-window-header">
      <span class="trend-handle">⋮⋮</span>
      <span class="trend-title">🔗 Combined (${combinedSizes.length} sizes · axis: ${formatTrendSize(yRefSize)})</span>
      <span class="trend-date-range">
        <input type="text" class="trend-date-input trend-date-start" placeholder="mm/dd/yyyy" maxlength="10" title="Start date">
        <span class="trend-date-sep">→</span>
        <input type="text" class="trend-date-input trend-date-end" placeholder="*" maxlength="10" title="End date (kosong = latest)">
      </span>
      <label class="trend-yref-wrap" title="Label y-axis (range selalu cover semua data biar semua size keliatan)">
        <span class="trend-yref-label">Y:</span>
        <select class="trend-yref-select">
          ${combinedSizes.map(sk => `<option value="${sk}"${sk === yRefSize ? ' selected' : ''}>${formatTrendSize(sk)}</option>`).join('')}
        </select>
      </label>
      <label class="trend-norm-wrap" title="Re-base semua size ke 100 dari titik pertama"><input type="checkbox" class="trend-norm-checkbox"> 100</label>
      <button class="trend-close-btn">×</button>
    </div>
    <div class="trend-window-body">
      <div class="trend-chart-wrap">
        <canvas class="trend-canvas"></canvas>
      </div>
      <div class="trend-legend"></div>
    </div>
    <div class="trend-resize-handle">⇲</div>
  `;
  // Set initial input values
  el.querySelector('.trend-date-start').value = startDate ? formatMMDDYYYY(startDate) : '';
  el.querySelector('.trend-date-end').value = endDate ? formatMMDDYYYY(endDate) : '';
  el.querySelector('.trend-norm-checkbox').checked = allNormalized;
  const yrefSelect = el.querySelector('.trend-yref-select');
  yrefSelect.disabled = allNormalized; // disabled when normalized on

  document.getElementById('trends-canvas').appendChild(el);

  const trend = { id, sizeKey: 'combined', combinedSizes, x, y, w, h, startDate, endDate, normalized: allNormalized, yRefSize, yMin, yMax, chart: null, el, selected: false };
  TRENDS.push(trend);

  // Build chart via helper
  rebuildCombinedChart(trend);

  // Populate custom legend strip with × buttons per size
  populateCombinedLegend(trend);

  // Wire date inputs (uses trend.startDate/endDate and calls rebuildCombinedChart on change)
  const startInput = el.querySelector('.trend-date-start');
  const endInput = el.querySelector('.trend-date-end');
  setupTrendDateInputs(trend, startInput, endInput, () => rebuildCombinedChart(trend));

  // Wire y-ref selector
  yrefSelect.addEventListener('change', e => {
    trend.yRefSize = e.target.value;
    rebuildCombinedChart(trend);
    saveTrendLayout();
  });

  // Wire normalize toggle (also enables/disables y-ref selector)
  el.querySelector('.trend-norm-checkbox').addEventListener('change', e => {
    trend.normalized = e.target.checked;
    yrefSelect.disabled = trend.normalized;
    rebuildCombinedChart(trend);
    saveTrendLayout();
  });

  // Right-click context menu
  setupTrendContextMenu(trend);

  // Drag window
  el.addEventListener('mousedown', () => { el.style.zIndex = ++trendZIndex; });
  const header = el.querySelector('.trend-window-header');
  header.addEventListener('mousedown', e => {
    if (e.target.closest('button, select, input, label')) return;
    e.preventDefault();
    const startX = e.clientX, startY = e.clientY;
    const origX = trend.x, origY = trend.y;
    const onMove = e => {
      trend.x = Math.max(0, origX + e.clientX - startX);
      trend.y = Math.max(0, origY + e.clientY - startY);
      el.style.left = trend.x + 'px';
      el.style.top = trend.y + 'px';
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      saveTrendLayout();
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
  el.querySelector('.trend-resize-handle').addEventListener('mousedown', e => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX, startY = e.clientY;
    const origW = trend.w, origH = trend.h;
    const onMove = e => {
      trend.w = Math.max(380, origW + e.clientX - startX);
      trend.h = Math.max(280, origH + e.clientY - startY);
      el.style.width = trend.w + 'px';
      el.style.height = trend.h + 'px';
      if (trend.chart) trend.chart.resize();
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      saveTrendLayout();
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
  el.querySelector('.trend-close-btn').addEventListener('click', () => {
    if (trend.chart) trend.chart.destroy();
    el.remove();
    TRENDS = TRENDS.filter(t => t.id !== id);
    showTrendCanvasEmpty();
    saveTrendLayout();
  });

  hideTrendCanvasEmpty();
  saveTrendLayout();
}

// ====== Right-click context menu for trend windows ======

function setupTrendContextMenu(trend) {
  trend.el.addEventListener('contextmenu', e => {
    e.preventDefault();
    e.stopPropagation();
    showTrendContextMenu(trend, e.clientX, e.clientY);
  });
}

function hideTrendContextMenu() {
  document.querySelectorAll('.trend-context-menu').forEach(el => el.remove());
}

function showTrendContextMenu(trend, clientX, clientY) {
  hideTrendContextMenu();
  const isCombined = trend.sizeKey === 'combined';
  const title = isCombined
    ? `🔗 ${trend.combinedSizes.length} sizes`
    : formatTrendSize(trend.sizeKey);
  const subtitle = isCombined
    ? (trend.normalized ? 'normalized' : `axis: ${formatTrendSize(trend.yRefSize)}`)
    : (trend.normalized ? 'normalized' : 'price');

  const menu = document.createElement('div');
  menu.className = 'trend-context-menu';

  // Build menu items
  let html = '';
  html += `<div class="trend-context-header">
    <span>${title}</span>
    <span class="trend-context-subtitle">${subtitle}</span>
  </div>`;

  // Date range
  html += `<div class="trend-context-item" data-action="focus-start">
    <span class="trend-context-label-left">📅 Start</span>
    <span class="trend-context-label-right"><b>${trend.startDate ? formatMMDDYYYY(trend.startDate) : '*'}</b></span>
  </div>`;
  html += `<div class="trend-context-item" data-action="focus-end">
    <span class="trend-context-label-left">📅 End</span>
    <span class="trend-context-label-right"><b>${trend.endDate ? formatMMDDYYYY(trend.endDate) : '*'}</b></span>
  </div>`;

  // Normalize toggle
  html += `<div class="trend-context-item" data-action="toggle-norm">
    <span class="trend-context-label-left">📐 Normalize (100)</span>
    <span class="trend-context-check ${trend.normalized ? 'checked' : ''}">${trend.normalized ? '✓' : ''}</span>
  </div>`;

  // Y-axis reference (combined only)
  if (isCombined) {
    html += `<div class="trend-context-item" data-action="set-yref">
      <span class="trend-context-label-left">🎯 Y-axis</span>
      <span class="trend-context-label-right"><b>${formatTrendSize(trend.yRefSize)}</b> <span class="trend-context-caret">▸</span></span>
    </div>`;
  }

  // Y-axis range (single + combined). Disabled when normalized (range fixed at 50-200).
  const isNorm = trend.normalized;
  const rangeLabel = isNorm ? '50 - 200' : getYRangeLabel(trend);
  const rangeDisabled = isNorm;
  html += `<div class="trend-context-item ${rangeDisabled ? 'disabled' : ''}" data-action="set-yrange">
    <span class="trend-context-label-left">📏 Y-axis range</span>
    <span class="trend-context-label-right"><b>${rangeLabel}</b> <span class="trend-context-caret">${rangeDisabled ? '' : '▸'}</span></span>
  </div>`;

  html += `<hr class="trend-context-sep">`;

  // Add / remove size
  if (isCombined) {
    const available = getValidSizeKeys().filter(sk => !trend.combinedSizes.includes(sk));
    if (available.length) {
      html += `<div class="trend-context-item" data-action="add-size">
        <span class="trend-context-label-left">➕ Add size</span>
        <span class="trend-context-label-right"><span class="trend-context-caret">▸</span></span>
      </div>`;
    }
    if (trend.combinedSizes.length > 1) {
      html += `<div class="trend-context-item" data-action="remove-size">
        <span class="trend-context-label-left">➖ Remove size</span>
        <span class="trend-context-label-right"><span class="trend-context-caret">▸</span></span>
      </div>`;
    }
  } else {
    html += `<div class="trend-context-item" data-action="convert-combined">
      <span class="trend-context-label-left">🔗 Convert to combined</span>
      <span class="trend-context-label-right"><span class="trend-context-caret">▸</span></span>
    </div>`;
  }

  html += `<hr class="trend-context-sep">`;

  // Export
  html += `<div class="trend-context-item" data-action="export">
    <span class="trend-context-label-left">📤 Export CSV</span>
    <span class="trend-context-label-right"></span>
  </div>`;

  // Reset
  html += `<div class="trend-context-item" data-action="reset">
    <span class="trend-context-label-left">↻ Reset to defaults</span>
    <span class="trend-context-label-right"></span>
  </div>`;

  // Close
  html += `<div class="trend-context-item danger" data-action="close">
    <span class="trend-context-label-left">🗑️ Close trend</span>
    <span class="trend-context-label-right"></span>
  </div>`;

  menu.innerHTML = html;
  document.body.appendChild(menu);

  // Position at cursor, clamp to viewport
  const rect = menu.getBoundingClientRect();
  const maxX = window.innerWidth - rect.width - 8;
  const maxY = window.innerHeight - rect.height - 8;
  menu.style.left = Math.max(8, Math.min(clientX, maxX)) + 'px';
  menu.style.top = Math.max(8, Math.min(clientY, maxY)) + 'px';

  // Wire items
  menu.querySelectorAll('.trend-context-item').forEach(item => {
    const action = item.dataset.action;
    item.addEventListener('click', e => {
      e.stopPropagation();
      handleContextAction(trend, action, item, menu);
    });
    // Submenu: show on hover
    if (['set-yref', 'set-yrange', 'add-size', 'remove-size', 'convert-combined'].includes(action)) {
      item.addEventListener('mouseenter', () => showContextSubmenu(trend, item, action, menu));
    }
  });

  // Close on outside click / Escape
  setTimeout(() => {
    document.addEventListener('mousedown', closeContextOnOutside, { once: true, capture: true });
    document.addEventListener('keydown', closeContextOnEscape, { once: true });
    document.addEventListener('contextmenu', closeContextOnOutside, { once: true, capture: true });
  }, 50);
}

function closeContextOnOutside(e) {
  // Close if click is outside any context menu
  if (!e.target.closest('.trend-context-menu')) {
    hideTrendContextMenu();
  } else {
    // Click inside menu, re-arm the listener for next outside click
    setTimeout(() => {
      document.addEventListener('mousedown', closeContextOnOutside, { once: true, capture: true });
    }, 50);
  }
}

function closeContextOnEscape(e) {
  if (e.key === 'Escape') hideTrendContextMenu();
}

function showContextSubmenu(trend, parentItem, action, parentMenu) {
  // Remove any existing submenu
  document.querySelectorAll('.trend-context-submenu').forEach(el => el.remove());

  const sub = document.createElement('div');
  sub.className = 'trend-context-menu trend-context-submenu';

  let html = '';
  if (action === 'set-yref') {
    html += `<div class="trend-context-header"><span>Pilih Y-axis</span></div>`;
    trend.combinedSizes.forEach(sk => {
      const isRef = sk === trend.yRefSize;
      html += `<div class="trend-context-item" data-action="set-yref-pick" data-size="${sk}">
        <span class="trend-context-label-left"><span class="trend-context-dot" style="background: ${getTrendColor(sk)}"></span>${formatTrendSize(sk)}</span>
        <span class="trend-context-check ${isRef ? 'checked' : ''}">${isRef ? '✓' : ''}</span>
      </div>`;
    });
  } else if (action === 'set-yrange') {
    // Y-axis range submenu
    html += `<div class="trend-context-header"><span>Y-axis range</span></div>`;
    // Auto option
    const isAuto = trend.yMin == null && trend.yMax == null;
    html += `<div class="trend-context-item" data-action="yrange-auto">
      <span class="trend-context-label-left">Auto (fit to data)</span>
      <span class="trend-context-check ${isAuto ? 'checked' : ''}">${isAuto ? '✓' : ''}</span>
    </div>`;
    // Show current custom range, if any
    if (!isAuto) {
      html += `<div class="trend-context-item" data-action="yrange-show">
        <span class="trend-context-label-left" style="padding-left: 12px; color: #d4af37;">${getYRangeLabel(trend)}</span>
        <span class="trend-context-label-right"></span>
      </div>`;
    }
    html += `<hr class="trend-context-sep">`;
    // Set min / max
    html += `<div class="trend-context-item" data-action="yrange-setmin">
      <span class="trend-context-label-left">Set min${trend.yMin != null ? `: ${formatYAxisValueShort(trend.yMin)}` : '...'}</span>
      <span class="trend-context-label-right"></span>
    </div>`;
    html += `<div class="trend-context-item" data-action="yrange-setmax">
      <span class="trend-context-label-left">Set max${trend.yMax != null ? `: ${formatYAxisValueShort(trend.yMax)}` : '...'}</span>
      <span class="trend-context-label-right"></span>
    </div>`;
    html += `<hr class="trend-context-sep">`;
    // Quick presets
    html += `<div class="trend-context-header" style="font-size: 10px; padding: 4px 10px; color: #9aa0a6; font-weight: 500;">Quick presets</div>`;
    const presets = [
      { label: '0 - 5M', min: 0, max: 5e6 },
      { label: '0 - 10M', min: 0, max: 10e6 },
      { label: '0 - 20M', min: 0, max: 20e6 },
      { label: '0 - 50M', min: 0, max: 50e6 },
      { label: '0 - 100M', min: 0, max: 100e6 },
      { label: '5M - 15M', min: 5e6, max: 15e6 },
    ];
    presets.forEach(p => {
      const isCurrent = trend.yMin === p.min && trend.yMax === p.max;
      html += `<div class="trend-context-item" data-action="yrange-preset" data-min="${p.min}" data-max="${p.max}">
        <span class="trend-context-label-left" style="padding-left: 12px;">${p.label}</span>
        <span class="trend-context-check ${isCurrent ? 'checked' : ''}">${isCurrent ? '✓' : ''}</span>
      </div>`;
    });
    html += `<hr class="trend-context-sep">`;
    // Reset
    if (!isAuto) {
      html += `<div class="trend-context-item" data-action="yrange-auto">
        <span class="trend-context-label-left">↻ Reset to auto</span>
        <span class="trend-context-label-right"></span>
      </div>`;
    }
  } else if (action === 'add-size') {
    html += `<div class="trend-context-header"><span>Add size</span></div>`;
    const available = getValidSizeKeys().filter(sk => !trend.combinedSizes.includes(sk));
    available.forEach(sk => {
      html += `<div class="trend-context-item" data-action="add-size-pick" data-size="${sk}">
        <span class="trend-context-label-left"><span class="trend-context-dot" style="background: ${getTrendColor(sk)}"></span>${formatTrendSize(sk)}</span>
        <span class="trend-context-label-right"></span>
      </div>`;
    });
  } else if (action === 'remove-size') {
    html += `<div class="trend-context-header"><span>Hapus size</span></div>`;
    trend.combinedSizes.forEach(sk => {
      html += `<div class="trend-context-item" data-action="remove-size-pick" data-size="${sk}">
        <span class="trend-context-label-left"><span class="trend-context-dot" style="background: ${getTrendColor(sk)}"></span>${formatTrendSize(sk)}</span>
        <span class="trend-context-label-right">✕</span>
      </div>`;
    });
  } else if (action === 'convert-combined') {
    html += `<div class="trend-context-header"><span>Combine dengan</span></div>`;
    const available = getValidSizeKeys().filter(sk => sk !== trend.sizeKey);
    available.forEach(sk => {
      html += `<div class="trend-context-item" data-action="convert-pick" data-size="${sk}">
        <span class="trend-context-label-left"><span class="trend-context-dot" style="background: ${getTrendColor(sk)}"></span>${formatTrendSize(sk)}</span>
        <span class="trend-context-label-right"></span>
      </div>`;
    });
  }

  sub.innerHTML = html;
  document.body.appendChild(sub);

  // Position next to parent (try right side, then left, then down)
  const parentRect = parentItem.getBoundingClientRect();
  const subRect = sub.getBoundingClientRect();
  const maxX = window.innerWidth - subRect.width - 8;
  let left = parentRect.right - 4;
  if (left > maxX) left = parentRect.left - subRect.width + 4;
  if (left < 8) left = 8;
  sub.style.left = left + 'px';
  // Align top with parent
  let top = parentRect.top;
  if (top + subRect.height > window.innerHeight - 8) {
    top = window.innerHeight - subRect.height - 8;
  }
  sub.style.top = Math.max(8, top) + 'px';

  // Wire submenu items
  sub.querySelectorAll('.trend-context-item').forEach(item => {
    item.addEventListener('click', e => {
      e.stopPropagation();
      const act = item.dataset.action;
      const sk = item.dataset.size;
      if (act === 'set-yref-pick') {
        trend.yRefSize = sk;
        const yrefSelect = trend.el.querySelector('.trend-yref-select');
        if (yrefSelect) yrefSelect.value = sk;
        rebuildCombinedChart(trend);
        saveTrendLayout();
        hideTrendContextMenu();
      } else if (act === 'yrange-auto') {
        // Reset to auto (clear custom range)
        trend.yMin = null;
        trend.yMax = null;
        if (trend.sizeKey === 'combined') {
          rebuildCombinedChart(trend);
        } else {
          createTrendChart(trend);
        }
        saveTrendLayout();
        hideTrendContextMenu();
      } else if (act === 'yrange-setmin' || act === 'yrange-setmax') {
        const isMin = act === 'yrange-setmin';
        const currentVal = isMin ? trend.yMin : trend.yMax;
        const displayVal = currentVal != null ? formatYAxisValueFull(currentVal) : '';
        const promptMsg = isMin
          ? 'Set MIN Y-axis value.\nFormat: 0, 100K, 10M, 1.5M, 10.000.000, 1e7'
          : 'Set MAX Y-axis value.\nFormat: 10000000, 10M, 20M, 5jt';
        const input = prompt(promptMsg, displayVal);
        if (input == null) return; // user cancelled
        const v = parseYAxisValue(input);
        if (v == null) {
          alert('Nilai tidak valid. Coba: 0, 100K, 10M, 10.000.000, dll.');
          return;
        }
        if (isMin) trend.yMin = v;
        else trend.yMax = v;
        // Validate: both set, min < max
        if (trend.yMin != null && trend.yMax != null && trend.yMin >= trend.yMax) {
          alert('Min harus lebih kecil dari max.\nMin saat ini: ' + formatYAxisValueShort(trend.yMin) + '\nMax saat ini: ' + formatYAxisValueShort(trend.yMax));
          if (isMin) trend.yMin = currentVal; // revert
          else trend.yMax = currentVal;
          return;
        }
        if (trend.sizeKey === 'combined') {
          rebuildCombinedChart(trend);
        } else {
          createTrendChart(trend);
        }
        saveTrendLayout();
        hideTrendContextMenu();
      } else if (act === 'yrange-preset') {
        trend.yMin = parseFloat(item.dataset.min);
        trend.yMax = parseFloat(item.dataset.max);
        if (trend.sizeKey === 'combined') {
          rebuildCombinedChart(trend);
        } else {
          createTrendChart(trend);
        }
        saveTrendLayout();
        hideTrendContextMenu();
      } else if (act === 'add-size-pick') {
        addSizeToTrend(trend, sk);
        hideTrendContextMenu();
      } else if (act === 'remove-size-pick') {
        removeSizeFromTrend(trend, sk);
        hideTrendContextMenu();
      } else if (act === 'convert-pick') {
        // Convert single → combined at same position
        const startDate = trend.startDate || null;
        const endDate = trend.endDate || null;
        const x = trend.x, y = trend.y, w = trend.w, h = trend.h;
        // Tear down source
        if (trend.chart) trend.chart.destroy();
        trend.el.remove();
        TRENDS = TRENDS.filter(t => t.id !== trend.id);
        combineTrends([
          { sizeKey: trend.sizeKey, normalized: false },
          { sizeKey: sk, normalized: false },
        ], { x, y, w, h, startDate, endDate });
        hideTrendContextMenu();
      }
    });
  });
}

function handleContextAction(trend, action, item, menu) {
  switch (action) {
    case 'focus-start': {
      hideTrendContextMenu();
      const input = trend.el.querySelector('.trend-date-start');
      input.focus();
      input.select();
      break;
    }
    case 'focus-end': {
      hideTrendContextMenu();
      const input = trend.el.querySelector('.trend-date-end');
      input.focus();
      input.select();
      break;
    }
    case 'toggle-norm': {
      trend.normalized = !trend.normalized;
      if (trend.sizeKey === 'combined') {
        const yrefSelect = trend.el.querySelector('.trend-yref-select');
        if (yrefSelect) yrefSelect.disabled = trend.normalized;
        rebuildCombinedChart(trend);
      } else {
        const normCb = trend.el.querySelector('.trend-norm-checkbox');
        if (normCb) normCb.checked = trend.normalized;
        createTrendChart(trend);
      }
      saveTrendLayout();
      hideTrendContextMenu();
      break;
    }
    case 'export': {
      exportTrendData(trend);
      hideTrendContextMenu();
      break;
    }
    case 'reset': {
      resetTrendToDefaults(trend);
      hideTrendContextMenu();
      break;
    }
    case 'close': {
      if (trend.sizeKey === 'combined') {
        if (trend.chart) trend.chart.destroy();
        trend.el.remove();
        TRENDS = TRENDS.filter(t => t.id !== trend.id);
        showTrendCanvasEmpty();
      } else {
        trend.el.querySelector('.trend-close-btn').click();
      }
      hideTrendContextMenu();
      break;
    }
    // Submenu actions are handled in showContextSubmenu
    case 'set-yref':
    case 'set-yrange':
    case 'add-size':
    case 'remove-size':
    case 'convert-combined':
      // Don't hide — submenu will open on hover
      break;
  }
}

function exportTrendData(trend) {
  const records = getRecordsForTrendDateRange(trend.startDate, trend.endDate);
  if (!records.length) {
    alert('No data in range to export');
    return;
  }
  const dates = records.map(r => r.date);
  const sizes = trend.combinedSizes || [trend.sizeKey];
  // For normalized, compute base per size
  const baseValues = {};
  sizes.forEach(sk => {
    const sizeKey = buildSizeKey(sk, 'sell');
    const vals = records.map(r => r[sizeKey]);
    if (trend.normalized) {
      const firstValid = vals.find(v => v != null);
      baseValues[sk] = firstValid || null;
    } else {
      baseValues[sk] = null;
    }
  });
  // Header
  let csv = 'date';
  sizes.forEach(sk => {
    csv += ',' + (trend.normalized ? `${formatTrendSize(sk)}_idx` : formatTrendSize(sk));
  });
  csv += '\n';
  // Rows
  dates.forEach((d, i) => {
    csv += d;
    sizes.forEach(sk => {
      const sizeKey = buildSizeKey(sk, 'sell');
      let v = records[i][sizeKey];
      if (trend.normalized && v != null && baseValues[sk]) {
        v = (v / baseValues[sk]) * 100;
      }
      csv += ',' + (v != null ? (Number.isInteger(v) ? v : v.toFixed(4)) : '');
    });
    csv += '\n';
  });
  // Download
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const fname = `trend-${sizes.join('-')}-${dates[0]}-to-${dates[dates.length-1]}.csv`;
  a.download = fname;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function resetTrendToDefaults(trend) {
  trend.startDate = defaultStartDate();
  trend.endDate = null;
  trend.normalized = false;
  trend.yMin = null;
  trend.yMax = null;
  if (trend.sizeKey === 'combined') {
    trend.yRefSize = trend.combinedSizes[0];
  }
  // Update header inputs
  trend.el.querySelector('.trend-date-start').value = formatMMDDYYYY(trend.startDate);
  trend.el.querySelector('.trend-date-end').value = '';
  const normCb = trend.el.querySelector('.trend-norm-checkbox');
  if (normCb) normCb.checked = false;
  if (trend.sizeKey === 'combined') {
    const yrefSelect = trend.el.querySelector('.trend-yref-select');
    if (yrefSelect) {
      yrefSelect.disabled = false;
      yrefSelect.value = trend.yRefSize;
    }
    rebuildCombinedChart(trend);
  } else {
    createTrendChart(trend);
  }
  saveTrendLayout();
}

function hideTrendCanvasEmpty() {
  document.getElementById('trends-canvas-empty')?.classList.add('hidden');
}

function showTrendCanvasEmpty() {
  if (TRENDS.length === 0) {
    document.getElementById('trends-canvas-empty')?.classList.remove('hidden');
  }
}

function saveTrendLayout() {
  const layout = TRENDS.map(t => ({
    id: t.id,
    sizeKey: t.sizeKey,
    x: Math.round(t.x), y: Math.round(t.y), w: Math.round(t.w), h: Math.round(t.h),
    startDate: t.startDate || null,
    endDate: t.endDate || null,
    normalized: t.normalized,
    selected: !!t.selected,
    yMin: t.yMin != null ? t.yMin : null,
    yMax: t.yMax != null ? t.yMax : null,
  }));
  try {
    localStorage.setItem('antam-trends-layout', JSON.stringify(layout));
  } catch (e) {
    console.warn('localStorage save failed', e);
  }
}

function loadTrendLayout() {
  // Should only run after data is loaded
  if (!allRecords || allRecords.length === 0) return;
  const raw = localStorage.getItem('antam-trends-layout');
  if (!raw) return;
  try {
    const layout = JSON.parse(raw);
    if (!Array.isArray(layout) || layout.length === 0) return;
    const valid = getValidSizeKeys();
    layout.forEach(t => {
      // Skip combined windows (can't reconstruct without re-running combine)
      if (t.sizeKey === 'combined') return;
      if (!valid.includes(t.sizeKey)) return;
      // Handle backward compat: old layout had 'range', new has 'startDate'/'endDate'
      const opts = { w: t.w, h: t.h, normalized: t.normalized, selected: t.selected, skipSave: true };
      if (t.startDate !== undefined || t.endDate !== undefined) {
        opts.startDate = t.startDate || null;
        opts.endDate = t.endDate !== undefined ? t.endDate : null;
      } else if (t.range) {
        opts.range = t.range; // addTrendWindow will convert via convertOldRangeToDateRange
      }
      if (t.yMin != null) opts.yMin = t.yMin;
      if (t.yMax != null) opts.yMax = t.yMax;
      addTrendWindow(t.sizeKey, t.x, t.y, opts);
    });
  } catch (e) {
    console.warn('Failed to load trend layout', e);
    try { localStorage.removeItem('antam-trends-layout'); } catch (_) {}
  }
}
