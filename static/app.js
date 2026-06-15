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
document.addEventListener('DOMContentLoaded', () => {
  buildSizeToggles();
  attachListeners();
  loadData();
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
  // Read all visible rows; return array of {id, buyDate, sizeRef, grams, valid}
  const rows = document.querySelectorAll('#roi-rows .roi-row');
  return Array.from(rows).map((row) => {
    const id = row.dataset.rowId;
    const buyDate = row.querySelector('.roi-buy-date').value;
    const sizeRef = row.querySelector('.roi-size-ref').value;
    const grams = parseFloat(row.querySelector('.roi-grams').value);
    return { id, buyDate, sizeRef, grams, valid: !!(buyDate && sizeRef && grams && grams > 0) };
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

  // Initialize defaults on first row if not yet
  const firstRow = document.querySelector('#roi-rows .roi-row');
  if (firstRow) setROIRowDefaults(firstRow);

  const rows = getROIRows();
  const validRows = rows.filter((r) => r.valid);

  // Reset outputs
  const reset = () => {
    ['roi-modal', 'roi-current', 'roi-pnl', 'roi-cagr'].forEach((id) => {
      const el = document.getElementById(id);
      el.textContent = '—';
      el.className = 'roi-result-value neutral';
    });
    ['roi-modal-detail', 'roi-current-detail', 'roi-pnl-detail', 'roi-cagr-detail'].forEach((id) => {
      document.getElementById(id).textContent = '—';
    });
    document.getElementById('roi-period').textContent = '—';
  };

  if (validRows.length === 0) {
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
      modal: buyPrice * r.grams,
      current: currentPrice * r.grams,
      pnl: (currentPrice - buyPrice) * r.grams,
    };
  }).filter(Boolean);

  if (computed.length === 0) {
    reset();
    document.getElementById('roi-modal-detail').textContent = 'Tidak ada data valid untuk kombinasi input yang dimasukkan';
    return;
  }

  // Aggregate
  const totalGrams = computed.reduce((s, r) => s + r.grams, 0);
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
    return `${r.grams}g · ${sizeLabel} @ ${formatDateID(r.actualBuyDate)}`;
  }).join(' + ');

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
