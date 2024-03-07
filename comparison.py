from dotenv import load_dotenv
import os
import requests
import math
import pandas as pd
import matplotlib.pyplot as plt
from matplotlib.dates import MonthLocator, DateFormatter

# Load the .env file
load_dotenv()

# Get the value of the 'LM_API' environmental variable
lm_api = os.getenv('LM_API_KEY')
lm_hostname = os.getenv('LM_HOSTNAME')

# Set the headers for the request
headers = {
    "Authorization": f"Bearer {lm_api}"
}

# using pandas, get the date of the start of the month and then the date of the previous month
today = pd.to_datetime('today')
start_of_this_month = today.replace(day=1)
end_of_previous_month = start_of_this_month - pd.Timedelta(days=1)
start_of_previous_month = end_of_previous_month.replace(day=1)

url = f"{lm_hostname}/v1/transactions"

###
# Get this month's transactions
###
params = {
    "start_date": start_of_this_month.strftime('%Y-%m-%d'),
    "end_date": today.strftime('%Y-%m-%d')
}

response = requests.get(url, headers=headers, params=params)

# get all the transactions for this past month and add to dataframe
transactions = response.json()['transactions']
current_month_df = pd.DataFrame(transactions)

# format the date, amount and other flags
current_month_df['date'] = pd.to_datetime(current_month_df['date'], format='%Y-%m-%d')
current_month_df['amount']=current_month_df['amount'].astype(float)
current_month_df['exclude_from_totals']=current_month_df['exclude_from_totals'].astype(bool)
current_month_df['is_income']=current_month_df['is_income'].astype(bool)

# remove items that are income or flagged to remove from totals
current_month_df = current_month_df[(current_month_df["exclude_from_totals"] == False) & (current_month_df['is_income']== False)]

###
# Get last month's transactions
###
params = {
    "start_date": start_of_previous_month.strftime('%Y-%m-%d'),
    "end_date": end_of_previous_month.strftime('%Y-%m-%d')
}

response = requests.get(url, headers=headers, params=params)

# Do the same again for last month's transactions
transactions = response.json()['transactions']
last_month_df = pd.DataFrame(transactions)

last_month_df['date'] = pd.to_datetime(last_month_df['date'], format='%Y-%m-%d')
last_month_df['amount']=last_month_df['amount'].astype(float)
last_month_df['exclude_from_totals']=last_month_df['exclude_from_totals'].astype(bool)
last_month_df['is_income']=last_month_df['is_income'].astype(bool)

last_month_df = last_month_df[(last_month_df["exclude_from_totals"] == False) & (last_month_df['is_income']== False)]

# Calculate cumulative amounts at the end of each day
last_month_df['cumulative'] = last_month_df['amount'].cumsum()
current_month_df['cumulative'] = current_month_df['amount'].cumsum()

# Create a new column for the day of the month
last_month_df['day'] = last_month_df['date'].dt.day
current_month_df['day'] = current_month_df['date'].dt.day

# Find the nearest available day in the last month
def find_nearest_available_day(df, target_day):
    # Find the nearest available day or fallback to the previous day
    available_days = df['day'].unique()
    nearest_day = min(available_days, key=lambda x: abs(x - target_day))
    return nearest_day

# Find the proportionate cumulative spending for the last month at the same point in time
equivalent_days_in_previous_month = math.ceil((today.day / today.days_in_month) * start_of_previous_month.days_in_month)

# Find the nearest available day in the last month that had a payment
nearest_day_last_month = find_nearest_available_day(last_month_df, equivalent_days_in_previous_month)

# Find the cumulative amount on the equivalent or nearest available day in the last month
cumulative_amount_on_equivalent_day_last_month = last_month_df.loc[last_month_df['day'] == nearest_day_last_month, 'cumulative'].tail(1)

# Handle the case where the equivalent day is not present
if cumulative_amount_on_equivalent_day_last_month.empty:
    # Fallback to the previous day
    previous_day = nearest_day_last_month - 1
    cumulative_amount_on_equivalent_day_last_month = last_month_df.loc[last_month_df['day'] == previous_day, 'cumulative'].tail(1)



this_month_total = current_month_df['cumulative'].max()
diff = this_month_total-cumulative_amount_on_equivalent_day_last_month.values[0]
diff = round(diff, 2)
s = "NaN"
if (diff > 0):
    s = f"Spending this month: ${this_month_total}\n${abs(diff)} more than last month"
elif (diff < 0):
    s = f"Spending this month: ${this_month_total}\n${abs(diff)} less than last month"
else:
    s = f"Spending this month: ${this_month_total}\nYou've spent the same as you did last month"
print(s)
# Plotting
fig, ax = plt.subplots(figsize=(10, 6))

# add the overlay to explain the diff between this month and same time last month
fig.text(0.02, 0.78, s, transform=plt.gca().transAxes, fontsize=12, bbox=dict(facecolor='white', alpha=0.8))


# Plot the cumulative spending for last month
ax.plot(last_month_df['day'], last_month_df['cumulative'], marker='o', label='Last Month', linestyle='--', color='blue')

# Plot the cumulative spending for current month
ax.plot(current_month_df['day'], current_month_df['cumulative'], marker='o', label='Current Month', linestyle='-', color='green')

plt.xlabel('Day of the Month')
plt.ylabel('Cumulative Amount Spent')
plt.title('Comparison of Cumulative Spending This Month vs. Last Month')
plt.legend()
plt.tight_layout()

# Save the plot as a PNG file
plt.savefig(f"{today.strftime('%Y-%m-%d')}-cumulative_spending_comparison.png")

# Close the plot
plt.close()
