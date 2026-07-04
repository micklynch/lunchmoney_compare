from dotenv import load_dotenv
import os
import requests
import math
import json
import pandas as pd
import matplotlib.pyplot as plt
from matplotlib.ticker import FuncFormatter
import sys
import argparse

# Load the .env file
load_dotenv()

# Get the value of the 'LM_API' environmental variable
lm_api = os.getenv('LM_API_KEY')
lm_hostname = os.getenv('LM_HOSTNAME')

# Set the headers for the request
headers = {
    "Authorization": f"Bearer {lm_api}"
}

# Create an ArgumentParser object
parser = argparse.ArgumentParser(description="Compare spending with the previous month.")
# Add an optional argument --date (or -d) that accepts a string
parser.add_argument("--date", "-d", type=str, help="Specify a date in YYYY-MM-DD format.")
# Parse the arguments
args = parser.parse_args()

# Process the date argument
if args.date:
    try:
        input_date = pd.to_datetime(args.date)
    except ValueError:
        print("Error: Invalid date format. Please use YYYY-MM-DD.")
        sys.exit(1)
else:
    input_date = pd.to_datetime('today')

def calculate_date_boundaries(current_date: pd.Timestamp) -> tuple[pd.Timestamp, pd.Timestamp, pd.Timestamp]:
    """
    Calculates key date boundaries based on the provided current_date.

    Args:
        current_date: The reference date (pandas Timestamp).

    Returns:
        A tuple containing:
            - start_of_this_month (pandas Timestamp)
            - end_of_previous_month (pandas Timestamp)
            - start_of_previous_month (pandas Timestamp)
    """
    start_of_this_month = current_date.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    end_of_previous_month = start_of_this_month - pd.Timedelta(days=1)
    start_of_previous_month = end_of_previous_month.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    return start_of_this_month, end_of_previous_month, start_of_previous_month

# Calculate key date boundaries using the new function
start_of_this_month, end_of_previous_month, start_of_previous_month = calculate_date_boundaries(input_date)

# Define API URL
api_url = f"{lm_hostname}/v1/transactions"

def get_transactions_df(start_date_str: str, end_date_str: str, hostname: str, request_headers: dict) -> pd.DataFrame:
    """
    Fetches transactions from the API for a given date range and processes them into a DataFrame.

    Args:
        start_date_str: The start date for transactions (YYYY-MM-DD).
        end_date_str: The end date for transactions (YYYY-MM-DD).
        hostname: The base URL of the API.
        request_headers: Headers to include in the API request.

    Returns:
        A pandas DataFrame containing the processed transaction data.
        Exits the script if no transactions are found or if there's an API error.
    """
    params = {
        "start_date": start_date_str,
        "end_date": end_date_str
    }
    response = requests.get(f"{hostname}/v1/transactions", headers=request_headers, params=params)
    response.raise_for_status() # Raises an exception for HTTP errors (4xx or 5xx)

    transactions_data = response.json().get('transactions')
    if not transactions_data: # Checks for None or empty list
        print(f"No transaction data found between {start_date_str} and {end_date_str}.")
        # Depending on requirements, might return empty DF instead of exiting:
        # return pd.DataFrame()
        sys.exit()

    df = pd.DataFrame(transactions_data)

    # Format the date, amount, and other flags
    df['date'] = pd.to_datetime(df['date'], format='%Y-%m-%d')
    df['amount'] = df['amount'].astype(float)
    df['exclude_from_totals'] = df['exclude_from_totals'].astype(bool)
    df['is_income'] = df['is_income'].astype(bool)

    # Remove items that are income or flagged to remove from totals
    df = df[(df["exclude_from_totals"] == False) & (df['is_income'] == False)]
    return df

###
# Get this month's transactions
###
current_month_start_str = start_of_this_month.strftime('%Y-%m-%d')
current_month_end_str = (input_date + pd.Timedelta(days=1)).strftime('%Y-%m-%d') # Includes all of input_date
current_month_df = get_transactions_df(current_month_start_str, current_month_end_str, lm_hostname, headers)
# Filter to ensure we don't include transactions from the next month (due to +1 day in end_str)
if not current_month_df.empty:
    # Ensure we compare normalized dates (though current_month_df['date'] is already normalized)
    # Use a normalized input_date for comparison to avoid issues if input_date has time (e.g. 'today')
    # But wait, if input_date is 'today', we want to include today's transactions.
    # current_month_df['date'] is 00:00:00.
    # If input_date is today (with time), df['date'] <= input_date is True for today.
    # If input_date is args.date (00:00:00), df['date'] <= input_date is True for that date.
    # So direct comparison is safe.
    current_month_df = current_month_df[current_month_df['date'] <= input_date]

###
# Get last month's transactions
###
previous_month_start_str = start_of_previous_month.strftime('%Y-%m-%d')
previous_month_end_str = end_of_previous_month.strftime('%Y-%m-%d')
last_month_df = get_transactions_df(previous_month_start_str, previous_month_end_str, lm_hostname, headers)


