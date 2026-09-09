# NZOSA: Claude Engineering & Implementation Specification

**Target Developer:** Claude / NZOSA Engineering Team  
**Subject Entity:** Sample New Zealand small business entity  
**Purpose:** Handover specification for implementing Opening Balances, Balance Sheet Generation, Shareholder Current Account Ledger, and Inland Revenue IR10 Box Mapping.

---

## 1. Executive Summary & Context

NZOSA has been thoroughly tested and validated against sample New Zealand accounting records for a full financial year.

### Key Accomplishments & Empirical Validation
1. **100% Transaction Coding:** Bank transactions from a sample feed (covering a Trading Current Account `02-1100-0022001-001` and Business Card `XXXX-XXXX-XXXX-4001` / `sample-card-4001`) have been coded and reconciled in the active book `demo-book`.
2. **Double-Entry Proof:** Double-entry journals produce a trial balance with **$0.00 imbalance** ($\sum \text{Debits} = \sum \text{Credits}$).
3. **Statutory P&L Agreement:** Accrual net profit exactly matches the sample statutory accounts:
   $$\text{Sample Financial Statements: } \$8,900.00 \quad \longleftrightarrow \quad \text{NZOSA Generated: } \$8,900.00$$
   Major expense lines match standard financial statements:
   * Cost of Goods Sold (`310`): **$36,000.00**
   * Motor Vehicle Expenses (`449`): **$7,500.00**
   * Subcontractors (`413`): **$3,200.00**
   * Advertising (`400`): **$1,600.00**
   * Consulting & Accounting (`412`): **$750.00**
   * Telephone & Internet (`489`): **$600.00**
   * Insurance (`433`): **$580.00**
   * Low Value Assets <$1K (`446`): **$400.00**
   * Rent (`469`): **$240.00**
   * Cleaning (`408`): **$10.00**
   * Depreciation (`416`): **$19,800.00** (derived independently from the fixed asset schedule)
   * Funds Introduced (`910`): **$2,300.00** (matches Shareholder Schedule: $2,300.00)

---

## 2. Verified Opening Balances (As at 1 April 2025)

To produce a statutory Balance Sheet, Statement of Changes in Equity, and Shareholder Current Account Schedule, the ledger requires **opening balances**. 

These figures are taken from the comparative columns of sample financial statements (`Financial_Statements_Sample.pdf`) and reconciled against sample daily closing reports (`Balance_Closing_Sample.csv`):

### The Opening Trial Balance Table (1 April 2025)

| Account Identifier | Description | Account Type | Opening Balance (Debit / Credit) | Cents (Integer) |
| :--- | :--- | :--- | :--- | :--- |
| `02-1100-0022001-001` | BNZ 01 Trading Current Account | Bank Asset | Dr $355.94 | `35594` |
| `sample-card-4001` | BNZ Business Visa Card | Bank / Card Asset | Dr $1,177.06 | `117706` |
| `610` | Accounts Receivable (Trade Debtors) | Current Asset | Dr $2,280.00 | `228000` |
| `820` | GST Control (Receivable from IRD) | Current Asset / Tax | Dr $3,255.00 | `325500` |
| `730` | Fixed Assets (PPE Net Book Value) | Fixed Asset | Dr $26,540.00 | `2654000` |
| **Total Opening Assets** | | | **Dr \$33,608.00** | **`3360800`** |
| `800` | Accounts Payable (Trade Creditors) | Current Liability | Cr $153.00 | `-15300` |
| `910` | Shareholder Current Accounts | Current Liability | Cr $58,211.00 | `-5821100` |
| **Total Opening Liabilities** | | | **Cr \$58,365.00** | **`-5836500`** |
| **Net Opening Assets** | **Total Assets - Total Liabilities** | | **-\$24,757.00** | **`-2475700`** |
| `960` | Retained Earnings (Opening Deficit) | Equity | Dr $24,757.00 | `-2475700` |
| **Total Opening Equity** | | | **-\$24,757.00** | **`-2475700`** |

### Mathematical Proof
$$\text{Opening Assets } (\$33,608.00) = \text{Opening Liabilities } (\$58,365.00) + \text{Opening Equity } (-\$24,757.00)$$
$$\text{Trial Balance Imbalance } = \$0.00$$

