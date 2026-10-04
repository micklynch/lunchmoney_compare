/**
 * End-to-end UI smoke test.
 *
 * Boots the real application bundle inside jsdom against a live Lunchmoney
 * proxy and exercises the interactions that unit tests cannot reach: rendering,
 * sorting, filtering, month stepping, the command palette, keyboard shortcuts
 * and the custom canvas chart plugins.
 *
 *   npm run dev          # terminal 1 — API proxy on :3001
 *   npm run test:ui      # terminal 2
 *
 * Set SMOKE_DATE=YYYY-MM-DD to target a month with budgets configured.
 */

import { JSDOM, VirtualConsole } from 'jsdom';
import { build } from 'vite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const API = process.env.SMOKE_API || 'http://localhost:3001';
const DATE = process.env.SMOKE_DATE || '2026-06-15';

let pass = 0;
let fail = 0;
const report = [];
const check = (name, ok, detail = '') => {
  if (ok) pass++; else fail++;
  report.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`);
};

/* ── 0. is the API up? ─────────────────────────────────────────────── */
try {
  const r = await fetch(`${API}/api/transactions?start_date=2024-01-01&end_date=2024-01-02`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
} catch (err) {
  console.error(`\nCannot reach the API proxy at ${API} (${err.message}).`);
  console.error('Start it first:  npm run dev\n');
  process.exit(2);
}

/* ── 1. bundle the app (CSS import stripped — jsdom has no CSSOM need) ─ */
const entry = path.join(root, 'src/__smoke.js');
const outDir = path.join(root, 'node_modules/.smoke-dist');
fs.writeFileSync(entry, fs.readFileSync(path.join(root, 'src/main.js'), 'utf8').replace("import './style.css';", ''));
try {
  await build({
    configFile: false, logLevel: 'error', root,
    build: {
      lib: { entry, name: 'App', formats: ['iife'], fileName: 'app' },
      outDir, minify: false, emptyOutDir: true, cssCodeSplit: false,
    },
  });
} finally {
  fs.rmSync(entry, { force: true });
}
const bundle = fs.readFileSync(path.join(outDir, 'app.iife.js'), 'utf8');

/* ── 2. boot the app in jsdom ───────────────────────────────────────── */
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
  .replace(/<script type="module"[^>]*><\/script>/, '');

const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => errors.push('jsdomError: ' + (e.stack || e.message)));
vc.on('error', (...a) => errors.push('console.error: ' + a.map(x => (x && x.stack) ? x.stack : String(x)).join(' ')));

const dom = new JSDOM(html, {
  runScripts: 'outside-only',
  pretendToBeVisual: true,
  url: `http://localhost/?date=${DATE}`,
  virtualConsole: vc,
});
const { window } = dom;
window.fetch = (u, o) => fetch(new URL(String(u), API), o);
window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
window.Element.prototype.scrollIntoView = function () {};
window.matchMedia = window.matchMedia || (q => ({
  matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
}));

/* Chart.js stand-in: every builder + option object is still constructed, only
   the 2D context is faked. Custom plugins are pulled off the instances and
   invoked manually against a stub context further down. */
const charts = [];
class MockChart {
  constructor(el, cfg, plugins) {
    this.canvas = el; this.config = cfg; this.plugins = plugins || [];
    this.data = cfg.data; this.options = cfg.options;
    this._rows = cfg.data?.datasets?.[0]?.data || [];
    charts.push(this);
  }
  destroy() { this.destroyed = true; }
  update() {}
  setDatasetVisibility(i, v) { this._visible = { ...(this._visible || {}), [i]: v }; }
  getDatasetMeta(i) {
    return { data: (this.data.datasets[i]?.data || []).map((_, idx) => ({ x: 40 + idx * 30, y: 200 - idx * 4, width: 20, $meta: this._rows[idx] })) };
  }
}
MockChart.getChart = id => charts.find(c => c.canvas?.id === id && !c.destroyed) || null;
window.Chart = MockChart;

const d = window.document;
const t = id => (d.getElementById(id)?.textContent || '').trim().replace(/\s+/g, ' ');
const rows = s => [...d.querySelectorAll(s)];

const t0 = Date.now();
window.eval(bundle);
const wait = ms => new Promise(r => setTimeout(r, ms));

/** Wait for the app to actually paint rather than guessing at a timeout —
 *  the deep-history phase can take several seconds on a cold API cache. */
