# SlowBooks Pro 2026 compared with NZOSA

What SlowBooks Pro 2026 does, set against NZOSA, and what of it NZOSA could
take. SlowBooks is a desktop and server bookkeeping application for United
States small businesses, written as a replacement for QuickBooks 2003.

How this was made, on 24 October 2026: from SlowBooks 2.27.0's source (its
574 server routes, its data models and services), its feature catalogue
(`docs/features.md`) and its release notes from 2.23.4 to 2.27.0, each set
against NZOSA's pages and core code as they stand on main. It was not driven
by hand through SlowBooks' screens, so a detail may differ in use. Earlier
versions of this comparison: 15 and 18 October 2026, against 2.23.0 and
2.23.4. Nothing of SlowBooks' code is used in NZOSA; its licence is
source-available, not free software, and this compares what it does only.

**Has** — NZOSA does it. **Partly** — says what NZOSA has. **No** — nothing
like it. The last column is whether NZOSA could take it: **Yes**, **US** (for
United States books only), or **No** (with why).

## Sales (money in)

| SlowBooks | NZOSA | Take? |
|---|---|---|
| Invoices: create, edit, void, duplicate, mark sent, email as PDF, numbering, terms | Has | — |
| Estimates converted to invoices | Has: "Save as quote" in New Zealand, "Save as estimate" elsewhere, listed on Invoices until made an invoice | — |
| Sales receipts (paid on the spot), and a walk-in customer | Partly: an invoice paid at once | Yes |
| Payments across several invoices, oldest first; batch payments across customers | Partly: a bank line settling several invoices on Reconcile | — (NZOSA matches to bank lines) |
| **Customer credits**: an overpayment or credit note held on the customer's account and applied later | Partly: credit notes against a named invoice | Yes |
| Credit limits, late fees, writing off small balances | Has | — |
| Recurring invoices | Has | — |
| Saved invoice messages (how to pay, a thank-you), one the default | Has | — |
| Email templates, editable, for invoices, statements and reminders | Has, with fill-ins such as {customer} and {amount} | — |
| Email all overdue statements from the receivables aging | Has: every overdue customer listed on Customers & vendors, one press each to save the statement or reminder and open the message | — |
| Customer statements and collection letters | Has | — |
| **Foreign-currency invoices** at an exchange rate, realised gain or loss on payment | No: one currency per set of books | Yes (large; the same work as Wise balances in other currencies) |
| **Online payment link** (Stripe, PayPal, Square) and a public pay page | No | Yes, with a decision on the provider and on keys held online |
| **Quick entry** of a backlog of paper invoices, save and next | No | Yes |
| Quantities and unit prices to four decimal places | Has: an optional quantity and price on any line, worked in whole numbers to the cent | — |
| Logo on invoices | Has | — |
| Per-line sales tax, tax-exempt customers, reseller permits, Pay Sales Tax | Partly: a sales tax report from the liability accounts | US |

## Purchases (money out)

| SlowBooks | NZOSA | Take? |
|---|---|---|
| Vendor records, usual account, inactive | Has | — |
| Vendor page: paid this year and all time, payments CSV | Has: Payments on each supplier in Customers & vendors, from the bank lines paid to them | — |
| Purchase orders to bills | Has | — |
| Bills, edited after posting | Has | — |
| A bill line as an amount alone (no quantity and rate) | Has: a line is an amount, with a quantity and price only if wanted | — |
| **Vendor credits held on account**, applied to later bills | Partly: credit notes against a bill | Yes (with customer credits) |
| Expenses and card charges as documents | Partly: bank and card lines are the entries | — |
| **Receipt scanning** into a bill or expense (OCR on the computer, no AI) | Partly: an AI can read a PDF bill | Yes: OCR in the page, no AI, no upload |
| **Attachments**: the receipt or file kept with a bill, expense, invoice, journal, contact | No: a link to a document only | Yes (storage in the folder, or Supabase Storage online) |
| Duplicate-name warning when a customer or vendor is added | Has: a name like one already there (spelling, accents, Limited, a letter apart) is asked about | — |
| Pay bills screen, printed checks | No | No: cheques are all but gone in New Zealand; bills are matched to bank lines |
| W-9, 1099 vendors, 1099-NEC and 1096 | Has (US) | — |

