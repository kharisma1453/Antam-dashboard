// Antam Gold Dashboard - frontend logic (with buyback support)
const SIZES = [0.5, 1, 2, 3, 5, 10, 25, 50, 100, 250, 500, 1000];
const DEFAULT_SIZES = [1, 5, 10, 100];

let chart = null;
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

    // Initial render: all data
    allRecords = getFilteredRecords(null, null);
    const summary = computeSummary(allRecords);

    document.getElementById('start-date').value = summary.first_date;
    document.getElementById('end-date').value = summary.last_date;
    document.getElementById('last-update').textContent = summary.last_date;
    document.getElementById('data-range').textContent =
      `${summary.first_date} → ${summary.last_date} (${summary.total_days} hari)`;
    updateKPIs(summary);
    renderChart(allRecords, getActiveSizes());
    renderMonthly(allRecords);
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
  document.getElementById('kpi-buyback').textContent = idr(s.last_buyback);
  document.getElementById('kpi-buyback-sub').textContent = 'harga beli balik';

  // Spread
  document.getElementById('kpi-spread').textContent = idr(s.spread);
  document.getElementById('kpi-spread-pct').textContent = (s.spread_pct >= 0 ? '+' : '') + s.spread_pct.toFixed(2) + '% dari buyback';
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
    const monthsWithData = Object.keys(byYearMonth[y]).length;
    return `<option value="${y}" ${y === currentSelection ? 'selected' : ''}>${y} (${monthsWithData} bulan)</option>`;
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
      <td><strong>${monthName}</strong> <span style="color:var(--text-muted); font-size:11px;">${m.days} hari</span></td>
      <td style="color:var(--gold); font-weight:600;">${m.avgSell != null ? idr(m.avgSell) : '—'}</td>
      <td>${m.avgBuyback != null ? idr(m.avgBuyback) : '—'}</td>
      <td>${changeCell}</td>
    `;
    tbody.appendChild(tr);
  });
}
