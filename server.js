import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import axios from 'axios';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(cors());

const LM_API_KEY = process.env.LM_API_KEY;
const LM_HOSTNAME = process.env.LM_HOSTNAME;

if (!LM_API_KEY || !LM_HOSTNAME) {
  console.error('Missing LM_API_KEY or LM_HOSTNAME in .env');
  process.exit(1);
}

/**
 * Upstream facts that shape this file:
 *  • GET /v1/transactions defaults to a **1000-row page** and silently
 *    truncates longer ranges — a 12-month request came back with only the
 *    newest 1000 transactions, quietly mangling the oldest months of the trend
 *    and the net-worth history.
 *  • The real cap is the rate limit: `x-ratelimit-limit: 100` requests per
 *    window. Naive pagination burns it fast, so we ask for large pages, space
 *    them out, back off on 429, and cache responses in-process.
 */
const PAGE_SIZE = 2000;
const MAX_ROWS = 30000;
const PAGE_GAP_MS = 140;   // polite pause between pages
const RETRY_LIMIT = 4;

const CACHE_TTL = {
  // Deep history is expensive (several upstream pages), so keep it warm.
  transactions: 30 * 60 * 1000,
  assets: 15 * 60 * 1000,
  plaid: 15 * 60 * 1000,
  budgets: 5 * 60 * 1000,
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** In-process response cache — the API key stays server-side and repeat loads are free. */
const cache = new Map();
function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expires) { cache.delete(key); return null; }
  cache.delete(key);
  cache.set(key, hit); // LRU bump
  return hit.data;
}
function cacheSet(key, data, ttl) {
  cache.set(key, { data, expires: Date.now() + ttl });
  while (cache.size > 60) cache.delete(cache.keys().next().value);
}

/**
 * Only these fields are used by the dashboard. The raw Lunchmoney payload is
 * ~30 fields per transaction (notes, recurring rules, plaid ids, audit stamps);
 * projecting them server-side shrinks a 12-month response by roughly 8×, which
 * is what makes deep history affordable to cache in the browser.
 */
const TX_FIELDS = [
  'id', 'date', 'amount', 'to_base', 'currency',
  'payee', 'category_name',
  'is_income', 'exclude_from_totals', 'exclude_from_budget', 'status',
];

const pick = tx => {
  const o = {};
  for (const k of TX_FIELDS) if (tx[k] !== undefined) o[k] = tx[k];
  return o;
};

/** One upstream GET with 429-aware backoff. */
async function lmGet(path, params = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await axios.get(`${LM_HOSTNAME}${path}`, {
        headers: { Authorization: `Bearer ${LM_API_KEY}` },
        params,
        timeout: 30000,
      }).then(r => r.data);
    } catch (err) {
      const status = err.response?.status;
      if (status !== 429 || attempt >= RETRY_LIMIT) {
        const e = new Error(err.response?.data?.error || err.message);
        e.status = status || 500;
        throw e;
      }
      // honour the server's reset hint when it gives us one
      const reset = Number(err.response?.headers?.['x-ratelimit-reset']);
      const secs = Number.isFinite(reset) && reset > Date.now() / 1000
        ? Math.min(30, reset - Date.now() / 1000)
        : Math.min(30, 2 ** attempt);
      console.warn(`[api] 429 from Lunchmoney — retrying in ${secs.toFixed(1)}s (attempt ${attempt + 1}/${RETRY_LIMIT})`);
      await sleep(secs * 1000 + 250);
    }
  }
}

function sendError(res, err) {
  res.status(err.status || 500).json({ error: err.message || 'proxy error' });
}

async function proxyLM(res, path, params = {}, ttl = 0) {
  try {
    const key = path + ':' + JSON.stringify(params);
    const hit = ttl ? cacheGet(key) : null;
    if (hit) return res.json(hit);
    const data = await lmGet(path, params);
    if (ttl) cacheSet(key, data, ttl);
    res.json(data);
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * GET /v1/transactions is capped upstream (1000 rows per call, ordered most
 * recent first) and *silently* truncates long ranges — a 12-month request came
 * back with only the newest ~1000 transactions, which quietly mangled the
 * oldest months of the trend and net-worth history. Walk the pages instead.
 */
async function fetchAllTransactions(start_date, end_date) {
  const out = [];
  let offset = 0;
  let truncated = false;

  for (;;) {
    const params = { start_date, end_date, limit: PAGE_SIZE, offset };
    const key = 'tx:' + JSON.stringify(params);
    let data = cacheGet(key);
    if (!data) {
      data = await lmGet('/v1/transactions', params);
      cacheSet(key, data, CACHE_TTL.transactions);
      if (offset > 0) await sleep(PAGE_GAP_MS);
    }

    const page = Array.isArray(data.transactions) ? data.transactions : [];
    for (const tx of page) out.push(pick(tx));

    if (!data.has_more || page.length === 0) break;
    offset += page.length;
    if (out.length >= MAX_ROWS) {
      truncated = true;
      out.length = MAX_ROWS;
      break;
    }
  }

  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (truncated) {
    console.warn(`[api] /transactions ${start_date}..${end_date} hit the ${MAX_ROWS}-row ceiling — history is incomplete`);
  }
  return { transactions: out, count: out.length, truncated };
}

app.get('/api/transactions', async (req, res) => {
  const { start_date, end_date } = req.query;
  if (!start_date || !end_date) {
    return res.status(400).json({ error: 'start_date and end_date required' });
  }
  try {
    res.json(await fetchAllTransactions(start_date, end_date));
  } catch (err) {
    sendError(res, err);
  }
});

app.get('/api/assets', async (req, res) => {
  await proxyLM(res, '/v1/assets', {}, CACHE_TTL.assets);
});

app.get('/api/plaid_accounts', async (req, res) => {
  await proxyLM(res, '/v1/plaid_accounts', {}, CACHE_TTL.plaid);
});

app.get('/api/budgets', async (req, res) => {
  const { start_date, end_date } = req.query;
  if (!start_date || !end_date) {
    return res.status(400).json({ error: 'start_date and end_date required' });
  }
  await proxyLM(res, '/v1/budgets', { start_date, end_date }, CACHE_TTL.budgets);
});

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, 'dist')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
  });
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});