## Banking

| SlowBooks | NZOSA | Take? |
|---|---|---|
| Bank feeds | Has: Akahu (NZ), Wise, SimpleFIN on the desktop | SimpleFIN online is in the backlog |
| OFX, QFX and any CSV, column picker, an Account column | Has | — |
| **A register you can type into**: a cash or petty-cash account's lines entered by hand, a running balance, an entry split across accounts | No: lines come from files and feeds only | Yes |
| Bank rules, a rule from a line | Has (rules learnt from coding) | — |
| Transfers, card payments | Has | — |
| Reconcile to a statement, mark all, lock | Has | — |
| **Reconcile: show only lines through a date; correct the statement's ending balance in place** | Partly: each day's balance is checked against the statement's | Yes |
| **Reconciliation reports**: every completed one listed, with its report | Partly: the report for one reconciliation | Yes |
| **Possible duplicates** in a bank account: same amount, similar payee, within three days, "not a duplicate" remembered | Has: duplicates found on import, with "kept on purpose" | — |
| Undeposited funds, make deposits, deposit slips | No | No for now: cheques are rare here; cash takings already come in as bank lines |

## Inventory

| SlowBooks | NZOSA | Take? |
|---|---|---|
| Items, stock on hand at average cost, cost of goods posted | Has | — |
| Stock counts and adjustments | Has | — |
| **Reorder points and a low-stock list** | No | Yes |
| **Stock valuation report** (quantity × average cost, by item) | No | Yes |
| **An item's movements** (every purchase, sale and adjustment) | No | Yes |
| Opening stock posted as it is entered | Partly: through opening balances | Yes |

## Jobs and time

| SlowBooks | NZOSA | Take? |
|---|---|---|
| Classes on every line, P&L by class, a class's own P&L | Has | — |
| **Jobs** belonging to a customer, job on invoice and bill lines, **job profitability** and **P&L by job** | Partly: classes stand in for jobs | Yes |
| Cost codes, committed cost, job budget vs actual, burden rates | No | Later: for builders and trades, after jobs |
| Time entries, invoiced by customer | Has | — |
| Time approval (submit, approve, reject) | Has: an optional setting; time waits, is approved or sent back with a reason, and only approved time is invoiced | — |
| QuickBooks Desktop timesheets imported | No | US |

## Accounting and reports

| SlowBooks | NZOSA | Take? |
|---|---|---|
| Chart: add, rename, merge, delete when unused | Has | — |
| **Sub-accounts** (an account under a parent, totals rolled up) | No: read from QuickBooks only as a name | Yes |
| **Inactive accounts**, and removing the starter chart's unused accounts in one step | Partly | Yes |
| Manual journals, reversing, opening balances, fixed assets, depreciation, disposal | Has | — |
| **Adjusting entries marked**, a report of them, and P&L or trial balance without them | No | Yes |
| Closing date | Has: lock dates, enforced on the server for the dates themselves | — |
| **Changes made into a locked period, reported** | No | Yes |
| **Accountant's package**: one zip of the statements, ledger and trial balance as CSV, agings, reconciliations, adjusting entries and history for a period | Partly: year-end packs and the Excel extract | Yes |
| **Reclassify transactions**: pick an account and a period, tick lines, move them to another account in one change | No: rename and merge move everything | Yes |
| Compare with last year on the profit and loss and balance sheet | Has: the same period a year earlier beside it, with the change | — |
| Report periods: this month, this quarter, year to date, any dates | Has, inside the chosen year; returns and year-end reports stay whole-year | — |
| **Saved reports** with their own addresses; Back returns to them | Partly: favourite reports | Yes |
| Every report row drills down; the drill-down saves as CSV and PDF | Has | — |
| Profit and loss, balance sheet, trial balance, general ledger, cash flow, agings | Has | — |
| Income by customer, and sales by item | Has: Sales by customer and Sales by item, for any period, with CSV | — |
| **Analytics**: revenue trend, expenses by category, aging charts, days sales outstanding, margin, **90-day cash forecast**, export | Partly: the Charts report | Yes |
| AI: an insights brief, eleven one-click analyses, any of eight providers | Partly: AI suggestions, the AI check, and a conversation with tools | Yes: one-click analyses |
| Global search across customers, vendors, items, invoices and payments | Partly: Ctrl+K finds pages | Yes |
| Keyboard shortcuts for new invoice, bill, payment | No | Yes |
| History of every change, with who | Has, with undo | — |
| Users and roles; an Accountant role; invite with an end date; last sign-in shown | Partly: roles and invitations online | Yes: an end date and last sign-in |
| CSV import and export of customers, vendors, items, the chart | Partly: customers and vendors | Yes: items and the chart, with a dry run |
| A documented API with tokens, read and write | Partly: an MCP server, read only | Later, with a decision on writing |
| Tamper-evident hash on printed tax forms | No | Yes (small) |
| Company file encryption, an accountant's copy file | No | No: books online are protected by the server; a folder is the person's own |
| Dark theme, a sidebar trimmed to what is used | Has (themes, modules) | — |