# --- Prepare data for "future" spending line (all transactions in current month) ---
end_of_current_month_for_plot = input_date.replace(day=1) + pd.offsets.MonthEnd(0)
full_current_month_df = pd.DataFrame() # Initialize as empty
# Only fetch if the end_of_current_month_for_plot is actually after input_date's effective range for current_month_df
if end_of_current_month_for_plot.strftime('%Y-%m-%d') >= current_month_end_str: # Compare string dates
    # Fetch all transactions from the start of the month to the actual end of the month
    full_current_month_df = get_transactions_df(
        current_month_start_str, # already defined: start_of_this_month.strftime('%Y-%m-%d')
        (end_of_current_month_for_plot + pd.Timedelta(days=1)).strftime('%Y-%m-%d'), # include last day
        lm_hostname,
        headers
    )
    # Filter to ensure we don't include transactions from the next month
    if not full_current_month_df.empty:
        full_current_month_df = full_current_month_df[full_current_month_df['date'] <= end_of_current_month_for_plot]

if not full_current_month_df.empty:
    full_current_month_df.sort_values(by='date', inplace=True) # ensure correct order for cumsum
    full_current_month_df['cumulative'] = full_current_month_df['amount'].cumsum()
    full_current_month_df['day'] = full_current_month_df['date'].dt.day


# Calculate cumulative amounts at the end of each day for the primary DFs
# Ensure dataframes are not empty before attempting cumsum
if not last_month_df.empty:
    last_month_df.sort_values(by='date', inplace=True) # ensure correct order for cumsum
    last_month_df['cumulative'] = last_month_df['amount'].cumsum()
else:
    last_month_df['cumulative'] = 0 # Or handle as per requirements for empty df

if not current_month_df.empty:
    current_month_df.sort_values(by='date', inplace=True) # ensure correct order for cumsum
    current_month_df['cumulative'] = current_month_df['amount'].cumsum()
else:
    current_month_df['cumulative'] = 0 # Or handle as per requirements

# Create a new column for the day of the month
if not last_month_df.empty:
    # 'day' column already added in get_transactions_df if we decide to move it there
    # For now, adding it here after cumsum if it wasn't added before.
    # However, 'date' is needed for sort_values, so 'day' should be added after sorting and cumsum.
    last_month_df['day'] = last_month_df['date'].dt.day
else:
    last_month_df['day'] = None # Or handle as per requirements

if not current_month_df.empty:
    current_month_df['day'] = current_month_df['date'].dt.day
else:
    current_month_df['day'] = None # Or handle as per requirements


# Find the nearest available day in the last month
def find_nearest_available_day(df, target_day):
    # Find the nearest available day or fallback to the previous day.
    # Ensure the DataFrame is not empty and has 'day' column.
    if df.empty or 'day' not in df.columns or df['day'].isnull().all():
        return None # Or a default value like 1, or raise an error
    available_days = df['day'].dropna().unique()
    if not available_days.size:
        return None # No available days
    nearest_day = min(available_days, key=lambda x: abs(x - target_day)) # Ensure available_days is not empty
    return nearest_day

