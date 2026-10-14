# SlowBooks Pro 2026 compared with NZOSA

What SlowBooks Pro 2026 (version 2.23.0, a desktop and server bookkeeping
application for United States small businesses, written as a replacement for
QuickBooks Pro) does that NZOSA does not.

How this was made: from SlowBooks' own shipped files -- its release notes
(`whats-new.json`, versions 2.7.0 to 2.23.0), its screens (`static/js`), its
report and form templates, and the 288 server routes its screens call --
set against what NZOSA's pages and core code do. It was not driven by hand
through SlowBooks' own screens, so a detail may differ in use.

"No" means NZOSA has nothing like it. "Partly" says what it has.

## Since this was written

Built after it, for non-New Zealand books: customer and vendor records (name,
company, email, phone, address, terms, tax ID, W-9, 1099 flag), imported from
QuickBooks lists and from the names on a QuickBooks ledger; statement-by-
statement bank reconciliation; invoices and bills read from a QuickBooks
ledger with their payments applied; a sales tax report; a payroll tax
worksheet for Form 941; self-employment and estimated tax; estimates made
into invoices; purchase orders that post nothing until approved; products and
services that fill an invoice line; budgets and budget vs actual; customer
statements; classes with a profit and loss by class; QuickBooks Desktop
IIF import (chart, customers, vendors, transactions and classes); time
entries invoiced by customer; reminder letters, late fees and writing off
small balances; credit limits; a vendor's usual account. Jobs are classes
(time can carry one, and its invoice goes under it). Stock is tracked line
by line at average cost, and counted. SlowBooks' own
General Ledger CSV is read whole, and was checked against SlowBooks with
entries entered in it. Still not built: reorder points and stock reports by
movement, a US payroll engine (941, 940, W-2), and the nonprofit statements.

## Sales (money in)

| SlowBooks | NZOSA |
|---|---|
| **Customer records**: name, addresses, phone, email, terms, credit limit, tax-exempt flag, W-9/tax details, notes, active or inactive, a page of its own with its invoices, payments and credits | No. A customer is the text on an invoice's contact; the email address is kept on the invoice |
| **Customer statements** (PDF, one or batch-emailed) and **collection letters** | No |
| **Estimates** (quotes) converted to invoices, and into a job's budget | No |
| **Sales receipts** (paid on the spot) | Partly: an invoice paid at once |
| **Credit memos** applied to invoices, voided, or held as customer credit | Partly: credit notes against an invoice |
| **Customer credit limit** enforced on invoices and estimates | No |
| **Write off small balances** in one go from the aging report, each to its own credit memo | Partly: a write-off on one invoice |
| **Late fees** applied to overdue invoices | No |
| **Batch payments**, one receipt across many invoices | Partly: one payment settling several invoices on Reconcile |
| **Receive payment screen** with deposits to **Undeposited Funds**, then **Make Deposits** and **deposit slips** (PDF) | No. Receipts are matched to bank lines |
| **Recurring invoices** | Yes (repeating invoices) |
| **Foreign-currency invoices** at an exchange rate, with FX rates | No: one currency per set of books |
| **Online payment links** (a customer pays a public page) | No |
| **Email templates** for invoices, with preview, before sending | No: a plain email message |
| **Invoice PDF** with the company logo, and print | Partly |
| **Per-line sales tax**: taxable and untaxed lines on one invoice, rates to four decimals, tax-exempt customers | No: there is no US sales tax |
| **Sales tax report** and **Pay Sales Tax** by jurisdiction; reseller permits (with expiry and verification) | No |

## Purchases (money out)

| SlowBooks | NZOSA |
|---|---|
| **Vendor records**: contact details, terms, default expense account, **W-9 on file**, 1099 flag, a page of their own | No |
| **Purchase orders**, converted into bills | No |
| **Vendor credits** applied to bills | Partly: credit notes |
| **Pay bills** screen, one payment per vendor, bill payments voidable, **checks** (PDF) | No. Bills are matched to bank lines |
| **Expenses** and **credit-card charges** entered as documents, voidable | No: bank and card lines are the entries |
| **Receipt intake**: scan a receipt (OCR) into a bill or expense | No |
| **Attachments** on bills, expenses, journal entries and employees, kept with the company file | No: only a link to a document |
| **Bill and purchase order PDFs** | Partly |

## Inventory and projects

| SlowBooks | NZOSA |
|---|---|
| **Items and services**: price, cost, income and expense accounts, inventory with quantity on hand, adjustments, movements, reorder points and low-stock | No (an item code on a line only) |
| **Jobs** under customers with budgets, **cost codes**, cost types, job cost entry, a cost tree, job profitability, job budget vs actual | No |
| **Classes** across every transaction, **P&L by class**, unclassified, by job, with a warning when a class is missing | No (entities do part of this) |
| **Time entries**, approval, posting to jobs at loaded labour rates | No |
| **Budgets** by account and year, with **budget vs actual** | No |
| **Equipment** register | No |

