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

params = {
    "start_date": start_of_this_month.strftime('%Y-%m-%d'),
    "end_date": today.strftime('%Y-%m-%d')
}

response = requests.get(url, headers=headers, params=params)

# sum the amount of all the transactions for the current month
transactions = response.json()['transactions']
current_month_df = pd.DataFrame(transactions)

current_month_df['date'] = pd.to_datetime(current_month_df['date'], format='%Y-%m-%d')
current_month_df['amount']=current_month_df['amount'].astype(float)
current_month_df['exclude_from_totals']=current_month_df['exclude_from_totals'].astype(bool)
current_month_df['is_income']=current_month_df['is_income'].astype(bool)

current_month_df = current_month_df[(current_month_df["exclude_from_totals"] == False) & (current_month_df['is_income']== False)]

params = {
    "start_date": start_of_previous_month.strftime('%Y-%m-%d'),
    "end_date": end_of_previous_month.strftime('%Y-%m-%d')
}

response = requests.get(url, headers=headers, params=params)

# sum the amount of all the transactions for the current month
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

# Find the proportionate cumulative spending for the last month at the same point in time
equivalent_days_in_previous_month = math.ceil((today.day / today.days_in_month) * start_of_previous_month.days_in_month)

# Find the cumulative amount on the equivalent day in the last month
cumulative_last_on_equivalent_day = last_month_df.loc[last_month_df['day'] == equivalent_days_in_previous_month, 'cumulative'].tail(1)

diff = current_month_df['cumulative'].max()-cumulative_last_on_equivalent_day.values[0]
s = "NaN"
if (diff > 0):
    s = f"You've spent ${abs(diff)} more than you did last month"
    print(s)
elif (diff < 0):
    s = f"You've spent ${abs(diff)} less than you did last month"
    print(s)
else:
    s = f"You've spent the same as you did last month"
    print(s)

# Plotting
fig, ax = plt.subplots(figsize=(10, 6))

# add the overlay to explain the diff between this month and same time last month
fig.text(0.02, 0.82, s, transform=plt.gca().transAxes, fontsize=12, bbox=dict(facecolor='white', alpha=0.8))


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
