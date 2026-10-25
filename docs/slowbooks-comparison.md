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
| Sales receipts (paid on the spot), and a walk-in customer | Has: Paid on the spot makes the document a receipt, with how it was paid; no name is a walk-in customer. The money is still matched from the bank line | — |
| Payments across several invoices, oldest first; batch payments across customers | Partly: a bank line settling several invoices on Reconcile | — (NZOSA matches to bank lines) |
| Customer credits: an overpayment or credit note held on the customer's account and applied later | Has: Credit on account on Invoices, applied in parts to later invoices | — |
| Credit limits, late fees, writing off small balances | Has | — |
| Recurring invoices | Has | — |
| Saved invoice messages (how to pay, a thank-you), one the default | Has | — |
| Email templates, editable, for invoices, statements and reminders | Has, with fill-ins such as {customer} and {amount} | — |
| Email all overdue statements from the receivables aging | Has: every overdue customer listed on Customers & vendors, one press each to save the statement or reminder and open the message | — |
| Customer statements and collection letters | Has | — |
| **Foreign-currency invoices** at an exchange rate, realised gain or loss on payment | No: one currency per set of books | Yes (large; the same work as Wise balances in other currencies) |
| **Online payment link** (Stripe, PayPal, Square) and a public pay page | No | Yes, with a decision on the provider and on keys held online |
| Quick entry of a backlog of paper invoices, save and next | Has: Save and next, carrying the date, account and tax to the next one | — |
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
| Vendor credits held on account, applied to later bills | Has: the same, on Bills | — |
| Expenses and card charges as documents | Partly: bank and card lines are the entries | — |
| **Receipt scanning** into a bill or expense (OCR on the computer, no AI) | Partly: an AI can read a PDF bill | Yes: OCR in the page, no AI, no upload |
| Attachments: the receipt or file kept with a bill, expense, invoice, journal, contact | Has: on bank lines, invoices and bills, journals and contacts, kept in the books' folder or the browser. Books kept online still keep a link: Supabase Storage is to come | Online: yes |
| Duplicate-name warning when a customer or vendor is added | Has: a name like one already there (spelling, accents, Limited, a letter apart) is asked about | — |
| Pay bills screen, printed checks | No | No: cheques are all but gone in New Zealand; bills are matched to bank lines |
| W-9, 1099 vendors, 1099-NEC and 1096 | Has (US) | — |

## Banking

| SlowBooks | NZOSA | Take? |
|---|---|---|
| Bank feeds | Has: Akahu (NZ), Wise, SimpleFIN on the desktop | SimpleFIN online is in the backlog |
| OFX, QFX and any CSV, column picker, an Account column | Has | — |
| A register you can type into: a cash or petty-cash account's lines entered by hand, a running balance, an entry split across accounts | Has: on Bank import, each line coded or split as it is typed, then a bank line like any other | — |
| Bank rules, a rule from a line | Has (rules learnt from coding) | — |
| Transfers, card payments | Has | — |
| Reconcile to a statement, mark all, lock | Has | — |
| Reconcile: show only lines through a date; correct the statement's ending balance in place | Has: Statements shows the lines to the statement's date, and the ending balance is open until the statement is finished | — |
| Reconciliation reports: every completed one listed, with its report | Has: every finished statement on every account, each with a report of its beginning, the lines it cleared, its end and what was still outstanding | — |
| **Possible duplicates** in a bank account: same amount, similar payee, within three days, "not a duplicate" remembered | Has: duplicates found on import, with "kept on purpose" | — |
| Undeposited funds, make deposits, deposit slips | No | No for now: cheques are rare here; cash takings already come in as bank lines |

## Inventory

| SlowBooks | NZOSA | Take? |
|---|---|---|
| Items, stock on hand at average cost, cost of goods posted | Has | — |
| Stock counts and adjustments | Has | — |
| Reorder points and a low-stock list | Has: a reorder point on each stocked product, and a note of what is at or below it | — |
| Stock valuation report (quantity × average cost, by item) | Has, on Items, with a CSV | — |
| An item's movements (every purchase, sale and adjustment) | Has: Movements on each product, with what it left on hand | — |
| Opening stock posted as it is entered | Partly: through opening balances | Yes |

## Jobs and time

| SlowBooks | NZOSA | Take? |
|---|---|---|
| Classes on every line, P&L by class, a class's own P&L | Has | — |
| **Jobs** belonging to a customer, job on invoice and bill lines, **job profitability** and **P&L by job** | Has: jobs with a customer, a quote and open or finished, given to invoices, bills, bank lines and journals; each job's whole-life profit and margin, and a Profit and loss by job report. A job is given to a whole document, not to each of its lines | — |
| Cost codes, committed cost, job budget vs actual, burden rates | No | Later: for builders and trades, after jobs |
| Time entries, invoiced by customer | Has | — |
| Time approval (submit, approve, reject) | Has: an optional setting; time waits, is approved or sent back with a reason, and only approved time is invoiced | — |
| QuickBooks Desktop timesheets imported | No | US |

## Accounting and reports