## Banking

| SlowBooks | NZOSA |
|---|---|
| **Bank rules** created from a statement line | Partly: rules and suggestions are made from coding |
| **Bank feeds** through SimpleFIN (any provider) | No. Akahu and Wise only |
| **Bank of America CSV** and other US bank files; QFX/OFX | OFX and QFX only |
| **Reconcile** to a statement with Mark all, Mark through a date, Clear all, locking what it closed, with a report | Partly: a bank reconciliation report and the daily-balance check; no statement-by-statement tick-off |
| **Check register** per account with running balance | No |
| **Transfers** between accounts, credit-card payments | Yes (paired transfers) |

## Accounting

| SlowBooks | NZOSA |
|---|---|
| **Chart of accounts**: add, edit, deactivate, delete, CSV template, import from CSV or hledger | Partly: import and edit; no delete |
| **Journal entries**, voidable, with receipts attached | Yes (manual journals) |
| **Opening balances** screen | Yes |
| **Fixed assets** with depreciation runs, disposal, reconciliation to the ledger | Yes |
| **Financial Statements Pack**, one PDF | Partly (year-end packs) |
| **Saved reports**, **report addresses** that can be bookmarked, drill-down from every row | Partly: drill-down yes; saved reports no |
| **Dashboard** with arrangeable cards and a revenue trend | No: Actions required |
| **Analytics** with AI insights and a PDF brief | No: AI suggests codes and checks |
| **Audit log** with every field change, and **document audits** with a footer hash that can be verified | Partly: History and undo |
| **Multi-user** with roles, per-user dashboards, read-only users | Partly: roles on online books only |
| **API tokens** and a documented API for other tools | Partly: an MCP server |
| **Multiple companies** with a picker | Yes (sets of books and entities) |
| **Backups** per company, restore | Yes |
| **Idempotency keys** so a repeated request books once | No (not needed: no API for posting) |

## Payroll and HR (United States)

NZOSA has New Zealand payroll only (PAYE, KiwiSaver, student loan, payday
filing). SlowBooks has:

- Federal withholding and **state withholding for all 50 states and DC**, state W-4 fields.
- **Form 941, Form 940, W-2, W-3, 1099-NEC and 1096** generated, with a history of every one made and a check that re-figures it from today's books.
- **Benefits engine**: benefit codes, rates by effective date, employer matching, groups, remittance bills.
- **Garnishments**.
- **PTO banks** with accrual, requests, approval, cancellation, and a liability posted.
- **Time off** requests and an **employee portal** (their own link).
- **New hire report**, **E-Verify** record, employee bank accounts and documents, onboarding checklists.
- Payroll burden flowing to jobs by hours; NACHA files for direct deposit.

## Nonprofit (United States)

NZOSA has grants, donation receipts and the New Zealand society reports.
SlowBooks has, for the United States:

- **Funds with donor restrictions** and **release from restriction**.
- **Statement of Activities**, **Statement of Financial Position**, **Fund balances**.
- **Program, management and fundraising allocation** on expenses, allocation rules, and the **Statement of Functional Expenses** (Form 990 Part IX).
- **Pledges** and a pledge report; **in-kind gifts**; **year-end giving statements** and acknowledgment letters with IRS language, batch-emailed.

## Interoperability

| SlowBooks | NZOSA |
|---|---|
| **IIF import and export** (QuickBooks Desktop) including classes, jobs, bills, deposits | No |
| **QuickBooks Desktop Transaction Detail CSV** to invoices, with open balances | No (the QuickBooks Online chart and general ledger, now) |
| **QuickBooks Online** connection: import journals and ledger activity, export | No |
| **Migrating from Wave** (account transactions, full export) and other sources, with a dry run first | Xero and spreadsheets, QuickBooks Online ledger; dry runs on some |
| **CSV import and export** of lists | Partly |

## What NZOSA has that SlowBooks does not

- Live New Zealand bank feeds (Akahu), Wise, and bank lines coded by rules that learn.
- AI suggestions and an AI check against IRD guidance and OpenAccountants, off until asked.
- Many entities in one set of books, with shared bank accounts, between-entity money and owner shares.
- New Zealand returns: GST, IR3, IR4, IR6, IR7, IR9, IR10, rental schedules, trust beneficiaries, payday filing.
- Lock dates, per-line confirmation, and History with undo on every change.
- Hosted books with sign-in, invitations, and read-only, bookkeeper and accountant roles.
- Australia and South Korea packs (work in progress).
- Free software under the AGPL.