_DASHBOARD_HTML = r'''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>spending dashboard</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
:root {
  --bg: #050505;
  --surface: #0b0b0b;
  --border: #191919;
  --border-faint: rgba(25,25,25,0.55);
  --accent: #00e5c4;
  --text: #bebebe;
  --text-dim: #343434;
  --text-mid: #585858;
  --text-bright: #eeeeee;
  --red: #f87171;
  --green: #34d399;
  --blue: #60a5fa;
}
body.light {
  --bg: #f8f8f8;
  --surface: #ffffff;
  --border: #e0e0e0;
  --border-faint: rgba(0,0,0,0.07);
  --accent: #00866e;
  --text: #5c5c5c;
  --text-dim: #b0b0b0;
  --text-mid: #888888;
  --text-bright: #1a1a1a;
  --red: #e03131;
  --green: #0d8a4e;
  --blue: #2563eb;
}
html, body {
  background: var(--bg);
  color: var(--text);
  font-family: 'JetBrains Mono', 'IBM Plex Mono', 'Fira Code', 'SF Mono', 'Consolas', monospace;
  font-size: 12px;
  line-height: 1.65;
}
body { max-width: 1280px; margin: 0 auto; padding: 52px 44px; }
header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  border-bottom: 1px solid var(--border);
  padding-bottom: 18px;
  margin-bottom: 48px;
}
.hd-wordmark { font-size: 11px; text-transform: uppercase; letter-spacing: .2em; color: var(--text-dim); }
.hd-date { font-size: 11px; color: var(--text-mid); }
.stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 1px;
  background: var(--border);
  border: 1px solid var(--border);
  margin-bottom: 48px;
}
.stat { background: var(--surface); padding: 28px 24px; }
.stat-lbl { font-size: 10px; text-transform: uppercase; letter-spacing: .15em; color: var(--text-dim); margin-bottom: 14px; }
.stat-val { font-size: 27px; color: var(--text-bright); letter-spacing: -.025em; line-height: 1; margin-bottom: 6px; font-variant-numeric: tabular-nums; }
.stat-val.up { color: var(--red); }
.stat-val.dn { color: var(--green); }
.stat-sub { font-size: 10px; color: var(--text-mid); }
.sec { margin-bottom: 48px; }
.sec-hd {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 20px;
}
.sec-title { font-size: 10px; text-transform: uppercase; letter-spacing: .15em; color: var(--accent); }
.sec-meta { font-size: 10px; color: var(--text-dim); }
.chart-box {
  background: var(--surface);
  border: 1px solid var(--border);
  padding: 24px 24px 18px;
  height: 310px;
  position: relative;
}
.two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 32px; margin-bottom: 48px; }
.bar-row { margin-bottom: 12px; }
.bar-row-hd { display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 5px; gap: 8px; }
.bar-row-name { color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bar-row-amt { color: var(--text-bright); font-variant-numeric: tabular-nums; flex-shrink: 0; }
.bar-track { height: 1px; background: var(--border); }
.bar-fill { height: 1px; background: var(--accent); }
.data-table { width: 100%; border-collapse: collapse; }
.data-table th {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: .12em;
  color: var(--text-dim);
  font-weight: 400;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  text-align: left;
}
.data-table td { padding: 7px 12px; border-bottom: 1px solid var(--border-faint); color: var(--text); }
.data-table tr:last-child td { border-bottom: none; }
.data-table .r { text-align: right; color: var(--text-bright); font-variant-numeric: tabular-nums; }
.data-table .dim { color: var(--text-mid); }
.data-table .trunc { max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.data-table th.sortable { cursor: pointer; user-select: none; }
.data-table th.sortable:hover { color: var(--text-mid); }
.sort-ind { color: var(--accent); }
.pace-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 1px;
  background: var(--border);
  border: 1px solid var(--border);
}
.pace-card { background: var(--surface); padding: 22px 24px; }
.pace-lbl { font-size: 10px; text-transform: uppercase; letter-spacing: .13em; color: var(--text-dim); margin-bottom: 10px; }
.pace-val { font-size: 18px; color: var(--text-bright); font-variant-numeric: tabular-nums; }
.pace-sub { font-size: 10px; color: var(--text-mid); margin-top: 5px; }
.prog-track { height: 1px; background: var(--border); margin-top: 10px; }
.prog-fill { height: 1px; background: var(--accent); }
footer {
  margin-top: 64px;
  padding-top: 16px;
  border-top: 1px solid var(--border);
  display: flex;
  justify-content: space-between;
  color: var(--text-dim);
  font-size: 10px;
}
</style>
</head>
<body>

<header>
  <span class="hd-wordmark">spending dashboard</span>
  <span style="display:flex;align-items:center;gap:16px;">
    <button id="theme-toggle" title="Toggle light/dark mode" style="background:none;border:1px solid var(--border);color:var(--text-mid);cursor:pointer;font-size:13px;padding:2px 8px;border-radius:3px;font-family:inherit;line-height:1.7;">◐</button>
    <span class="hd-date" id="hd-date"></span>
  </span>
</header>

<div class="stats">
  <div class="stat">
    <div class="stat-lbl">this month</div>
    <div class="stat-val" id="s-cur"></div>
    <div class="stat-sub" id="s-cur-sub"></div>
  </div>
  <div class="stat">
    <div class="stat-lbl">last month · equivalent</div>
    <div class="stat-val" id="s-leq"></div>
    <div class="stat-sub" id="s-leq-sub"></div>
  </div>
  <div class="stat">
    <div class="stat-lbl">vs last month</div>
    <div class="stat-val" id="s-diff"></div>
    <div class="stat-sub" id="s-diff-sub"></div>
  </div>
  <div class="stat">
    <div class="stat-lbl">last month · total</div>
    <div class="stat-val" id="s-ltot"></div>
    <div class="stat-sub" id="s-ltot-sub"></div>
  </div>
</div>

<div class="sec">
  <div class="sec-hd">
    <span class="sec-title">cumulative spending</span>
    <span class="sec-meta" id="chart-meta"></span>
  </div>
  <div class="chart-box">
    <canvas id="cumulative-chart"></canvas>
  </div>
</div>

<div class="two-col">
  <div class="sec">
    <div class="sec-hd">
      <span class="sec-title">daily totals</span>
      <span class="sec-meta">this month · top days</span>
    </div>
    <div id="daily-bars"></div>
  </div>
  <div class="sec">
    <div class="sec-hd">
      <span class="sec-title">by category</span>
      <span class="sec-meta">this month</span>
    </div>
    <div id="cat-bars"></div>
  </div>
</div>

<div class="sec">
  <div class="sec-hd">
    <span class="sec-title">transactions</span>
    <span class="sec-meta" id="txn-meta">this month</span>
  </div>
  <table class="data-table">
    <thead>
      <tr>
        <th class="sortable" onclick="sortTable('date')">date<span class="sort-ind" id="sort-date"> ↓</span></th>
        <th class="sortable" onclick="sortTable('payee')">payee<span class="sort-ind" id="sort-payee"></span></th>
        <th class="sortable" onclick="sortTable('category')">category<span class="sort-ind" id="sort-category"></span></th>
        <th class="sortable" style="text-align:right" onclick="sortTable('amount')">amount<span class="sort-ind" id="sort-amount"></span></th>
      </tr>
    </thead>
    <tbody id="txn-body"></tbody>
  </table>
</div>

<div class="sec">
  <div class="sec-hd"><span class="sec-title">pace &amp; projection</span></div>
  <div class="pace-grid">
    <div class="pace-card">
      <div class="pace-lbl">avg / day</div>
      <div class="pace-val" id="p-avg"></div>
    </div>
    <div class="pace-card">
      <div class="pace-lbl">projected total</div>
      <div class="pace-val" id="p-proj"></div>
      <div class="pace-sub" id="p-proj-sub"></div>
      <div class="prog-track"><div class="prog-fill" id="p-proj-bar"></div></div>
    </div>
    <div class="pace-card">
      <div class="pace-lbl">month progress</div>
      <div class="pace-val" id="p-prog"></div>
      <div class="prog-track"><div class="prog-fill" id="p-prog-bar"></div></div>
    </div>
    <div class="pace-card">
      <div class="pace-lbl">days remaining</div>
      <div class="pace-val" id="p-rem"></div>
      <div class="pace-sub" id="p-rem-sub"></div>
    </div>
  </div>
</div>

<footer>
  <span>lunchmoney · spending comparison</span>
  <span id="ft-date"></span>
</footer>

<script>
const D = __DATA_JSON__;

// ── Helpers ─────────────────────────────────────────
const $ = id => document.getElementById(id);
const fmt = n => '$' + n.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
const fmtDiff = n => (n >= 0 ? '+$' : '−$') + Math.abs(n).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
const fmtK = n => n >= 1000 ? '$' + (n / 1000).toFixed(1) + 'k' : fmt(n);
const clamp = (n, a, b) => Math.min(Math.max(n, a), b);

// ── Theme ────────────────────────────────────────────
const THEME_KEY = 'lm-dashboard-theme';
function getTheme() {
  try {
    const s = localStorage.getItem(THEME_KEY);
    if (s === 'light' || s === 'dark') return s;
  } catch (_) {}
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}
let currentTheme = getTheme();
function applyTheme(t) {
  currentTheme = t;
  document.body.classList.toggle('light', t === 'light');
  try { localStorage.setItem(THEME_KEY, t); } catch (_) {}
}
applyTheme(currentTheme);

$('hd-date').textContent = D.summary.date;
$('ft-date').textContent = 'generated ' + D.summary.date;
$('chart-meta').textContent = D.summary.monthName;

// Stats
$('s-cur').textContent = fmt(D.summary.currentMonthTotal);
$('s-cur-sub').textContent = D.summary.daysElapsed + ' of ' + D.summary.daysInMonth + ' days';
$('s-leq').textContent = fmt(D.summary.lastMonthEquivalent);
$('s-leq-sub').textContent = 'proportional equivalent';
const dEl = $('s-diff');
const isUp = D.summary.difference > 0;
dEl.textContent = fmtDiff(D.summary.difference);
dEl.className = 'stat-val ' + (isUp ? 'up' : 'dn');
$('s-diff-sub').textContent = (isUp ? '+' : '') + D.summary.percentDiff.toFixed(1) + '% vs last month';
$('s-ltot').textContent = fmt(D.summary.lastMonthTotal);
$('s-ltot-sub').textContent = 'full month';

// Chart
function buildChart() {
  const L = currentTheme === 'light';
  const ACCENT = '#00e5c4';
  const LAST_C = '#3b82f6';
  const gridC   = L ? 'rgba(0,0,0,0.08)' : 'rgba(25,25,25,0.95)';
  const tickC   = L ? '#a3a3a3'         : '#343434';
  const axisC   = L ? '#d4d4d4'         : '#191919';
  const legendC = L ? '#888888'         : '#585858';
  const ttBg    = L ? '#ffffff'         : '#0b0b0b';
  const ttBdr   = L ? '#d4d4d4'         : '#191919';
  const ttTitle = L ? '#888888'         : '#585858';
  const ttBody  = L ? '#525252'         : '#bebebe';

  // Destroy previous chart instance if it exists
  const prev = Chart.getChart('cumulative-chart');
  if (prev) prev.destroy();

  const chartCtx = $('cumulative-chart').getContext('2d');
  const chartDatasets = [
    {
      label: 'last month',
      data: D.lastMonthChart,
      borderColor: LAST_C,
      backgroundColor: 'rgba(59,130,246,0.05)',
      borderWidth: 1.5,
      pointRadius: 2,
      pointHoverRadius: 4,
      fill: true,
      tension: 0.35,
    },
    {
      label: 'this month',
      data: D.currentMonthChart,
      borderColor: ACCENT,
      backgroundColor: 'rgba(0,229,196,0.06)',
      borderWidth: 2,
      pointRadius: 3,
      pointHoverRadius: 5,
      fill: true,
      tension: 0.35,
    },
  ];
  if (D.futureChart && D.futureChart.length > 1) {
    chartDatasets.push({
      label: 'projected',
      data: D.futureChart,
      borderColor: ACCENT,
      backgroundColor: 'transparent',
      borderWidth: 1.5,
      borderDash: [4, 5],
      pointRadius: 0,
      fill: false,
      tension: 0.35,
    });
  }
  new Chart(chartCtx, {
    type: 'line',
    data: { datasets: chartDatasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      parsing: { xAxisKey: 'x', yAxisKey: 'y' },
      interaction: { mode: 'index', intersect: false },
      animation: { duration: 350 },
      plugins: {
        legend: {
          align: 'end',
          labels: {
            color: legendC,
            font: { family: "'JetBrains Mono', monospace", size: 10 },
            boxWidth: 20, padding: 20,
            usePointStyle: true, pointStyle: 'line',
          }
        },
        tooltip: {
          backgroundColor: ttBg,
          borderColor: ttBdr,
          borderWidth: 1,
          titleColor: ttTitle,
          bodyColor: ttBody,
          titleFont: { family: "'JetBrains Mono', monospace", size: 10 },
          bodyFont: { family: "'JetBrains Mono', monospace", size: 11 },
          padding: 12,
          callbacks: {
            title: ctx => 'day ' + ctx[0].parsed.x,
            label: ctx => '  ' + ctx.dataset.label + ': ' + fmt(ctx.parsed.y),
          }
        }
      },
      scales: {
        x: {
          type: 'linear', min: 1, max: 31,
          grid: { color: gridC },
          ticks: { color: tickC, font: { family: "'JetBrains Mono', monospace", size: 10 }, stepSize: 5, maxTicksLimit: 8 },
          border: { color: axisC }
        },
        y: {
          grid: { color: gridC },
          ticks: { color: tickC, font: { family: "'JetBrains Mono', monospace", size: 10 }, callback: v => fmtK(v) },
          border: { color: axisC }
        }
      }
    }
  });
}

buildChart();

// ── Theme toggle ──────────────────────────────────────
$('theme-toggle').addEventListener('click', () => {
  applyTheme(currentTheme === 'dark' ? 'light' : 'dark');
  buildChart();
});

// Bar renderer
function renderBars(containerId, items, limit) {
  const el = $(containerId);
  if (!items || !items.length) {
    el.innerHTML = '<div style="color:var(--text-dim);padding:16px 0">no data</div>';
    return;
  }
  const top = items.slice(0, limit);
  const maxAmt = Math.max(...top.map(i => i.amount));
  top.forEach(item => {
    const w = maxAmt > 0 ? clamp((item.amount / maxAmt) * 100, 0, 100) : 0;
    el.innerHTML += `<div class="bar-row">
      <div class="bar-row-hd">
        <span class="bar-row-name">${item.label}</span>
        <span class="bar-row-amt">${fmt(item.amount)}</span>
      </div>
      <div class="bar-track"><div class="bar-fill" style="width:${w.toFixed(1)}%"></div></div>
    </div>`;
  });
}

renderBars('daily-bars', (D.dailyTotals || []).map(d => ({ label: 'day ' + String(d.day).padStart(2, '0'), amount: d.amount })), 14);
renderBars('cat-bars', (D.categories || []).map(c => ({ label: c.name, amount: c.amount })), 10);

// Transactions table
let txnData = D.recentTransactions ? [...D.recentTransactions] : [];
let txnSortCol = 'date';
let txnSortDir = -1; // -1 desc, 1 asc

function renderTxns() {
  const tbody = $('txn-body');
  if (!txnData.length) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-dim);padding:20px">no transactions</td></tr>';
    return;
  }
  tbody.innerHTML = '';
  txnData.forEach(t => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="dim">${t.date}</td>
      <td class="trunc">${t.payee || '—'}</td>
      <td class="dim trunc">${t.category || '—'}</td>
      <td class="r">${fmt(t.amount)}</td>`;
    tbody.appendChild(tr);
  });
  ['date','payee','category','amount'].forEach(col => {
    const el = $('sort-' + col);
    if (el) el.textContent = col === txnSortCol ? (txnSortDir === -1 ? ' ↓' : ' ↑') : '';
  });
  $('txn-meta').textContent = 'this month · ' + txnData.length + ' transactions';
}

function sortTable(col) {
  if (txnSortCol === col) {
    txnSortDir *= -1;
  } else {
    txnSortCol = col;
    txnSortDir = col === 'amount' ? -1 : 1;
  }
  txnData.sort((a, b) => {
    let av = a[col] ?? '', bv = b[col] ?? '';
    if (col === 'amount') { av = Number(av); bv = Number(bv); }
    else { av = String(av).toLowerCase(); bv = String(bv).toLowerCase(); }
    if (av < bv) return -txnSortDir;
    if (av > bv) return txnSortDir;
    return 0;
  });
  renderTxns();
}

renderTxns();

// Pace
$('p-avg').textContent = fmt(D.summary.avgDaily);
$('p-proj').textContent = fmt(D.summary.projectedTotal);
const vsLast = D.summary.lastMonthTotal > 0
  ? ((D.summary.projectedTotal - D.summary.lastMonthTotal) / D.summary.lastMonthTotal * 100)
  : 0;
$('p-proj-sub').textContent = (vsLast >= 0 ? '+' : '') + vsLast.toFixed(1) + '% vs last month total';
$('p-proj-bar').style.width = clamp(D.summary.lastMonthTotal > 0 ? (D.summary.projectedTotal / D.summary.lastMonthTotal * 100) : 50, 0, 100) + '%';
const progPct = D.summary.daysInMonth > 0 ? D.summary.daysElapsed / D.summary.daysInMonth : 0;
$('p-prog').textContent = (progPct * 100).toFixed(0) + '%';
$('p-prog-bar').style.width = clamp(progPct * 100, 0, 100) + '%';
$('p-rem').textContent = D.summary.daysRemaining;
$('p-rem-sub').textContent = 'of ' + D.summary.daysInMonth + ' days';
</script>
</body>
</html>'''


