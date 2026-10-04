// Thin fetch layer over the Express proxy with a two-tier cache:
//   1. in-memory Map  — instant on re-render / theme toggles / month stepping
//   2. sessionStorage  — survives reloads within the same tab session
// A cache-busting refresh wipes both so the user always has an escape hatch.

const NS = 'lm.dash.v4:';
const TTL_MS = 20 * 60 * 1000;
const MAX_ENTRIES = 80;

const mem = new Map();
let lsOk = true;
try {
  sessionStorage.setItem(NS + 'probe', '1');
  sessionStorage.removeItem(NS + 'probe');
} catch (_) {
  lsOk = false;
}

let keys = [];
try {
  keys = JSON.parse(sessionStorage.getItem(NS + 'keys') || '[]');
} catch (_) {
  keys = [];
}

function persistKeys() {
  if (!lsOk) return;
  try {
    sessionStorage.setItem(NS + 'keys', JSON.stringify(keys.slice(-MAX_ENTRIES)));
  } catch (_) {
    lsOk = false;
  }
}

function readStored(key) {
  if (!lsOk) return null;
  try {
    const raw = sessionStorage.getItem(NS + key);
    if (!raw) return null;
    const rec = JSON.parse(raw);
    if (!rec || Date.now() - rec.t > TTL_MS) {
      sessionStorage.removeItem(NS + key);
      return null;
    }
    return rec.d;
  } catch (_) {
    return null;
  }
}

function writeStored(key, data) {
  if (!lsOk) return;
  try {
    sessionStorage.setItem(NS + key, JSON.stringify({ t: Date.now(), d: data }));
    if (!keys.includes(key)) keys.push(key);
    while (keys.length > MAX_ENTRIES) {
      const drop = keys.shift();
      try { sessionStorage.removeItem(NS + drop); } catch (_) {}
    }
    persistKeys();
  } catch (_) {
    // Quota exceeded — drop everything and carry on in memory only.
    try { sessionStorage.clear(); } catch (_) {}
    lsOk = false;
  }
}

async function request(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    let msg = res.statusText || `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body && body.error) msg = body.error;
    } catch (_) {}
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/** Cached GET. Throws on failure. */
export async function getJSON(url) {
  if (mem.has(url)) {
    const v = mem.get(url);
    mem.delete(url);
    mem.set(url, v); // LRU bump
    return v;
  }
  const stored = readStored(url);
  if (stored !== null) {
    mem.set(url, stored);
    return stored;
  }
  const data = await request(url);
  mem.set(url, data);
  writeStored(url, data);
  return data;
}

/** Cached GET that resolves to null instead of throwing. */
export async function getJSONSafe(url) {
  try {
    return await getJSON(url);
  } catch (_) {
    return null;
  }
}

export function invalidateAll() {
  mem.clear();
  keys = [];
  if (!lsOk) return;
  try {
    for (const k of Object.keys(sessionStorage)) {
      if (k.startsWith(NS)) sessionStorage.removeItem(k);
    }
  } catch (_) {}
}

/* ── typed endpoints ─────────────────────────────────── */

const qs = params => new URLSearchParams(params).toString();

export function fetchTransactions(startDate, endDate) {
  return getJSON(`/api/transactions?${qs({ start_date: startDate, end_date: endDate })}`)
    .then(d => (Array.isArray(d.transactions) ? d.transactions : []));
}

export function fetchBudgets(startDate, endDate) {
  return getJSON(`/api/budgets?${qs({ start_date: startDate, end_date: endDate })}`)
    .then(d => d || null)
    .catch(() => null);
}

export const fetchAssets = () => getJSONSafe('/api/assets');
export const fetchPlaidAccounts = () => getJSONSafe('/api/plaid_accounts');