| SlowBooks | NZOSA | Take? |
|---|---|---|
| Chart: add, rename, merge, delete when unused | Has | — |
| **Sub-accounts** (an account under a parent, totals rolled up) | Has: an account set under another, one level deep; the profit and loss shows the parent with its total and the parts beneath. The balance sheet and the downloads still list each account | — |
| Inactive accounts, and removing the starter chart's unused accounts in one step | Has: Make inactive keeps an account and its history out of the pickers; Remove unused takes out every account nothing uses | — |
| Manual journals, reversing, opening balances, fixed assets, depreciation, disposal | Has | — |
| **Adjusting entries marked**, a report of them, and P&L or trial balance without them | Has: Adjusting entry on a manual journal, the Adjusting entries report, and Without adjusting entries on the P&L, balance sheet and trial balance | Yes |
| Closing date | Has: lock dates, enforced on the server for the dates themselves | — |
| **Changes made into a locked period, reported** | Has: on Setup → Lock dates, each lock moved back and every change that then moved a figure in the period it had covered, with a CSV | Yes |
| **Accountant's package**: one zip of the statements, ledger and trial balance as CSV, agings, reconciliations, adjusting entries and history for a period | Has: Accountant's package on Reports, for the period and entity chosen, with a README of what is in it and what was not | Yes |
| Reclassify transactions: pick an account and a period, tick lines, move them to another account in one change | Has: Reclassify, under Accounting, undone as one from History | — |
| Compare with last year on the profit and loss and balance sheet | Has: the same period a year earlier beside it, with the change | — |
| Report periods: this month, this quarter, year to date, any dates | Has, inside the chosen year; returns and year-end reports stay whole-year | — |
| **Saved reports** with their own addresses; Back returns to them | Partly: favourite reports | Yes |
| Every report row drills down; the drill-down saves as CSV and PDF | Has | — |
| Profit and loss, balance sheet, trial balance, general ledger, cash flow, agings | Has | — |
| Income by customer, and sales by item | Has: Sales by customer and Sales by item, for any period, with CSV | — |
| **Analytics**: revenue trend, expenses by category, aging charts, days sales outstanding, margin, **90-day cash forecast**, export | Has, on the Charts report: the months, the biggest costs, days to be paid, gross and net margin, and a 13-week cash forecast with a CSV | — |
| AI: an insights brief, eleven one-click analyses, any of eight providers | Has: AI suggestions, the AI check, a conversation with tools, and eight one-click questions about the year | — |
| Global search across customers, vendors, items, invoices and payments | Has: Ctrl+K finds pages, contacts, invoices, quotes, bills and bank lines, by words or by amount | — |
| Keyboard shortcuts for new invoice, bill, payment | Has: Alt+Shift+I, B and J for a new invoice, bill and journal, from any page | — |
| History of every change, with who | Has, with undo | — |
| Users and roles; an Accountant role; invite with an end date; last sign-in shown | Has, for books online: an end date on an invitation or a member, enforced by the database, and each person's last sign-in | — |
| CSV import and export of customers, vendors, items, the chart | Has: items and the chart with a dry run, as well as customers and vendors | — |
| A documented API with tokens, read and write | Partly: an MCP server, read only | Later, with a decision on writing |
| Tamper-evident hash on printed tax forms | Has: a fingerprint of the figures on the GST return (page and download) and the IR3 pack, with a box to check a printed one against the books | — |
| Company file encryption, an accountant's copy file | No | No: books online are protected by the server; a folder is the person's own |
| Dark theme, a sidebar trimmed to what is used | Has (themes, modules) | — |

## Payroll

| SlowBooks | NZOSA | Take? |
|---|---|---|
| Pay runs, journals, year-to-date | Has: New Zealand (PAYE, KiwiSaver, student loan, payday filing, Holidays Act leave) and Australia (PAYG, super, STP figures) | — |
| Pay stubs as PDFs | Has: a payslip per employee per pay run, New Zealand and Australian, to print or save as PDF, and to email from your own mail program | — |
| Direct deposit file for the bank | Has: bulk payment files for ANZ, ASB, BNZ, Kiwibank and Westpac, and ABA for Australia, from a pay run or from bills ticked on Bills | — |
| Garnishments | Has: deduction notices on the employee (child support, IR deduction notices, fines attachment orders), taken every pay until what is owed is paid | — |
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
| Pledges, in-kind gifts, year-end giving statements | Has: donation receipts, and a year's giving statement per donor or for every donor | — |

## Moving in

