// Transactions — filterable, sortable, capped list. Rendering is incremental so
// a 400-row month never blocks the main thread.

import { byId, esc } from '../dom.js';
import { money, int } from '../../lib/format.js';
import { ui, setState } from '../state.js';

const SORTERS = {
  ts: t => t.ts,
  payee: t => t.payee.toLowerCase(),
  category: t => t.category.toLowerCase(),
  amount: t => Math.abs(t.amount),
};

let model = null;

export function renderTransactions(m) {
  model = m;
  renderCatFilter(m);
  renderTable(m);
}

function renderCatFilter(m) {
  const sel = byId('txn-cat');
  if (sel.dataset.built !== m.dateStr) {
    const cats = [...new Set(m.transactions.map(t => t.category))].sort();
    sel.innerHTML = `<option value="all">all categories</option>` +
      cats.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    sel.dataset.built = m.dateStr;
  }
  sel.value = [...sel.options].some(o => o.value === ui.txnCategory) ? ui.txnCategory : 'all';
}

function filtered(m) {
  const q = (ui.txnQuery || '').trim().toLowerCase();
  let rows = m.transactions;
  if (!ui.showIncome) rows = rows.filter(t => !(t.isIncome || t.excluded));
  if (ui.txnCategory !== 'all') rows = rows.filter(t => t.category === ui.txnCategory);
  if (q) rows = rows.filter(t =>
    t.payee.toLowerCase().includes(q) || t.category.toLowerCase().includes(q));
  const key = SORTERS[ui.txnSort] ? ui.txnSort : 'ts';
  return rows.slice().sort((a, b) => {
    const av = SORTERS[key](a);
    const cv = SORTERS[key](b);
    if (typeof av === 'string') return av.localeCompare(cv) * ui.txnDir;
    return (av - cv) * ui.txnDir;
  });
}

function renderTable(m) {
  const rows = filtered(m);
  const body = byId('txn-body');
  const limit = Math.min(ui.txnLimit, rows.length);

  byId('txn-meta').textContent =
    `${int(rows.length)} transaction${rows.length === 1 ? '' : 's'}` +
    (ui.showIncome ? ' · including income' : '');

  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="4"><div class="empty">No transactions match.</div></td></tr>`;
    byId('txn-more').hidden = true;
    return;
  }

  body.innerHTML = rows.slice(0, limit).map(t => {
    const amt = Math.abs(t.amount);
    const cls = t.isIncome ? 'income' : t.excluded ? 'excluded' : 'spend';
    return `<tr class="${cls}">
      <td class="dim mono">${esc(t.dateLabel)}</td>
      <td class="payee">${esc(t.payee)}${t.excluded ? '<span class="tag warn">excluded</span>' : ''}</td>
      <td><span class="tag cat">${esc(t.category)}</span></td>
      <td class="num mono ${cls}">${t.isIncome ? '+' : t.amount < 0 ? '−' : ''}$${amt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
    </tr>`;
  }).join('');

  const more = byId('txn-more');
  more.hidden = limit >= rows.length;
  if (!more.hidden) more.querySelector('span').textContent = `show ${Math.min(60, rows.length - limit)} more of ${rows.length - limit} remaining`;

  document.querySelectorAll('#txn-table th.sortable').forEach(th => {
    const on = th.dataset.k === ui.txnSort;
    th.classList.toggle('asc', on && ui.txnDir === 1);
    th.classList.toggle('desc', on && ui.txnDir === -1);
  });
}

export function bindTransactions() {
  byId('txn-table').addEventListener('click', e => {
    const th = e.target.closest('th.sortable');
    if (!th) return;
    const k = th.dataset.k;
    if (ui.txnSort === k) setState({ txnDir: -ui.txnDir }, 'txn-sort');
    else setState({ txnSort: k, txnDir: k === 'payee' || k === 'category' ? 1 : -1 }, 'txn-sort');
  });

  byId('txn-search').addEventListener('input', e => {
    setState({ txnQuery: e.target.value, txnLimit: 60 }, 'txn-search');
  });

  byId('txn-cat').addEventListener('change', e => {
    setState({ txnCategory: e.target.value, txnLimit: 60 }, 'txn-cat');
  });

  byId('txn-income').addEventListener('click', () => {
    setState({ showIncome: !ui.showIncome, txnLimit: 60 }, 'txn-income');
    byId('txn-income').classList.toggle('active', ui.showIncome);
  });

  byId('txn-more').addEventListener('click', () => {
    setState({ txnLimit: ui.txnLimit + 60 }, 'txn-more');
  });
}