def generate_html_dashboard(
    input_date: pd.Timestamp,
    this_month_total: float,
    cumulative_amount_on_equivalent_day_last_month_val: float,
    last_month_total_end: float,
    diff: float,
    percent_diff: float,
    current_month_df: pd.DataFrame,
    last_month_df: pd.DataFrame,
    full_current_month_df: pd.DataFrame,
) -> str:
    days_elapsed = input_date.day
    days_in_month = input_date.days_in_month
    days_remaining = days_in_month - days_elapsed
    avg_daily = this_month_total / days_elapsed if days_elapsed > 0 else 0
    projected_total = avg_daily * days_in_month

    current_chart = []
    if not current_month_df.empty and 'day' in current_month_df.columns and 'cumulative' in current_month_df.columns:
        # Group by day, take the final cumulative (max per day) to avoid vertical segments
        day_groups = current_month_df.groupby('day')['cumulative'].max()
        for day, cum in day_groups.items():
            if pd.notna(day) and pd.notna(cum):
                current_chart.append({'x': int(day), 'y': round(float(cum), 2)})
        current_chart.sort(key=lambda p: p['x'])

    last_chart = []
    if not last_month_df.empty and 'normalized_day' in last_month_df.columns and 'cumulative' in last_month_df.columns:
        # Group by normalized_day, take the final cumulative per day
        day_groups = last_month_df.groupby('normalized_day')['cumulative'].max()
        for nday, cum in day_groups.items():
            if pd.notna(nday) and pd.notna(cum):
                last_chart.append({'x': round(float(nday), 2), 'y': round(float(cum), 2)})
        last_chart.sort(key=lambda p: p['x'])

    future_chart = []
    if not full_current_month_df.empty and 'day' in full_current_month_df.columns and 'cumulative' in full_current_month_df.columns:
        cutoff = input_date.normalize()
        future_slice = full_current_month_df[full_current_month_df['date'] > cutoff]
        if not current_month_df.empty:
            last_actual = current_month_df.iloc[-1]
            future_chart.append({'x': int(last_actual['day']), 'y': round(float(last_actual['cumulative']), 2)})
        if not future_slice.empty:
            day_groups = future_slice.groupby('day')['cumulative'].max()
            for day, cum in day_groups.items():
                if pd.notna(day) and pd.notna(cum):
                    future_chart.append({'x': int(day), 'y': round(float(cum), 2)})

    has_category = not current_month_df.empty and 'category_name' in current_month_df.columns
    categories = []
    if has_category:
        grp = current_month_df.groupby('category_name', dropna=False)['amount'].sum().sort_values(ascending=False)
        for cat, amt in grp.items():
            name = str(cat) if (cat is not None and str(cat) not in ('nan', 'None', '')) else 'uncategorized'
            categories.append({'name': name, 'amount': round(float(amt), 2)})

    has_payee = not current_month_df.empty and 'payee' in current_month_df.columns
    recent_txns = []
    if not current_month_df.empty:
        for _, row in current_month_df.sort_values('date', ascending=False).iterrows():
            txn = {
                'date': row['date'].strftime('%b %d'),
                'amount': round(float(row['amount']), 2),
                'payee': str(row['payee']) if has_payee and pd.notna(row.get('payee')) else '',
                'category': str(row['category_name']) if has_category and pd.notna(row.get('category_name')) and str(row.get('category_name')) not in ('nan', 'None') else '',
            }
            recent_txns.append(txn)

    daily_totals = []
    if not current_month_df.empty and 'day' in current_month_df.columns:
        grp = current_month_df.groupby('day')['amount'].sum().reset_index().sort_values('amount', ascending=False)
        for _, row in grp.iterrows():
            daily_totals.append({'day': int(row['day']), 'amount': round(float(row['amount']), 2)})

    data = {
        'summary': {
            'currentMonthTotal': round(this_month_total, 2),
            'lastMonthEquivalent': round(float(cumulative_amount_on_equivalent_day_last_month_val), 2),
            'difference': round(float(diff), 2),
            'percentDiff': round(float(percent_diff), 1),
            'lastMonthTotal': round(float(last_month_total_end), 2),
            'daysElapsed': days_elapsed,
            'daysRemaining': days_remaining,
            'daysInMonth': days_in_month,
            'avgDaily': round(avg_daily, 2),
            'projectedTotal': round(projected_total, 2),
            'date': input_date.strftime('%Y-%m-%d'),
            'monthName': input_date.strftime('%B %Y'),
        },
        'currentMonthChart': current_chart,
        'lastMonthChart': last_chart,
        'futureChart': future_chart,
        'categories': categories,
        'recentTransactions': recent_txns,
        'dailyTotals': daily_totals,
    }

    return _DASHBOARD_HTML.replace('__DATA_JSON__', json.dumps(data))


