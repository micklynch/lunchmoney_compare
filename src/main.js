import './style.css';

// ── Helpers ─────────────────────────────────────────
const $ = id => document.getElementById(id);
const fmt = n => '$' + n.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
const fmtDiff = n => (n >= 0 ? '+$' : '−$') + Math.abs(n).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
const fmtK = n => {
  const abs = Math.abs(n);
  const core = abs >= 1000 ? '$' + (abs / 1000).toFixed(1) + 'k' : fmt(abs);
  return (n < 0 ? '−' : '') + core;
};
const clamp = (n, a, b) => Math.min(Math.max(n, a), b);

function fmtYMD(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

// ── Module State ──────────────────────────────────────
let dashboardData = null;
let trendData = null;
let trendChartInstance = null;
let netWorthData = null;
let netWorthChartInstance = null;

// ── Theme ────────────────────────────────────────────
const THEME_KEY = 'lm-dashboard-theme';
function getTheme() {
  const q = new URLSearchParams(location.search).get('theme');
  if (q === 'light' || q === 'dark') return q;
  try {
    const s = localStorage.getItem(THEME_KEY);
    if (s === 'light' || s === 'dark') return s;
  } catch (_) {}
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}
let currentTheme = getTheme();
function applyTheme(t) {
  currentTheme = t;
  document.body.classList.toggle('light', t === 'light');
  document.documentElement.style.colorScheme = t;
  try { localStorage.setItem(THEME_KEY, t); } catch (_) {}
}
applyTheme(currentTheme);

// ── API ──────────────────────────────────────────────
async function fetchTransactions(startDate, endDate) {
  const params = new URLSearchParams({ start_date: startDate, end_date: endDate });
  const res = await fetch(`/api/transactions?${params}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'API error');
  }
  const data = await res.json();
  return data.transactions || [];
}

async function fetchJSONSafe(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch (_) {
    return null;
  }
}

// Budget summary for the month containing inputDate:
// counts budgeted expense categories not yet fully spent.
function computeBudgetSummary(budgetsRaw, inputDate) {
  if (!Array.isArray(budgetsRaw)) return null;
  const monthKey = inputDate.getFullYear() + '-' + String(inputDate.getMonth() + 1).padStart(2, '0') + '-01';
  let remainingTotal = 0, remainingCount = 0, totalBudget = 0;
  budgetsRaw.forEach(b => {
    if (b.is_group || b.is_income || b.exclude_from_budget || b.archived) return;
    const d = b.data && b.data[monthKey];
    const budget = d ? Math.abs(d.budget_to_base ?? d.budget_amount ?? 0) : 0;
    if (budget <= 0) return;
    const spent = d ? Math.abs(d.spending_to_base ?? 0) : 0;
    totalBudget += budget;
    const rem = Math.max(0, budget - spent);
    if (rem > 0.005) { remainingCount++; remainingTotal += rem; }
  });
  if (totalBudget <= 0) return null;
  return {
    remainingTotal: Math.round(remainingTotal * 100) / 100,
    remainingCount,
    totalBudget: Math.round(totalBudget * 100) / 100,
  };
}

// Net worth: current balances from assets + plaid accounts,
// history estimated by walking backwards through monthly cash flow.
const LIABILITY_TYPES = ['credit', 'loan'];
function computeNetWorth(assetsRes, plaidRes, trend) {
  const assets = (assetsRes && assetsRes.assets) || [];
  const plaid = (plaidRes && plaidRes.plaid_accounts) || [];
  let current = 0, count = 0;
  assets.forEach(a => {
    if (a.closed_on) return;
    const b = parseFloat(a.to_base ?? a.balance) || 0;
    // manually managed liabilities: count as debt regardless of sign entered
    const isDebt = LIABILITY_TYPES.includes((a.type_name || '').toLowerCase());
    current += isDebt ? -Math.abs(b) : b;
    count++;
  });
  plaid.forEach(a => {
    const b = parseFloat(a.to_base ?? a.balance) || 0;
    // plaid convention for credit/loan: positive balance = amount owed,
    // negative = credit in our favour -> negate the signed balance
    const isDebt = LIABILITY_TYPES.includes((a.type || '').toLowerCase());
    current += isDebt ? -b : b;
    count++;
  });
  if (count === 0 || trend.length === 0) return null;
  const n = trend.length;
  const values = new Array(n);
  values[n - 1] = current;
  for (let i = n - 2; i >= 0; i--) {
    values[i] = values[i + 1] - (trend[i + 1].income - trend[i + 1].spending);
  }
  return {
    labels: trend.map(m => m.label),
    values: values.map(v => Math.round(v * 100) / 100),
    current: Math.round(current * 100) / 100,
    count,
  };
}

// ── Data Processing ─────────────────────────────────
function calculateDateBoundaries(inputDate) {
  const startOfThisMonth = new Date(inputDate.getFullYear(), inputDate.getMonth(), 1);
  const endOfPrevMonth = new Date(inputDate.getFullYear(), inputDate.getMonth(), 0);
  const startOfPrevMonth = new Date(endOfPrevMonth.getFullYear(), endOfPrevMonth.getMonth(), 1);
  return { startOfThisMonth, endOfPrevMonth, startOfPrevMonth };
}

function processTransactions(txns) {
  let df = txns.map(t => ({
    date: new Date(t.date + 'T00:00:00'),
    amount: parseFloat(t.amount) || 0,
    exclude_from_totals: !!t.exclude_from_totals,
    is_income: !!t.is_income,
    payee: t.payee || '',
    category_name: t.category_name || '',
  }));
  df = df.filter(t => !t.exclude_from_totals && !t.is_income);
  df.sort((a, b) => a.date - b.date);
  let cum = 0;
  df.forEach(t => {
    cum += t.amount;
    t.cumulative = cum;
    t.day = t.date.getDate();
  });
  return df;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function computeDayOfWeek(txns) {
  const dow = {};
  txns.forEach(t => {
    const d = t.date.getDay();
    dow[d] = (dow[d] || 0) + t.amount;
  });
  return DAY_NAMES.map((name, i) => ({ label: name, amount: Math.round((dow[i] || 0) * 100) / 100 }));
}

function findNearestAvailableDay(df, targetDay) {
  const availableDays = [...new Set(df.map(t => t.day))].sort((a, b) => a - b);
  if (!availableDays.length) return null;
  return availableDays.reduce((nearest, day) =>
    Math.abs(day - targetDay) < Math.abs(nearest - targetDay) ? day : nearest
  );
}

async function computeMonthlyTrend(inputDate) {
  const startDate = new Date(inputDate.getFullYear() - 1, inputDate.getMonth(), 1);
  const endDate = new Date(inputDate.getFullYear(), inputDate.getMonth() + 1, 0);
  const raw = await fetchTransactions(fmtYMD(startDate), fmtYMD(addDays(endDate, 1)));
  const spendingMonthly = {};
  const incomeMonthly = {};
  raw.forEach(t => {
    if (t.exclude_from_totals) return;
    const d = new Date(t.date + 'T00:00:00');
    if (d.getFullYear() === inputDate.getFullYear() && d.getMonth() === inputDate.getMonth() && d > inputDate) return;
    const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    const amt = parseFloat(t.amount) || 0;
    if (t.is_income) {
      incomeMonthly[key] = (incomeMonthly[key] || 0) + Math.abs(amt);
    } else {
      spendingMonthly[key] = (spendingMonthly[key] || 0) + amt;
    }
  });
  const result = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(inputDate.getFullYear(), inputDate.getMonth() - i, 1);
    const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    const label = d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
    result.push({
      label,
      spending: Math.round((spendingMonthly[key] || 0) * 100) / 100,
      income: Math.round((incomeMonthly[key] || 0) * 100) / 100,
    });
  }
  // trim leading months that have no data at all
  const firstIdx = result.findIndex(m => m.spending !== 0 || m.income !== 0);
  return firstIdx === -1 ? [] : result.slice(firstIdx);
}

function buildChartDataPoints(df, dayKey) {
  const groups = {};
  df.forEach(t => {
    const key = t[dayKey];
    if (key == null || isNaN(key)) return;
    const rk = Math.round(key * 100) / 100;
    if (!groups[rk] || t.cumulative > groups[rk]) {
      groups[rk] = t.cumulative;
    }
  });
  return Object.entries(groups)
    .map(([x, y]) => ({ x: parseFloat(x), y: Math.round(y * 100) / 100 }))
    .sort((a, b) => a.x - b.x);
}

function buildDashboardData(currentMonth, lastMonth, fullCurrentMonth, inputDate, boundaries) {
  const { startOfPrevMonth } = boundaries;
  const daysInCurrentMonth = daysInMonth(inputDate.getFullYear(), inputDate.getMonth() + 1);
  const daysInPrevMonth = daysInMonth(startOfPrevMonth.getFullYear(), startOfPrevMonth.getMonth() + 1);
  const daysElapsed = inputDate.getDate();
  const daysRemaining = daysInCurrentMonth - daysElapsed;

  // Current month chart: group by day
  const currentChart = buildChartDataPoints(currentMonth, 'day');

  // Last month chart: normalize days, group by normalized_day
  const lastMonthNorm = lastMonth.map(t => ({
    ...t,
    normalized_day: t.day * (daysInCurrentMonth / daysInPrevMonth),
  }));
  const lastChart = buildChartDataPoints(lastMonthNorm, 'normalized_day');

  // Future chart: starting from last actual point
  const futureChart = [];
  const cutoff = new Date(inputDate);
  cutoff.setHours(0, 0, 0, 0);
  const futureSlice = fullCurrentMonth.filter(t => t.date > cutoff);
  if (futureSlice.length > 0 && currentMonth.length > 0) {
    const lastActual = currentMonth[currentMonth.length - 1];
    futureChart.push({ x: lastActual.day, y: Math.round(lastActual.cumulative * 100) / 100 });
    const fg = {};
    futureSlice.forEach(t => {
      if (t.day == null || isNaN(t.day)) return;
      if (!fg[t.day] || t.cumulative > fg[t.day]) fg[t.day] = t.cumulative;
    });
    Object.entries(fg).forEach(([day, cum]) => {
      futureChart.push({ x: parseInt(day), y: Math.round(cum * 100) / 100 });
    });
    futureChart.sort((a, b) => a.x - b.x);
  }

  // Summary
  const thisMonthTotal = currentMonth.length > 0
    ? currentMonth[currentMonth.length - 1].cumulative : 0;

  const equivDays = Math.ceil((daysElapsed / daysInCurrentMonth) * daysInPrevMonth);
  const cappedEquiv = Math.min(equivDays, daysInPrevMonth);
  const nearestDay = findNearestAvailableDay(lastMonth, cappedEquiv);
  let lastMonthEquivalent = 0;
  if (nearestDay !== null) {
    const dayEntries = lastMonth.filter(t => t.day === nearestDay);
    if (dayEntries.length > 0) {
      lastMonthEquivalent = dayEntries[dayEntries.length - 1].cumulative;
    }
  }

  const diff = thisMonthTotal - lastMonthEquivalent;
  const percentDiff = lastMonthEquivalent > 0 ? (diff / lastMonthEquivalent) * 100 : 0;
  const lastMonthTotal = lastMonth.length > 0 ? lastMonth[lastMonth.length - 1].cumulative : 0;

  const avgDaily = daysElapsed > 0 ? thisMonthTotal / daysElapsed : 0;
  const projectedTotal = avgDaily * daysInCurrentMonth;

  // Categories
  const catMap = {};
  currentMonth.forEach(t => {
    const name = (t.category_name && !['nan', 'None', ''].includes(t.category_name))
      ? t.category_name : 'uncategorized';
    catMap[name] = (catMap[name] || 0) + t.amount;
  });
  const categories = Object.entries(catMap)
    .map(([name, amount]) => ({ name, amount: Math.round(amount * 100) / 100 }))
    .sort((a, b) => b.amount - a.amount);

  // Recent transactions
  const recentTransactions = [...currentMonth]
    .sort((a, b) => b.date - a.date)
    .map(t => ({
      date: t.date.toLocaleDateString('en-US', { month: 'short', day: '2-digit' }),
      amount: Math.round(t.amount * 100) / 100,
      payee: t.payee || '',
      category: (t.category_name && !['nan', 'None', ''].includes(t.category_name))
        ? t.category_name : '',
    }));

  // Daily totals
  const dayMap = {};
  currentMonth.forEach(t => { dayMap[t.day] = (dayMap[t.day] || 0) + t.amount; });
  const dailyTotals = Object.entries(dayMap)
    .map(([day, amount]) => ({ day: parseInt(day), amount: Math.round(amount * 100) / 100 }))
    .sort((a, b) => b.amount - a.amount);

  const monthName = inputDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  return {
    summary: {
      currentMonthTotal: Math.round(thisMonthTotal * 100) / 100,
      lastMonthEquivalent: Math.round(lastMonthEquivalent * 100) / 100,
      difference: Math.round(diff * 100) / 100,
      percentDiff: Math.round(percentDiff * 10) / 10,
      lastMonthTotal: Math.round(lastMonthTotal * 100) / 100,
      daysElapsed, daysRemaining, daysInMonth: daysInCurrentMonth,
      avgDaily: Math.round(avgDaily * 100) / 100,
      projectedTotal: Math.round(projectedTotal * 100) / 100,
      date: fmtYMD(inputDate), monthName,
    },
    currentMonthChart: currentChart,
    lastMonthChart: lastChart,
    futureChart,
    categories,
    recentTransactions,
    dailyTotals,
  };
}

// ── Motion Utilities ────────────────────────────────
function countUp(el, to, formatter, dur = 950) {
  if (!el) return;
  const from = typeof el._val === 'number' ? el._val : 0;
  el._val = to;
  const start = performance.now();
  function frame(t) {
    const p = clamp((t - start) / dur, 0, 1);
    const e = p === 1 ? 1 : 1 - Math.pow(2, -10 * p); // easeOutExpo
    el.textContent = formatter(from + (to - from) * e);
    if (p < 1) requestAnimationFrame(frame);
    else el.textContent = formatter(to);
  }
  requestAnimationFrame(frame);
}

// reveal on scroll
const revealObserver = new IntersectionObserver(entries => {
  entries.forEach(e => {
    if (e.isIntersecting) {
      e.target.classList.add('in');
      revealObserver.unobserve(e.target);
    }
  });
}, { threshold: 0.06 });
document.querySelectorAll('.reveal').forEach(el => revealObserver.observe(el));

// pointer spotlight
document.addEventListener('pointermove', e => {
  const el = e.target.closest('.spot');
  if (!el) return;
  const r = el.getBoundingClientRect();
  el.style.setProperty('--mx', ((e.clientX - r.left) / r.width * 100) + '%');
  el.style.setProperty('--my', ((e.clientY - r.top) / r.height * 100) + '%');
});

// ── Chart Theming ───────────────────────────────────
const cssVar = v => getComputedStyle(document.body).getPropertyValue(v).trim();

function chartPalette() {
  return {
    accent:  cssVar('--accent'),
    accent2: cssVar('--accent-2'),
    blue:    cssVar('--blue'),
    dn:      cssVar('--dn'),
    grid:    cssVar('--chart-grid'),
    tick:    cssVar('--chart-tick'),
    axis:    cssVar('--chart-axis'),
    legend:  cssVar('--text-dim'),
    ttBg:    cssVar('--tt-bg'),
    ttBdr:   cssVar('--tt-border'),
    ttTitle: cssVar('--text-dim'),
    ttBody:  cssVar('--text'),
  };
}

function vGrad(ctx, area, topColor, bottomColor) {
  const g = ctx.createLinearGradient(0, area.bottom, 0, area.top);
  g.addColorStop(0, bottomColor);
  g.addColorStop(1, topColor);
  return g;
}

const MONO_10 = { family: "'JetBrains Mono', monospace", size: 10 };
const MONO_11 = { family: "'JetBrains Mono', monospace", size: 11 };

function tooltipStyle(P) {
  return {
    backgroundColor: P.ttBg,
    borderColor: P.ttBdr,
    borderWidth: 1,
    titleColor: P.ttTitle,
    bodyColor: P.ttBody,
    titleFont: MONO_10,
    bodyFont: MONO_11,
    padding: 12,
    cornerRadius: 10,
    boxPadding: 4,
  };
}

// ── Rendering ────────────────────────────────────────
function renderStats(s) {
  countUp($('s-cur'), s.currentMonthTotal, fmt);
  $('s-cur-sub').textContent = s.daysElapsed + ' of ' + s.daysInMonth + ' days elapsed';
  countUp($('s-leq'), s.lastMonthEquivalent, fmt);
  $('s-leq-sub').textContent = 'proportional equivalent';

  const isUp = s.difference > 0;
  const dEl = $('s-diff');
  dEl.className = 'stat-val num ' + (isUp ? 'up' : 'dn');
  countUp(dEl, s.difference, fmtDiff);

  const chip = $('s-diff-chip');
  chip.className = 'delta-chip ' + (isUp ? 'up' : 'dn');
  chip.textContent = (isUp ? '▲ +' : '▼ ') + s.percentDiff.toFixed(1) + '%';
  $('s-diff-sub').textContent = 'vs proportional pace';

  countUp($('s-ltot'), s.lastMonthTotal, fmt);
  $('s-ltot-sub').textContent = 'full month';

  countUp($('p-avg'), s.avgDaily, fmt);
  countUp($('p-proj'), s.projectedTotal, fmt);

  if (s.hasBudget) {
    const n = s.budgetRemainingCount;
    $('p-proj-sub').textContent = 'incl. ' + fmt(s.budgetRemainingTotal) + ' left in ' + n + ' budget item' + (n === 1 ? '' : 's');
    countUp($('p-bud'), n, v => Math.round(v));
    $('p-bud-sub').textContent = fmt(s.budgetRemainingTotal) + ' left to pay';
  } else {
    $('p-proj-sub').textContent = 'based on current pace';
    $('p-bud').textContent = '—';
    $('p-bud-sub').textContent = 'no budget data';
  }

  const vsLast = s.lastMonthTotal > 0
    ? ((s.projectedTotal - s.lastMonthTotal) / s.lastMonthTotal * 100) : 0;
  $('p-proj-sub2').textContent = (vsLast >= 0 ? '+' : '') + vsLast.toFixed(1) + '% vs last month total';
  const projW = clamp(s.lastMonthTotal > 0
    ? (s.projectedTotal / s.lastMonthTotal * 100) : 50, 0, 100);
  requestAnimationFrame(() => { $('p-proj-bar').style.width = projW + '%'; });

  const progPct = s.daysInMonth > 0 ? s.daysElapsed / s.daysInMonth : 0;
  countUp($('p-prog'), progPct * 100, v => Math.round(v) + '%');
  const C = 2 * Math.PI * 30;
  requestAnimationFrame(() => {
    $('p-prog-ring').style.strokeDashoffset = (C * (1 - clamp(progPct, 0, 1))).toFixed(2);
  });

  countUp($('p-rem'), s.daysRemaining, v => Math.round(v));
  $('p-rem-sub').textContent = 'of ' + s.daysInMonth + ' days';
}

function buildChart(D) {
  const P = chartPalette();
  const ACCENT = P.accent;
  const LAST_C = P.blue;

  const prev = Chart.getChart('cumulative-chart');
  if (prev) prev.destroy();

  const datasets = [
    {
      label: 'last month',
      data: D.lastMonthChart,
      borderColor: LAST_C,
      backgroundColor: c => {
        const { ctx, chartArea } = c.chart;
        if (!chartArea) return LAST_C + '14';
        return vGrad(ctx, chartArea, LAST_C + '2b', LAST_C + '00');
      },
      borderWidth: 2,
      pointRadius: 0,
      pointHoverRadius: 5,
      pointHoverBackgroundColor: LAST_C,
      pointHoverBorderColor: P.ttBg,
      pointHoverBorderWidth: 2,
      fill: true,
      tension: 0.4,
    },
    {
      label: 'this month',
      data: D.currentMonthChart,
      borderColor: ACCENT,
      backgroundColor: c => {
        const { ctx, chartArea } = c.chart;
        if (!chartArea) return ACCENT + '1f';
        return vGrad(ctx, chartArea, ACCENT + '40', ACCENT + '00');
      },
      borderWidth: 2.5,
      pointRadius: 0,
      pointHoverRadius: 6,
      pointHoverBackgroundColor: ACCENT,
      pointHoverBorderColor: P.ttBg,
      pointHoverBorderWidth: 2,
      fill: true,
      tension: 0.4,
    },
  ];
  if (D.futureChart && D.futureChart.length > 1) {
    datasets.push({
      label: 'projected',
      data: D.futureChart,
      borderColor: P.accent2,
      backgroundColor: 'transparent',
      borderWidth: 2,
      borderDash: [5, 6],
      pointRadius: 0,
      pointHoverRadius: 4,
      fill: false,
      tension: 0.4,
    });
  }

  new Chart($('cumulative-chart'), {
    type: 'line',
    data: { datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      parsing: { xAxisKey: 'x', yAxisKey: 'y' },
      interaction: { mode: 'index', intersect: false },
      animation: { duration: 1000, easing: 'easeOutQuart' },
      plugins: {
        legend: {
          align: 'end',
          labels: {
            color: P.legend,
            font: MONO_10,
            boxWidth: 8, boxHeight: 8, padding: 18,
            usePointStyle: true, pointStyle: 'circle',
          },
        },
        tooltip: {
          ...tooltipStyle(P),
          callbacks: {
            title: ctx => 'day ' + ctx[0].parsed.x,
            label: ctx => '  ' + ctx.dataset.label + ': ' + fmt(ctx.parsed.y),
          },
        },
      },
      scales: {
        x: {
          type: 'linear', min: 1, max: 31,
          grid: { color: P.grid },
          ticks: { color: P.tick, font: MONO_10, stepSize: 5, maxTicksLimit: 8 },
          border: { color: P.axis },
        },
        y: {
          grid: { color: P.grid },
          ticks: { color: P.tick, font: MONO_10, callback: v => fmtK(v) },
          border: { color: P.axis },
        },
      },
    },
  });
}

function buildTrendChart(trend) {
  const P = chartPalette();
  const accentC = P.accent;
  const accent2C = P.accent2;
  const spendC = P.blue;
  const incomeC = P.dn;

  if (trendChartInstance) trendChartInstance.destroy();
  const ctx = document.getElementById('trend-chart').getContext('2d');

  const barGrad = (c, top, bottom) => {
    const { ctx: cctx, chartArea } = c.chart;
    if (!chartArea) return top;
    return vGrad(cctx, chartArea, top, bottom);
  };

  trendChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: trend.map(d => d.label),
      datasets: [
        {
          label: 'spending',
          data: trend.map(d => d.spending),
          backgroundColor: c => c.dataIndex === trend.length - 1
            ? barGrad(c, accentC, accent2C + 'cc')
            : barGrad(c, spendC, spendC + '55'),
          borderRadius: 6,
          borderSkipped: false,
          maxBarThickness: 26,
        },
        {
          label: 'income',
          data: trend.map(d => d.income),
          backgroundColor: c => barGrad(c, incomeC, incomeC + '55'),
          borderRadius: 6,
          borderSkipped: false,
          maxBarThickness: 26,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: {
        duration: 850,
        easing: 'easeOutQuart',
        delay: c => c.type === 'data' ? c.dataIndex * 45 : 0,
      },
      plugins: {
        legend: {
          align: 'end',
          labels: {
            color: P.legend,
            font: MONO_10,
            boxWidth: 8, boxHeight: 8, padding: 16,
            usePointStyle: true, pointStyle: 'circle',
          },
        },
        tooltip: {
          ...tooltipStyle(P),
          callbacks: {
            title: ctx => ctx[0].label,
            label: ctx => '  ' + ctx.dataset.label + ': ' + fmt(ctx.parsed.y),
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: P.tick, font: { family: "'JetBrains Mono', monospace", size: 9 }, maxRotation: 45 },
          border: { color: P.axis },
        },
        y: {
          grid: { color: P.grid },
          ticks: { color: P.tick, font: MONO_10, callback: v => fmtK(v) },
          border: { color: P.axis },
        },
      },
    },
  });
}

function buildNetWorthChart(nw) {
  const P = chartPalette();
  const C = P.accent2;

  if (netWorthChartInstance) netWorthChartInstance.destroy();

  netWorthChartInstance = new Chart($('networth-chart'), {
    type: 'line',
    data: {
      labels: nw.labels,
      datasets: [{
        label: 'net worth',
        data: nw.values,
        borderColor: C,
        backgroundColor: c => {
          const { ctx, chartArea } = c.chart;
          if (!chartArea) return C + '1f';
          return vGrad(ctx, chartArea, C + '45', C + '00');
        },
        borderWidth: 2.5,
        pointRadius: 0,
        pointHoverRadius: 6,
        pointHoverBackgroundColor: C,
        pointHoverBorderColor: P.ttBg,
        pointHoverBorderWidth: 2,
        fill: true,
        tension: 0.4,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      animation: { duration: 1000, easing: 'easeOutQuart' },
      plugins: {
        legend: { display: false },
        tooltip: {
          ...tooltipStyle(P),
          callbacks: {
            title: ctx => ctx[0].label,
            label: ctx => '  net worth: ' + fmt(ctx.parsed.y),
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: P.tick, font: { family: "'JetBrains Mono', monospace", size: 9 } },
          border: { color: P.axis },
        },
        y: {
          grid: { color: P.grid },
          ticks: { color: P.tick, font: MONO_10, callback: v => fmtK(v) },
          border: { color: P.axis },
        },
      },
    },
  });
}

function renderNetWorth(nw) {
  const panel = $('networth-panel');
  if (!nw) {
    panel.style.display = 'none';
    return;
  }
  panel.style.display = '';
  countUp($('nw-total'), nw.current, fmt);
  $('nw-meta').textContent = nw.count + ' accounts · estimated from balances + cash flow';

  const n = nw.values.length;
  const chip = $('nw-chip');
  if (n > 1 && nw.values[n - 2] !== 0) {
    const delta = nw.values[n - 1] - nw.values[n - 2];
    const pct = (delta / Math.abs(nw.values[n - 2])) * 100;
    const grew = delta >= 0;
    chip.style.display = '';
    chip.className = 'delta-chip ' + (grew ? 'dn' : 'up');
    chip.textContent = (grew ? '▲ +' : '▼ ') + pct.toFixed(1) + '%';
    $('nw-sub').textContent = fmtDiff(delta) + ' since last month';
  } else {
    chip.style.display = 'none';
    $('nw-sub').textContent = 'current total across accounts';
  }
  buildNetWorthChart(nw);
}

function renderBars(containerId, items, limit) {
  const el = $(containerId);
  if (!items || !items.length) {
    el.innerHTML = '<div class="bar-empty">no data</div>';
    return;
  }
  const top = items.slice(0, limit);
  const maxAmt = Math.max(...top.map(i => i.amount));
  el.innerHTML = '';
  top.forEach((item, i) => {
    const w = maxAmt > 0 ? clamp((item.amount / maxAmt) * 100, 0, 100) : 0;
    el.innerHTML += `<div class="bar-row" style="--i:${i}">
      <div class="bar-row-hd">
        <span class="bar-row-name">${item.label}</span>
        <span class="bar-row-amt">${fmt(item.amount)}</span>
      </div>
      <div class="bar-track"><div class="bar-fill" style="--i:${i};width:${w.toFixed(1)}%"></div></div>
    </div>`;
  });
}

function renderDow(items) {
  const el = $('dow-chart');
  if (!items || !items.length) {
    el.innerHTML = '<div class="bar-empty">no data</div>';
    return;
  }
  const maxAmt = Math.max(...items.map(i => i.amount), 0);
  el.innerHTML = items.map((item, i) => {
    const h = maxAmt > 0 ? clamp((item.amount / maxAmt) * 100, 2, 100) : 0;
    return `<div class="dow-col" title="${item.label}: ${fmt(item.amount)}">
      <span class="dow-amt">${item.amount > 0 ? fmtK(item.amount) : ''}</span>
      <div class="dow-bar-zone"><div class="dow-bar" style="--i:${i};--h:${h.toFixed(1)}%"></div></div>
      <span class="dow-label">${item.label}</span>
    </div>`;
  }).join('');
}

let txnData = [];
let txnSortCol = 'date';
let txnSortDir = -1;

function renderTxns(data) {
  if (data) txnData = [...data];
  const tbody = $('txn-body');
  if (!txnData.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="txn-empty">no transactions</td></tr>';
    return;
  }
  tbody.innerHTML = '';
  txnData.forEach((t, i) => {
    const tr = document.createElement('tr');
    tr.style.setProperty('--i', i);
    tr.innerHTML = `
      <td class="dim">${t.date}</td>
      <td class="payee trunc">${t.payee || '—'}</td>
      <td>${t.category ? `<span class="chip">${t.category}</span>` : '<span class="dim">—</span>'}</td>
      <td class="r">${fmt(t.amount)}</td>`;
    tbody.appendChild(tr);
  });
  ['date','payee','category','amount'].forEach(col => {
    const el = $('sort-' + col);
    if (el) el.textContent = col === txnSortCol ? (txnSortDir === -1 ? '↓' : '↑') : '';
  });
  $('txn-meta').textContent = 'this month · ' + txnData.length + ' transactions';
}

function sortTable(col) {
  if (txnSortCol === col) { txnSortDir *= -1; }
  else { txnSortCol = col; txnSortDir = col === 'amount' ? -1 : 1; }
  txnData.sort((a, b) => {
    let av = a[col] ?? '', bv = b[col] ?? '';
    if (col === 'amount') { av = Number(av); bv = Number(bv); }
    else { av = String(av).toLowerCase(); bv = String(bv).toLowerCase(); }
    if (av < bv) return -txnSortDir;
    if (av > bv) return txnSortDir;
    return 0;
  });
  renderTxns();
}

// ── Data Loading ──────────────────────────────────────
async function loadData() {
  const inputDate = new Date();
  inputDate.setHours(0, 0, 0, 0);
  const boundaries = calculateDateBoundaries(inputDate);
  const { startOfThisMonth, endOfPrevMonth, startOfPrevMonth } = boundaries;

  const currentMonthStart = fmtYMD(startOfThisMonth);
  const currentMonthEnd = fmtYMD(addDays(inputDate, 1));
  const prevMonthStart = fmtYMD(startOfPrevMonth);
  const prevMonthEnd = fmtYMD(endOfPrevMonth);
  const endOfCurrentMonth = new Date(inputDate.getFullYear(), inputDate.getMonth() + 1, 0);
  const fullCurrentMonthEnd = fmtYMD(addDays(endOfCurrentMonth, 1));

  const budgetParams = new URLSearchParams({
    start_date: currentMonthStart,
    end_date: fmtYMD(endOfCurrentMonth),
  });

  const [currentRaw, lastRaw, fullRaw, trend, budgetsRaw, assetsRes, plaidRes] = await Promise.all([
    fetchTransactions(currentMonthStart, currentMonthEnd),
    fetchTransactions(prevMonthStart, prevMonthEnd),
    fetchTransactions(currentMonthStart, fullCurrentMonthEnd),
    computeMonthlyTrend(inputDate),
    fetchJSONSafe(`/api/budgets?${budgetParams}`),
    fetchJSONSafe('/api/assets'),
    fetchJSONSafe('/api/plaid_accounts'),
  ]);

  let currentMonth = processTransactions(currentRaw);
  currentMonth = currentMonth.filter(t => t.date <= inputDate);

  let lastMonth = processTransactions(lastRaw);

  let fullCurrentMonth = processTransactions(fullRaw);
  fullCurrentMonth = fullCurrentMonth.filter(t => t.date <= endOfCurrentMonth);

  const D = buildDashboardData(currentMonth, lastMonth, fullCurrentMonth, inputDate, boundaries);

  // budget-aware projection: actuals so far + remaining budgeted expenses
  const budget = computeBudgetSummary(budgetsRaw, inputDate);
  D.summary.hasBudget = !!budget;
  if (budget) {
    D.summary.budgetRemainingTotal = budget.remainingTotal;
    D.summary.budgetRemainingCount = budget.remainingCount;
    D.summary.projectedTotal = Math.round((D.summary.currentMonthTotal + budget.remainingTotal) * 100) / 100;
  }

  dashboardData = D;
  trendData = trend;
  netWorthData = computeNetWorth(assetsRes, plaidRes, trend);

  $('hd-date').textContent = D.summary.date;
  $('ft-date').textContent = 'generated ' + D.summary.date;
  $('chart-meta').textContent = D.summary.monthName;

  renderStats(D.summary);
  buildChart(D);
  renderBars(
    'daily-bars',
    (D.dailyTotals || []).map(d => ({ label: 'day ' + String(d.day).padStart(2, '0'), amount: d.amount })),
    14,
  );
  renderBars(
    'cat-bars',
    (D.categories || []).map(c => ({ label: c.name, amount: c.amount })),
    10,
  );
  renderTxns(D.recentTransactions);

  renderDow(computeDayOfWeek(currentMonth));

  const totalSpent = trend.reduce((s, m) => s + m.spending, 0);
  const totalEarned = trend.reduce((s, m) => s + m.income, 0);
  const totalSaved = totalEarned - totalSpent;
  const savingsRate = totalEarned > 0 ? (totalSaved / totalEarned) * 100 : null;

  $('trend-title').textContent = 'monthly spending · ' + trend.length + '-month trend';
  $('trend-meta').textContent = trend.length > 1
    ? trend[0].label + ' – ' + trend[trend.length - 1].label : '';
  countUp($('ts-spent'), totalSpent, fmt);
  countUp($('ts-earned'), totalEarned, fmt);
  const savedEl = $('ts-saved');
  savedEl.className = 'mini-val num ' + (totalSaved >= 0 ? 'pos' : 'neg');
  countUp(savedEl, totalSaved, fmtDiff);
  const rateEl = $('ts-rate');
  if (savingsRate !== null) {
    rateEl.className = 'mini-val num rate';
    countUp(rateEl, savingsRate, v => v.toFixed(1) + '%');
  } else {
    rateEl.textContent = '—';
  }
  buildTrendChart(trend);

  renderNetWorth(netWorthData);

  const loading = document.getElementById('loading');
  if (loading) {
    loading.classList.add('done');
    setTimeout(() => { loading.style.display = 'none'; }, 600);
  }
}

// ── Initialization ────────────────────────────────────
async function main() {
  document.querySelectorAll('.data-table th.sortable').forEach(th => {
    th.addEventListener('click', () => sortTable(th.dataset.col));
  });

  try {
    await loadData();

    $('theme-toggle').addEventListener('click', () => {
      applyTheme(currentTheme === 'dark' ? 'light' : 'dark');
      if (dashboardData) buildChart(dashboardData);
      if (trendData) buildTrendChart(trendData);
      if (netWorthData) buildNetWorthChart(netWorthData);
    });

    $('refresh-btn').addEventListener('click', async () => {
      const btn = $('refresh-btn');
      btn.classList.add('spin');
      btn.style.pointerEvents = 'none';
      try {
        await loadData();
      } catch (err) {
        console.error(err);
      } finally {
        btn.classList.remove('spin');
        btn.style.pointerEvents = 'auto';
      }
    });

  } catch (err) {
    console.error(err);
    const loading = document.getElementById('loading');
    if (loading) {
      loading.innerHTML = `<div class="loading-error">
        failed to load dashboard
        <small>${err.message}</small>
      </div>`;
    }
  }
}

main();
