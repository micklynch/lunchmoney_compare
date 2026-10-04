// Currency / number formatting. All money is rendered with a real minus sign
// (U+2212) so columns line up nicely in the mono font.

/** true minus sign — aligns columns in the mono font */
export const MINUS = '−';

const _n2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const _n0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const _n1 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** $1,234.56 */
export function money(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  return (n < -0.004 ? MINUS : '') + '$' + _n2.format(Math.abs(n));
}

/** +$1,234.56 / −$1,234.56 */
export function signedMoney(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  return (n >= 0.004 ? '+' : MINUS) + '$' + _n2.format(Math.abs(n));
}

/** $12.3k — for axis ticks and dense chips */
export function compactMoney(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  const a = Math.abs(n);
  const sign = n < 0 ? MINUS : '';
  if (a >= 1e6) return sign + '$' + (a >= 1e7 ? (a / 1e6).toFixed(0) : (a / 1e6).toFixed(1)) + 'M';
  if (a >= 1e4) return sign + '$' + (a / 1e3).toFixed(0) + 'k';
  if (a >= 1e3) return sign + '$' + (a / 1e3).toFixed(1) + 'k';
  return sign + '$' + _n0.format(a);
}

export function signedCompactMoney(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  const a = Math.abs(n);
  const sign = n < 0 ? MINUS : '+';
  if (a >= 1e6) return sign + '$' + (a / 1e6).toFixed(1) + 'M';
  if (a >= 1e4) return sign + '$' + (a / 1e3).toFixed(0) + 'k';
  if (a >= 1e3) return sign + '$' + (a / 1e3).toFixed(1) + 'k';
  return sign + '$' + _n0.format(a);
}

/** +12.3% / −4.0% (always signed, for delta chips) */
export function signedPct(n, digits = 1) {
  if (n == null || !Number.isFinite(n)) return '—';
  if (Math.abs(n) < 0.05) return '0.0%';
  return (n > 0 ? '+' : MINUS) + Math.abs(n).toFixed(digits) + '%';
}

/** 12.3% (unsigned, for ratios like savings rate / budget used) */
export function pct(n, digits = 1) {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toFixed(digits) + '%';
}

export const int = n => _n0.format(Math.round(n || 0));

/**
 * Semantic tone for a delta.
 * polarity 'spend' → going up is bad (spending more)
 * polarity 'gain'  → going up is good (income, net worth)
 */
export function tone(delta, polarity = 'spend') {
  const EPS = 0.005;
  if (delta == null || !Number.isFinite(delta) || Math.abs(delta) < EPS) return 'flat';
  const up = delta > 0;
  return (polarity === 'gain') === up ? 'good' : 'bad';
}

/** Short weekday / month helpers */
export const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

export function relTime(ts) {
  if (!ts) return 'never';
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}