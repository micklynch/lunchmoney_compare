// ───────────────────────────────────────────────────────────────
// Analytics core. Everything the UI renders is derived here so the
// "same period last month" comparison is computed once, consistently,
// and reused by every panel.
// ───────────────────────────────────────────────────────────────

import { clamp, num, round2, sum, groupBy, HISTORY_MONTHS, CALENDAR_WEEKS } from './util.js';
import { MONTH_SHORT, MONTH_LONG } from './format.js';

/* ── date helpers ───────────────────────────────────────────── */

export const ymd = d =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const parseYmd = s => new Date(`${s}T00:00:00`);

export const addDays = (d, n) => {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
};

export const daysInMonth = (year, monthIndex0) => new Date(year, monthIndex0 + 1, 0).getDate();

export const startOfMonth = d => new Date(d.getFullYear(), d.getMonth(), 1);

export const endOfMonth = d => new Date(d.getFullYear(), d.getMonth() + 1, 0);

export const shiftMonths = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, 1);

export function monthKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function monthMeta(d) {
  const days = daysInMonth(d.getFullYear(), d.getMonth());
  return {
    year: d.getFullYear(),
    month: d.getMonth(),
    key: monthKey(d),
    days,
    short: `${MONTH_SHORT[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`,
    long: `${MONTH_LONG[d.getMonth()]} ${d.getFullYear()}`,
  };
}

/**
 * Which calendar day of the *previous* month lines up with `elapsed` days of
 * this month. Months have different lengths, so day 15 of a 30-day month maps
 * to ~day 15.5 → day 16 of a 31-day month.
 */
export function equivalentDay(elapsed, daysCur, daysPrev) {
  return clamp(Math.round((elapsed / daysCur) * daysPrev), 1, daysPrev);
}

/* ── transaction normalisation ─────────────────────────────── */

const UNCATEGORISED = 'Uncategorised';

function cleanCategory(name) {
  const v = (name ?? '').toString().trim();
  return !v || v === 'nan' || v === 'None' ? UNCATEGORISED : v;
}

export function normalise(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(t => {
      const date = parseYmd(t.date);
      // `to_base` keeps multi-currency accounts comparable; fall back to the
      // native amount when the base conversion is missing.
      const amount = t.to_base != null && t.to_base !== '' ? num(t.to_base) : num(t.amount);
      return {
        date,
        day: date.getDate(),
        ts: date.getTime(),
        amount,
        currency: t.currency || '',
        isIncome: !!t.is_income,
        excluded: !!t.exclude_from_totals,
        payee: (t.payee || '').toString(),
        category: cleanCategory(t.category_name),
      };
    })
    .filter(t => !Number.isNaN(t.ts))
    .sort((a, b) => a.ts - b.ts);
}

/** Expenses count as positive spend regardless of how the API signs them. */
export const spendOf = t => (t.isIncome ? 0 : t.excluded ? 0 : Math.abs(t.amount));
export const incomeOf = t => (t.isIncome && !t.excluded ? Math.abs(t.amount) : 0);

export const isSpend = t => !t.isIncome && !t.excluded;

/**
 * Dense day-by-day cumulative series (index 0 = day 1). Missing days carry
 * forward so the curve is monotonic and continuous.
 */
function cumulativeByDay(spendTxns, days) {
  const perDay = new Float64Array(days + 1);
  for (const t of spendTxns) {
    if (t.day >= 1 && t.day <= days) perDay[t.day] += Math.abs(t.amount);
  }
  const out = new Array(days);
  let run = 0;
  for (let d = 1; d <= days; d++) {
    run += perDay[d];
    out[d - 1] = round2(run);
  }
  return out;
}

const toPoints = (values, xFn) => values.map((y, i) => ({ x: xFn(i), y }));

/* ── spend calendar (GitHub-style intensity grid) ─────────────────── */

/**
 * One cell per day for the last `CALENDAR_WEEKS` weeks, laid out in columns of
 * weeks. Levels are quantile-based rather than absolute so the grid adapts to
 * whatever the user's spending distribution actually looks like.
 *
 * Days outside the fetched history are marked `unknown` instead of $0 — "we
 * have no data" and "you spent nothing" are very different claims.
 */
