# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Two deliverables live in this repo:

1. `comparison.py` — a single-script Python tool that fetches transaction data from the Lunchmoney API and generates a cumulative spending comparison chart (current month vs. previous month). Intentionally small and procedural — not a library or service.
2. A Vite + Express web dashboard (`index.html` / `src/`) that presents the same comparison as a fast, dark, keyboard-driven UI.

## Common Commands

- **Install dependencies:** `uv sync` (or `uv sync --group dev`) and `npm install`
- **Run the script:** `uv run python comparison.py`
- **Run with a specific reference date:** `uv run python comparison.py --date 2023-11-15`
- **Run tests:** `uv run python -m unittest test_comparison`
- **Run a single test:** `uv run python -m unittest test_comparison.TestCalculateDateBoundaries.test_mid_month`
- **Run the dashboard:** `npm run dev`
- **Run the dashboard UI smoke test:** `npm run test:ui` (needs `npm run dev` running)

## Web Dashboard

A Vite + Express web dashboard lives alongside the Python script.

- **Dev mode:** `npm run dev` (Vite dev server + `server.js` API proxy concurrently; Vite proxies `/api` to `localhost:3001`)
- **Build:** `npm run build` (outputs to `dist/`)
- **Production:** `npm start` (serves `dist/` and the API on port 3001)

### Source layout

```
index.html            app shell: rail nav, topbar, status strip, sections, palette
src/style.css         design system — dark-first CSS custom properties, light override
src/lib/api.js        cached fetch layer (memory + sessionStorage, 20 min TTL, LRU)
src/lib/compute.js    ALL analytics — pacing, month-over-month, budget model, net worth
src/lib/charts.js     Chart.js factories, lazy chart registry, custom canvas plugins
src/lib/format.js     money / percent formatting with semantic tone helpers
src/lib/util.js       clamp, debounce, esc, sum, groupBy
src/ui/state.js       tiny observable store; panels re-render on a reason string
src/ui/dom.js         DOM helpers, SVG sparklines, one shared rAF number ticker
src/ui/palette.js     command palette (Cmd+K / Ctrl+K)
src/ui/panels/*.js    one module per section: overview, pace, budget, calendar,
                      categories, trend, networth, transactions
server.js             Express proxy to the Lunchmoney API (needs the LM_* keys)
```

### API proxy endpoints

`/api/transactions`, `/api/assets`, `/api/plaid_accounts`, `/api/budgets` (transactions and budgets take `start_date`/`end_date`).

### Data loading — two phases

**Phase 1 (fast, ~0.5 s):** current month to date, full previous month, budgets, assets, plaid — in parallel. This alone is enough to render the KPIs, pace chart, budget, categories and transactions, i.e. the entire month-over-month story.

**Phase 2 (deep history):** a rolling `HISTORY_MONTHS` (36) window **anchored on today, not the reference date**. Because its URL never changes as the user steps through months, it is a client cache hit after the first visit and only feeds the trend, calendar and net-worth panels. `renderHistoryPhase()` re-renders just those three.

Budgets / assets / plaid degrade to null on failure; a failure renders a banner, never destroys the shell.

### The Lunchmoney API (read before touching `server.js`)

* `GET /v1/transactions` **defaults to a 1000-row page and silently truncates** longer ranges, returning the most recent 1000 rows. Before pagination, early months in the trend were near-zero when they should have held full totals. The proxy must keep walking pages via `offset`.
* The page size is not capped at 1000 — `limit=2000` works. Four large pages cover years of history.
* The rate limit is **100 requests per window** (`x-ratelimit-limit`). Pagination is sequential, so naive paging burns it and gets a 429. `server.js` therefore uses large pages, pauses between them, honours `x-ratelimit-reset` with exponential backoff, and caches responses in-process (transactions 30 min).
* `server.js` projects each transaction down to ~11 used fields. The raw payload is ~30 fields and roughly 8× larger, which is what makes deep history cheap to cache in the browser.

### Conventions worth preserving

