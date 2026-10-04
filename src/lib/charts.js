// Chart layer.
//
// • Charts are created lazily — only once their section approaches the viewport.
// • Every chart lives in a registry keyed by canvas id so a theme flip can
//   rebuild them all (Chart.js bakes colours at construction time).
// • Colours are read from CSS custom properties, so there is one source of truth.

import { compactMoney, money, signedPct } from './format.js';
import { prefersReducedMotion } from './util.js';

const cv = v => getComputedStyle(document.body).getPropertyValue(v).trim();

export function palette() {
  return {
    cur: cv('--c-cur'),
    prior: cv('--c-prior'),
    pace: cv('--c-pace'),
    proj: cv('--c-proj'),
    income: cv('--c-income'),
    pos: cv('--c-pos'),
    neg: cv('--c-neg'),
    accent: cv('--accent'),
    grid: cv('--c-grid'),
    tick: cv('--c-tick'),
    axis: cv('--c-axis'),
    tipBg: cv('--c-tip-bg'),
    tipBd: cv('--c-tip-bdr'),
    tipTitle: cv('--c-tip-title'),
    tipBody: cv('--c-tip-body'),
    future: cv('--c-future'),
    surface: cv('--panel'),
  };
}

const MONO = size => ({ family: "'JetBrains Mono', ui-monospace, monospace", size });
const ANIM = () => (prefersReducedMotion() ? false : { duration: 750, easing: 'easeOutQuart' });

function verticalGradient(ctx, area, from, to) {
  if (!area) return from;
  const g = ctx.createLinearGradient(0, area.top, 0, area.bottom);
  g.addColorStop(0, from);
  g.addColorStop(1, to);
  return g;
}

/* ── shared option fragments ───────────────────────────────── */

function tooltip(P, extra = {}) {
  return {
    backgroundColor: P.tipBg,
    borderColor: P.tipBd,
    borderWidth: 1,
    titleColor: P.tipTitle,
    titleFont: MONO(10),
    bodyFont: MONO(11),
    bodyColor: P.tipBody,
    padding: 10,
    cornerRadius: 8,
    displayColors: true,
    boxWidth: 8,
    boxHeight: 8,
    boxPadding: 4,
    usePointStyle: true,
    caretSize: 5,
    ...extra,
  };
}

const gridX = P => ({ grid: { display: false }, border: { color: P.axis }, ticks: { color: P.tick, font: MONO(9) } });
const gridY = P => ({
  grid: { color: P.grid, drawTicks: false },
  border: { display: false },
  ticks: { color: P.tick, font: MONO(9), padding: 6, callback: v => compactMoney(v) },
});

/* ── pace chart plugins ────────────────────────────────────── */

/** Interpolate a sorted pixel-space point list at x = px. */
function sampleAt(points, px) {
  if (!points.length) return null;
  if (px <= points[0].x) return points[0].y;
  const last = points[points.length - 1];
  if (px >= last.x) return last.y;
  for (let i = 1; i < points.length; i++) {
    if (points[i].x >= px) {
      const a = points[i - 1];
      const b = points[i];
      const span = b.x - a.x || 1;
      return a.y + (b.y - a.y) * ((px - a.x) / span);
    }
  }
  return null;
}

/**
 * Shades the region still to come, then the gap between "this month" and
 * "last month" up to today. That gap *is* the month-over-month story.
 */
const gapPlugin = {
  id: 'lmGap',
  beforeDatasetsDraw(chart, _args, opts) {
    const area = chart.chartArea;
    if (!area) return;
    const ctx = chart.ctx;
    const P = palette();

    // future shading
    const todayX = chart.scales.x.getPixelForValue(opts.today);
    if (todayX < area.right) {
      ctx.save();
      ctx.fillStyle = P.future;
      ctx.fillRect(todayX, area.top, area.right - todayX, area.bottom - area.top);
      ctx.restore();
    }

    const cur = chart.getDatasetMeta(opts.curIdx).data;
    const prior = chart.getDatasetMeta(opts.priorIdx).data;
    if (!cur.length || !prior.length) return;

    const end = Math.min(todayX, area.right);
    if (end <= area.left) return;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(area.left, sampleAt(cur, area.left));
    for (let x = area.left; x <= end; x += 3) ctx.lineTo(x, sampleAt(cur, x));
    for (let x = end; x >= area.left; x -= 3) ctx.lineTo(x, sampleAt(prior, x));
    ctx.closePath();
    ctx.fillStyle = opts.color;
    ctx.fill();
    ctx.restore();
  },
};