# This calculation determines a comparable day in the previous month,
# scaled by the proportion of the current month that has passed.
equivalent_days_in_previous_month = math.ceil((input_date.day / input_date.days_in_month) * start_of_previous_month.days_in_month)

# Ensure equivalent_days_in_previous_month does not exceed the number of days in the previous month
last_month_days = start_of_previous_month.days_in_month
if equivalent_days_in_previous_month > last_month_days:
    equivalent_days_in_previous_month = last_month_days

# Default value for cumulative spending last month if no data is available
cumulative_amount_on_equivalent_day_last_month_val = 0.0

if not last_month_df.empty:
    # Find the nearest available day in the last month that had a payment
    nearest_day_last_month = find_nearest_available_day(last_month_df, equivalent_days_in_previous_month)

    if nearest_day_last_month is not None:
        # Find the cumulative amount on the equivalent or nearest available day in the last month
        cumulative_amount_series = last_month_df.loc[last_month_df['day'] == nearest_day_last_month, 'cumulative']

        if not cumulative_amount_series.empty:
            # Take the latest cumulative amount for that day
            cumulative_amount_on_equivalent_day_last_month_val = cumulative_amount_series.iloc[-1]
        else:
            # Fallback if specific day had no transactions (e.g. if find_nearest_available_day logic changes)
            # This part might need adjustment based on how find_nearest_available_day handles no data for target.
            # For now, assumes find_nearest_available_day returns a day that *has* data.
            # If not, we might need to iterate backwards from nearest_day_last_month.
            pass # Handled by initialization
    # else: No suitable day found in last_month_df, use default 0.0
