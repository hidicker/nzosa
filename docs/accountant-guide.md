# NZOSA: A Guide for Accountants and Tax Practitioners

What this software does with client financial data, how its double-entry journal engine works, what it will and will not do, and how its figures can be verified for New Zealand Inland Revenue (IRD / Te Tari Taake) compliance.

Read this before relying on anything it produces.

---

## 1. What It Is — And the Rules of Engagement

NZOSA takes raw bank exports and live bank feeds, reconciles invoices and fixed assets, and produces a fully balanced double-entry transaction ledger, statutory GST returns, and annual financial summaries. It runs locally on your machine or inside a browser — financial data is processed in-memory and on your local disk, never uploaded to third-party cloud servers.

### Can It Be Used to Prepare Accounts?

**It is your judgement alone, we suggest the safeguards below. At this point it is still a WIP.** NZOSA is built to be checked rather than trusted: every reported figure decomposes into the bank lines, invoices and human decisions behind it, and the trial balance proof in section 2 either balances to zero or names the journal that does not. Section 9 sets out how to validate it against a signed set of accounts before you rely on it.

**It must be used with caution and professional diligence.**

1. **No Developer Guarantees or Warranties:** NZOSA is open-source software distributed under the MIT Licence. It is provided strictly *"as is"*, without warranty of any kind, express or implied. Neither the developers who wrote it nor anyone distributing it assume any liability or legal responsibility if a figure, tax classification, or return is incorrect. The compiling accountant, tax agent, or taxpayer remains entirely responsible for every figure filed with Inland Revenue.
2. **Not a Blind "Black Box":** The software is deliberately designed around **complete auditability and traceability**. It does not make opaque adjustments or hide unreviewed guesses. Every ledger figure decomposes into visible bank lines, source invoices, and explicit human decisions.
3. **Accountant in the Loop:** NZOSA automates the mechanical heavy lifting of bank transaction coding, GST classification, invoice settlement matching, and asset depreciation calculations. What it does not replace are the professional judgements of a qualified accountant: year-end closing journals, opening equity reconciliations, tax provisions, shareholder loan benchmark interest adjustments, and compilation disclosures under Service Engagement Standard 2 (SES-2).

---

## 2. How the Double-Entry Journal Works

At the very heart of NZOSA is a deterministic, balanced **double-entry journal posting engine**. Understanding how this engine functions is essential for any accountant reviewing its output.

### The Journal Entry Model

Unlike simple single-entry cashbooks that merely categorise bank inflows and outflows, every approved transaction in NZOSA generates balanced double-entry journal lines:

$$\sum \text{Debits} = \sum \text{Credits}$$

Each journal line carries an Account Code, Account Name, Monetary Amount (tracked in integer cents to eliminate floating-point rounding discrepancies), and explicit GST Classification metadata.

#### Example A: Standard Expense with GST
When a $115.00 payment for advertising clears the bank account:

```text
Dr  400 Advertising Expenses       $100.00   [15% GST on Expenses — Input Tax]
Dr  820 GST Control Account         $15.00   [15% GST on Expenses — Claimable in Box 11 & 12]
Cr  Bank Account (BNZ Current)     $115.00   [Out of Scope — Gross Bank Settlement]
```

#### Example B: Invoiced Sale vs Bank Settlement (Avoiding Double-Counted Revenue)
In an accrual-aware accounting workflow, customer sales are invoiced before payment:

1. **When the Sales Invoice is Issued:**
   ```text
   Dr  610 Accounts Receivable        $1,150.00  [Debtor Asset Created]
   Cr  200 Sales Revenue              $1,000.00  [Output Tax Supply]
   Cr  820 GST Control Account          $150.00  [Output Tax — Box 5 & 8]
   ```
2. **When the Bank Receipt Clears:**
   When the customer pays $1,150.00 into the bank account, NZOSA matches the payment to the outstanding invoice. The receipt does **not** credit Sales again (which would inflate revenue by 100%):
   ```text
   Dr  Bank Account (BNZ Current)     $1,150.00  [Cash Asset Inflow]
   Cr  610 Accounts Receivable        $1,150.00  [Debtor Asset Settled]
   ```

