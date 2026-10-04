// spendctl — application shell.
//
// Owns: data loading (+caching), theme, navigation, keyboard shortcuts and
// the render orchestration. All heavy lifting lives in lib/ and ui/panels/.

import './style.css';

import { fetchTransactions, fetchBudgets, fetchAssets, fetchPlaidAccounts, invalidateAll } from './lib/api.js';
import {
  analyze, ymd, addDays, startOfMonth, endOfMonth, shiftMonths, daysInMonth,
} from './lib/compute.js';
import { HISTORY_MONTHS } from './lib/util.js';
import { refreshAllCharts } from './lib/charts.js';
import { relTime, MONTH_SHORT, MONTH_LONG } from './lib/format.js';
import { clamp } from './lib/util.js';

import { byId, $, $$, esc, stopNumAnimations } from './ui/dom.js';
import { ui, setState, subscribe } from './ui/state.js';
import { renderOverview, renderStatusStrip } from './ui/panels/overview.js';
import { renderPace, bindLegend } from './ui/panels/pace.js';
import { renderBudget, bindBudget, syncBasisButtons } from './ui/panels/budget.js';
import { renderCalendar, bindCalendar } from './ui/panels/calendar.js';
import { renderCategories, bindCategories } from './ui/panels/categories.js';
import { renderTrend, bindTrend } from './ui/panels/trend.js';
import { renderNetWorth } from './ui/panels/networth.js';
import { renderTransactions, bindTransactions } from './ui/panels/transactions.js';
import { initPalette, setCommands, toggle as togglePalette, isOpen as paletteOpen } from './ui/palette.js';

const THEME_KEY = 'lm-dashboard-theme';

let model = null;
let lastLoad = 0;
let inFlight = null;
/** Date most recently *requested* (not yet necessarily rendered) — keeps rapid
 *  month-stepping clicks from computing from stale state. */
let navDate = null;

/* ── theme ──────────────────────────────────────────────────────────── */

function readTheme() {
  const q = new URLSearchParams(location.search).get('theme');
  if (q === 'light' || q === 'dark') return q;
  try {
    const s = localStorage.getItem(THEME_KEY);
    if (s === 'light' || s === 'dark') return s;
  } catch (_) {}
  return 'dark';
}

function applyTheme(t) {
  document.body.classList.toggle('light', t === 'light');
  document.documentElement.style.colorScheme = t;
  try { localStorage.setItem(THEME_KEY, t); } catch (_) {}
}
let theme = readTheme();
applyTheme(theme);

/* ── data loading ───────────────────────────────────────────────────── */

function setLoading(on) {
  byId('loadbar').classList.toggle('on', on);
  byId('refresh-btn').classList.toggle('loading', on);
}

