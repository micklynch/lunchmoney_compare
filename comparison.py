from dotenv import load_dotenv
import os
import requests
import math
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

comparison_summary_text = "NaN"
if (diff > 0):
    comparison_summary_text = f"Spending this month: ${this_month_total}\n${abs(diff)} more than last month"
elif (diff < 0):
    comparison_summary_text = f"Spending this month: ${this_month_total}\n${abs(diff)} less than last month"
else:
    comparison_summary_text = f"Spending this month: ${this_month_total}\nYou've spent the same as you did last month"
print(comparison_summary_text)

# Set professional dark theme styling
plt.style.use("dark_background")

# Plotting
fig, ax = plt.subplots(figsize=(12, 7), facecolor='#1a1a1a')
ax.set_facecolor('#1a1a1a')

# Add the overlay to explain the diff between this month and same time last month
fig.text(0.02, 0.78, comparison_summary_text, transform=plt.gca().transAxes, fontsize=11,
         bbox=dict(facecolor='#2d2d2d', alpha=0.9, edgecolor='#404040', boxstyle='round,pad=0.5'),
         color='#ffffff', family='monospace')

# Plot the cumulative spending for last month, if data exists
if not last_month_df.empty and 'day' in last_month_df.columns and 'cumulative' in last_month_df.columns:
    ax.plot(last_month_df['day'], last_month_df['cumulative'], marker='o', label='Last Month',
            linestyle='-', color='#5470c6', linewidth=2.5, markersize=6, markerfacecolor='#5470c6',
            markeredgecolor='#ffffff', markeredgewidth=1)

# Plot the cumulative spending for current month, if data exists
if not current_month_df.empty and 'day' in current_month_df.columns and 'cumulative' in current_month_df.columns:
    # Plot actual spending up to input_date (solid line)
    # current_month_df is already filtered up to input_date + 1 day by get_transactions_df,
    # then its 'day' and 'cumulative' are calculated.
    ax.plot(current_month_df['day'], current_month_df['cumulative'], marker='o', label='Current Month Spending',
            linestyle='-', color='#91cc75', linewidth=2.5, markersize=6, markerfacecolor='#91cc75',
            markeredgecolor='#ffffff', markeredgewidth=1)

# Plot projected spending for the rest of the month (faded line)
if not full_current_month_df.empty and 'day' in full_current_month_df.columns and 'cumulative' in full_current_month_df.columns:
    # Filter data from input_date to the end of the month for the projected line
    projected_line_df = full_current_month_df[full_current_month_df['date'] >= input_date.replace(hour=0, minute=0, second=0, microsecond=0)]
    if not projected_line_df.empty:
        # To make the line connect:
        # The cumulative sum in full_current_month_df at input_date should naturally align with current_month_df's last point
        # if current_month_df is a subset of full_current_month_df up to input_date.
        # Let's ensure the first point of projected_line_df matches the last point of current_month_df if current_month_df is not empty.

        plot_df_for_projection = projected_line_df

        # If current_month_df has data, ensure the projected line starts from its last point
        if not current_month_df.empty and not current_month_df[current_month_df['date'].dt.date == input_date.date()].empty:
            last_actual_day_data = current_month_df[current_month_df['date'].dt.date == input_date.date()].iloc[-1]

            # If input_date is not the first day of the month, and we have data for it in full_current_month_df
            if not projected_line_df[projected_line_df['day'] == input_date.day].empty:
                 # Update the cumulative value of the first point of the projected line to match the actual spending
                 projected_line_df.loc[projected_line_df['day'] == input_date.day, 'cumulative'] = last_actual_day_data['cumulative']
            else: # input_date might not have transactions in full_current_month_df after input_date (e.g. if input_date is last transaction day)
                  # Or, if it's the first day and no prior transactions, this point is fine.
                  # We need to add this point to projected_line_df to start the line from there.
                  # Create a new DataFrame for this single point to avoid SettingWithCopyWarning
                point_to_add = pd.DataFrame([{
                    'date': last_actual_day_data['date'],
                    'day': last_actual_day_data['day'],
                    'cumulative': last_actual_day_data['cumulative'],
                    # Add other necessary columns if they are used by plotting, with appropriate values
                    'amount': 0, # Placeholder, not used for plotting cumulative
                    'exclude_from_totals': False,
                    'is_income': False
                }])
                plot_df_for_projection = pd.concat([point_to_add, projected_line_df], ignore_index=True).sort_values(by='day').drop_duplicates(subset=['day'], keep='first')


        ax.plot(plot_df_for_projection['day'], plot_df_for_projection['cumulative'], marker='.', label='Projected Spending (Full Month)',
            linestyle='--', color='#91cc75', alpha=0.6, linewidth=2, markersize=4)

# Professional styling for axes and labels
ax.set_xlabel('Day of the Month', fontsize=12, color='#cccccc', fontweight='500')
ax.set_ylabel('Cumulative Amount Spent ($)', fontsize=12, color='#cccccc', fontweight='500')
ax.set_title('Cumulative Spending Comparison', fontsize=16, color='#ffffff', fontweight='600', pad=20)

# Grid styling
ax.grid(True, linestyle='--', alpha=0.3, color='#666666')
ax.set_axisbelow(True)

# Axis styling
ax.tick_params(colors='#cccccc', labelsize=10)
ax.spines['top'].set_visible(False)
ax.spines['right'].set_visible(False)
ax.spines['bottom'].set_color('#404040')
ax.spines['left'].set_color('#404040')

# Legend styling
legend = ax.legend(loc='upper left', frameon=True, facecolor='#2d2d2d',
                  edgecolor='#404040', labelcolor='#ffffff', fontsize=10)
legend.get_frame().set_boxstyle('round,pad=0.3')

# Format y-axis to show dollar amounts
def currency_formatter(x, p):
    return f'${x:,.0f}'
ax.yaxis.set_major_formatter(FuncFormatter(currency_formatter))

plt.tight_layout()

# Save the plot as a PNG file
plt.savefig(f"{input_date.strftime('%Y-%m-%d')}-cumulative_spending_comparison.png",
            facecolor='#1a1a1a', dpi=120, bbox_inches='tight')

# Close the plot
plt.close()