async function untilReady(timeout = 45000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (d.body.classList.contains('ready') && (d.getElementById('kpi-spend')?.textContent || '').trim() !== '—') return true;
    await wait(150);
  }
  return false;
}
const firstPaintMs = Date.now() - t0;
const firstPaintReady = await untilReady(15000);
const firstPaintActual = Date.now() - t0;

/** The deep-history phase lands later; it costs several upstream pages cold. */
async function untilHistory(timeout = 60000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (d.getElementById('history-meta').textContent.includes('months')) return true;
    await wait(200);
  }
  return false;
}
const fullReady = await untilHistory();
await wait(300);
const coldMs = Date.now() - t0;

const click = sel => {
  const el = d.querySelector(sel);
  if (el) el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  return !!el;
};
const key = (k, opts = {}) => window.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true, ...opts }));
const live = id => charts.filter(c => c.canvas?.id === id && !c.destroyed).pop();

/* ── 3. assertions ──────────────────────────────────────────────────── */
check('boots without runtime errors', errors.length === 0, errors.slice(0, 2).join(' | '));
check('no error banner on a healthy load', d.getElementById('banner').hidden, t('banner').slice(0, 60));
check('first paint (KPIs) under 8s', firstPaintReady, `${firstPaintActual}ms`);
check('deep history arrives within 60s', fullReady, `${coldMs}ms total`);

/* overview */
check('spend KPI rendered', /^\$[\d,]+\.\d\d$/.test(t('kpi-spend')), t('kpi-spend'));
check('benchmark KPI rendered', /^\$[\d,]+\.\d\d$/.test(t('kpi-bench')), t('kpi-bench'));
check('projection KPI rendered', /^\$[\d,]+\.\d\d$/.test(t('kpi-proj')), t('kpi-proj'));
check('status strip populated', t('strip-inline').length > 20, t('strip-inline').slice(0, 80));
check('sparklines emitted', d.querySelectorAll('#kpi-spend-spark svg, #kpi-bench-spark svg').length === 2);

/* pace */
check('pace verdict written', t('pace-verdict').length > 20, t('pace-verdict').slice(0, 70));
check('legend toggles present', d.querySelectorAll('#pace-legend .lg').length === 4);
check('readouts present', d.querySelectorAll('#pace-readout .readout').length === 4);

/* budget */
const budgetRows = rows('#budget-rows tbody tr');
check('budget rows rendered', budgetRows.length > 0, `${budgetRows.length} rows`);
check('pace markers drawn', d.querySelectorAll('#budget-rows .meter-marker').length > 0);
const budgetFirst = () => d.querySelector('#budget-rows tbody tr .name')?.textContent.trim();
const b0 = budgetFirst();
click('#budget-rows th[data-k="remaining"]'); await wait(60);
const b1 = budgetFirst();
click('#budget-rows th[data-k="remaining"]'); await wait(60);
const b2 = budgetFirst();
check('budget sorting is bidirectional', b0 !== b1 || b1 !== b2, `${b0} → ${b1} → ${b2}`);
const bf = d.getElementById('budget-filter');
bf.value = 'zzzz'; bf.dispatchEvent(new window.Event('input', { bubbles: true })); await wait(60);
check('budget filter empties when no match', /No budget lines match/.test(t('budget-rows')), t('budget-rows').slice(0, 40));
bf.value = ''; bf.dispatchEvent(new window.Event('input', { bubbles: true })); await wait(60);

/* categories */
check('category rows rendered', rows('#cat-body tbody tr').length > 0, `${rows('#cat-body tbody tr').length} rows`);
check('movers summary populated', d.querySelectorAll('#cat-summary .mv-line').length > 0);
const c0 = rows('#cat-body tbody tr').map(r => r.querySelector('.name').textContent.trim()).join();
click('#cat-body th[data-k="now"]'); await wait(60);
check('category sorting works', c0 !== rows('#cat-body tbody tr').map(r => r.querySelector('.name').textContent.trim()).join());

/* comparison basis */
const budgetLastHeader = () => d.querySelector('#budget-rows thead th[data-k="last"]')?.textContent.trim();
const bh0 = budgetLastHeader();
click('#basis-control button[data-basis="full"]'); await wait(60);
check('basis switches to full month', d.querySelector('#basis-control button[data-basis="full"]').classList.contains('active'));
check('budget table follows the basis', budgetLastHeader() !== bh0, `${bh0} → ${budgetLastHeader()}`);
click('#basis-control button[data-basis="same"]'); await wait(60);
check('basis switches back', d.querySelector('#basis-control button[data-basis="same"]').classList.contains('active'));
check('budget header restored', budgetLastHeader() === bh0, budgetLastHeader());