- **`compute.js` is the single source of truth.** Panels never do arithmetic; they render the model it returns.
- **Same-period comparison is one function.** `equivalentDay(elapsed, daysCur, daysPrev)` picks the calendar day of the previous month that lines up proportionally (day 15 of a 30-day month → day 16 of a 31-day month). Every "versus last month" figure — the KPI benchmark, category deltas, budget rows, the day-normalised pace curve — derives from it.
- **Aggregate on `to_base`, not `amount`**, so multi-currency accounts stay comparable; take spend as an absolute value so the API's income sign convention does not matter.
- **Budget spend-to-date is computed from the transactions we already hold**, not from the API's `spending_to_base` (which reports the whole month for any month already in the past). One source of truth means the budget meter always agrees with the headline numbers.
- **The projection is a run-rate.** Do not reintroduce `spent + budget remaining` — that always collapses to the budget total and says nothing. The budget is a *target* shown alongside the projection, not an input to it.
- **Chart colours come from CSS custom properties** (`--c-cur`, `--c-prior`, …) read at construction time, which is why `refreshAllCharts()` rebuilds every chart on a theme flip.
- **Custom canvas plugins must be passed as the third `Chart` constructor argument**, not inside the config object.
- **Charts are lazy.** `chart(id, factory, model)` defers creation until the canvas nears the viewport.
- **State changes go through `setState(patch, reason)`**; passing a reason always emits, even when no tracked value changed (some panels keep local sort state).

### UI

- **Layout:** fixed left rail (section nav + palette trigger), sticky topbar (month stepper, comparison-basis switch, theme, refresh), a sticky status strip with the headline month-over-month numbers, then full-width panels.
- **Sections top to bottom:** overview KPIs → cumulative pace → budget → categories → spend calendar → monthly trend → net worth → transactions.
- **Calendar:** rows are weekdays, columns are weeks, exactly `CALENDAR_WEEKS` (52) Monday-aligned columns ending on the reference date. Shade levels are quantiles of the user's own non-zero daily spend, not fixed dollar steps. Days outside the fetched history render as `unknown` (hatched), never as $0 — "no data" and "spent nothing" are different claims. Income is excluded: the grid shows spending.
- **Theme:** dark by default; toggle persisted to `localStorage`; `?theme=light|dark` and `?date=YYYY-MM-DD` URL params supported (the date is kept in sync with history, so any view is shareable).
- **Keyboard:** `1`–`8` jump to sections, Cmd/Ctrl+K palette, `r` refresh, `t` theme, `f` flip comparison basis, `/` search transactions.
- **Unambiguous numbers:** the benchmark KPI states whose figure it is showing — labelled *spent last month · same period*, badged with the date, with an explicit `you spent X → that is less by Y (−Z%)` block beneath. Keep this property when touching the overview.

## Architecture

- **Entry point:** `comparison.py` is the entire Python application. It is designed to be run as a standalone script, not as an installed package.
- **Environment:** both the script and the dashboard need a `.env` file in the repo root with `LM_API_KEY` and `LM_HOSTNAME` — loaded at module level via `python-dotenv` in Python and `dotenv` in `server.js`.
- **Date logic:** `calculate_date_boundaries()` (in `comparison.py`) computes the start of the current month, start of the previous month, and end of the previous month. This is the only logic covered by unit tests (`test_comparison.py`).
- **Data flow:** The script fetches transactions from the Lunchmoney API for up to three date ranges:
  1. Current month from the 1st through the reference date.
  2. The full previous month.
  3. The full current month (only when `--date` is in the past relative to today) — this is used for the optional "Future Spending" projection line.
- **Plotting logic:** The previous month's days are normalized (scaled) to align with the current month's length so both lines share the same x-axis. The chart is a dark-themed Matplotlib figure saved as `{date}-cumulative_spending_comparison.png` in the repo root.
- **Filtering:** Income and transactions flagged `exclude_from_totals` are removed before cumsum and plotting.
- **Comparison text:** The summary text compares the current month's cumulative total against the cumulative total on a proportionally equivalent day in the previous month (e.g., day 15 of a 30-day month is compared to day 15.5 → day 16 of a 31-day month). If no exact day exists, the nearest available day with data is used.