export function buildCalendar(historyTxns, endDate) {
  const end = new Date(endDate);
  end.setHours(0, 0, 0, 0);

  // Monday of the reference week, minus (CALENDAR_WEEKS - 1) weeks.
  // Yields exactly CALENDAR_WEEKS * 7 cells ending on `end`.
  const endDow = (end.getDay() + 6) % 7;          // 0 = Monday
  const lastMonday = addDays(end, -endDow);
  const start = addDays(lastMonday, -(CALENDAR_WEEKS - 1) * 7);
  const totalDays = Math.round((end - start) / 86400000) + 1;

  let coverageStart = null;
  for (const t of historyTxns || []) {
    const ts = parseYmd(t.date).getTime();
    if (!Number.isNaN(ts) && (coverageStart === null || ts < coverageStart)) coverageStart = ts;
  }

  const totals = new Map();
  for (const raw of historyTxns || []) {
    const d = parseYmd(raw.date);
    if (d < start || d > end) continue;
    if (raw.exclude_from_totals) continue;
    if (raw.is_income) continue; // the grid shows spending, not net cash flow
    const amt = Math.abs(num(raw.to_base != null && raw.to_base !== '' ? raw.to_base : raw.amount));
    const k = ymd(d);
    const cur = totals.get(k) || { amount: 0, count: 0 };
    cur.amount += amt;
    cur.count++;
    totals.set(k, cur);
  }

  const active = [...totals.values()].map(v => v.amount).filter(v => v > 0).sort((a, b) => a - b);
  const q = p => (active.length ? active[Math.min(active.length - 1, Math.floor(active.length * p))] : 0);
  const levels = [q(0.25), q(0.5), q(0.75)];

  const days = [];
  const weeks = Math.ceil(totalDays / 7);
  let monthCursor = null;

  for (let i = 0; i < weeks * 7; i++) {
    const date = addDays(start, i);
    if (date > end) { days.push(null); continue; } // trailing pad to a full week

    const rec = totals.get(ymd(date));
    const amount = rec ? round2(rec.amount) : 0;
    const known = !coverageStart || date.getTime() >= coverageStart;

    let level = 0;
    if (!known) level = -1;
    else if (amount > 0) level = Math.min(4, levels.findIndex(th => amount > th) + 2);

    days.push({
      date: ymd(date),
      d: date.getDate(),
      month: date.getMonth(),
      year: date.getFullYear(),
      dow: i % 7,                    // 0 = Monday (start is a Monday)
      week: Math.floor(i / 7),
      amount,
      count: rec ? rec.count : 0,
      level,
      isToday: date.getTime() === end.getTime(),
      monthStart: monthCursor !== date.getMonth(),
    });
    monthCursor = date.getMonth();
  }

  // month captions for the column headers
  const monthLabels = [];
  let lastSeen = null;
  for (const day of days) {
    if (!day || !day.monthStart) continue;
    const key = day.year + '-' + day.month;
    if (lastSeen === key) continue;
    lastSeen = key;
    monthLabels.push({ week: day.week, label: MONTH_SHORT[day.month] + (day.month === 0 ? ` '${String(day.year).slice(2)}` : '') });
  }

  return {
    days,
    weeks,
    monthLabels,
    start: ymd(start),
    end: ymd(end),
    max: active.length ? round2(active[active.length - 1]) : 0,
    totalDays: days.filter(Boolean).length,
    activeDays: active.length,
    thresholds: levels.map(round2),
  };
}

/* ── budgets ──────────────────────────────────────────────────── */

/**
 * Budget rows for the month containing `date`, enriched with how the same
 * category was tracking at the same point last month.
 *
 * Spend-to-date is computed from the transactions we already hold rather than
 * the API's `spending_to_base`, which reports the *whole* month for any month
 * that is already in the past. Keeping one source of truth means the budget
 * meter always agrees with the headline figures.
 */