#### Example C: Inter-Bank Account Transfers
When funds move between the trading current account and the business credit card, single-entry systems often double-count income and expenditure or leave unreconciled balances in clearing accounts. 

NZOSA pairs corresponding outflow and inflow legs across accounts owned by the same entity:
```text
Dr  BNZ Visa Card                  $1,260.65  [Liability Reduction / Card Inflow]
Cr  BNZ 01 Current Account         $1,260.65  [Cash Outflow]
```
Both legs are posted as **one single journal**, with no intermediate clearing account, and both sides marked strictly *Out of Scope* for GST.

#### Example D: Split Transactions (e.g. Stripe Payouts & Customs Border GST)
Real commercial transactions rarely fit single ledger categories. NZOSA enforces that all split parts must sum to the bank statement line to the exact cent:

* **Stripe Card Payout:** A net bank deposit of $972.43 represents gross sales of $1,000.00 less Stripe processing fees of $27.57:
  ```text
  Dr  Bank Account                   $972.43  [Net Cash Deposited]
  Dr  506 Stripe Fees                  $27.57  [No GST / Exempt Expense]
  Cr  610 Accounts Receivable / 200  $1,000.00  [Gross Sales Settled, incl GST]
  ```
* **Customs Border GST:** A courier payment of $1,039.02 may represent $102.42 of freight (subject to 15% GST) and $936.60 of customs border GST paid on behalf of the importer. In NZOSA, the $936.60 is tagged as `imports` (100% GST claimed directly in Box 13), while $102.42 is standard freight.

### Derived vs Stored Postings

In NZOSA, **journal lines are derived, not frozen in opaque database tables**. 

When you modify a rule, correct an account mapping, or assign an invoice settlement, the journals for those transactions are recomputed from the underlying source data and the updated human decision. This ensures that the ledger never suffers from "drift" or orphan records where a rule was updated but historical journal lines were left stranded.

### The Trial Balance Proof

NZOSA can run a full mathematical proof over every journal in the book. However many journals and lines a set of books holds, the aggregate is the same:

$$\text{Total Debits} - \text{Total Credits} = \$0.00$$

If any journal fails to balance to zero, NZOSA flags the offending journal ID and blocks generation of financial reports until the discrepancy is resolved.

---

## 3. The Three Accounting Bases

One of the most common pitfalls in small business software is conflating cash movements with accrual financial statements. NZOSA clearly separates three accounting bases:

| Feature | Cash Basis | Accrual (Own Postings) | Accrual (Imported General Ledger) |
| :--- | :--- | :--- | :--- |
| **Primary Source** | Bank statements | Bank + Invoices + Assets | External General Ledger export (e.g. Xero) |
| **Revenue Recognition** | When money hits the bank | When sales invoice is issued | When entered in GL |
| **Expenses Recognized** | When money leaves the bank | When bill is issued / paid | When entered in GL |
| **Depreciation** | Never | From Fixed Asset Register | From GL journals |
| **GST Returns** | **Used for Payments Basis (GST101A)** | Reconciles to Debtors/Creditors | Audit comparison |
| **Financial Statements** | Cash flow only | Management / Draft accounts | Statutory SES-2 Annual Accounts |

### Why Cash and Accrual Differ (And Why That Is Correct)

A cash P&L will almost never equal an accrual P&L. Taking round figures for illustration:
* **Invoiced sales (accrual):** $85,000
* **Cash banked in the year:** $79,700
* **Difference:** $5,300

This difference is not an error — it is the net movement in trade debtors across the balance date. Sales invoiced in March and paid in April belong to the year they were invoiced in, and to next year's bank statement. Expect the two figures to differ, and expect the difference to equal the movement in Accounts Receivable; if it does not, something is miscoded. NZOSA’s dual-engine allows you to prepare GST returns on the cash/payments basis mandated by Inland Revenue while simultaneously tracking trade debtors and accrued revenue.