/** Initial date: ?date=YYYY-MM-DD, otherwise today. Keeps views shareable. */
function initialDate() {
  const q = new URLSearchParams(location.search).get('date');
  if (q && /^\d{4}-\d{2}-\d{2}$/.test(q)) {
    const d = new Date(q + 'T00:00:00');
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}

async function load(dateStr, { force = false } = {}) {
  if (inFlight) inFlight.cancelled = true;
  const token = { cancelled: false };
  inFlight = token;

  if (force) invalidateAll();

  const date = dateStr ? new Date(dateStr + 'T00:00:00') : new Date();
  date.setHours(0, 0, 0, 0);
  navDate = date;

  setLoading(true);
  stopNumAnimations();

  const curStart = startOfMonth(date);
  const curEnd = endOfMonth(date);
  const prevCur = shiftMonths(date, -1);
  const prevStart = startOfMonth(prevCur);
  const prevEnd = endOfMonth(prevCur);

  // The deep history window is anchored on *today*, not the reference date, so
  // its URL never changes while stepping through months — one request, then
  // always a cache hit. Trend, net worth and the calendar all read from it.
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const historyStart = startOfMonth(shiftMonths(today, -(HISTORY_MONTHS - 1)));

  try {
    /* ── phase 1: the month you are looking at ───────────────
       Small, fast requests that carry the whole month-over-month story:
       KPIs, pace, budget, categories, transactions. */
    const [currentTxns, previousTxns, budgets, assets, plaid] = await Promise.all([
      fetchTransactions(ymd(curStart), ymd(addDays(date, 1))),
      fetchTransactions(ymd(prevStart), ymd(prevEnd)),
      fetchBudgets(ymd(curStart), ymd(curEnd)),
      fetchAssets(),
      fetchPlaidAccounts(),
    ]);

    if (token.cancelled) return;

    model = analyze({ date, currentTxns, previousTxns, fullTxns: currentTxns, historyTxns: [], budgets, assets, plaid });
    model.historyMonths = { complete: false };
    lastLoad = Date.now();
    syncUrl();
    clearError();
    renderAll();

    /* ── phase 2: deep history for trend, calendar, net worth ──
       Anchored on *today* so its URL never changes as you step through
       months — one request, then always a client cache hit. */
    const historyTxns = await fetchTransactions(ymd(historyStart), ymd(addDays(today, 1)));
    if (token.cancelled) return;

    const full = (historyTxns || []).filter(t => String(t.date).slice(0, 7) === ymd(date).slice(0, 7));
    model = analyze({
      date,
      currentTxns,
      previousTxns,
      fullTxns: full.length ? full : currentTxns,
      historyTxns,
      budgets,
      assets,
      plaid,
    });
    model.historyMonths = historySpan(historyTxns);
    renderHistoryPhase();
  } catch (err) {
    if (token.cancelled) return;
    showError(err);
  } finally {
    if (!token.cancelled) setLoading(false);
  }
}

/** Second paint: only the panels the deep history actually feeds. */
function renderHistoryPhase() {
  const m = model;
  renderCalendar(m);
  renderTrend(m);
  renderNetWorth(m);
  const hs = m.historyMonths;
  byId('history-meta').textContent = hs && hs.complete ? historyLabel(hs, m.trend.length) : 'no history';
}

/** e.g. "Nov 2023 → Oct 2026 · 36 months" */
function historyLabel(hs, months) {
  const a = new Date(hs.from + 'T00:00:00');
  const b = new Date(hs.to + 'T00:00:00');
  return `${MONTH_LONG[a.getMonth()].slice(0, 3)} ${a.getFullYear()} → ${MONTH_LONG[b.getMonth()].slice(0, 3)} ${b.getFullYear()} · ${months} months`;
}

/**
 * Errors surface in a banner rather than replacing the page, so a retry
 * re-renders into the same DOM and the shell is never destroyed.
 */
function showError(err) {
  console.error(err);
  const banner = byId('banner');
  banner.hidden = false;
  banner.innerHTML = `
    <div class="banner-hd">
      <b>could not load data</b>
      <button class="pill" id="banner-retry">retry</button>
    </div>
    <p class="banner-msg">${esc(err.message || err)}</p>
    <p class="banner-hint">check that the API server is running (<code>npm run dev</code>) and that the Lunchmoney API key and hostname are set</p>`;
  byId('banner-retry').addEventListener('click', () => load(navDate ? ymd(navDate) : null, { force: true }));
}

function clearError() {
  const banner = byId('banner');
  banner.hidden = true;
  banner.innerHTML = '';
}

/** What range of history actually came back, for honest labelling in the UI. */
function historySpan(txns) {
  const dates = (txns || []).map(t => t.date).filter(Boolean).sort();
  if (!dates.length) return { from: null, to: null, rows: 0, complete: false };
  return { from: dates[0], to: dates[dates.length - 1], rows: dates.length, complete: true };
}

/* ── url sync ────────────────────────────────────────────────────── */

let lastWrittenUrl = '';
function syncUrl() {
  const url = new URL(location.href);
  if (model.dateStr === ymd(new Date())) url.searchParams.delete('date');
  else url.searchParams.set('date', model.dateStr);
  const next = url.pathname + url.search + url.hash;
  if (next === lastWrittenUrl) return;
  lastWrittenUrl = next;
  history.replaceState(null, '', next);
}

/* ── rendering ──────────────────────────────────────────────────────── */

function renderAll() {
  const m = model;
  document.body.classList.add('ready');

  setState({ txnLimit: 60, txnQuery: '', txnCategory: 'all' }, 'silent-reset');
  const search = byId('txn-search');
  if (search) search.value = '';

  byId('mp-text').textContent = m.month.short;
  byId('mp-label').title = `${m.month.long} — click to pick a date`;
  byId('mp-input').value = m.dateStr;
  byId('crumb-leaf').textContent = 'overview';
  byId('pace-meta').textContent = `${m.month.long} · day ${m.elapsed} of ${m.month.days}`;
  byId('foot-meta').textContent =
    `${m.categories.length} categories · ${m.txCategoryCount} with transactions · refreshed ${relTime(lastLoad)}`;
  const hs = m.historyMonths;
  byId('history-meta').textContent = hs && hs.complete ? historyLabel(hs, m.trend.length) : 'loading history…';
  byId('rail-updated').textContent = relTime(lastLoad);

  renderOverview(m);
  renderStatusStrip(m);
  renderPace(m);
  renderBudget(m);
  renderCalendar(m);
  renderCategories(m);
  renderTrend(m);
  renderNetWorth(m);
  renderTransactions(m);
}

/* ── navigation + scroll spy ────────────────────────────────────────── */

const NAV = ['section-overview', 'section-pace', 'section-budget', 'section-categories',
  'section-calendar', 'section-trend', 'section-networth', 'section-txns'];

function gotoSection(id) {
  const el = byId(id);
  if (!el || el.hidden) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  document.body.classList.remove('nav-open');
  const nav = $(`.nav-item[data-nav="${id}"]`);
  if (nav) {
    $$('.nav-item').forEach(a => a.classList.toggle('on', a === nav));
    byId('crumb-leaf').textContent = nav.textContent.trim().replace(/\d+$/, '').trim();
  }
}

function initSpy() {
  const io = new IntersectionObserver(entries => {
    const visible = entries
      .filter(e => e.isIntersecting)
      .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
    if (!visible.length) return;
    const id = visible[0].target.id;
    $$('.nav-item').forEach(a => a.classList.toggle('on', a.dataset.nav === id));
    const nav = $('.nav-item.on');
    byId('crumb-leaf').textContent = nav ? nav.textContent.trim().replace(/\d+$/, '').trim() : 'overview';
  }, { rootMargin: '-15% 0px -65% 0px', threshold: 0 });

  NAV.forEach(id => {
    const el = byId(id);
    if (el) io.observe(el);
  });
}

/* ── month stepping ─────────────────────────────────────────────────── */

function stepMonth(delta) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const base = navDate || model?.date;
  if (!base) return;
  const days = daysInMonth(
    base.getFullYear(),
    delta > 0 ? base.getMonth() + 1 : base.getMonth() - 1
  );
  // keep the day-of-month where possible so the same point in the month is compared
  let next = new Date(base.getFullYear(), base.getMonth() + delta, 1);
  next = new Date(next.getFullYear(), next.getMonth(), clamp(base.getDate(), 1, days));
  if (next > today) {
    if (delta < 0) return;
    // stepping into the current month lands on today rather than refusing
    if (base.getTime() === today.getTime()) return;
    next = today;
  }
  load(ymd(next));
}

