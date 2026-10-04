// Monthly trend — 12 months of spend vs earn, with month-over-month % labels
// drawn above each bar and a 3-month trailing average for context.

import { byId, setNum, setHTML, esc } from '../dom.js';
import { chart, trendChartFactory } from '../../lib/charts.js';
import { money, signedMoney, signedPct, pct, tone, compactMoney } from '../../lib/format.js';
import { ui, setState } from '../state.js';

export function renderTrend(m) {
  const rows = visibleRows(m);
  chart('trend-chart', trendChartFactory(() => rows), m);

  const spent = rows.reduce((s, r) => s + r.spending, 0);
  const earned = rows.reduce((s, r) => s + r.income, 0);
  const net = earned - spent;
  const rate = earned > 0 ? (net / earned) * 100 : null;
  const avg = rows.length ? spent / rows.length : 0;

  setNum(byId('t-spent'), spent, money);
  setNum(byId('t-earned'), earned, money);
  const netEl = byId('t-net');
  netEl.textContent = signedMoney(net);
  netEl.className = 'strip-val num ' + (net >= 0 ? 'tone-good' : 'tone-bad');
  const rateEl = byId('t-rate');
  rateEl.textContent = rate == null ? '—' : pct(rate, 1);
  rateEl.className = 'strip-val num ' + (rate == null ? '' : rate >= 0 ? 'tone-good' : 'tone-bad');
  setNum(byId('t-avg'), avg, money);

  byId('trend-meta').textContent = rows.length
    ? `${rows[0].short} – ${rows[rows.length - 1].short} · ${rows.length} months`
    : '';

  /* month-over-month strip */
  const strip = byId('trend-strip');
  const seq = rows.slice(-12);
  const maxSpend = Math.max(...seq.map(r => r.spending), 1);
  strip.innerHTML = seq.map(r => {
    const t = tone(r.delta, 'spend');
    const h = (r.spending / maxSpend) * 100;
    return `<div class="mbar ${r.partial ? 'partial' : ''}" title="${esc(r.full)} · ${money(r.spending)}">
      <span class="mbar-track"><span class="mbar-fill" style="height:${clamp(h, 2, 100).toFixed(1)}%"></span></span>
      <span class="mbar-lbl">${esc(r.short.split(' ')[0])}</span>
      <span class="mbar-delta tone-${t}">${r.delta ? signedPct(r.deltaPct, 0) : '–'}</span>
    </div>`;
  }).join('');

  const hi = seq.reduce((a, b) => (b.spending > a.spending ? b : a), seq[0]);
  const lo = seq.reduce((a, b) => (b.spending < a.spending ? b : a), seq[0]);
  if (hi && lo) {
    byId('trend-note').innerHTML = `Peak <b>${esc(hi.short)}</b> at ${money(hi.spending)}
      <span class="dot">·</span> lightest <b>${esc(lo.short)}</b> at ${money(lo.spending)}
      <span class="dot">·</span> average ${money(avg)}/mo`;
  }
}

function visibleRows(m) {
  if (ui.trendRange === 'all') return m.trend;
  return m.trend.slice(-Math.min(ui.trendRange, m.trend.length));
}

const clamp = (n, a, b) => Math.min(Math.max(n, a), b);

export function bindTrend() {
  byId('trend-range').addEventListener('click', e => {
    const btn = e.target.closest('button[data-r]');
    if (!btn) return;
    setState({ trendRange: btn.dataset.r === 'all' ? 24 : Number(btn.dataset.r) }, 'trend-range');
    document.querySelectorAll('#trend-range button').forEach(b => b.classList.toggle('active', b === btn));
  });
}