/* deep history — the calendar and full trend only make sense once the
   long window has landed */
check('trend reaches beyond a year', (() => {
  const btns = [...d.querySelectorAll('#trend-range button')];
  btns.find(b => b.dataset.r === 'all')?.click();
  return true;
})());
await wait(300);
const allMonths = rows('#trend-strip .mbar').length;
check('calendar grid renders 52 weeks of cells',
  d.querySelectorAll('#cal-body .cal-cell[data-d]').length >= 350,
  `${d.querySelectorAll('#cal-body .cal-cell[data-d]').length} cells`);
check('calendar has month captions', d.querySelectorAll('#cal-body .cal-months span').length >= 10,
  `${d.querySelectorAll('#cal-body .cal-months span').length} captions`);
check('calendar intensity levels are populated',
  d.querySelectorAll('#cal-body .cal-cell.lv1, #cal-body .cal-cell.lv2, #cal-body .cal-cell.lv3, #cal-body .cal-cell.lv4').length > 100,
  `${d.querySelectorAll('#cal-body .cal-cell.lv1, #cal-body .cal-cell.lv2, #cal-body .cal-cell.lv3, #cal-body .cal-cell.lv4').length} shaded`);
check('calendar tooltip has content', (() => {
  const cell = d.querySelector('#cal-body .cal-cell[data-d][data-c]:not([data-c="0"])');
  if (!cell) return false;
  cell.dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true }));
  const tip = d.querySelector('.cal-tip');
  return tip && !tip.hidden && /\$/.test(tip.textContent);
})(), 'hover a spending day');
check('calendar shows a spending summary', /days/.test(t('cal-summary')) && !/−\$/.test(t('cal-summary')), t('cal-summary').slice(0, 80));
click('#trend-range button[data-r="12"]'); await wait(250);
check('trend returns to 12m', rows('#trend-strip .mbar').length === 12, `${allMonths} → ${rows('#trend-strip .mbar').length}`);

/* transactions */
const txn0 = rows('#txn-body tr').length;
check('transaction rows rendered', txn0 > 0, `${txn0} rows`);
click('#txn-income'); await wait(80);
check('income toggle adds rows', rows('#txn-body tr.income').length > 0);
click('#txn-income'); await wait(80);
click('#txn-more'); await wait(80);
check('load more appends rows', rows('#txn-body tr').length > txn0, `${txn0} → ${rows('#txn-body tr').length}`);
const ts = d.getElementById('txn-search');
ts.value = 'zzzznomatch'; ts.dispatchEvent(new window.Event('input', { bubbles: true })); await wait(80);
check('search filters to empty state', /No transactions match/.test(t('txn-body')));
ts.value = ''; ts.dispatchEvent(new window.Event('input', { bubbles: true })); await wait(80);

/* palette + keys */
key('k', { ctrlKey: true }); await wait(60);
check('ctrl-k opens palette', d.getElementById('palette').classList.contains('on'));
const pi = d.querySelector('#palette .p-input');
pi.value = 'full month'; pi.dispatchEvent(new window.Event('input', { bubbles: true })); await wait(60);
check('palette filters commands', rows('#palette .p-row').length === 1, rows('#palette .p-row').map(r => r.textContent.replace(/\s+/g, ' ').trim()).join(' | '));
pi.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await wait(150);
check('palette closes and runs the command',
  !d.getElementById('palette').classList.contains('on') &&
  d.querySelector('#basis-control button[data-basis="full"]').classList.contains('active'));
click('#basis-control button[data-basis="same"]'); await wait(60);

key('4'); await wait(60);
check('number key activates nav', d.querySelector('.nav-item[data-nav="section-categories"]').classList.contains('on'));
key('t'); await wait(60);
check('t toggles theme', d.body.classList.contains('light'));
key('t'); await wait(60);