else:
    # last_month_df is empty, so no transactions last month.
    # cumulative_amount_on_equivalent_day_last_month_val remains 0.0
    pass

this_month_total = current_month_df['cumulative'].max() if not current_month_df.empty else 0
this_month_total = round(this_month_total, 2)
diff = this_month_total - cumulative_amount_on_equivalent_day_last_month_val
diff = round(diff, 2)

# Calculate percentage difference
percent_diff = 0.0
if cumulative_amount_on_equivalent_day_last_month_val > 0:
    percent_diff = (diff / cumulative_amount_on_equivalent_day_last_month_val) * 100

# Get total spending for the entire last month
last_month_total_end = last_month_df['cumulative'].iloc[-1] if not last_month_df.empty else 0.0

# Prepare Console Output
# ANSI Color Codes
GREEN = '\033[92m'
RED = '\033[91m'
BOLD = '\033[1m'
CYAN = '\033[96m'
RESET = '\033[0m'

diff_color = RED if diff > 0 else GREEN
diff_sign = "+" if diff > 0 else ""

console_output = (
    f"\n{BOLD}{CYAN}--- Spending Comparison ({input_date.strftime('%Y-%m-%d')}) ---{RESET}\n"
    f"{BOLD}Current Month:{RESET}         ${this_month_total:,.2f}\n"
    f"{BOLD}Last Month (Same Day):{RESET} ${cumulative_amount_on_equivalent_day_last_month_val:,.2f}\n"
    f"{BOLD}Difference:{RESET}            {diff_color}${diff:+,.2f} ({percent_diff:+.1f}%){RESET}\n"
    f"{BOLD}Last Month Total:{RESET}      ${last_month_total_end:,.2f}\n"
    f"{CYAN}-------------------------------------------{RESET}"
)
print(console_output)