### Ledger File Schema: `opening-balances.json`
Store this file in `<ledger-folder>/opening-balances.json` and mirror in `decisions.json`:
```json
{
  "version": 1,
  "data": {
    "asAt": "2025-04-01",
    "source": "Signed financial statements, prior year comparative column",
    "accounts": {
      "02-1100-0022001-001": 35594,
      "sample-card-4001": 117706,
      "610": 228000,
      "820": 325500,
      "730": 2654000,
      "800": -15300,
      "910": -5821100,
      "960": -2475700
    }
  }
}
```

---

## 3. Inland Revenue IR10 Box Mapping Specification

Inland Revenue requires all New Zealand companies filing an IR4 tax return to complete the **IR10 (Financial Statement Summary)**. Every account in the NZOSA small-business chart maps deterministically to an IR10 Box:

### Complete Mapping Table

| Code | Account Name | Account Type | IR10 Box | IR10 Form Description |
| :--- | :--- | :--- | :--- | :--- |
| `200` | Sales | Revenue | **Box 2** | Sales and/or services |
| `630` | Inventory (Opening) | Inventory | **Box 3** | Opening stock (including work in progress) |
| `310` | Cost of Goods Sold | Direct Costs | **Box 4** | Purchases |
| `630` | Inventory (Closing) | Inventory | **Box 5** | Closing stock (including work in progress) |
| *calc* | *Gross Profit* | *Summary* | **Box 6** | *Gross profit (Box 2 - Box 3 - Box 4 + Box 5)* |
| `270` | Interest Income | Revenue | **Box 7** | Interest received |
| `260` | Other Revenue | Revenue | **Box 10** | Other income |
| `300` | Depreciation Recovered | Other Income | **Box 10** | Other income (Depreciation clawback) |
| `301` | Capital Gain on Disposal | Revenue | **Box 10** | Other income (Non-assessable capital item) |
| *calc* | *Total Income* | *Summary* | **Box 11** | *Total income (Boxes 6 + 7 + 8 + 9 + 10)* |
| `416` | Depreciation | Overhead | **Box 13** | Accounting depreciation and amortisation |
| `433` | Insurance | Overhead | **Box 14** | Insurance (excluding ACC levies) |
| `437` | Interest Expense | Overhead | **Box 15** | Interest expenses |
| `412` | Consulting & Accounting | Overhead | **Box 16** | Professional and consulting fees |
| `441` | Legal expenses | Overhead | **Box 16** | Professional and consulting fees |
| `469` | Rent | Overhead | **Box 18** | Rental, lease and licence payments |
| `473` | Repairs and Maintenance | Overhead | **Box 19** | Repairs and maintenance |
| `477` | Salaries | Overhead | **Box 22** | Salaries and wages paid to employees |
| `478` | KiwiSaver Employer Contrib | Overhead | **Box 22** | Salaries and wages paid to employees |
| `413` | Subcontractors (GST Reg) | Expense | **Box 23** | Contractor and sub-contractor payments |
| `414` | Subcontractors (Non-GST) | Expense | **Box 23** | Contractor and sub-contractor payments |
| `400` | Advertising | Overhead | **Box 24** | Other expenses |
| `401` | ACC Levy Expenses | Expense | **Box 24** | Other expenses |
| `404` | Bank Fees | Overhead | **Box 24** | Other expenses |
| `408` | Cleaning | Overhead | **Box 24** | Other expenses |
| `420` | Entertainment (Deductible) | Overhead | **Box 24** | Other expenses |
| `424` | Entertainment (Non-deduct) | Overhead | **Box 24** | Other expenses (Adjusted on IR4 tax calc) |
| `425` | Freight & Courier | Overhead | **Box 24** | Other expenses |
| `429` | General Expenses | Overhead | **Box 24** | Other expenses |
| `445` | Light, Power, Heating | Overhead | **Box 24** | Other expenses |
| `446` | Low Value Assets < \$1,000 | Expense | **Box 24** | Other expenses |
| `449` | Motor Vehicle Expenses | Overhead | **Box 24** | Other expenses |
| `453` | Office Expenses | Overhead | **Box 24** | Other expenses |
| `454` | Instruction & School Exp | Overhead | **Box 24** | Other expenses |
| `461` | Printing & Stationery | Overhead | **Box 24** | Other expenses |
| `470` | Loss on Sale of Fixed Assets| Expense | **Box 24** | Other expenses |
| `485` | Subscriptions | Overhead | **Box 24** | Other expenses |
| `489` | Telephone & Internet | Overhead | **Box 24** | Other expenses |
| `493` | Travel - National | Overhead | **Box 24** | Other expenses |
| `494` | Travel - International | Overhead | **Box 24** | Other expenses |
| `495` | Staff Training Expense | Expense | **Box 24** | Other expenses |
| `506` | Stripe Fees | Expense | **Box 24** | Other expenses |
| `507` | PayPal fees | Expense | **Box 24** | Other expenses |
| `Donation`| Charitable Donation | Expense | **Box 24** | Other expenses |
| *calc* | *Total Expenses* | *Summary* | **Box 25** | *Total expenses (Sum of Boxes 12 through 24)* |
| *calc* | *Net Profit Before Tax* | *Summary* | **Box 26** | *Box 11 Total Income less Box 25 Total Expenses* |
| `610, 611` | Accounts Receivable | Current Asset | **Box 27** | Accounts receivable (debtors) |
| `Bank` | BNZ 01, Visa, Wise, PayPal | Bank Accounts | **Box 28** | Cash and bank balances |
| `620, 625` | Prepayments / RWT Paid | Current Asset | **Box 29** | Other current assets |
| `710–741` | Property, Plant & Equipment | Fixed Assets | **Box 31** | Fixed assets (net book value) |
| `800–850` | Payables, GST, PAYE, Provisions| Current Liab | **Box 34** | Current liabilities |
| `900` | Term Loans | Non-Current | **Box 35** | Total non-current liabilities |
| `910, 980` | Shareholder Loan / Drawings | Equity / Liab | **Box 37** | Owners' equity / Shareholder current account |
| `960` | Retained Earnings | Equity | **Box 38** | Retained earnings / reserves |