---

## 4. Chart of Accounts and New Zealand Tax Rules

NZOSA is pre-configured with the standard New Zealand small company chart of accounts:

* **200–299: Revenue** (200 Sales, 260 Interest Income, 270 Other Revenue)
* **300–399: Cost of Sales** (310 Cost of Goods Sold, 320 Freight Inwards, 330 Packaging)
* **400–499: Operating Overheads** (400 Advertising, 412 Consulting & Accounting, 420 Entertainment, 433 Insurance, 449 Motor Vehicle, 469 Rent, 485 Subscriptions)
* **700–799: Fixed Assets** (710 Computer Equipment, 720 Office Equipment, 730 Plant & Equipment, 740 Motor Vehicles, and accumulated depreciation contra-accounts)
* **800–899: Current Liabilities & Equity** (800 Accounts Payable, 820 GST Control, 840 PAYE Payable, 860 Retained Earnings, 880 Share Capital)
* **900–999: Non-Current Liabilities & Director Loans** (910 Loan from Director, 980 Owner Drawings)

### GST Classification Engine (Te Tari Taake Rules)

The GST engine operates according to the Goods and Services Tax Act 1985:

1. **Standard Rated (15%):** Tax fraction of $3/23$ applied to tax-inclusive amounts. Claimed in Box 11 & 12 (Purchases) or returned in Box 5 & 8 (Sales).
2. **Zero-Rated (0%):** Exports, financial services where applicable. Reported in Box 5 and deducted in Box 6.
3. **Exempt / Out of Scope:** Bank fees, interest, drawings, director loans, inter-account transfers, and Inland Revenue tax settlements. Does not appear on the GST101A form.
4. **Customs / Border GST Imports:** 100% of the line is tax (no $3/23$ fraction). Claimed in Box 13 as a credit adjustment.
5. **50% Non-Deductible Entertainment:** Under Subpart DD of the Income Tax Act 2007, business entertainment (meals, corporate events) is only 50% deductible for income tax, and the associated GST input tax on the non-deductible half must be adjusted. NZOSA supports assigning a `deductiblePercent: 50` tag to entertainment expenses to maintain statutory compliance.

---

## 5. Bank Feeds and Verification of Completeness

A major source of accounting error is missing transactions or duplicate imports. NZOSA addresses this at two levels:

1. **Akahu Open Banking Integration:** Direct, read-only OAuth connection to New Zealand registered banks (ANZ, ASB, BNZ, Westpac, Kiwibank). Pulls transactions directly with end-to-end data integrity.
2. **Daily Balance Verification (`Bank import → Check against the bank's own balances`):** Compares the running balance of imported transactions against the bank’s official daily closing balances. If a transaction is missed or duplicated, NZOSA flags the exact calendar day and exact dollar variance immediately.

---

## 6. The Decisioning Engine: Rules Suggest, Humans Decide

Automated accounting AI often fails when it guesses silently. NZOSA adheres to a strict design principle:

* **Rules Propose:** Machine learning or regex keyword rules suggest a probable account code and GST treatment.
* **Humans Decide:** No coding becomes part of the permanent ledger until a human confirms it or overrides it.
* **Immutable Bank Feed:** Raw statement data lives in `transactions.json` and is never altered. User decisions live in `decisions.json`.
* **Audit Change Log:** Every change is timestamped and recorded in `events.json`, allowing full historical playback and rollback.

---

## 7. Meeting Inland Revenue (IRD) Requirements

From the perspective of an accountant, tax agent, or IRD auditor, software must satisfy specific statutory criteria under the Tax Administration Act 1994 (TAA):

### Record-Keeping (TAA Section 22)
Under section 22, taxpayers must keep sufficient records in English or Te Reo Māori to enable the Commissioner to ascertain readily their taxable income, allowable deductions, and GST liabilities, and retain them for at least 7 years.
* NZOSA stores all data in standard, non-proprietary JSON files on local disk. 
* Books can be copied, archived, or version-controlled using Git, ensuring that financial records remain permanently readable without vendor lock-in or subscription requirements.