# Prepare Plot Summary Text (Keep it concise)
comparison_summary_text = "NaN"
if (diff > 0):
    comparison_summary_text = f"Spending this month: ${this_month_total:,.2f}\n${abs(diff):,.2f} more than last month ({percent_diff:+.1f}%)"
elif (diff < 0):
    comparison_summary_text = f"Spending this month: ${this_month_total:,.2f}\n${abs(diff):,.2f} less than last month ({percent_diff:+.1f}%)"
else:
    comparison_summary_text = f"Spending this month: ${this_month_total:,.2f}\nSame as last month"

# Set professional dark theme styling
plt.style.use("dark_background")

# Plotting
fig, ax = plt.subplots(figsize=(12, 8), facecolor='#1a1a1a') # Increased height slightly
ax.set_facecolor('#1a1a1a')

# Move summary text to a dedicated area below the title (subtitle style)
# Adjust subplot params to make room at the top
plt.subplots_adjust(top=0.82)

# Main Title
fig.suptitle('Cumulative Spending Comparison', fontsize=20, color='#ffffff', fontweight='bold', y=0.96)

# Subtitle (Summary Text)
fig.text(0.5, 0.89, comparison_summary_text, fontsize=12, ha='center', va='top',
         color='#e0e0e0', family='monospace', fontweight='bold')

# Colors
color_last_month = '#00f2fe' # Cyan/Blue
color_current_month = '#43e97b' # Green/Teal
color_projected = '#43e97b'

# Calculate days in months for normalization
days_in_current_month = start_of_this_month.days_in_month
days_in_prev_month = start_of_previous_month.days_in_month

# Normalize 'day' for plotting
if not last_month_df.empty:
    # Scale the previous month's days to match the current month's length
    last_month_df['normalized_day'] = last_month_df['day'] * (days_in_current_month / days_in_prev_month)
else:
    last_month_df['normalized_day'] = None

if not current_month_df.empty:
    # Current month days are already correct relative to the x-axis
    current_month_df['normalized_day'] = current_month_df['day']
else:
    current_month_df['normalized_day'] = None

# Plot the cumulative spending for last month, if data exists
if not last_month_df.empty and 'normalized_day' in last_month_df.columns and 'cumulative' in last_month_df.columns:
    ax.plot(last_month_df['normalized_day'], last_month_df['cumulative'], marker='o', label='Last Month',
            linestyle='-', color=color_last_month, linewidth=2, markersize=5, markerfacecolor=color_last_month,
            markeredgecolor='#ffffff', markeredgewidth=0.5, alpha=0.8)
    # Add fill
    ax.fill_between(last_month_df['normalized_day'], last_month_df['cumulative'], color=color_last_month, alpha=0.1)
    
    # Annotation for last point
    last_val = last_month_df['cumulative'].iloc[-1]
    last_day = last_month_df['normalized_day'].iloc[-1]
    ax.annotate(f'${last_val:,.0f}', xy=(last_day, last_val), xytext=(5, 0), textcoords='offset points',
                color=color_last_month, fontsize=9, fontweight='bold', va='center')

