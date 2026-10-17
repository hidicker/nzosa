# NZOSA outside New Zealand

Books can be kept in another country. The engine is the same everywhere:
- double entry and coding learned from past decisions
- matching and reconciliation
- the profit and loss, balance sheet and cash flow

What changes is a short list of facts about the country, and which returns the books produce.

This is the `international` branch. New Zealand's books open and read exactly as they did: the
parity check (below) compares every page, report and workbook sheet with `main`, word for word.

## Choosing the country

- **A set of books' country is `jurisdiction`** in its decisions.
  - Unset is New Zealand, so every set kept before this is New Zealand's.
- **The choice is under Setup → Country.** It shows only in the international edition:
  - `node apps/web/build.js --edition international` (or `NZOSA_EDITION=international`)
- **Books already set to another country show it in either edition.**
- **NZOSA as it ships never asks.**

## What the country decides

| | New Zealand | Australia | United States | South Korea | Anywhere |
|---|---|---|---|---|---|
| Tax year | 1 Apr – 31 Mar | 1 Jul – 30 Jun | Calendar | Calendar | Calendar |
| Currency | NZD | AUD | USD | KRW (shown without decimals) | USD |
| Sales tax | GST 15% (3/23) | GST 10% (1/11) | none | VAT 10% (1/11) | none |
| Usual GST period | 2 months | quarter | – | 6 months | – |
| Dates in bank files | day first | day first | month first | year first | day first |
| Starter chart | NZ small company | Xero AU | Schedule C/E names | 표준 계정과목 | NZ |

The facts are in `packages/core/src/jurisdiction.ts`. The web app reads them through:
- `apps/web/src/country.ts`: locale, currency, decimals, the rate of GST and the country's own reports
- `apps/web/src/tax-year.ts`: the year's dates, and the year in words

## Returns and reports by country

**New Zealand:** everything NZOSA has always done:
- GST returns, IR10, IR3 and IR3R
- payroll and myIR
- Akahu
- the AI accounts check

Modules tagged `countries: ["nz"]`, and pages marked `data-module="nz"` or `business+nz`, appear only for New Zealand books.

**United States** (`packages/core/src/us-tax.ts`):
- Schedule E Part I, one per rental property
- Schedule C, one per business, with half of business meals on line 24b and cost of goods sold off gross income
- 1099-NEC contractors: payments to contract labor accounts by payee, against the year's threshold
  - $600 to 2025, $2,000 from 2026: confirm
- The four estimated tax dates, moved off weekends
- Not covered:
  - federal or state income tax itself
  - state sales tax
  - payroll
  - Form 8582 passive loss limits
  - home office

**Australia** (`au-tax.ts`):
- The rental property schedule (individual tax return item 21) on the ATO's labels, with notes on:
  - residential travel (not deductible since 2017)
  - second-hand plant