| SlowBooks | NZOSA | Take? |
|---|---|---|
| QuickBooks Desktop IIF, Transaction Detail by Account | Has | — |
| QuickBooks Online's Export data zip | Has | — |
| Xero | Has, checked against Xero's own reports | — |
| **MYOB** | No | Yes: MYOB is the other big name in New Zealand and Australia |
| **Sage 50, Wave, Zoho Books, GnuCash** | Has: GnuCash's own book (.gnucash, or its XML). Sage 50, Wave and Zoho Books not yet | Yes, smaller: the other three, once there are sample files |
| A categorised bank sheet (Transaction Pro layout: bank account, date, payee, account, amount) | No | Yes |
| Chart from CSV or hledger, with a dry run | Has: Bring in accounts on the chart, shown as what would be added and updated before anything changes; nothing is removed | — |
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
5. ~~Reclassify transactions~~: done 25 October 2026.
6. ~~A register you can type into~~: done 25 October 2026.
7. ~~Customer and vendor credits held on account~~: done 25 October 2026.
8. ~~Attachments~~: done 25 October 2026 for books in a folder or the browser, bank lines included. Books kept online need a Supabase Storage bucket, still to do.
9. **MYOB import** (L). Waiting on sample files: MYOB's own help does not give the exact export layout, and an importer guessed from it would fail on real files.

**Second: smaller, and quickly done**

10. ~~Duplicate an invoice~~: done 25 October 2026, bills too.
11. ~~Saved invoice messages~~: done 25 October 2026.
12. ~~Editable email wording~~: done 25 October 2026.
13. ~~Overdue customers' statements~~: done 25 October 2026, one message each, since a mail program opens one at a time.
14. ~~Reorder points, low stock, stock valuation and movements~~: done 25 October 2026.
15. ~~Income by customer, and sales by item~~: done 25 October 2026.
16. ~~Paid this year and all time, per supplier~~: done 25 October 2026.
17. ~~A duplicate-name warning~~: done 25 October 2026.
18. ~~A bill line as an amount alone~~: already so; the comparison had it wrong.
19. ~~Quantities and prices to four decimal places~~: done 25 October 2026.
20. ~~Quotes offered in New Zealand~~: done 25 October 2026.
21. ~~Time approval~~: done 25 October 2026.
22. ~~Reconcile through a date~~: already so on Statements; the comparison had it wrong.
23. ~~Every completed reconciliation listed~~: done 25 October 2026, each with its report.
24. ~~Inactive accounts, and unused accounts removed in one step~~: done 25 October 2026.
25. ~~Keyboard shortcuts~~: done 25 October 2026.
26. ~~Sales receipts, and a walk-in customer~~: done 25 October 2026.
27. ~~Quick entry for a backlog of paper invoices~~: done 25 October 2026, bills too.

**Third: for accountants**

28. ~~Adjusting entries marked, reported, and left out of a report on request~~: done 25 October 2026. The year-end adjustments for vehicles and prepayments count as adjusting entries without being marked.
29. ~~Changes made into a locked period, reported~~: done 25 October 2026. A lock refuses changes inside it, so what is reported is each time a lock was moved back and what was changed while it was.
30. ~~The accountant's package: one zip for a period~~: done 25 October 2026. The balance sheet gained a CSV download of its own on the way.
31. ~~An end date on an invitation, and each person's last sign-in~~: done 25 October 2026. The end is checked by the database on every request; an owner's access never ends.

**Fourth: larger, or wanting a decision**

32. ~~Jobs belonging to customers, job profitability and P&L by job~~: done 25 October 2026. A job goes on a whole document or line, as a class does; one line of an invoice to one job and another to a second is not yet possible.
33. ~~Sub-accounts in the chart~~: done 25 October 2026, on the profit and loss. QuickBooks' Parent:Child names are not yet read into it.
34. ~~Analytics: revenue trend, expenses by category, days sales outstanding, margin and a 90-day cash forecast~~: done 25 October 2026 on the Charts report. The forecast counts only what is known: documents owing and recurring invoices.
35. ~~One-click AI analyses beside the conversation~~: done 25 October 2026 on the AI check page: asked with the books' own key where there is one, copied for your own assistant where not.
36. ~~Global search across contacts, invoices, bills and lines~~: done 25 October 2026, in the menu's search; an amount finds what is exactly that much.
37. Receipt scanning in the page, without AI (L).
38. Foreign-currency invoices and bank accounts (L; with Wise balances in other currencies).
39. Online payment links (L; which provider, and keys held online).
40. Sage 50, Wave, Zoho Books and GnuCash imports, and the Transaction Pro bank sheet (M each). ~~GnuCash~~ done 25 October 2026. The rest wait on sample files, as MYOB does: their export layouts are not published in enough detail to read them blind.
41. ~~Chart import from CSV or hledger with a dry run~~: done 25 October 2026.
42. ~~New Zealand deduction notices on pay runs~~: done 25 October 2026. Child support keeps its 60% protection; other notices' protected earnings rates are for the person to check, and the editor says so.
43. ~~A year's giving statement per donor~~: done 25 October 2026, one donor's or every donor's, one to a page.
44. ~~Items and the chart exported and imported as CSV~~: done 25 October 2026, each with the same dry run.
45. ~~A hash on printed returns, to show they are unchanged~~: done 25 October 2026 for the GST return and the IR3 pack.

**Not taking**, and why: printed cheques and deposit slips (cheques are all but gone here), undeposited funds, United States payroll for every state and its forms, Form 990 reports, reseller permits, the employee portal, company file encryption and the accountant's copy file (books online are protected by the server; a folder is the person's own), and QuickBooks 2003's look.