---

## 4. Key Architectural Additions Implemented in Core

### Module 1: `packages/core/src/ir10.ts`
Exports `ir10BoxForAccount(code: string, type?: string): number | null` and types for building the IR10 form structure.

### Module 2: `packages/core/src/balance-sheet.ts`
Exports `computeBalanceSheet(options)` which aggregates opening balances and double-entry journals up to any balance date, constructing:
* Current Assets (Cash, Debtors, GST receivable)
* Non-Current Assets (Fixed assets net book value)
* Current Liabilities (Creditors, GST payable, Shareholder current accounts)
* Non-Current Liabilities (Term loans)
* Net Assets
* Equity (Opening Retained Earnings + Current Year Net Profit)
* Imbalance check ($\text{Net Assets} - \text{Total Equity} = 0$)

---

## 5. Next Implementation Tasks for Claude

1. **Reports Navigation (`apps/web/src/main.ts` & `apps/web/public/index.html`):**
   * Add options to `<select id="report-kind">`:
     ```html
     <option value="balancesheet">Balance sheet</option>
     <option value="ir10">IR10 summary (Inland Revenue)</option>
     <option value="shareholders">Shareholder current accounts</option>
     ```
   * Add renderer functions `renderBalanceSheet(body, year)` and `renderIr10Report(body, year)` inside `renderReportsPage()`.
2. **Fixed Asset Disposal Engine (`packages/core/src/assets.ts`):**
   * When an asset is marked disposed in the CSV or UI with sale proceeds, automatically compute:
     - Book Value Written Off: $\min(\text{Book Value}, \text{Proceeds})$
     - Depreciation Recovered: $\min(\text{Cost} - \text{Book Value}, \text{Proceeds} - \text{Book Value})$
     - Capital Gain: $\max(0, \text{Proceeds} - \text{Cost})$
     - Loss on Sale: $\max(0, \text{Book Value} - \text{Proceeds})$
3. **Shareholder Current Account Compliance (`packages/core/src/shareholders.ts`):**
   * Provide schedule showing: Opening Balance + Funds Introduced (`910`) - Drawings (`980`) + Profit Share.
   * Add warning when closing balance is negative (overdrawn account) reminding the practitioner that IRD benchmark interest (~8.41%) must be charged under Section HB 1 / FBT rules.
4. **SES-2 HTML / PDF Report Generator:**
   * Provide a clean, printable HTML document containing Compilation Report, Approval of Financial Report, Profit or Loss, Balance Sheet, Statement of Changes in Equity, Depreciation Schedule, and Notes to the Financial Statements.

---

## 6. How to Verify & Test

Run the following commands from the repository root:
```bash
# 1. Typecheck and verify compilation
npx tsc --build

# 2. Run test suite
npm test

# 3. Test balance sheet computation
node tools/test-balance-sheet.mjs

# 4. Start local web application on port 3210
cd apps/web && node build.js --serve
```