## Payroll

| SlowBooks | NZOSA | Take? |
|---|---|---|
| Pay runs, journals, year-to-date | Has: New Zealand (PAYE, KiwiSaver, student loan, payday filing, Holidays Act leave) and Australia (PAYG, super, STP figures) | — |
| Pay stubs as PDFs | Has: a payslip per employee per pay run, New Zealand and Australian, to print or save as PDF, and to email from your own mail program | — |
| Direct deposit file for the bank | Has: bulk payment files for ANZ, ASB, BNZ, Kiwibank and Westpac, and ABA for Australia, from a pay run or from bills ticked on Bills | — |
| Garnishments | No | Yes: New Zealand deduction notices (child support, IRD), as deductions on a pay run |
| Leave requests, approved | Partly: leave taken is recorded | Later |
| Onboarding checklist, new-hire report | No | Later (New Zealand: IR330, KiwiSaver forms) |
| Employee portal | No | No for now |
| US payroll for every state, W-2, W-3, 940, 941, NACHA | Partly: the 941 worksheet from a payroll service | US |

## Nonprofit

| SlowBooks | NZOSA | Take? |
|---|---|---|
| Grants, donation receipts | Has, and New Zealand's tier 3 and 4 reports | — |
| Funds with donor restrictions, releases | No | Later: PBE reporting takes restricted reserves |
| Statement of activities, functional expenses (Form 990) | No | US |
| Pledges, in-kind gifts, year-end giving statements | Partly: donation receipts | Yes: a year's giving statement per donor |

## Moving in

| SlowBooks | NZOSA | Take? |
|---|---|---|
| QuickBooks Desktop IIF, Transaction Detail by Account | Has | — |
| QuickBooks Online's Export data zip | Has | — |
| Xero | Has, checked against Xero's own reports | — |
| **MYOB** | No | Yes: MYOB is the other big name in New Zealand and Australia |
| **Sage 50, Wave, Zoho Books, GnuCash** | No | Yes, smaller |
| A categorised bank sheet (Transaction Pro layout: bank account, date, payee, account, amount) | No | Yes |
| Chart from CSV or hledger, with a dry run | Partly | Yes |
| IIF export back to QuickBooks Desktop | No | US |

## What NZOSA has that SlowBooks does not

- New Zealand bank feeds (Akahu) and Wise, and coding rules that learn from each decision.
- Known-business lists for New Zealand, Australia and the United States that code fuel, phone, power and the rest before any AI is asked.
- AI suggestions, an AI check against tax authority guidance and OpenAccountants, and a conversation with the books -- off until asked.
- Many entities in one set of books, with shared bank accounts, money between entities and owner shares.
- New Zealand's returns (GST, IR3, IR4, IR6, IR7, IR9, IR10, rental schedules, payday filing); Australia's BAS, payroll and tax estimates; South Korea's VAT; the United States' Schedule C, Schedule E, 1099-NEC, Form 941 worksheet and Form 1120 estimate.
- Lock dates, per-line confirmation, and History with undo on every change.
- Books online with sign-in, invitations and roles, saving only what changed, and two people working at once; free software under the AGPL.