/** "Today" rule + a hollow marker on last month's curve at the same x. */
const todayPlugin = {
  id: 'lmToday',
  afterDatasetsDraw(chart, _args, opts) {
    const area = chart.chartArea;
    if (!area) return;
    const ctx = chart.ctx;
    const P = palette();
    const x = chart.scales.x.getPixelForValue(opts.today);
    if (x < area.left || x > area.right) return;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x, area.top);
    ctx.lineTo(x, area.bottom);
    ctx.strokeStyle = P.axis;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.stroke();
    ctx.setLineDash([]);

    // small "TODAY" tag at the top of the rule
    ctx.font = '600 8px ' + MONO(8).family;
    const label = opts.label || 'TODAY';
    const w = ctx.measureText(label).width + 10;
    const bx = Math.min(Math.max(x - w / 2, area.left), area.right - w);
    ctx.fillStyle = P.tipBg;
    ctx.strokeStyle = P.tipBd;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(bx, area.top - 2, w, 13, 3);
    else ctx.rect(bx, area.top - 2, w, 13);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = P.tipTitle;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillText(label, bx + w / 2, area.top + 5);
    ctx.restore();
  },
};

/* ── trend chart plugin: MoM % labels above the spending bars ── */

const momLabelPlugin = {
  id: 'lmMom',
  afterDatasetsDraw(chart, _args, opts) {
    const area = chart.chartArea;
    const meta = chart.getDatasetMeta(opts.idx);
    if (!area || !meta || !meta.data || !meta.data.length) return;
    const P = palette();
    const ctx = chart.ctx;
    ctx.save();
    ctx.font = '600 9px ' + MONO(9).family;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    for (let i = 1; i < meta.data.length; i++) {
      const bar = meta.data[i];
      const el = bar.$meta;
      if (!el || !el.delta) continue;
      const half = (bar.width || 20) / 2;
      if (bar.x - half < area.left + 2 || bar.x + half > area.right - 2) continue;
      ctx.fillStyle = el.delta > 0 ? P.neg : P.pos;
      ctx.fillText(signedPct(el.delta, 0), bar.x, bar.y - 4);
    }
    ctx.restore();
  },
};

/* ── net worth chart plugin: dotted baseline at zero ────────── */

const zeroLinePlugin = {
  id: 'lmZero',
  afterDatasetsDraw(chart) {
    const { ctx, chartArea, scales } = chart;
    if (!chartArea) return;
    const y = scales.y.getPixelForValue(0);
    if (y < chartArea.top || y > chartArea.bottom) return;
    const P = palette();
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(chartArea.left, y);
    ctx.lineTo(chartArea.right, y);
    ctx.strokeStyle = P.axis;
    ctx.setLineDash([2, 4]);
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  },
};

/* ── lazy chart registry ───────────────────────────────────── */

const registry = new Map(); // id -> { factory, model, chart, canvas }
let observer = null;

function ensureObserver() {
  if (observer) return observer;
  observer = new IntersectionObserver(entries => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const entry = registry.get(e.target.id);
      observer.unobserve(e.target);
      if (entry && !entry.chart) draw(e.target.id);
    }
  }, { rootMargin: '320px 0px' });
  return observer;
}

function draw(id) {
  const entry = registry.get(id);
  if (!entry) return;
  if (entry.chart) entry.chart.destroy();
  entry.chart = entry.factory(entry.model, entry.canvas) || null;
}

function visible(el) {
  const r = el.getBoundingClientRect();
  return r.top < window.innerHeight + 340 && r.bottom > -340;
}

/**
 * Register (or update) a chart.
 * @param {string} id       canvas element id
 * @param {(model, canvas) => Chart} factory
 * @param {any}    model
 * @param {object} [opts]   { visible: boolean } force eager draw
 */
