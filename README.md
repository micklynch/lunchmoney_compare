## Introduction
Due to Mint.com closing, I transition to Lunchmoney.app to tracking my spending and managing budgets. One feature I missed from Mint was the chart which showed how I was tracking compared to the previous month. As Lunchmoney has shared an [API](lunchmoney.dev).

### Set-up
Create a file called `.env` in the root folder of this project. The variables included should be:
```
LM_API_KEY="xyzxyzxyzxyzxyzxyzxyzxyzxyzxyzxyz"
LM_HOSTNAME="https://dev.lunchmoney.app"
```
You can get an API key [from lunchmoney](https://my.lunchmoney.app/developers).

#### Running the code
You can run the code using;
```
$ python comparison.py
```