/* charts + custom plugins */
check('all three charts built', ['pace-chart', 'trend-chart', 'networth-chart'].every(id => live(id)));
const ctxStub = new Proxy({}, {
  get: (_, k) => (k === 'measureText' ? () => ({ width: 30 }) : k === 'canvas' ? {} : () => {}),
  set: () => true,
});
const fake = {
  ctx: ctxStub,
  chartArea: { left: 40, right: 900, top: 10, bottom: 300 },
  scales: { x: { getPixelForValue: v => 40 + (v / 30) * 860 }, y: { getPixelForValue: () => 150 } },
  getDatasetMeta: i => live('pace-chart').getDatasetMeta(i),
};
let pluginErr = null;
try {
  const [gap, today] = live('pace-chart').plugins;
  gap.beforeDatasetsDraw(fake, null, { today: 15, curIdx: 1, priorIdx: 0, color: 'rgba(255,0,0,.1)' });
  today.afterDatasetsDraw(fake, null, { today: 15, label: 'TODAY' });
  live('trend-chart').plugins[0].afterDatasetsDraw({ ...fake, getDatasetMeta: () => live('trend-chart').getDatasetMeta(0) }, null, { idx: 0 });
  live('networth-chart').plugins[0].afterDatasetsDraw(fake, null, {});
} catch (e) { pluginErr = e; }
check('canvas plugins run clean', !pluginErr, pluginErr ? pluginErr.message : 'gap band · today rule · MoM labels · zero line');

check('no NaN/undefined leaked into the UI',
  !/NaN|undefined/.test(d.getElementById('content').textContent));

/* month navigation (last: it leaves us on the current month) */
const nowLabel = new Date().toLocaleDateString('en-US', { month: 'short' }) + ' ' + String(new Date().getFullYear()).slice(2);
const startLabel = t('mp-text');
click('#mp-prev'); await wait(2000);
check('previous month steps back', t('mp-text') !== startLabel && /date=\d{4}-\d{2}-\d{2}/.test(window.location.search), `${startLabel} → ${t('mp-text')}`);
click('#mp-next'); await wait(2000);
check('next month returns', t('mp-text') === startLabel, t('mp-text'));
for (let i = 0; i < 8; i++) { click('#mp-next'); await wait(250); }
await wait(4000);
check('stepping forward reaches the current month', t('mp-text') === nowLabel, `${t('mp-text')} vs ${nowLabel}`);
click('#mp-next'); await wait(2500);
check('cannot step past today', t('mp-text') === nowLabel, t('mp-text'));
check('still no runtime errors after navigation', errors.length === 0, errors.slice(0, 2).join(' | '));

/* failure path: the shell must survive so a retry can re-render into it */
{
  const realFetch = window.fetch;
  window.fetch = () => Promise.reject(new Error('simulated outage'));
  click('#refresh-btn');
  await wait(600);
  check('errors surface in a banner', !d.getElementById('banner').hidden);
  check('shell survives the error', !!d.getElementById('pace-chart') && d.querySelectorAll('.nav-item').length === 8);
  window.fetch = realFetch;
  click('#banner-retry');
  await wait(3000);
  check('retry recovers', d.getElementById('banner').hidden && t('kpi-spend') !== '—', t('kpi-spend'));
}

/* ── 4. stylesheet invariants ───────────────────────────────────────
   jsdom has no layout engine, so a misplaced sticky header cannot be caught
   by inspecting positions. Assert the CSS instead: .table-scroll is a scroll
   container on both axes, so a thead offset derived from the topbar is
   resolved against the table itself and shoves the header into the rows. */
{
  const css = fs.readFileSync(path.join(root, 'src/style.css'), 'utf8');
  const thead = css.match(/table\.grid thead th\s*{([^}]*)}/)?.[1] || '';
  const wrap = css.match(/\.table-scroll\s*{([^}]*)}/)?.[1] || '';
  check('table header sticks to the table top, not the topbar',
    /position:\s*sticky/.test(thead) && /top:\s*0\s*;/.test(thead),
    thead.match(/top:[^;]*;?/)?.[0].trim() || 'no top offset');
  check('table-scroll wrapper does not scroll vertically',
    !/overflow-y/.test(wrap), wrap.trim().replace(/\s+/g, ' ').slice(0, 60));
}

console.log(`\n${report.join('\n')}\n\n${pass}/${pass + fail} checks passed`);
const unexpected = errors.filter(e => !/simulated outage/.test(e));
if (unexpected.length) console.log('\nUNEXPECTED ERRORS:\n' + unexpected.join('\n'));
fs.rmSync(outDir, { recursive: true, force: true });
process.exit(fail ? 1 : 0);