export function chart(id, factory, model, opts = {}) {
  const canvas = document.getElementById(id);
  if (!canvas) return;
  const prev = registry.get(id);
  registry.set(id, { factory, model, canvas, chart: prev ? prev.chart : null });

  // Already on screen → (re)draw immediately. Otherwise wait for scroll-in so
  // the initial paint never pays for four canvas layouts.
  if (prev && prev.chart) draw(id);
  else if (opts.visible || visible(canvas)) draw(id);
  else ensureObserver().observe(canvas);
}

export function refreshAllCharts() {
  for (const [id, entry] of registry) draw(id);
}

export function destroyAllCharts() {
  for (const entry of registry.values()) entry.chart?.destroy();
  registry.clear();
}

/* ── chart builders ────────────────────────────────────────── */

export function paceChartFactory(model) {
  const P = palette();
  const CUR = 1;
  const PRIOR = 0;

  /* The "projection" series is the real thing when you are looking at a past
     month; otherwise it is simply the run-rate extended to month end. */
  const projection = model.future.length
    ? model.future
    : model.currentPoints.slice(-1).concat([{ x: model.month.days, y: model.projection }]);

  const cfg = {
    type: 'line',
    data: {
      datasets: [
        {
          label: 'last month',
          data: model.priorNormalized,
          borderColor: P.prior,
          borderWidth: 1.6,
          borderDash: [5, 4],
          pointRadius: 0,
          pointHoverRadius: 4,
          pointHoverBackgroundColor: P.prior,
          pointHoverBorderColor: P.surface,
          pointHoverBorderWidth: 2,
          fill: false,
          tension: 0.35,
          order: 3,
        },
        {
          label: 'this month',
          data: model.currentPoints,
          borderColor: P.cur,
          borderWidth: 2.2,
          pointRadius: 0,
          pointHoverRadius: 5,
          pointHoverBackgroundColor: P.cur,
          pointHoverBorderColor: P.surface,
          pointHoverBorderWidth: 2,
          fill: true,
          backgroundColor: c => verticalGradient(c.chart.ctx, c.chart.chartArea,
            'rgba(123,108,255,0.28)', 'rgba(123,108,255,0)'),
          tension: 0.35,
          order: 1,
        },
        {
          label: 'last month, even pace',
          data: model.paceSeries.map((y, i) => ({ x: i + 1, y })),
          borderColor: P.pace,
          borderWidth: 1,
          borderDash: [1, 3],
          pointRadius: 0,
          pointHoverRadius: 0,
          fill: false,
          tension: 0,
          order: 4,
        },
        {
          label: 'projection',
          data: projection,
          borderColor: P.proj,
          borderWidth: 1.8,
          borderDash: [6, 5],
          pointRadius: 0,
          pointHoverRadius: 4,
          pointHoverBackgroundColor: P.proj,
          fill: false,
          tension: 0.35,
          order: 2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: ANIM(),
      resizeDelay: 80,
      parsing: false,
      normalized: true,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        lmGap: {
          today: model.elapsed,
          curIdx: CUR,
          priorIdx: PRIOR,
          color: model.delta >= 0 ? 'rgba(255,95,109,0.11)' : 'rgba(46,204,143,0.13)',
        },
        lmToday: { today: model.elapsed, label: model.isToday ? 'TODAY' : 'DAY ' + model.elapsed },
        tooltip: tooltip(P, {
          callbacks: {
            title: items => 'day ' + Math.round(items[0].parsed.x),
            label: c => `  ${c.dataset.label}: ${money(c.parsed.y)}`,
          },
        }),
      },
      scales: {
        x: {
          type: 'linear',
          min: 1,
          max: model.month.days,
          grid: { color: P.grid },
          border: { color: P.axis },
          ticks: {
            color: P.tick,
            font: MONO(9),
            stepSize: model.month.days <= 20 ? 2 : model.month.days <= 31 ? 4 : 5,
            padding: 4,
            callback: v => (Number.isInteger(v) ? v : ''),
          },
        },
        y: {
          beginAtZero: true,
          grid: { color: P.grid },
          border: { display: false },
          ticks: { color: P.tick, font: MONO(9), padding: 6, maxTicksLimit: 6, callback: v => compactMoney(v) },
        },
      },
    },
  };

  return new Chart(document.getElementById('pace-chart'), cfg, [gapPlugin, todayPlugin]);
}

export function trendChartFactory(getVisible) {
  return function build(model) {
    const rows = getVisible(model);
    const P = palette();
    const canvas = document.getElementById('trend-chart');

    const chart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: rows.map(r => r.short),
        datasets: [
          {
            label: 'spent',
            data: rows.map(r => r.spending),
            backgroundColor: c => {
              const last = c.dataIndex === rows.length - 1;
              return verticalGradient(c.chart.ctx, c.chart.chartArea,
                last ? 'rgba(123,108,255,0.95)' : 'rgba(123,108,255,0.42)',
                last ? 'rgba(123,108,255,0.30)' : 'rgba(123,108,255,0.06)');
            },
            borderRadius: 3,
            borderSkipped: false,
            maxBarThickness: 30,
            categoryPercentage: 0.62,
            barPercentage: 0.82,
            order: 2,
          },
          {
            label: 'earned',
            data: rows.map(r => r.income),
            backgroundColor: 'rgba(76,201,240,0.13)',
            borderColor: 'rgba(76,201,240,0.35)',
            borderWidth: 1,
            borderRadius: 3,
            borderSkipped: false,
            maxBarThickness: 8,
            categoryPercentage: 0.62,
            barPercentage: 0.16,
            order: 1,
          },
          {
            type: 'line',
            label: '3-mo avg',
            data: rows.map(r => r.ma3),
            borderColor: P.pace,
            borderWidth: 1.2,
            borderDash: [3, 3],
            pointRadius: 0,
            pointHoverRadius: 4,
            tension: 0.3,
            fill: false,
            spanGaps: true,
            order: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: prefersReducedMotion()
          ? false
          : { duration: 700, delay: c => (c.type === 'data' ? c.dataIndex * 35 : 0) },
        resizeDelay: 80,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          lmMom: { idx: 0 },
          tooltip: tooltip(P, {
            callbacks: {
              title: items => rows[items[0].dataIndex]?.full || items[0].label,
              label: c => {
                if (c.datasetIndex !== 0) {
                  return c.parsed.y == null ? null : `  ${c.dataset.label}: ${money(c.parsed.y)}`;
                }
                const r = rows[c.dataIndex];
                const net = r.income - r.spending;
                const netStr = (net >= 0 ? '+' : '−') + '$' + Math.abs(net).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                return [
                  `  spent  ${money(r.spending)}`,
                  `  earned ${money(r.income)}`,
                  `  net    ${netStr}`,
                  r.partial ? '  (month in progress)' : `  MoM    ${signedPct(r.deltaPct, 1)}`,
                ];
              },
            },
          }),
        },
        scales: {
          x: { ...gridX(P), ticks: { ...gridX(P).ticks, maxRotation: 0, autoSkipPadding: 8 } },
          y: { ...gridY(P), beginAtZero: true },
        },
      },
    }, [momLabelPlugin]);

    // hand the row metadata to the plugin so it can label month-over-month %
    chart.getDatasetMeta(0).data.forEach((el, i) => { el.$meta = rows[i]; });
    chart.update('none');
    return chart;
  };
}

