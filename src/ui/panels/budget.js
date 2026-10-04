// Budget panel — each budgeted line with a meter that shows where you *should*
// be by now (pace marker), what you have actually spent, and how that compares
// with the same line at the same point last month.

import { byId, setHTML, setNum, esc } from '../dom.js';
import { money, signedMoney, pct, tone, MONTH_SHORT } from '../../lib/format.js';
import { clamp } from '../../lib/util.js';
import { ui, setState } from '../state.js';

let sortKey = 'spent';
let sortDir = -1;

const sum = (arr, f) => arr.reduce((a, b) => a + (f(b) || 0), 0);
const bare = n => String(n).replace('+', '');

export function renderBudget(m) {
  const host = byId('budget-rows');
  const head = byId('budget-head');
  const b = m.budget;
  if (!b) {
    head.hidden = true;
    host.innerHTML = `<div class="empty">No budget configured for ${esc(m.month.long)} — add budgets in Lunchmoney, then hit refresh.</div>`;
    return;
  }
  head.hidden = false;

  setNum(byId('b-total'), b.total.budget, money);
  setNum(byId('b-spent'), b.total.spent, money);
  setNum(byId('b-left'), b.total.remaining, money);
  setNum(byId('b-proj'), b.projected, money);

  const tPace = tone(b.aheadOfPace, 'spend');
  const tLeft = tone(b.total.remaining, 'spend');
  byId('b-sub').innerHTML = [
    `<span class="tone-${tPace}">${signedMoney(b.aheadOfPace)} vs even pace</span>`,
    `<span class="tone-${tLeft}">${signedMoney(b.total.remaining)} unspent</span>`,
    b.overCount
      ? `<span class="tone-bad">${b.overCount} item${b.overCount === 1 ? '' : 's'} over budget</span>`
      : `<span class="tone-good">everything within budget</span>`,
  ].join('<span class="dot">·</span>');

  setHTML(byId('b-meter'), meter(b.total.spent, b.total.budget, b.elapsed / b.days, tPace));

  renderRows(m, b);
  byId('budget-meta').textContent = `${b.itemCount} line items · ${money(b.total.budget)} planned`;
}

function meter(spent, budget, pace, t) {
  const used = budget > 0 ? (spent / budget) * 100 : 0;
  const cls = used > 100 ? 'bad' : t === 'bad' ? 'warn' : 'ok';
  return `<span class="meter meter-lg">
    <span class="meter-fill ${cls}" style="width:${clamp(used, 0, 100).toFixed(1)}%"></span>
    <span class="meter-marker" title="even pace" style="left:${clamp(pace * 100, 0, 100).toFixed(1)}%"></span>
  </span>`;
}

function rowValue(r, key) {
  const last = ui.basis === 'same' ? r.lastSame : r.lastFull;
  switch (key) {
    case 'name': return r.name;
    case 'budget': return r.budget;
    case 'spent': return r.spent;
    case 'last': return last;
    case 'delta': return r.spent - last;
    case 'remaining': return r.remaining;
    case 'used': return r.usedPct;
    default: return 0;
  }
}

function renderRows(m, b) {
  const host = byId('budget-rows');
  const q = (ui.budgetFilter || '').trim().toLowerCase();
  const rows = q ? b.rows.filter(r => r.name.toLowerCase().includes(q)) : b.rows.slice();

  rows.sort((a, c) => {
    const av = rowValue(a, sortKey);
    const cv = rowValue(c, sortKey);
    if (typeof av === 'string' || typeof cv === 'string') {
      return String(av).localeCompare(String(cv)) * sortDir;
    }
    return (av - cv) * sortDir;
  });

  if (!rows.length) {
    host.innerHTML = `<div class="empty">No budget lines match “${esc(ui.budgetFilter || '')}”.</div>`;
    return;
  }

  const sameBasis = ui.basis === 'same';
  const lastLabel = sameBasis ? `${MONTH_SHORT[m.prevMonth.month]} ${m.eqDay}` : 'last month';
  host.innerHTML = `
    <table class="grid budget-grid">
      <thead>
        <tr>
          <th class="sortable" data-k="name">line item</th>
          <th class="num sortable" data-k="budget">budget</th>
          <th class="num sortable" data-k="spent">spent</th>
          <th class="meter-col">progress<i class="hint" title="◈ marks where an even pace would put you today">◈</i></th>
          <th class="num sortable" data-k="last">${lastLabel}</th>
          <th class="num sortable" data-k="delta">Δ</th>
          <th class="num sortable" data-k="remaining">left</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(r => {
          const last = sameBasis ? r.lastSame : r.lastFull;
          const delta = r.spent - last;
          const t = tone(delta, 'spend');
          const over = r.remaining < 0;
          return `<tr class="${over ? 'over' : ''}">
            <td class="name">${esc(r.name)}</td>
            <td class="num dim">${money(r.budget)}</td>
            <td class="num strong">${money(r.spent)}<span class="sub">${pct(r.usedPct, 0)}</span></td>
            <td class="meter-col">${meter(r.spent, r.budget, r.pacePct, tone(r.spent - r.expected, 'spend'))}</td>
            <td class="num dim">${money(last)}</td>
            <td class="num"><span class="tone-${t}">${delta >= 0 ? '▲' : '▼'} ${bare(signedMoney(delta))}</span></td>
            <td class="num ${over ? 'tone-bad strong' : 'tone-good'}">${bare(signedMoney(r.remaining))}</td>
          </tr>`;
        }).join('')}
      </tbody>
      <tfoot>
        <tr>
          <td>${rows.length} item${rows.length === 1 ? '' : 's'}</td>
          <td class="num">${money(sum(rows, r => r.budget))}</td>
          <td class="num">${money(sum(rows, r => r.spent))}</td>
          <td class="meter-col"></td>
          <td class="num">${money(sum(rows, r => (sameBasis ? r.lastSame : r.lastFull)))}</td>
          <td class="num"></td>
          <td class="num">${bare(signedMoney(sum(rows, r => r.remaining)))}</td>
        </tr>
      </tfoot>
    </table>`;

  document.querySelectorAll('#budget-rows th.sortable').forEach(th => {
    const on = th.dataset.k === sortKey;
    th.classList.toggle('asc', on && sortDir === 1);
    th.classList.toggle('desc', on && sortDir === -1);
  });
}

export function bindBudget() {
  byId('budget-rows').addEventListener('click', e => {
    const th = e.target.closest('th.sortable');
    if (!th) return;
    const k = th.dataset.k;
    if (sortKey === k) sortDir *= -1;
    else { sortKey = k; sortDir = k === 'name' ? 1 : -1; }
    setState({}, 'budget-sort');
  });

  const basisWrap = byId('basis-control');
  basisWrap.addEventListener('click', e => {
    const btn = e.target.closest('button[data-basis]');
    if (!btn) return;
    setState({ basis: btn.dataset.basis }, 'basis');
    syncBasisButtons();
  });
  syncBasisButtons();

  const f = byId('budget-filter');
  f.addEventListener('input', e => setState({ budgetFilter: e.target.value }, 'budget-filter'));
}

export function syncBasisButtons() {
  document.querySelectorAll('#basis-control button[data-basis]').forEach(b => {
    b.classList.toggle('active', b.dataset.basis === ui.basis);
  });
}