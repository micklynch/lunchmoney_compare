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

async function proxyLM(res, path, params = {}) {
  try {
    const response = await axios.get(`${LM_HOSTNAME}${path}`, {
      headers: { Authorization: `Bearer ${LM_API_KEY}` },
      params
    });
    res.json(response.data);
  } catch (err) {
    const status = err.response?.status || 500;
    const msg = err.response?.data?.error || err.message;
    res.status(status).json({ error: msg });
  }
}

app.get('/api/transactions', async (req, res) => {
  const { start_date, end_date } = req.query;
  if (!start_date || !end_date) {
    return res.status(400).json({ error: 'start_date and end_date required' });
  }
  await proxyLM(res, '/v1/transactions', { start_date, end_date });
});

app.get('/api/assets', async (req, res) => {
  await proxyLM(res, '/v1/assets');
});

app.get('/api/plaid_accounts', async (req, res) => {
  await proxyLM(res, '/v1/plaid_accounts');
});

app.get('/api/budgets', async (req, res) => {
  const { start_date, end_date } = req.query;
  if (!start_date || !end_date) {
    return res.status(400).json({ error: 'start_date and end_date required' });
  }
  await proxyLM(res, '/v1/budgets', { start_date, end_date });
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