/* ── keyboard ───────────────────────────────────────────────────────── */

function initKeys() {
  addEventListener('keydown', e => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);

    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      togglePalette();
      return;
    }
    if (e.key === 'Escape' && paletteOpen()) return;
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;

    if (e.key >= '1' && e.key <= '8') {
      e.preventDefault();
      gotoSection(NAV[Number(e.key) - 1]);
    } else if (e.key === 'r') {
      e.preventDefault();
      load(model ? model.dateStr : null, { force: true });
    } else if (e.key === 't') {
      toggleTheme();
    } else if (e.key === 'f') {
      e.preventDefault();
      $('#basis-control button.active')?.click();
    } else if (e.key === '/') {
      e.preventDefault();
      byId('txn-search').focus();
      byId('txn-search').scrollIntoView({ block: 'center', behavior: 'smooth' });
    } else if (e.key === '?') {
      e.preventDefault();
      togglePalette();
    }
  });
}

function toggleTheme() {
  theme = theme === 'dark' ? 'light' : 'dark';
  applyTheme(theme);
  if (model) {
    refreshAllCharts();
    // fonts/metrics can shift slightly across themes; re-render text for safety
    renderStatusStrip(model);
  }
}

/* ── command palette ────────────────────────────────────────────────── */

function initCommands() {
  setCommands([
    { id: 'nav:overview', group: 'jump to', title: 'Overview', kbd: '1' },
    { id: 'nav:pace', group: 'jump to', title: 'Cumulative pace', kbd: '2' },
    { id: 'nav:budget', group: 'jump to', title: 'Budget', kbd: '3' },
    { id: 'nav:categories', group: 'jump to', title: 'Categories', kbd: '4' },
    { id: 'nav:calendar', group: 'jump to', title: 'Spend calendar', kbd: '5' },
    { id: 'nav:trend', group: 'jump to', title: 'Monthly trend', kbd: '6' },
    { id: 'nav:networth', group: 'jump to', title: 'Net worth', kbd: '7' },
    { id: 'nav:txns', group: 'jump to', title: 'Transactions', kbd: '8' },

    { id: 'basis:same', group: 'comparison', title: 'Compare to same period last month', keys: 'proportional day' },
    { id: 'basis:full', group: 'comparison', title: 'Compare to full previous month', keys: 'whole month' },
    { id: 'cat:movers', group: 'comparison', title: 'Toggle “movers only”', keys: 'category filter' },

    { id: 'trend:3', group: 'range', title: 'Trend · 3 months' },
    { id: 'trend:6', group: 'range', title: 'Trend · 6 months' },
    { id: 'trend:12', group: 'range', title: 'Trend · 12 months' },
    { id: 'trend:24', group: 'range', title: 'Trend · 24 months' },
    { id: 'trend:all', group: 'range', title: 'Trend · full history' },

    { id: 'txn:search', group: 'actions', title: 'Search transactions', kbd: '/' },
    { id: 'txn:income', group: 'actions', title: 'Toggle income rows' },
    { id: 'act:prev', group: 'actions', title: 'Previous month' },
    { id: 'act:today', group: 'actions', title: 'Jump to today' },
    { id: 'act:next', group: 'actions', title: 'Next month' },
    { id: 'act:refresh', group: 'actions', title: 'Refresh from Lunchmoney', kbd: 'r' },
    { id: 'act:theme', group: 'actions', title: 'Toggle theme', kbd: 't' },

    { id: 'help:keys', group: 'shortcuts', title: '1–8  jump between sections' },
    { id: 'help:keys2', group: 'shortcuts', title: '⌘K / Ctrl+K  command palette' },
    { id: 'help:keys3', group: 'shortcuts', title: '/  search transactions · f  flip comparison basis' },
  ], {
    'nav:overview': () => gotoSection('section-overview'),
    'nav:pace': () => gotoSection('section-pace'),
    'nav:budget': () => gotoSection('section-budget'),
    'nav:categories': () => gotoSection('section-categories'),
    'nav:calendar': () => gotoSection('section-calendar'),
    'nav:trend': () => gotoSection('section-trend'),
    'nav:networth': () => gotoSection('section-networth'),
    'nav:txns': () => gotoSection('section-txns'),
    'basis:same': () => setState({ basis: 'same' }, 'basis') || syncBasisButtons(),
    'basis:full': () => setState({ basis: 'full' }, 'basis') || syncBasisButtons(),
    'cat:movers': () => byId('movers-toggle').click(),
    'trend:3': () => pickRange('3'),
    'trend:6': () => pickRange('6'),
    'trend:12': () => pickRange('12'),
    'trend:24': () => pickRange('24'),
    'trend:all': () => pickRange('all'),
    'txn:search': () => { byId('txn-search').focus(); byId('txn-search').scrollIntoView({ block: 'center', behavior: 'smooth' }); },
    'txn:income': () => byId('txn-income').click(),
    'act:prev': () => stepMonth(-1),
    'act:next': () => stepMonth(1),
    'act:today': () => load(ymd(new Date())),
    'act:refresh': () => load(navDate ? ymd(navDate) : null, { force: true }),
    'act:theme': toggleTheme,
    'help:keys': () => {},
    'help:keys2': () => {},
    'help:keys3': () => {},
  });

  initPalette();
}