export function buildBudgetModel(budgetsRaw, date, prevCategoryTotals, prevCategoryTotalsFull, spentByCat) {
  if (!Array.isArray(budgetsRaw) || !budgetsRaw.length) return null;
  const key = `${monthKey(date)}-01`;
  const cur = monthMeta(date);
  const elapsed = date.getDate();

  const rows = [];
  let totalBudget = 0;
  let totalSpent = 0;
  let overCount = 0;

  for (const b of budgetsRaw) {
    if (b.is_group || b.is_income || b.exclude_from_budget || b.archived) continue;
    const d = b.data && b.data[key];
    const budget = Math.abs(num(d ? (d.budget_to_base ?? d.budget_amount) : 0));
    if (budget <= 0.005) continue;

    const name = cleanCategory(b.category_name);
    const spent = round2(spentByCat.get(name) || 0);
    const expected = (budget * elapsed) / cur.days;
    const remaining = round2(budget - spent);
    const over = remaining < -0.005;
    if (over) overCount++;

    totalBudget += budget;
    totalSpent += spent;

    rows.push({
      name,
      budget: round2(budget),
      spent,
      remaining,
      expected: round2(expected),
      usedPct: budget > 0 ? (spent / budget) * 100 : 0,
      pacePct: budget > 0 ? (elapsed / cur.days) * 100 : 0,
      over,
      lastSame: round2(prevCategoryTotals.get(name) || 0),
      lastFull: round2(prevCategoryTotalsFull.get(name) || 0),
    });
  }

  if (!rows.length) return null;

  rows.sort((a, b) => b.spent - a.spent || b.budget - a.budget);

  const remaining = round2(totalBudget - totalSpent);
  const expectedNow = round2((totalBudget * elapsed) / cur.days);
  const dailyRate = elapsed > 0 ? totalSpent / elapsed : 0;

  return {
    rows,
    total: { budget: round2(totalBudget), spent: round2(totalSpent), remaining, expectedNow },
    days: cur.days,
    elapsed,
    itemCount: rows.length,
    overCount,
    /** run-rate month-end figure for the budgeted lines */
    projected: round2(totalSpent + dailyRate * (cur.days - elapsed)),
    burnPerDay: round2(dailyRate),
    aheadOfPace: round2(totalSpent - expectedNow),
  };
}

/* ── net worth ──────────────────────────────────────────────── */

const LIABILITY_TYPES = new Set(['credit', 'loan', 'creditcard', 'line of credit']);

function balancesFrom(assetsRes, plaidRes) {
  const assets = (assetsRes && assetsRes.assets) || [];
  const plaid = (plaidRes && plaidRes.plaid_accounts) || [];
  const buckets = new Map();
  let current = 0;
  let count = 0;

  const add = (name, balance, isDebt, type) => {
    current += isDebt ? -Math.abs(balance) : balance;
    count++;
    const k = type || 'other';
    buckets.set(k, round2((buckets.get(k) || 0) + (isDebt ? -Math.abs(balance) : balance)));
    return name;
  };

  assets.forEach(a => {
    if (a.closed_on) return;
    const b = num(a.to_base ?? a.balance);
    add(a.name || 'asset', b, LIABILITY_TYPES.has((a.type_name || '').toLowerCase()), (a.type_name || 'other').toLowerCase());
  });
  plaid.forEach(a => {
    const b = num(a.to_base ?? a.balance);
    const t = (a.type || '').toLowerCase();
    add(a.name || 'account', b, LIABILITY_TYPES.has(t), t || 'other');
  });

  return { current: round2(current), count, buckets: [...buckets.entries()].map(([k, v]) => ({ type: k, value: v })) };
}

/**
 * Current balances are exact; history is reconstructed by walking backwards
 * through each month's net cash flow.
 */
export function buildNetWorth(assetsRes, plaidRes, trend) {
  const { current, count, buckets } = balancesFrom(assetsRes, plaidRes);
  if (!count || !trend.length) return null;
  const n = trend.length;
  const values = new Array(n);
  values[n - 1] = current;
  for (let i = n - 2; i >= 0; i--) {
    values[i] = round2(values[i + 1] - (trend[i].income - trend[i].spending));
  }
  const labels = trend.map((m, i) => (i === n - 1 ? 'now' : m.short));
  const hasDelta = n > 1 && values[n - 2] !== 0;
  return {
    values,
    labels,
    current,
    count,
    buckets,
    delta: n > 1 ? round2(values[n - 1] - values[n - 2]) : 0,
    deltaPct: hasDelta ? ((values[n - 1] - values[n - 2]) / Math.abs(values[n - 2])) * 100 : 0,
    partial: n < 2, // history not loaded yet
    min: round2(Math.min(...values)),
    max: round2(Math.max(...values)),
  };
}

/* ── the big one ────────────────────────────────────────────── */

/**
 * @param {object} input
 * @param {Date}   input.date
 * @param {Array}  input.currentTxns   month-to-date raw transactions
 * @param {Array}  input.previousTxns  full previous month
 * @param {Array}  input.fullTxns      full current month (only used for past dates)
 * @param {Array}  input.historyTxns    the long window (today - HISTORY_MONTHS … today)
 * @param {Array}  input.budgets       raw budget payload
 * @param {object} input.assets
 * @param {object} input.plaid
 */