### GST Returns (GST101A)
Returns are generated on the payments basis for one-monthly, two-monthly, or six-monthly filing periods. Box 5 through Box 15 reconcile directly to tagged journal lines.

### IR10 Financial Statements Summary
Every company income tax return (IR4) filed in New Zealand requires an IR10 summary or full financial statements. NZOSA accounts map directly to the IR10 box categories:
* Box 2: Sales / Operating Revenue
* Box 4: Purchases / Direct Costs
* Box 10: Other Income (e.g. Depreciation Recovered)
* Box 13: Depreciation
* Box 14: Insurance
* Box 16: Professional & Consulting
* Box 18: Rent
* Box 23: Contractor Payments
* Box 24: Other Expenses

### Shareholder Current Accounts (Section HB 1 & FBT/Deemed Dividend Rules)
In owner-operated New Zealand companies, transactions between the company and its shareholders are heavily scrutinised by the IRD:
* If a shareholder current account becomes overdrawn (the shareholder owes the company money), the company has provided a low-interest or interest-free loan. The IRD prescribes an official **benchmark interest rate** (currently ~8.41%). If interest is not charged at or above this benchmark, the shortfall is treated as a taxable dividend or subject to Fringe Benefit Tax (FBT).
* NZOSA explicitly isolates **Drawings** (`980`) and **Funds Introduced** (`910`), allowing practitioners to accurately produce the Shareholder Current Account schedule required for Page 2 & Page 3 of the IR4 tax return (Boxes 40A–40E).

---

## 8. Producing Annual Financial Statements (SES-2 Standard)

To prepare financial statements that can be signed by directors and submitted to banks and Inland Revenue, accounts must comply with the *Special Purpose Financial Reporting Framework for For-Profit Entities* (SPFR for FPEs), compiled under *Service Engagement Standard No. 2 (SES-2)*.

A full statutory financial report consists of eight essential parts:

1. **Compilation Report:** The practitioner’s report detailing scope, responsibilities, disclaimers, and lack of audit assurance under SES-2.
2. **Approval of Financial Report:** Formal resolution signed and dated by the Board of Directors under the Companies Act 1993.
3. **Statement of Profit or Loss:** Categorised into Trading Income, Cost of Sales, Gross Profit, Other Income, Operating Expenses, Non-Assessable Income, Non-Deductible Expenses, and Net Profit Before and After Tax.
4. **Balance Sheet (Statement of Financial Position):** Current Assets (Bank, Debtors, GST), Non-Current Assets (PPE), Current Liabilities (Creditors, GST, Shareholder Loans), Net Assets, and Equity.
5. **Statement of Changes in Equity:** Opening balance, Net Profit for the year, Dividends/Drawings, Closing Equity.
6. **Depreciation Schedule:** Line-by-line register of all fixed assets showing asset description, purchase date, cost, opening book value, additions, disposals (sale proceeds and gain/loss), depreciation rate, method (SL or DV), current year depreciation, and closing book value.
7. **Shareholder Current Accounts Schedule:** Detailed reconciliation for each shareholder: Opening balance, Funds Introduced, Share of Profit / Salaries, Drawings, and Closing balance.
8. **Notes to the Financial Statements:** Accounting policies adopted (measurement base, revenue recognition, accounts receivable valuation, depreciation rates, GST presentation).

### What NZOSA Provides vs What the Accountant Supplies

| Statement / Schedule | NZOSA Native Capability | What the Accountant / Practitioner Supplies |
| :--- | :--- | :--- |
| **Profit or Loss** | Complete from bank + invoices + assets | Year-end non-cash adjustments (accruals, provisions) |
| **Depreciation Schedule** | Computed from Fixed Asset CSV | Review of depreciation rates & tax vs book methods |
| **Asset Disposals** | Book value derecognition | Splitting proceeds into Capital Gain vs Depn Recovery |
| **Balance Sheet** | Bank balances, Debtors, Creditors | Opening balances, Tax provisions, Retained earnings |
| **Equity Statement** | Current year net profit | Opening equity from prior year's signed accounts |
| **Shareholder Accounts** | Drawings & Funds Introduced movements | Opening balances, salary allocations, benchmark interest |
| **SES-2 Compilation Report** | Standard markdown/HTML export template | Professional sign-off, firm letterhead, client disclosures |