- The business activity statement by quarter: the simpler BAS's G1, 1A and 1B, with the due dates for lodging yourself, and PAYG instalment income (T1), with the instalment (T11) once the ATO's notified rate is entered
- An income tax estimate for each owner: resident rates (2024–25 to 2027–28, with the 14% rate from 1 July 2027), the low income tax offset, the small business income tax offset on business income (not rent), and the Medicare levy with the single low-income reduction (the latest threshold held, for a year whose own is not set yet)
- The full BAS as well as the simpler one: G1, G2, G3, G10 and G11 with 1A and 1B, and the ATO's G1–G20 calculation worksheet beneath. G1 includes GST-free and input taxed sales; only entities registered for GST are on it (a rental kept as its own unregistered entity is not)
- Payroll (`au-payroll.ts`, the Payroll page): employees, pay runs, PAYG withheld by the ATO's Schedule 1 formula (scales 1 to 4, with the coefficients from 1 July 2024 and from 1 July 2026, checked against the ATO's worked examples; Medicare levy variations and declared tax offsets are for the employer to take off), the super guarantee at 12% with the annual maximum contribution base from 2026-27, and when each pay's super is due (7 business days from 1 July 2026, quarterly before). Pay runs post wages and super, and what is owed to employees, the ATO and the funds; W1 and W2 go on the BAS
- Single Touch Payroll: each pay event's figures and year to date, to report through STP-enabled software. NZOSA does not lodge STP itself
- Study and training support loans: the ATO's Schedule 8 component from 24 September 2025 and from 1 July 2026; before that, the marginal repayment from 2025-26 (nothing to $67,000, 15c to $125,000, 17c above, 10% of the whole from $179,286) withheld on top of PAYG, on thresholds lowered by the tax-free threshold where it is not claimed
- Depreciation (core `assets.ts`, `depreciationRules()` in the web app): by the days an asset is held in the books' own year, from the day it was bought; prime cost or diminishing value, with an effective life on the Fixed assets page setting the rate (200% or 100% of life). An asset disposed of is depreciated to the day it went, and the balancing adjustment note says the whole of a gain is assessable
- The accountant's workbook carries the BAS, rental property schedule and tax estimate in place of New Zealand's GST return, filed returns and IR3 sheets
- Xero Australia's tax codes read on import: GST on Capital (G10), GST Free (and GST Free Capital and Exports), Input Taxed, BAS Excluded
- Three lessons with the demo: the BAS, payroll (PAYG, super and STP), and depreciation, the rental and the tax estimate
- Checked against Xero's Demo Company (AU) on 17 October 2026, converting mid-year from its exports (chart, trial balance, invoices, bills, aged receivables and payables detail, fixed assets): the opening balance sheet matches Xero's trial balance account by account, and the aged receivables ($25,056.55) and payables ($8,507.78) match Xero's in every column. Its July to September BAS agrees on G1, G11, 1A and 1B
- Checked against the OpenAccountants Australian guides (`au-gst-bas`, `australia-gst`, `au-rates-2026-27`, `australia-payroll`, `au-super-guarantee`)
- Not covered:
  - Schedule 1's Medicare levy variations and declared tax offsets, and study loan withholding before 24 September 2025 (estimated on the year's pay)
  - G13, G15 and the adjustment labels on the full BAS
  - lodging STP, payroll tax, leave and termination payments
  - capital works (Division 43), low-value pools and the instant asset write-off

**South Korea** (`kr-tax.ts`), with each line in Korean and English:
- 표준손익계산서: the standard income statement for a sole proprietor
- 부동산임대업: rental income and expenses, with notes on deemed rent (간주임대료), separate taxation of housing rent up to 20 million won, and the single-house rule
- 부가가치세: VAT for each half year (1기, 2기), with the final return due dates
- Comprehensive income tax rates and local income tax are in core (`krIncomeTax`); the 31 May due date is on the business statement
- Not covered:
  - tax invoices against card and cash-receipt sales
  - preliminary returns (예정신고)
  - simplified taxpayers (간이과세자)
  - deemed rent itself
  - deductions and credits

How the forms work:
- **One engine fills every form:** `formSchedule` (core `form-schedules.ts`).
- **Placement:** an account goes on the first line whose rule its name matches, and the line lists the accounts behind it.
- **Choice:** a person's choice of line can be passed in, and wins over the guess.

Rates, thresholds and rules were checked on 7 October 2026 against the OpenAccountants guides:
- **United States:** us-1099-nec-issuance (accountant-verified), us-tax-workflow-base, us-sole-prop-bookkeeping and us-federal-return-assembly
- **Australia:** au-rates-2026-27, au-gst-bas, australia-gst and au-rental-property
- **South Korea:** kr-income-tax, written by the accountant Yeong Min Lee

That check corrected:
- Entertainment is not deductible in the US.
- The 1099-NEC note now covers attorneys and payment processors.
- Australia's low income tax offset and Medicare low-income threshold are applied.
- BAS due dates move off weekends.
- Australian rental losses are limited from 1 July 2027 (new builds, or properties held at 12 May 2026).
- Korea's tax base is rounded down to 10,000 won, with the basic deduction and standard credit applied.
- National pension and health insurance are kept out of Korean business expenses.

The guides are guidance, not certified figures: confirm each rate with the ATO, the IRS and the NTS (Hometax) before relying on it.

## Bank files

- **OFX and QFX** (`packages/core/src/ofx.ts`): most US and Australian banks offer them, as do some New Zealand banks. Both dialects are read through `importFile`:
  - OFX 1, SGML with unclosed tags
  - OFX 2, XML
- **The bank's FITID** is kept as the reference.
- **"Day first"** on Bank import follows the country.

## Moving from QuickBooks Online

