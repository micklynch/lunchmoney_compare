// Small, dependency-free helpers shared across the app.

export const clamp = (n, a, b) => Math.min(Math.max(n, a), b);

export const sum = (arr, f = x => x) => {
  let t = 0;
  for (let i = 0; i < arr.length; i++) t += f(arr[i], i) || 0;
  return t;
};

export function groupBy(arr, keyFn) {
  const m = new Map();
  for (const item of arr) {
    const k = keyFn(item);
    let bucket = m.get(k);
    if (!bucket) m.set(k, (bucket = []));
    bucket.push(item);
  }
  return m;
}

export function debounce(fn, ms = 120) {
  let t = 0;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export function rafThrottle(fn) {
  let queued = false;
  let lastArgs;
  return (...args) => {
    lastArgs = args;
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      fn(...lastArgs);
    });
  };
}

export const idle = (fn, timeout = 400) =>
  window.requestIdleCallback
    ? window.requestIdleCallback(fn, { timeout })
    : setTimeout(fn, 1);

export const prefersReducedMotion = () =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const num = v => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

export const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * How much history the dashboard pulls. The reference month and the month
 * before it are fetched separately (small, per-month requests); everything
 * else — trend, net worth, calendar — comes from this one long window, which
 * is anchored on today so it stays identical as you step through months and
 * therefore always hits the client cache.
 */
export const HISTORY_MONTHS = 36;

/** GitHub-style calendar span. */
export const CALENDAR_WEEKS = 52;

/** Escape untrusted text before it goes into innerHTML. */
export function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}