---

## 9. Validating It Against a Signed Set of Accounts

Do not take this guide's word for any of the above. The way to satisfy yourself is to run a year you already have signed accounts for, and see whether the figures come back. This is the recommended first use of the software on any client, and it takes an afternoon.

### What to load

* Every bank account for the year, from the bank's own export, plus the bank's daily balance export if it offers one.
* The chart of accounts.
* The coded history for the year, so the rules learn from work already done.
* Sales invoices and bills.
* The fixed asset register.
* The trial balance at the previous year end, for opening balances.
* The general ledger or journal report, for the year-end journals.
* The GST returns as filed.

### What to compare, and in what order

Work down this list. Each step depends on the one above it, so a difference found late is usually caused by something skipped early.

1. **Bank completeness first.** Every account's closing balance must agree with the bank's own figure. Until this holds, nothing below it means anything: a report built from an incomplete set of transactions can still balance perfectly and still be wrong.
2. **Trial balance proof.** Debits less credits across every journal must be zero.
3. **Balance sheet.** Compare against the signed statement of financial position, line by line. Differences here usually mean opening balances, not coding.
4. **Profit or loss, line by line.** Expect most lines to agree exactly and a handful not to. The exceptions are the interesting part.
5. **Depreciation**, against the signed depreciation schedule.
6. **Each GST period**, against the return as filed.

### Reading the differences

A line that does not agree is not necessarily a fault in the software, and this is where professional judgement is actually required. In practice differences fall into a few recognisable kinds:

* **A year-end journal that exists only in the accountant's working papers.** Reclassifications, provisions, and adjustments made outside the accounting system will not appear in bank data. These are entered as manual journals with a narration saying why.
* **Entries dated before the ledger opens.** A prior-year accrual reversed on the first day of the year is real, and no bank export contains it.
* **A receipt coded to revenue that should have settled an invoice.** This overstates income and leaves the debtor outstanding. It is the single most common coding error this software finds, and it is worth checking for specifically.
* **Rounding on a split.** Half of an odd amount is not a whole number of cents. The convention here is that the odd cent goes to the first part.
* **A genuine error in the signed accounts.** This does happen. Do not assume the signed figure is right merely because it was signed; establish which of the two is correct before adjusting anything.

### The standard to hold it to

A validation has passed when every difference is *explained*, not when every difference is zero. An unexplained agreement is worth less than an explained difference: the first may be luck, the second is understanding. Record the explanations — they are the working papers for the year, and they are what makes the following year quick.

---

## 10. Summary Checklist for Practitioners

When using NZOSA to review client books or compile financial statements:

1. **Verify Bank Feed Completeness:** Run `Bank import → Check against the bank's own balances` to ensure zero missing or duplicated transactions.
2. **Review Uncoded & Guess Rates:** Ensure that 100% of transactions are confirmed decisions, with zero unreviewed guesses.
3. **Check Inter-Account Transfers:** Confirm that all inter-account sweep and credit card payments are paired as transfer journals.
4. **Reconcile Invoices & Debtors:** Verify that customer receipts settle invoices rather than posting directly to revenue.
5. **Reconcile Fixed Assets & Disposals:** Check that capital gains, losses on disposal, and depreciation recovery have been recognised.
6. **Input Opening Balances:** Carry forward opening retained earnings, opening shareholder current accounts, and opening fixed asset values from last year's signed financial report.
7. **Review Tax Adjustments:** Apply the 50% non-deductible entertainment split and remove non-assessable capital gains before finalizing taxable income.

With these safeguards in place, NZOSA provides an exceptionally rigorous, auditable, and transparent accounting platform for New Zealand small businesses and their professional advisors.
