// Overview — the four hero numbers plus the secondary stat strip.
// Everything here is framed around "where am I versus the same point last month".

import { byId, setHTML, setNum, sparkline, esc } from '../dom.js';
import {
  money, signedMoney, signedCompactMoney, signedPct, pct, tone, int, compactMoney,
  MONTH_SHORT, MONTH_LONG,
} from '../../lib/format.js';
import { clamp } from '../../lib/util.js';

const CHIPS = {
  up: '▲', dn: '▼', flat: '–',
};

export function renderOverview(m) {
  /* 1 — spent month to date */
  setNum(byId('kpi-spend'), m.total, money);
  setHTML(byId('kpi-spend-delta'), chip(m.deltaPct, m.delta));
  byId('kpi-spend-delta-raw').textContent = `${signedMoney(m.delta)} vs last mo`;
  setHTML(byId('kpi-spend-spark'), sparkline(m.currentSeries.slice(0, m.elapsed), { color: 'var(--accent)', w: 160, h: 36 }));
  byId('kpi-spend-sub').innerHTML =
    `<b>day ${m.elapsed}</b> of ${m.month.days} · ${money(m.dailyAvg)}/day avg`;

  /* 2 — the benchmark: what last month looked like at this exact point */
  const eqShort = `${MONTH_SHORT[m.prevMonth.month]} ${m.eqDay}`;
  setNum(byId('kpi-bench'), m.prevSameTotal, money);
  byId('kpi-bench-date').textContent = `by ${eqShort}`;
  setHTML(byId('kpi-bench-spark'), sparkline(m.priorSeries.slice(0, m.eqDay), { color: 'var(--c-prior)', w: 160, h: 36, dash: '3 3', fill: false }));
  byId('kpi-bench-sub').innerHTML =
    `that is what you had spent by <b>day ${m.eqDay}</b> of ${MONTH_LONG[m.prevMonth.month]}`;

  // spell the comparison out — the number above is last month's, not yours
  const flat = Math.abs(m.delta) < 0.005;
  const t = tone(m.delta, 'spend');
  byId('kpi-bench-vs').innerHTML = `
    <span class="kvs-row">
      <i>you spent</i><b class="num">${money(m.total)}</b>
    </span>
    <span class="kvs-row">
      <i>${flat ? 'difference' : t === 'good' ? 'that is less by' : 'that is more by'}</i>
      <b class="num tone-${t}">${flat ? money(0) : money(Math.abs(m.delta))} (${signedPct(m.deltaPct, 1)})</b>
    </span>`;

  byId('kpi-bench-card').classList.toggle('is-over', m.delta > 0);
  byId('kpi-bench-card').classList.toggle('is-under', m.delta < 0);

  /* 3 — projection */
  setNum(byId('kpi-proj'), m.projection, money);
  setHTML(byId('kpi-proj-delta'), chip(m.projectionVsPrevPct, m.projectionVsPrev));
  byId('kpi-proj-sub').innerHTML = m.budget
    ? `${money(m.dailyAvg)}/day · ${m.budget.itemCount} budgeted lines`
    : `${money(m.dailyAvg)}/day · ${m.remainingDays} days left`;
  const projPct = m.budget ? (m.projection / m.budget.total.budget) * 100 : m.progress;
  byId('kpi-proj-meter').innerHTML = meterHtml(projPct, m.budget ? m.progress : null,
    m.projectionVsBudget > 0 ? 'bad' : 'good');
  byId('kpi-proj-meta').innerHTML = m.budget
    ? `${signedMoney(m.projectionVsBudget)} vs budget`
    : `${pct(m.progress, 0)} of month elapsed`;

  /* 4 — net worth */
  const nw = m.netWorth;
  const nwCard = byId('kpi-nw');
  if (nw) {
    nwCard.hidden = false;
    setNum(byId('kpi-nw-val'), nw.current, money);
    setHTML(byId('kpi-nw-delta'), chip(nw.deltaPct, nw.delta, 'gain'));
    byId('kpi-nw-sub').innerHTML = `<b>${signedMoney(nw.delta)}</b> since ${MONTH_SHORT[m.prevMonth.month]} 1 · ${nw.count} accounts`;
    setHTML(byId('kpi-nw-spark'), sparkline(nw.values, { color: 'var(--c-income)', w: 160, h: 36 }));
  } else {
    nwCard.hidden = true;
  }

  /* secondary strip */
  setNum(byId('s-daily'), m.dailyAvg, money);
  setNum(byId('s-left'), m.remainingDays, int);
  setNum(byId('s-income'), m.income, money);
  const rateEl = byId('s-rate');
  if (m.rate != null) {
    rateEl.textContent = pct(m.rate, 1);
    rateEl.className = 'strip-val num ' + (m.rate >= 0 ? 'tone-good' : 'tone-bad');
  } else {
    rateEl.textContent = '—';
    rateEl.className = 'strip-val num';
  }
  const budEl = byId('s-budget');
  if (m.budget) {
    budEl.textContent = money(m.budget.total.remaining);
    budEl.className = 'strip-val num';
  } else {
    budEl.textContent = '—';
    budEl.className = 'strip-val num';
  }
  byId('s-budget-lbl').textContent = m.budget ? `budget unspent` : 'budget left';
  if (m.budget && m.unbudgetedSpend > 0.005) {
    byId('s-budget-lbl').textContent += ` · ${compactMoney(m.unbudgetedSpend)} unbudgeted`;
  }
}

function chip(deltaPct, deltaRaw, polarity = 'spend') {
  const t = tone(deltaRaw, polarity);
  const flat = t === 'flat';
  return `<span class="chip-delta tone-${t}">${flat ? CHIPS.flat : deltaRaw >= 0 ? CHIPS.up : CHIPS.dn}<b>${flat ? '0.0%' : signedPct(deltaPct, 1)}</b></span>`;
}

function meterHtml(pctValue, marker, toneName) {
  const w = clamp(pctValue, 0, 100);
  return `<span class="meter" style="--h:5px">
    <span class="meter-fill ${toneName}" style="width:${w.toFixed(1)}%"></span>
    ${marker != null ? `<span class="meter-marker" title="pace" style="left:${clamp(marker, 0, 100).toFixed(1)}%"></span>` : ''}
  </span>`;
}

/** Compact inline summary used by the sticky status strip. */
export function renderStatusStrip(m) {
  const t = tone(m.delta, 'spend');
  const el = byId('strip-inline');
  el.innerHTML = `
    <span class="si"><i>${esc(m.month.long)}</i><b>day ${m.elapsed}/${m.month.days}</b></span>
    <span class="si"><i>spent</i><b>${money(m.total)}</b></span>
    <span class="si"><i>same period last month</i><b>${money(m.prevSameTotal)}</b></span>
    <span class="si"><i>delta</i><b class="tone-${t}">${signedCompactMoney(m.delta)} · ${signedPct(m.deltaPct, 1)}</b></span>
    <span class="si"><i>projected</i><b>${compactMoney(m.projection)}</b></span>`;
}