export function analyze({ date, currentTxns, previousTxns, fullTxns, historyTxns, budgets, assets, plaid }) {
  const cur = monthMeta(date);
  const prevDate = shiftMonths(date, -1);
  const prev = monthMeta(prevDate);

  const elapsed = clamp(date.getDate(), 1, cur.days);
  const remainingDays = cur.days - elapsed;
  const eqDay = equivalentDay(elapsed, cur.days, prev.days);

  /* ── current month ─────────────────────────────────────── */
  const allCurrent = normalise(currentTxns);
  const curSpend = allCurrent.filter(t => isSpend(t) && t.day <= elapsed);
  const curIncome = allCurrent.filter(t => !t.excluded && t.isIncome && t.day <= elapsed);

  const currentSeries = cumulativeByDay(curSpend, cur.days);
  const total = currentSeries[elapsed - 1] || 0;
  const income = round2(sum(curIncome, incomeOf));

  /* ── previous month ────────────────────────────────────── */
  const allPrev = normalise(previousTxns);
  const prevSpend = allPrev.filter(isSpend);
  const prevSpendSame = prevSpend.filter(t => t.day <= eqDay);
  const prevSeries = cumulativeByDay(prevSpend, prev.days);
  const prevTotal = prevSeries[prev.days - 1] || 0;
  const prevSameTotal = prevSeries[eqDay - 1] || 0;

  /* ── month-over-month deltas (the headline of this dashboard) ── */
  const delta = round2(total - prevSameTotal);
  const deltaPct = prevSameTotal > 0 ? (delta / prevSameTotal) * 100 : (total > 0 ? 100 : 0);

  /* ── pacing ────────────────────────────────────────────── */
  const dailyAvg = elapsed > 0 ? total / elapsed : 0;
  const runRate = round2(dailyAvg * cur.days);
  const paceLineSeries = Array.from({ length: cur.days }, (_, i) => round2((prevTotal * (i + 1)) / cur.days));

  /* ── budgets ───────────────────────────────────────────── */
  const prevCatTotals = new Map();
  for (const [name, list] of groupBy(prevSpendSame, t => t.category)) {
    prevCatTotals.set(name, round2(sum(list, spendOf)));
  }
  const prevCatTotalsFull = new Map();
  for (const [name, list] of groupBy(prevSpend, t => t.category)) {
    prevCatTotalsFull.set(name, round2(sum(list, spendOf)));
  }

  /* spend-to-date per category — one source of truth for both the budget
     meter and the category table */
  const catNow = new Map();
  for (const [name, list] of groupBy(curSpend, t => t.category)) {
    catNow.set(name, round2(sum(list, spendOf)));
  }

  const budget = buildBudgetModel(budgets, date, prevCatTotals, prevCatTotalsFull, catNow);

  /* ── projection ─────────────────────────────────────────
     Deliberately the run-rate, not `spent + budget remaining` — that
     expression always collapses to the budget total and tells you nothing.
     The budget is surfaced separately as the target the projection is
     measured against.                                          */
  const projection = runRate;
  const projectionBasis = 'run-rate';
  const unbudgeted = budget ? round2(Math.max(0, total - budget.total.spent)) : 0;

  /* ── category MoM table ────────────────────────────────── */
  const names = new Set([...catNow.keys(), ...prevCatTotals.keys(), ...prevCatTotalsFull.keys()]);
  const categories = [...names].map(name => {
    const now = catNow.get(name) || 0;
    const same = prevCatTotals.get(name) || 0;
    const full = prevCatTotalsFull.get(name) || 0;
    const d = round2(now - same);
    return {
      name,
      now,
      same,
      full,
      delta: d,
      deltaPct: same > 0 ? (d / same) * 100 : (now > 0 ? 100 : 0),
      fullDelta: round2(now - full),
      fullDeltaPct: full > 0 ? ((now - full) / full) * 100 : (now > 0 ? 100 : 0),
      share: total > 0 ? (now / total) * 100 : 0,
      isNew: same <= 0.005 && now > 0,
      isGone: now <= 0.005 && same > 0,
    };
  });
  categories.sort((a, b) => b.now - a.now || b.same - a.same);
  const maxCat = categories.reduce((m, c) => Math.max(m, c.now, c.same), 0) || 1;

  /* ── monthly trend over the long history window ─────────── */
  const N = HISTORY_MONTHS - 1; // index of the reference month within the window
  const spendByMonth = new Float64Array(HISTORY_MONTHS);
  const incomeByMonth = new Float64Array(HISTORY_MONTHS);
  for (const raw of Array.isArray(historyTxns) ? historyTxns : []) {
    const d = parseYmd(raw.date);
    if (Number.isNaN(d.getTime()) || raw.exclude_from_totals) continue;
    if (d > date) continue; // never chart the future
    const idx = (d.getFullYear() - cur.year) * 12 + (d.getMonth() - cur.month) + N;
    if (idx < 0 || idx > N) continue;
    const amt = Math.abs(num(raw.to_base != null && raw.to_base !== '' ? raw.to_base : raw.amount));
    if (raw.is_income) incomeByMonth[idx] += amt;
    else spendByMonth[idx] += amt;
  }

  // trim leading months that have no data at all
  let first = 0;
  while (first < N && spendByMonth[first] === 0 && incomeByMonth[first] === 0) first++;

  const trend = [];
  for (let i = first; i <= N; i++) {
    const d = new Date(cur.year, cur.month - (N - i), 1);
    const sp = round2(spendByMonth[i]);
    const inc = round2(incomeByMonth[i]);
    trend.push({
      key: monthKey(d),
      short: `${MONTH_SHORT[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`,
      full: `${MONTH_LONG[d.getMonth()].slice(0, 3)} ${d.getFullYear()}`,
      month: d.getMonth(),
      year: d.getFullYear(),
      spending: sp,
      income: inc,
      net: round2(inc - sp),
      rate: inc > 0 ? ((inc - sp) / inc) * 100 : null,
      partial: i === N,
    });
  }
  trend.forEach((m, i) => {
    const p = trend[i - 1];
    m.delta = p ? round2(m.spending - p.spending) : 0;
    m.deltaPct = p && p.spending > 0 ? (m.delta / p.spending) * 100 : 0;
  });
  // 3-month trailing average (excluding the in-progress month)
  trend.forEach((m, i) => {
    if (i === trend.length - 1) { m.ma3 = null; return; }
    const w = trend.slice(Math.max(0, i - 2), i + 1).map(x => x.spending);
    m.ma3 = round2(sum(w) / w.length);
  });

  /* ── spend calendar ─────────────────────────────────────── */
  const calendar = buildCalendar(historyTxns, date);

  /* ── transactions ──────────────────────────────────────── */
  const allFull = normalise(fullTxns);
  const txPool = allFull.length >= allCurrent.length ? allFull : allCurrent;
  const transactions = txPool.slice(-400).reverse().map(t => ({
    ts: t.ts,
    day: t.day,
    dateLabel: `${MONTH_SHORT[t.date.getMonth()]} ${String(t.day).padStart(2, '0')}`,
    payee: t.payee || '(no payee)',
    category: t.category,
    amount: round2(t.amount),
    isIncome: t.isIncome,
    excluded: t.excluded,
  }));

  /* ── "actual future" line: only meaningful when inspecting a past date ── */
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const isToday = date.getTime() === today.getTime();
  let future = [];
  if (!isToday && date < today) {
    const futureTxns = allFull.filter(t => isSpend(t) && t.day > elapsed);
    if (futureTxns.length && total > 0) {
      const cum = cumulativeByDay(txPool.filter(isSpend), cur.days);
      future = toPoints(cum, i => i + 1).filter(p => p.x > elapsed);
      if (future.length) future.unshift({ x: elapsed, y: round2(total) });
    }
  }

  /* ── net worth ─────────────────────────────────────────── */
  const netWorth = buildNetWorth(assets, plaid, trend);

  const rate = income > 0 ? ((income - total) / income) * 100 : null;

  return {
    date,
    dateStr: ymd(date),
    month: cur,
    prevMonth: prev,
    elapsed,
    remainingDays,
    progress: (elapsed / cur.days) * 100,
    eqDay,
    eqDate: new Date(prev.year, prev.month, eqDay),
    isCurrentMonth: date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth(),
    isToday,

    total,
    income,
    net: round2(income - total),
    rate,
    prevSameTotal,
    prevTotal,
    delta,
    deltaPct,

    dailyAvg: round2(dailyAvg),
    projectedPerDay: remainingDays > 0 ? round2((projection - total) / remainingDays) : 0,
    runRate,
    projection,
    projectionBasis,
    projectionVsPrev: round2(projection - prevTotal),
    projectionVsPrevPct: prevTotal > 0 ? ((projection - prevTotal) / prevTotal) * 100 : 0,
    projectionVsBudget: budget ? round2(projection - budget.total.budget) : null,
    unbudgetedSpend: unbudgeted,

    paceSeries: paceLineSeries,
    currentSeries,
    priorSeries: prevSeries,
    priorNormalized: toPoints(prevSeries, i => (i + 1) * (cur.days / prev.days)),
    currentPoints: toPoints(currentSeries.slice(0, elapsed), i => i + 1),
    future,

    categories,
    maxCat,
    budget,
    trend,
    calendar,
    netWorth,
    transactions,
    txCategoryCount: new Set(transactions.map(t => t.category)).size,
  };
}