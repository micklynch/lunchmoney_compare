import unittest
import pandas as pd
from comparison import calculate_date_boundaries

class TestDateCalculations(unittest.TestCase):

    def test_mid_month_date(self):
        input_dt = pd.Timestamp("2023-03-15")
        sotm, eopm, sopm = calculate_date_boundaries(input_dt)
        self.assertEqual(sotm, pd.Timestamp("2023-03-01"))
        self.assertEqual(eopm, pd.Timestamp("2023-02-28"))
        self.assertEqual(sopm, pd.Timestamp("2023-02-01"))

    def test_start_of_month(self):
        input_dt = pd.Timestamp("2023-03-01")
        sotm, eopm, sopm = calculate_date_boundaries(input_dt)
        self.assertEqual(sotm, pd.Timestamp("2023-03-01"))
        self.assertEqual(eopm, pd.Timestamp("2023-02-28"))
        self.assertEqual(sopm, pd.Timestamp("2023-02-01"))

    def test_end_of_month(self):
        input_dt = pd.Timestamp("2023-03-31")
        sotm, eopm, sopm = calculate_date_boundaries(input_dt)
        self.assertEqual(sotm, pd.Timestamp("2023-03-01"))
        self.assertEqual(eopm, pd.Timestamp("2023-02-28"))
        self.assertEqual(sopm, pd.Timestamp("2023-02-01"))

    def test_january_date_previous_year(self):
        input_dt = pd.Timestamp("2023-01-15")
        sotm, eopm, sopm = calculate_date_boundaries(input_dt)
        self.assertEqual(sotm, pd.Timestamp("2023-01-01"))
        self.assertEqual(eopm, pd.Timestamp("2022-12-31"))
        self.assertEqual(sopm, pd.Timestamp("2022-12-01"))

    def test_march_date_non_leap_february(self):
        # Test with a date where previous month is February in a non-leap year (2023)
        input_dt = pd.Timestamp("2023-03-15")
        _, eopm, _ = calculate_date_boundaries(input_dt)
        self.assertEqual(eopm, pd.Timestamp("2023-02-28"))

    def test_march_date_leap_february(self):
        # Test with a date where previous month is February in a leap year (2024)
        input_dt = pd.Timestamp("2024-03-15")
        _, eopm, _ = calculate_date_boundaries(input_dt)
        self.assertEqual(eopm, pd.Timestamp("2024-02-29"))

if __name__ == '__main__':
    unittest.main()
