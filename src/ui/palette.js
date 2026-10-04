// ⌘K command palette — the fast path for everything the mouse can do.

import { esc } from './dom.js';
import { prefersReducedMotion } from '../lib/util.js';

let items = [];
let actions = new Map();
let cursor = 0;
let open = false;

export function initPalette() {
  const el = document.getElementById('palette');
  const input = el.querySelector('.p-input');
  const list = el.querySelector('.p-list');

  input.addEventListener('input', () => { cursor = 0; paint(); });
  input.addEventListener('keydown', e => {
    const visible = filtered();
    if (e.key === 'ArrowDown') { e.preventDefault(); cursor = Math.min(cursor + 1, visible.length - 1); paint(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); cursor = Math.max(cursor - 1, 0); paint(); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const item = visible[cursor];
      if (item) run(item);
    } else if (e.key === 'Escape') { e.preventDefault(); close(); }
  });
  el.addEventListener('mousedown', e => {
    if (e.target === el) close();
  });
  list.addEventListener('mousemove', e => {
    const row = e.target.closest('.p-row');
    if (!row) return;
    const visible = filtered();
    const i = visible.findIndex(v => v.id === row.dataset.id);
    if (i >= 0 && i !== cursor) { cursor = i; paint(); }
  });
  list.addEventListener('click', e => {
    const row = e.target.closest('.p-row');
    if (!row) return;
    const item = filtered().find(v => v.id === row.dataset.id);
    if (item) run(item);
  });
}

export function setCommands(list, handlers) {
  items = list;
  actions = handlers instanceof Map ? handlers : new Map(Object.entries(handlers || {}));
}

function filtered() {
  const el = document.querySelector('#palette .p-input');
  const q = (el?.value || '').trim().toLowerCase();
  if (!q) return items;
  return items
    .map(it => ({ it, score: score(it, q) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(x => x.it);
}

function score(item, q) {
  const hay = `${item.group} ${item.title} ${item.keys || ''}`.toLowerCase();
  const needle = q.split(/\s+/);
  let total = 0;
  for (const n of needle) {
    const idx = hay.indexOf(n);
    if (idx === -1) return 0;
    total += idx === 0 ? 10 : 5;
  }
  return total;
}

function paint() {
  const list = document.querySelector('#palette .p-list');
  const visible = filtered();
  if (!visible.length) {
    list.innerHTML = `<div class="p-none">no matching command</div>`;
    return;
  }
  cursor = Math.max(0, Math.min(cursor, visible.length - 1));
  let html = '';
  let lastGroup = null;
  visible.forEach((it, i) => {
    if (it.group !== lastGroup) {
      html += `<div class="p-group">${esc(it.group)}</div>`;
      lastGroup = it.group;
    }
    html += `<div class="p-row ${i === cursor ? 'on' : ''}" data-id="${esc(it.id)}">
      <span class="p-title">${esc(it.title)}</span>
      ${it.meta ? `<span class="p-meta">${esc(it.meta)}</span>` : ''}
      ${it.kbd ? `<span class="p-kbd">${esc(it.kbd)}</span>` : ''}
    </div>`;
  });
  list.innerHTML = html;
  const on = list.querySelector('.p-row.on');
  on?.scrollIntoView({ block: 'nearest' });
}

function run(item) {
  close();
  const fn = actions.get(item.id);
  if (fn) fn();
}

export function toggle() {
  open ? close() : show();
}

function show() {
  if (open) return;
  open = true;
  cursor = 0;
  const el = document.getElementById('palette');
  el.classList.add('on');
  document.querySelector('#palette .p-input').value = '';
  document.body.classList.add('no-scroll');
  paint();
  if (!prefersReducedMotion()) requestAnimationFrame(() => document.querySelector('#palette .p-input').focus());
  else document.querySelector('#palette .p-input').focus();
}

function close() {
  if (!open) return;
  open = false;
  document.getElementById('palette').classList.remove('on');
  document.body.classList.remove('no-scroll');
}

export const isOpen = () => open;