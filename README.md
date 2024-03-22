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
You can run the code using;
```
$ python comparison.py
```
## Result
The final graph looks like this -- not pretty but has all the information needed.
<img width="500" alt="2024-03-06-cumulative_spending_comparison" src="https://github.com/micklynch/lunchmoney/assets/37063953/02f7fe2b-f09f-403d-bd03-bc4f77a33f44">

* [ ] Need to align the days of the month better, currently the x-axis are the dates from the previous month. This causes slight visualization issue when months have different dates (e.g. Feb & Mar)
