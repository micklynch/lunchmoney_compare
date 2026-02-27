## Introduction
Due to Mint.com closing, I transition to Lunchmoney.app for tracking my spending and managing budgets. One feature I missed from Mint was the chart which showed how I was tracking compared to the previous month. As Lunchmoney has shared an [API](lunchmoney.dev), I created my own script to generate a similar chart.

### Set-up
Create a file called `.env` in the root folder of this project. The variables included should be:
```
LM_API_KEY="xyzxyzxyzxyzxyzxyzxyzxyzxyzxyzxyz"
LM_HOSTNAME="https://dev.lunchmoney.app"
```
You can get an API key [from lunchmoney](https://my.lunchmoney.app/developers).

#### Installing dependencies

This project uses [uv](https://docs.astral.sh/uv/) for dependency management. To install dependencies:

```bash
uv sync
```

To also install development dependencies:

```bash
uv sync --group dev
```

#### Running the code
You can run the code using:
```bash
uv run python comparison.py
```

The script also accepts an optional date argument to specify the reference date for the comparison. If omitted, it defaults to the current date.

*   `--date` or `-d`: Specify a date in YYYY-MM-DD format.

Example:
```bash
uv run python comparison.py --date 2023-11-15
```

Alternatively, you can activate the virtual environment first and run normally:
```bash
source .venv/bin/activate
python comparison.py
```

This will generate a comparison as of November 15, 2023, comparing spending up to that day against the equivalent period in October 2023.

## How it Works
The script fetches your transactions for two periods:
1.  The "current" period: This starts from the first day of the month of the reference date (either the date provided via `--date` or today's date if no argument is given) and includes all transactions up to and including the reference date.
2.  The "previous" period: This covers the entire month immediately preceding the reference date's month.

It then calculates cumulative spending for both periods and plots them. The comparison text ("X more/less than last month") is determined by comparing the total spending up to the reference day in the "current" period against a proportionally equivalent day in the "previous" period.

## Result
The final graph provides a visual comparison of cumulative spending. An example is shown below (note: your specific output will vary).

<img width="500" alt="lunchmoney_compare_example" src="assets/lunchmoney_compare_example.png">

**Note on the plot:**
*   The solid green line shows your spending in the current reference month up to the specified (or current) date.
*   The dashed blue line shows your spending throughout the entire previous month.
*   A dotted green line may also appear, showing "Projected Spending" for the remainder of the current reference month. This projection is based on transactions already made within that month that occur after the reference date.

**Potential Improvements:**
* [ ] Further refinement of x-axis alignment and labeling for clarity, especially when comparing months of different lengths.
