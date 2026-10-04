// Categories — a dense, sortable month-over-month table. The default sort is
// absolute dollar movement versus the same period last month, so the biggest
// movers are always at the top.

import { byId, setHTML, esc } from '../dom.js';
import { money, signedMoney, signedPct, pct, tone } from '../../lib/format.js';
import { clamp } from '../../lib/util.js';
import { ui, setState, lastOf, deltaOf, deltaPctOf } from '../state.js';

const SORTS = {
  name: r => r.name.toLowerCase(),
  now: r => r.now,
  last: r => lastOf(r),
  delta: r => Math.abs(deltaOf(r)),
  deltaPct: r => Math.abs(deltaPctOf(r)),
  share: r => r.share,
};

export function renderCategories(m) {
  const host = byId('cat-body');
  if (!m.categories.length) {
    host.innerHTML = `<div class="empty">Nothing recorded in ${esc(m.month.long)} yet.</div>`;
    setHTML(byId('cat-summary'), '');
    return;
  }

  const max = m.maxCat;
  const q = (ui.catFilter || '').trim().toLowerCase();
  let rows = m.categories;
  if (q) rows = rows.filter(r => r.name.toLowerCase().includes(q));
  if (ui.moversOnly) rows = rows.filter(r => Math.abs(deltaOf(r)) > 0.005);

  const key = SORTS[ui.catSort] ? ui.catSort : 'delta';
  rows = rows.slice().sort((a, b) => {
    const av = SORTS[key](a);
    const cv = SORTS[key](b);
    if (typeof av === 'string') return av.localeCompare(cv) * ui.catDir;
    return (av - cv) * ui.catDir;
  });

  /* movers summary */
  const moved = m.categories.slice().sort((a, b) => Math.abs(deltaOf(b)) - Math.abs(deltaOf(a)));
  const up = moved.filter(r => deltaOf(r) > 0.005).slice(0, 3);
  const down = moved.filter(r => deltaOf(r) < -0.005).slice(0, 3);
  setHTML(byId('cat-summary'), `
    <div class="movers">
      <div class="mover-col">
        <span class="mv-hdr tone-bad">▲ spending more than last month</span>
        ${up.map(r => moverLine(r)).join('') || '<span class="mv-empty">nothing up</span>'}
      </div>
      <div class="mover-col">
        <span class="mv-hdr tone-good">▼ spending less than last month</span>
        ${down.map(r => moverLine(r)).join('') || '<span class="mv-empty">nothing down</span>'}
      </div>
    </div>`);

  if (!rows.length) {
    host.innerHTML = `<div class="empty">Nothing matches the current filter.</div>`;
    return;
  }

  host.innerHTML = `
    <table class="grid cat-grid">
      <thead>
        <tr>
          <th class="sortable ${key === 'name' ? 'on' : ''}" data-k="name">category</th>
          <th class="num sortable ${key === 'now' ? 'on' : ''}" data-k="now">${esc(m.month.short)}</th>
          <th class="bar-col">vs ${ui.basis === 'same' ? `same period` : esc(m.prevMonth.short)}</th>
          <th class="num sortable ${key === 'last' ? 'on' : ''}" data-k="last">last month</th>
          <th class="num sortable ${key === 'delta' ? 'on' : ''}" data-k="delta">Δ $</th>
          <th class="num sortable ${key === 'deltaPct' ? 'on' : ''}" data-k="deltaPct">Δ %</th>
          <th class="num sortable ${key === 'share' ? 'on' : ''}" data-k="share">share</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(r => {
          const last = lastOf(r);
          const d = deltaOf(r);
          const dp = deltaPctOf(r);
          const t = tone(d, 'spend');
          const wNow = max > 0 ? clamp((r.now / max) * 100, 0, 100) : 0;
          const wLast = max > 0 ? clamp((last / max) * 100, 0, 100) : 0;
          const flat = Math.abs(d) <= 0.005;
          return `<tr class="${r.isNew ? 'is-new' : ''} ${flat ? 'flat' : 'mover'}">
            <td class="name">${esc(r.name)}${r.isNew ? '<span class="tag">new</span>' : ''}</td>
            <td class="num strong">${money(r.now)}</td>
            <td class="bar-col">
              <span class="dual" title="${money(r.now)} vs ${money(last)}">
                <span class="dual-now" style="width:${wNow.toFixed(1)}%"></span>
                <span class="dual-last" style="width:${wLast.toFixed(1)}%"></span>
              </span>
            </td>
            <td class="num dim">${last > 0 ? money(last) : '<span class="zero">—</span>'}</td>
            <td class="num"><span class="tone-${t}">${flat ? '–' : `${d >= 0 ? '▲' : '▼'} $${Math.abs(d).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</span></td>
            <td class="num"><span class="tone-${t}">${flat || last <= 0 ? '–' : signedPct(dp, 0)}</span></td>
            <td class="num dim">${pct(r.share, r.share >= 10 ? 0 : 1)}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
    <div class="grid-foot">
      <span>${rows.length} of ${m.categories.length} categories</span>
      <span>total ${money(m.total)} · same-period last month ${money(m.prevSameTotal)} · Δ ${signedMoney(m.delta)}</span>
    </div>`;

  document.querySelectorAll('#cat-body th.sortable').forEach(th => {
    th.classList.toggle('desc', th.dataset.k === key && ui.catDir === -1);
    th.classList.toggle('asc', th.dataset.k === key && ui.catDir === 1);
  });
}

function moverLine(r) {
  const d = deltaOf(r);
  const t = tone(d, 'spend');
  return `<span class="mv-line">
    <i class="mv-name">${esc(r.name)}</i>
    <b class="tone-${t}">${signedMoney(d)}</b>
    <em class="tone-${t}">${signedPct(deltaPctOf(r), 0)}</em>
  </span>`;
}

export function bindCategories() {
  byId('cat-body').addEventListener('click', e => {
    const th = e.target.closest('th.sortable');
    if (!th) return;
    const k = th.dataset.k;
    if (ui.catSort === k) setState({ catDir: -ui.catDir }, 'cat-sort');
    else setState({ catSort: k, catDir: k === 'name' ? 1 : -1 }, 'cat-sort');
  });

  const f = byId('cat-filter');
  f.addEventListener('input', e => setState({ catFilter: e.target.value }, 'cat-filter'));

  byId('movers-toggle').addEventListener('click', () => {
    setState({ moversOnly: !ui.moversOnly }, 'movers');
    byId('movers-toggle').classList.toggle('active', ui.moversOnly);
  });
  byId('movers-toggle').classList.toggle('active', ui.moversOnly);
}