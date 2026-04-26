# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a single-script Python tool that fetches transaction data from the Lunchmoney API and generates a cumulative spending comparison chart (current month vs. previous month). It is intentionally small and procedural — not a library or service.

## Common Commands

- **Install dependencies:** `uv sync` (or `uv sync --group dev`)
- **Run the script:** `uv run python comparison.py`
- **Run with a specific reference date:** `uv run python comparison.py --date 2023-11-15`
- **Run tests:** `uv run python -m unittest test_comparison`
- **Run a single test:** `uv run python -m unittest test_comparison.TestCalculateDateBoundaries.test_mid_month`

## Architecture

- **Entry point:** `comparison.py` is the entire application. It is designed to be run as a standalone script, not as an installed package.
- **Environment:** The script requires a `.env` file in the repo root with `LM_API_KEY` and `LM_HOSTNAME`. These are loaded at module level via `python-dotenv`.
- **Date logic:** `calculate_date_boundaries()` (in `comparison.py`) computes the start of the current month, start of the previous month, and end of the previous month. This is the only logic covered by unit tests (`test_comparison.py`).
- **Data flow:** The script fetches transactions from the Lunchmoney API for up to three date ranges:
  1. Current month from the 1st through the reference date.
  2. The full previous month.
  3. The full current month (only when `--date` is in the past relative to today) — this is used for the optional "Future Spending" projection line.
- **Plotting logic:** The previous month's days are normalized (scaled) to align with the current month's length so both lines share the same x-axis. The chart is a dark-themed Matplotlib figure saved as `{date}-cumulative_spending_comparison.png` in the repo root.
- **Filtering:** Income and transactions flagged `exclude_from_totals` are removed before cumsum and plotting.
- **Comparison text:** The summary text compares the current month's cumulative total against the cumulative total on a proportionally equivalent day in the previous month (e.g., day 15 of a 30-day month is compared to day 15.5 → day 16 of a 31-day month). If no exact day exists, the nearest available day with data is used.