Two exports are needed, dropped on Setup (or Start here) together or one at a
time; the rest add to them:

- **Chart of accounts** (Accounting > Chart of accounts > Export): account name, type and detail type. QuickBooks has no account codes, so they are made: 1100s receivables, 1200s other current assets, 1500s fixed assets, 2000s payables, 2100s other current liabilities, 2500s long-term, 3000s equity, 4000s income, 5000s cost of goods sold, 6000s expenses. Banks and cards get none, as Xero's do. A sub-account keeps its whole name (`Automobile:Fuel`).
- **General ledger** (Reports > General ledger, All dates, with the Line due date and Line open balance columns added, and Class where classes are used; Export to CSV). Every posting in it is put back into the entry it came from, and the entries become:
  - **Bank and card lines**, with a card's sign turned round, coded from the Split column so the coding check and the rules work as they do for Xero.
  - **Invoices and bills as documents**, due on the Line due date, with their payments applied where QuickBooks applied them (from Line open balance; oldest first without it): matched where a payment settled one, split where it settled several, recorded as paid outside the bank for a deposit to undeposited funds or a credit memo. They age, can be emailed and are matched like any other. Receivables and payables post to the chart's own accounts.
  - **Splits** on a bank line QuickBooks spread over several accounts; **transfers** paired between your own accounts; **journals** for the rest (stock adjustments, journal entries, sales receipts).
  - **Customers and vendors**, from the names on the entries, as records.
- **Customers and Vendors lists** (the Export on each page): addresses, emails, phone, terms, W-9 and 1099 flags, read by heading, by name, into the same records.
- **Products and services** (Sales > Products and services > Export): the price list, and stock on hand counted in for inventory items.
- **A/R and A/P Aging Detail, or the Invoice List**: due dates for the open documents, where the general ledger was exported without Line due date.
- **Trial Balance**: opening balances where the general ledger does not go back to the start. With an All dates ledger it is a check instead: once the coding is accepted, the coding check says whether every asset and liability balance agrees.

Checked against QuickBooks' own reports for the sample company (last on 17 October 2026, the Advanced edition, all seven files dropped together): profit and loss line by line, every balance sheet account, and each open invoice and bill against the A/R and A/P aging, all agree to the cent. A credit card is shown as a negative asset (as Xero's are), not a liability; net assets are the same.

It is not limited to one country: the exports have the same shape wherever QuickBooks Online is sold. The date order is taken from the file when a day past 12 settles it, and from the books' country otherwise. Code: `packages/core/src/quickbooks.ts` and `contact-lists.ts`, read in `apps/web/src/check-ui.ts` and `apps/web/src/migrate/quickbooks.ts`. Not yet read: tax reports, estimates and purchase orders.

## Moving from SlowBooks Pro

SlowBooks Pro's **General Ledger** report saved as CSV (Reports > General Ledger > CSV) holds every posting with its account number and name, debit, credit and source type, and is read on its own: account types come from the numbers (1000s assets, 2000s liabilities, 3000s equity, 4000s income, 5000s cost of sales, 6000s and on expenses) and the names (checking, savings, receivables, payables, credit cards); rows sharing a date, source, reference and description are one entry, and go the same way as QuickBooks' entries. Its IIF export is not the file to use: it leaves out journal entries and bill payments.

Checked on 15 October 2026 against SlowBooks Pro 2.23.0 with eight entries entered in it: profit and loss, bank, receivables, payables and equity all agree. Code: `packages/core/src/slowbooks.ts`.

## Moving from QuickBooks Desktop (IIF)

QuickBooks Desktop's IIF export (File > Utilities > Export > Lists to IIF Files, and transactions from an IIF-producing tool) is dropped on Start here like any other export. One file can hold everything:

- `!ACCNT` rows become the chart. An account's own number is kept as its code; one without is given a code from its type, in the same ranges as QuickBooks Online's. `CCARD` accounts are cards.
- `!CUST` and `!VEND` rows become customer and vendor records, with address, email, phone, terms, tax ID and the 1099 flag.
- `TRNS`/`SPL`/`ENDTRNS` blocks are entries, debits positive. They go the same way as QuickBooks Online's general ledger: postings to bank and card accounts become bank lines with their coding offered on the coding check, invoices and bills become documents with payments applied, money between your own accounts is paired as transfers, and the rest are journals. An entry that does not balance is left out and listed.

