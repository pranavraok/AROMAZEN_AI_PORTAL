import io
import unittest

from pypdf import PdfReader

from app.modules.cash_flow.service import BankSummary, build_report


class CashFlowReportTests(unittest.TestCase):
    def test_previous_month_adds_comparison_and_comparative_insights(self):
        receipts = [("Domestic collections", 1_250_000), ("GST refund", 125_000)]
        payments = [("Raw materials", 640_000), ("Electricity", 92_000), ("Transport", 71_000)]
        banks = [
            BankSummary("Bank of Baroda", 200_000, 250_000, "Cr"),
            BankSummary("Axis Bank", 175_000, 190_000, "Cr"),
            BankSummary("IndusInd Bank", 90_000, 110_000, "Cr"),
        ]
        previous = {
            "report_month": "2026-06",
            "receipts": [["Domestic collections", 1_000_000], ["GST refund", 100_000]],
            "payments": [["Raw materials", 580_000], ["Electricity", 85_000], ["Transport", 76_000]],
            "banks": [],
            "total_receipts": 1_100_000,
            "total_payments": 741_000,
            "net_movement": 359_000,
        }

        generated = build_report("2026-07", receipts, payments, banks, [], "AromaZen#Jul2026", previous)
        reader = PdfReader(io.BytesIO(generated)); self.assertTrue(reader.is_encrypted)
        self.assertEqual(reader.decrypt("AromaZen#Jul2026").name, "OWNER_PASSWORD")
        text = "\n".join(page.extract_text() or "" for page in reader.pages)
        self.assertIn("MONTH-ON-MONTH CASH FLOW COMPARISON", text)
        self.assertIn("AI CASH-FLOW INSIGHTS", text)
        self.assertIn("June 2026 vs July 2026", text)


if __name__ == "__main__":
    unittest.main()