function pickRange(r) {
  const btn = document.querySelector(`#trend-range button[data-r="${r}"]`);
  if (btn) btn.click();
}

/* ── bootstrap ──────────────────────────────────────────────────────── */

function init() {
  initCommands();
  initSpy();
  initKeys();

  /* theme */
  byId('theme-toggle').addEventListener('click', toggleTheme);

  /* month navigation */
  byId('mp-prev').addEventListener('click', () => stepMonth(-1));
  byId('mp-next').addEventListener('click', () => stepMonth(1));
  const mpInput = byId('mp-input');
  byId('mp-label').addEventListener('click', () => {
    if (mpInput.showPicker) mpInput.showPicker();
    else mpInput.click();
  });
  mpInput.addEventListener('change', () => { if (mpInput.value) load(mpInput.value); });

  /* refresh */
  byId('refresh-btn').addEventListener('click', () => load(navDate ? ymd(navDate) : null, { force: true }));

  /* palette trigger */
  byId('cmd-open').addEventListener('click', togglePalette);
  const isApple = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  if (isApple) byId('kbd-hint').textContent = '⌘K';
  else byId('kbd-hint').textContent = '^K';

  /* mobile nav */
  byId('menu-btn').addEventListener('click', () => document.body.classList.toggle('nav-open'));
  $$('.nav-item').forEach(a => a.addEventListener('click', () => document.body.classList.remove('nav-open')));

  /* panels */
  bindLegend();
  bindBudget();
  bindCalendar();
  bindCategories();
  bindTrend();
  bindTransactions();

  /* state-driven re-renders */
  subscribe((_, reason) => {
    if (!model) return;
    switch (reason) {
      case 'basis':
        syncBasisButtons();
        renderBudget(model);
        renderCategories(model);
        break;
      case 'budget-sort':
      case 'budget-filter':
        renderBudget(model);
        break;
      case 'cat-sort':
      case 'cat-filter':
      case 'movers':
        renderCategories(model);
        break;
      case 'trend-range':
        renderTrend(model);
        break;
      case 'txn-sort':
      case 'txn-search':
      case 'txn-cat':
      case 'txn-income':
      case 'txn-more':
        renderTransactions(model);
        break;
      default:
        break;
    }
  });

  /* keep the "updated" timestamp honest */
  setInterval(() => {
    if (lastLoad) byId('rail-updated').textContent = relTime(lastLoad);
  }, 15000);

  load(ymd(initialDate()));
}

if (document.readyState === 'loading') addEventListener('DOMContentLoaded', init);
else init();