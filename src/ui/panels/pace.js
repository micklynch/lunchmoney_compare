// Pace panel — cumulative month-to-date versus last month, with the gap
// between the two curves shaded and a "today" rule so the month-over-month
// position is readable at a glance.

import { byId } from '../dom.js';
import { chart, paceChartFactory } from '../../lib/charts.js';
import { money, signedMoney, signedPct, pct, tone, MONTH_SHORT } from '../../lib/format.js';

const SERIES = [
  { key: 0, label: 'last month', css: 'var(--c-prior)' },
  { key: 1, label: 'this month', css: 'var(--c-cur)', on: true },
  { key: 2, label: 'even pace', css: 'var(--c-pace)' },
  { key: 3, label: 'projection', css: 'var(--c-proj)' },
];

const hidden = new Set();

export function renderPace(m) {
  chart('pace-chart', paceChartFactory, m);

  const t = tone(m.delta, 'spend');
  const paceDelta = m.total - (m.paceSeries[m.elapsed - 1] || 0);
  const tp = tone(paceDelta, 'spend');
  const needed = m.remainingDays > 0 ? (m.projection - m.total) / m.remainingDays : 0;
  const budgetLeft = m.budget ? m.budget.total.remaining : null;

  byId('pace-readout').innerHTML = `
    <div class="readout">
      <span class="ro-lbl">vs same period last month</span>
      <span class="ro-val tone-${t}">${signedMoney(m.delta)}</span>
      <span class="ro-sub tone-${t}">${signedPct(m.deltaPct, 1)} · ${MONTH_SHORT[m.prevMonth.month]} ${m.eqDay} was ${money(m.prevSameTotal)}</span>
    </div>
    <div class="readout">
      <span class="ro-lbl">vs even pace</span>
      <span class="ro-val tone-${tp}">${signedMoney(paceDelta)}</span>
      <span class="ro-sub">straight-line budget for ${m.elapsed}/${m.month.days} days = ${money(m.paceSeries[m.elapsed - 1] || 0)}</span>
    </div>
    <div class="readout">
      <span class="ro-lbl">needed / remaining day</span>
      <span class="ro-val">${money(needed)}</span>
      <span class="ro-sub">${m.remainingDays} days left to hold ${money(m.projection)}${budgetLeft != null ? ` · ${money(budgetLeft)} still budgeted` : ''}</span>
    </div>
    <div class="readout">
      <span class="ro-lbl">month-end estimate</span>
      <span class="ro-val tone-${tone(m.projectionVsPrev)}">${money(m.projection)}</span>
      <span class="ro-sub">${signedPct(m.projectionVsPrevPct, 1)} vs ${m.prevMonth.short} total of ${money(m.prevTotal)}${m.budget ? ` · ${signedMoney(m.projectionVsBudget)} vs budget` : ''}</span>
    </div>`;

  byId('pace-verdict').innerHTML = verdict(m);
  renderLegend();
}

function verdict(m) {
  if (!m.total) return `<span class="tone-flat">No spending recorded yet this month.</span>`;
  const d = m.delta;
  const pctW = Math.abs(m.deltaPct);
  if (Math.abs(d) < Math.max(25, m.prevSameTotal * 0.02)) {
    return `<b class="tone-flat">On par.</b> You are within ${money(Math.abs(d))} of where you were on ${MONTH_SHORT[m.prevMonth.month]} ${m.eqDay}.`;
  }
  if (d > 0) {
    return `<b class="tone-bad">${pctW.toFixed(0)}% ahead of last month's pace.</b>
      ${money(d)} more spent by day ${m.elapsed} than last month had at day ${m.eqDay}.
      ${m.budget ? `Still inside budget with ${money(m.budget.total.remaining)} unspent.` : `At this rate the month closes around ${money(m.projection)}.`}`;
  }
  return `<b class="tone-good">${pctW.toFixed(0)}% behind last month's pace.</b>
    ${money(-d)} less spent by day ${m.elapsed} than last month had at day ${m.eqDay}.
    ${m.budget ? `That leaves ${money(m.budget.total.remaining)} still budgeted for ${m.remainingDays} days.` : `At this rate the month closes around ${money(m.projection)}.`}`;
}

function renderLegend() {
  const wrap = byId('pace-legend');
  if (!wrap) return;
  wrap.innerHTML = SERIES.map(s => {
    const off = hidden.has(s.key);
    return `<button type="button" class="lg ${off ? 'off' : ''}" data-key="${s.key}">
      <i style="background:${s.css}"></i>${s.label}</button>`;
  }).join('');
}

export function bindLegend(onChange) {
  byId('pace-legend').addEventListener('click', e => {
    const btn = e.target.closest('.lg');
    if (!btn) return;
    const key = Number(btn.dataset.key);
    if (hidden.has(key)) hidden.delete(key);
    else hidden.add(key);
    const c = Chart.getChart('pace-chart');
    if (c) {
      c.setDatasetVisibility(key, hidden.has(key));
      c.update();
    }
    renderLegend();
    onChange?.();
  });
}