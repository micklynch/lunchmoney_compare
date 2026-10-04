// Small UI state store. Panels read from it synchronously and re-render via the
// `onState` callback — no framework, no virtual DOM, no stale copies.

const listeners = new Set();

export const ui = {
  basis: 'same',       // 'same' | 'full'  → compare against same period or full previous month
  trendRange: 12,      // months shown in the trend chart
  catSort: 'delta',
  catDir: -1,
  catFilter: '',
  moversOnly: false,
  budgetFilter: '',
  txnSort: 'ts',
  txnDir: -1,
  txnQuery: '',
  txnCategory: 'all',
  showIncome: false,
  txnLimit: 60,
  loading: false,
};

/**
 * Apply a patch and notify subscribers.
 * Passing a `reason` is a deliberate "something changed, re-render" signal —
 * some panels keep local sort state, so no tracked value may differ.
 */
export function setState(patch, reason) {
  let changed = false;
  for (const [k, v] of Object.entries(patch || {})) {
    if (ui[k] !== v) { ui[k] = v; changed = true; }
  }
  if (changed || reason) emit(reason);
  return changed;
}

export function emit(reason) {
  for (const fn of listeners) fn(ui, reason);
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Comparison basis helpers — one definition of "where I was last month". */
export const lastOf = (row) => (ui.basis === 'same' ? row.same : row.full);
export const deltaOf = (row) => (ui.basis === 'same' ? row.delta : row.fullDelta);
export const deltaPctOf = (row) => (ui.basis === 'same' ? row.deltaPct : row.fullDeltaPct);
export const basisLabel = (m) =>
  ui.basis === 'same'
    ? `same period last month (${m.prevMonth.short} ${m.eqDay})`
    : `full ${m.prevMonth.long}`;