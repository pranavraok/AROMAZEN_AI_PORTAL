import io
import unittest

from pypdf import PdfReader
from openpyxl import Workbook
from reportlab.pdfgen.canvas import Canvas

from app.modules.cash_flow.service import BankSummary, build_report, indian, read_bank, reconciliation_checks, _sum_labeled_details


class CashFlowReportTests(unittest.TestCase):
    def test_reconciliation_exposes_variance_and_preserves_paise(self):
        banks = [BankSummary('A', 100000, 150000, 'Cr', '2000-01'), BankSummary('B', 50000, 60000, 'Cr', '2000-01'), BankSummary('C', 25000, 35000, 'Cr', '2000-01')]
        warnings, metrics = reconciliation_checks('2000-01', [('Collections', 100000)], [('Payments', 33000)], banks)
        self.assertEqual(dict(metrics)['Unreconciled difference'], 3000)
        self.assertIn('INR 3,000', warnings[0])
        self.assertEqual(indian(1181.01), 'INR 1,181.01')
        self.assertEqual(indian(-0.55), '-INR 0.55')

    def test_debit_balances_and_matching_period_reconcile(self):
        banks = [BankSummary('A', -100, 50, 'Dr', '2000-01'), BankSummary('B', 0, 0, 'Cr', '2000-01'), BankSummary('C', 0, 0, 'Cr', '2000-01')]
        warnings, metrics = reconciliation_checks('2000-01', [('Collections', 100)], [('Payments', 50)], banks)
        self.assertEqual(warnings, [])
        self.assertEqual(dict(metrics)['Unreconciled difference'], 0)

    def test_missing_balances_and_mismatched_period_are_not_silent(self):
        warnings, metrics = reconciliation_checks('2000-02', [], [], [BankSummary('A', 100, None, None, '2000-01')])
        self.assertTrue(any('differs' in warning for warning in warnings))
        self.assertTrue(any('incomplete' in warning for warning in warnings))
        self.assertEqual(metrics, [])

    def test_transaction_balance_is_not_used_as_closing(self):
        data = io.BytesIO(); canvas = Canvas(data)
        canvas.drawString(40, 750, 'Statement period: January 2000')
        canvas.drawString(40, 720, 'Opening Balance 100.00 Cr')
        canvas.drawString(40, 690, 'Transaction balance 250.00 Cr')
        canvas.save()
        bank = read_bank('Test', data.getvalue())
        self.assertEqual(bank.opening, 100)
        self.assertIsNone(bank.closing)
        self.assertEqual(bank.statement_month, '2000-01')

    def test_explicit_zero_category_is_allowed_but_empty_is_rejected(self):
        sheet = Workbook().active
        sheet.append(['TRANSPORT', 0])
        self.assertEqual(_sum_labeled_details(sheet, (('TRANSPORT',),), 'transport'), 0)
        sheet['B1'] = None
        with self.assertRaisesRegex(ValueError, 'No numeric'):
            _sum_labeled_details(sheet, (('TRANSPORT',),), 'transport')

    def test_pdf_shows_warning_full_asset_name_and_readable_currency(self):
        label = 'Laboratory production equipment with accessories and installation costs - long asset description'
        banks = [BankSummary(name, 100, 200, 'Cr', '2000-01') for name in ['A', 'B', 'C']]
        generated = build_report('2000-02', [('Collections', 1000)], [('Payments', 400)], banks, [(label, 250000.55)], 'test-password')
        reader = PdfReader(io.BytesIO(generated))
        self.assertEqual(reader.decrypt('wrong'), 0)
        self.assertNotEqual(reader.decrypt('test-password'), 0)
        text = '\n'.join(page.extract_text() or '' for page in reader.pages)
        self.assertIn('REVIEW REQUIRED', text)
        self.assertIn('Unreconciled bank difference', text)
        self.assertIn('INR 2,50,000.55', text)
        self.assertNotIn('■', text)
        self.assertIn(label, ' '.join(text.split()))

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
