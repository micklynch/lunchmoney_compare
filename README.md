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

It’s typically recommended to use virtual environments when working with specific applications, so:

1. `python3 -m venv .venv` // create virtual environment for this directory
2. `source .venv/bin/activate` // activate it
3. `pip install -r requirements.txt` // install requirements

All dependencies will be installed for the project; proceed.

#### Running the code
You can run the code using:
```bash
python comparison.py
```

The script also accepts an optional date argument to specify the reference date for the comparison. If omitted, it defaults to the current date.

*   `--date` or `-d`: Specify a date in YYYY-MM-DD format.

Example:
```bash
python comparison.py --date 2023-11-15
```

This will generate a comparison as of November 15, 2023, comparing spending up to that day against the equivalent period in October 2023.

## How it Works
The script fetches your transactions for two periods:
1.  The "current" period: This starts from the first day of the month of the reference date (either the date provided via `--date` or today's date if no argument is given) and includes all transactions up to and including the reference date.
2.  The "previous" period: This covers the entire month immediately preceding the reference date's month.

It then calculates cumulative spending for both periods and plots them. The comparison text ("X more/less than last month") is determined by comparing the total spending up to the reference day in the "current" period against a proportionally equivalent day in the "previous" period.

## Result
The final graph provides a visual comparison of cumulative spending. An example is shown below (note: your specific output will vary).

<img width="500" alt="2024-03-06-cumulative_spending_comparison" src="https://github.com/micklynch/lunchmoney/assets/37063953/02f7fe2b-f09f-403d-bd03-bc4f77a33f44">

**Note on the plot:**
*   The solid green line shows your spending in the current reference month up to the specified (or current) date.
*   The dashed blue line shows your spending throughout the entire previous month.
*   A dotted green line may also appear, showing "Projected Spending" for the remainder of the current reference month. This projection is based on transactions already made within that month that occur after the reference date.

**Potential Improvements:**
* [ ] Further refinement of x-axis alignment and labeling for clarity, especially when comparing months of different lengths.