export function netWorthChartFactory(model) {
  const P = palette();
  const nw = model.netWorth;
  return new Chart(document.getElementById('networth-chart'), {
    type: 'line',
    data: {
      labels: nw.labels,
      datasets: [
        {
          label: 'net worth',
          data: nw.values,
          borderColor: P.income,
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 5,
          pointHoverBackgroundColor: P.income,
          pointHoverBorderColor: P.surface,
          pointHoverBorderWidth: 2,
          tension: 0.35,
          fill: true,
          backgroundColor: c => verticalGradient(c.chart.ctx, c.chart.chartArea,
            'rgba(76,201,240,0.22)', 'rgba(76,201,240,0)'),
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: ANIM(),
      resizeDelay: 80,
      parsing: false,
      normalized: true,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: tooltip(P, {
          callbacks: {
            title: items => nw.labels[items[0].dataIndex],
            label: c => `  ${money(c.parsed.y)}`,
          },
        }),
      },
      scales: {
        x: { ...gridX(P) },
        y: { ...gridY(P), ticks: { ...gridY(P).ticks, maxTicksLimit: 5 } },
      },
    },
  }, [zeroLinePlugin]);
}

/* ── helpers ───────────────────────────────────────────────────────── */

/** Readable pretty-print for axis ticks and dense chips. */
export { compactMoney };