# Plot the cumulative spending for current month, if data exists
if not current_month_df.empty and 'normalized_day' in current_month_df.columns and 'cumulative' in current_month_df.columns:
    # Filter out any invalid days (e.g. day 0 or NaN) that might have crept in
    plot_df = current_month_df[current_month_df['normalized_day'] >= 1]
    
    if not plot_df.empty:
        ax.plot(plot_df['normalized_day'], plot_df['cumulative'], marker='o', label='Current Month',
                linestyle='-', color=color_current_month, linewidth=3, markersize=7, markerfacecolor=color_current_month,
                markeredgecolor='#ffffff', markeredgewidth=1.5, zorder=5) # Higher zorder to stay on top
        # Add fill
        ax.fill_between(plot_df['normalized_day'], plot_df['cumulative'], color=color_current_month, alpha=0.2)

        # Annotation for last point
        last_val = plot_df['cumulative'].iloc[-1]
        last_day = plot_df['normalized_day'].iloc[-1]
        ax.annotate(f'${last_val:,.0f}', xy=(last_day, last_val), xytext=(5, 5), textcoords='offset points',
                    color=color_current_month, fontsize=10, fontweight='bold', va='bottom',
                    bbox=dict(facecolor='#1a1a1a', edgecolor='none', alpha=0.7, pad=1))

# Determine if we should show future spending (only if looking at a past date)
# We compare normalized dates to ignore time components
show_future_spending = input_date.normalize() < pd.Timestamp.now().normalize()

# Plot future spending for the rest of the month (faded line)
if show_future_spending and not full_current_month_df.empty and 'day' in full_current_month_df.columns and 'cumulative' in full_current_month_df.columns:
    projected_line_df = full_current_month_df[full_current_month_df['date'] >= input_date.replace(hour=0, minute=0, second=0, microsecond=0)]
    if not projected_line_df.empty:
        plot_df_for_projection = projected_line_df

        # Connect lines logic (same as before)
        if not current_month_df.empty and not current_month_df[current_month_df['date'].dt.date == input_date.date()].empty:
            last_actual_day_data = current_month_df[current_month_df['date'].dt.date == input_date.date()].iloc[-1]
            if not projected_line_df[projected_line_df['day'] == input_date.day].empty:
                 projected_line_df.loc[projected_line_df['day'] == input_date.day, 'cumulative'] = last_actual_day_data['cumulative']
            else:
                point_to_add = pd.DataFrame([{
                    'date': last_actual_day_data['date'],
                    'day': last_actual_day_data['day'],
                    'cumulative': last_actual_day_data['cumulative'],
                    'amount': 0,
                    'exclude_from_totals': False,
                    'is_income': False
                }])
                plot_df_for_projection = pd.concat([point_to_add, projected_line_df], ignore_index=True).sort_values(by='day').drop_duplicates(subset=['day'], keep='first')

        # Filter out any invalid days
        plot_df_for_projection = plot_df_for_projection[plot_df_for_projection['day'] >= 1]

        ax.plot(plot_df_for_projection['day'], plot_df_for_projection['cumulative'], marker='', label='Future Spending',
            linestyle='--', color=color_projected, alpha=0.5, linewidth=2)
        
        # Annotation for projected end
        last_val = plot_df_for_projection['cumulative'].iloc[-1]
        last_day = plot_df_for_projection['day'].iloc[-1]
        ax.annotate(f'Future: ${last_val:,.0f}', xy=(last_day, last_val), xytext=(5, 0), textcoords='offset points',
                    color=color_projected, fontsize=9, alpha=0.7, va='center')


# Professional styling for axes and labels
ax.set_xlabel('Day of the Month', fontsize=12, color='#cccccc', fontweight='500', labelpad=10)
ax.set_ylabel('Cumulative Amount Spent ($)', fontsize=12, color='#cccccc', fontweight='500', labelpad=10)
# ax.set_title removed in favor of fig.suptitle

# Grid styling
ax.grid(True, linestyle=':', alpha=0.4, color='#666666') # Dotted grid
ax.set_axisbelow(True)

# Axis styling
ax.tick_params(colors='#cccccc', labelsize=10)
ax.spines['top'].set_visible(False)
ax.spines['right'].set_visible(False)
ax.spines['bottom'].set_color('#404040')
ax.spines['left'].set_color('#404040')

# Ensure x-axis covers the full month for context
ax.set_xlim(1, 31)

# Legend styling
legend = ax.legend(loc='upper left', frameon=True, facecolor='#2d2d2d',
                  edgecolor='#404040', labelcolor='#ffffff', fontsize=10)
legend.get_frame().set_boxstyle('round,pad=0.3')

# Format y-axis to show dollar amounts
def currency_formatter(x, p):
    return f'${x:,.0f}'
ax.yaxis.set_major_formatter(FuncFormatter(currency_formatter))

# plt.tight_layout() # Removed in favor of manual subplots_adjust for title/subtitle control

# Save the plot as a PNG file
plt.savefig(f"{input_date.strftime('%Y-%m-%d')}-cumulative_spending_comparison.png",
            facecolor='#1a1a1a', dpi=120, bbox_inches='tight')

# Close the plot
plt.close()

# Save the HTML dashboard
html_content = generate_html_dashboard(
    input_date=input_date,
    this_month_total=this_month_total,
    cumulative_amount_on_equivalent_day_last_month_val=cumulative_amount_on_equivalent_day_last_month_val,
    last_month_total_end=last_month_total_end,
    diff=diff,
    percent_diff=percent_diff,
    current_month_df=current_month_df,
    last_month_df=last_month_df,
    full_current_month_df=full_current_month_df,
)
html_path = f"{input_date.strftime('%Y-%m-%d')}-dashboard.html"
with open(html_path, 'w', encoding='utf-8') as f:
    f.write(html_content)
print(f"Dashboard saved: {html_path}")