Dates are read month first. Code: `packages/core/src/iif.ts`, sharing `quickBooksBooksFrom` in `quickbooks.ts`. The `CLASS` column is given to the Classes page for bank lines and invoices and bills; a journal's is not carried yet.

## United States pages

Shown for books kept outside New Zealand:

- **Customers & vendors** (`contacts-page.ts`): records looked up by name from invoices and bills; names are offered when an invoice is written, and an invoice takes the customer's email.
- **Reconcile a statement** (`statements-page.ts`, core `reconciliation.ts`): type the statement's ending balance, tick the lines it cleared, finish when the difference is nothing. Each finished statement keeps its lines, so the next starts where it ended.
- **Products & services** (`items-page.ts`): a price list; an invoice line written with an item's name takes its account and price.
- **Stock** (core `stock.ts`, `stockCostJournals` in `books.ts`): a product with a cost a unit is kept in stock. A bill line naming it, with a quantity, goes into the Inventory account; an invoice line takes it out at the average cost, posted from Inventory to cost of goods sold on the invoice's date. A stock count values what is on hand, resets the quantities, and posts the difference as a journal. Products & services shows what is on hand.
- **Budgets** (`budgets-page.ts`): one figure per income or expense account per year, and a **Budget vs actual** report with the year to date.
- **Estimates and purchase orders**: an invoice saved as an estimate, or a bill kept as a purchase order, posts nothing until it is made an invoice or approved. An estimate prints and emails as an estimate.
- **Customer statements**: from Customers & vendors, a printable statement of what a customer owes, aged.
- **Getting paid**: from Customers & vendors, a reminder letter for what is past due (a first reminder, second notice or final notice by how late the oldest invoice is), a late fee drafted as an invoice to approve, and small balances written off to a bad debts account in one go. A customer can have a credit limit, which warns when an invoice would go over it; a vendor a usual account, which fills a new bill.
- **Time** (`time-page.ts`, core `time-entries.ts`): hours for a customer at a rate, optionally for a class; what is not invoiced is gathered by customer and drafted into an invoice with a line per entry.
- **Classes** (`classes-page.ts`, core `classes.ts`): a class given to a bank line, invoice or journal, and a **Profit and loss by class** report. An invoice's payment goes with the invoice.
- **Invoice documents** drop the GST column and write dates month first where there is no sales tax.
- **Reports**: Schedule C, Schedule E, Contractors and 1099-NEC (with W-9 on file), Self-employment and estimated tax, Sales tax collected and paid (read from the liability accounts), and a Payroll tax worksheet for Form 941 (read from the wage and payroll tax accounts, by quarter).

## The United States demo

`apps/web/public/demo/us/ledger.json`, made by `node tools/make-demo-us.mjs`: Ellis Design Studio (a sole proprietor, Schedule C) and a rented duplex (Schedule E), January to September 2026, 126 bank lines on two accounts, seven left uncoded, and three contractors for the 1099-NEC report. It is a demo persona like the others (`demo-personas.ts`, id `us`), so it is chosen from "Demo books" on the Tutorials page; switching between it and the New Zealand books reloads the page, because the country sets the reports, tax and currency as the app opens. Its lessons are `us-schedules` and `us-quickbooks`; the welcome and code-a-line lessons read differently where there is no sales tax.

Two company sets sit beside the sole traders, and the demo list runs United States, Australia, New Zealand. `demo/us-company/`, made by `node tools/make-demo-us-company.mjs`: Cedar Ridge Landscaping, Inc., a C corporation in Oregon (no sales tax), January to September 2026, with each payday's Gusto register as a manual journal, monthly EFTPS deposits split across the payroll tax accounts (the Form 941 worksheet reads them), estimated Form 1120 payments and a dividend; lesson `us-corporation`. `demo/au-company/`, made by `node tools/make-demo-au-company.mjs` after building core: Southern Cross Plumbing Pty Ltd, the year to 30 June 2026, a director and an apprentice (with a study loan) on fortnightly pay, quarterly BAS with PAYG withheld and the company's own instalments, a franked dividend and a drain camera depreciated; lesson `au-company-tax`. The tax estimates show a company's own tax (21% on Form 1120; 25% as a base rate entity or 30% in Australia), and Schedule C leaves corporations out.