## Everything NZOSA could take, in order

Sizes are rough: **S** a day or less, **M** a few days, **L** a week or more.

**First: what bookkeepers here meet every week**

1. ~~Report periods~~: done 25 October 2026.
2. ~~Compare with last year~~: done 25 October 2026.
3. ~~Payslips~~: done 25 October 2026.
4. ~~Direct credit files~~: done 25 October 2026 (ANZ, ASB, BNZ, Kiwibank, Westpac; ABA). TSB and the smaller banks still to come.
5. **Reclassify transactions**: move chosen lines from one account to another in one change, undoable (M).
6. **A register you can type into**, for cash, petty cash and accounts with no feed, entries split across accounts (M).
7. **Customer and vendor credits held on account**, applied later (M).
8. **Attachments** on invoices, bills, journals and contacts (L).
9. **MYOB import** (L).

**Second: smaller, and quickly done**

10. ~~Duplicate an invoice~~: done 25 October 2026, bills too.
11. ~~Saved invoice messages~~: done 25 October 2026.
12. ~~Editable email wording~~: done 25 October 2026.
13. ~~Overdue customers' statements~~: done 25 October 2026, one message each, since a mail program opens one at a time.
14. Reorder points, a low-stock list, a stock valuation report and an item's movements (M).
15. ~~Income by customer, and sales by item~~: done 25 October 2026.
16. ~~Paid this year and all time, per supplier~~: done 25 October 2026.
17. ~~A duplicate-name warning~~: done 25 October 2026.
18. ~~A bill line as an amount alone~~: already so; the comparison had it wrong.
19. ~~Quantities and prices to four decimal places~~: done 25 October 2026.
20. ~~Quotes offered in New Zealand~~: done 25 October 2026.
21. ~~Time approval~~: done 25 October 2026.
22. Reconcile: lines through a date, and the statement balance corrected in place (S).
23. Every completed reconciliation listed (S).
24. Inactive accounts, and the starter chart's unused accounts removed in one step (S).
25. Keyboard shortcuts for a new invoice, bill and journal (S).
26. Sales receipts, and a walk-in customer (M).
27. Quick entry for a backlog of paper invoices (S).

**Third: for accountants**

28. Adjusting entries marked, reported, and left out of a report on request (M).
29. Changes made into a locked period, reported (M).
30. The accountant's package: one zip for a period (M).
31. An end date on an invitation, and each person's last sign-in (S).

**Fourth: larger, or wanting a decision**

32. Jobs belonging to customers, job profitability and P&L by job (L).
33. Sub-accounts in the chart (L).
34. Analytics: revenue trend, expenses by category, days sales outstanding, margin and a 90-day cash forecast (M).
35. One-click AI analyses beside the conversation (S).
36. Global search across contacts, invoices, bills and lines (M).
37. Receipt scanning in the page, without AI (L).
38. Foreign-currency invoices and bank accounts (L; with Wise balances in other currencies).
39. Online payment links (L; which provider, and keys held online).
40. Sage 50, Wave, Zoho Books and GnuCash imports, and the Transaction Pro bank sheet (M each).
41. Chart import from CSV or hledger with a dry run (S).
42. New Zealand deduction notices on pay runs (M).
43. A year's giving statement per donor (S).
44. Items and the chart exported and imported as CSV (S).
45. A hash on printed returns, to show they are unchanged (S).

**Not taking**, and why: printed cheques and deposit slips (cheques are all but gone here), undeposited funds, United States payroll for every state and its forms, Form 990 reports, reseller permits, the employee portal, company file encryption and the accountant's copy file (books online are protected by the server; a folder is the person's own), and QuickBooks 2003's look.
