# SlowBooks Pro 2026 compared with NZOSA

What SlowBooks Pro 2026 (version 2.23.4, released 17 October 2026: a desktop
and server bookkeeping application for United States small businesses,
written as a replacement for QuickBooks) does that NZOSA does not.

How this was made: from SlowBooks' release notes (2.7.0 to 2.23.4), its
screens and its server routes, set against what NZOSA's pages and core code
do. It was not driven by hand through SlowBooks' own screens, so a detail may
differ in use. First written against 2.23.0 on 15 October 2026; brought up to
date on 18 October 2026, when much of what was missing had been built.

"No" means NZOSA has nothing like it. "Partly" says what it has.

## Sales (money in)

| SlowBooks | NZOSA |
|---|---|
| Customer records with their own page, invoices, payments and credits | Yes |
| Customer statements and collection letters | Yes (statements, reminder letters) |
| Estimates converted to invoices | Yes, outside New Zealand |
| Sales receipts (paid on the spot) | Partly: an invoice paid at once |
| Credit memos applied to invoices, or held as customer credit | Partly: credit notes against an invoice |
| Credit limits, late fees, writing off small balances | Yes |
| Batch payments, one receipt across many invoices | Partly: one payment settling several invoices on Reconcile |
| **Receive payment to Undeposited Funds, Make Deposits, deposit slips** | No. Receipts are matched to bank lines |
| Recurring invoices | Yes |
| **Foreign-currency invoices** at an exchange rate | No: one currency per set of books |
| **Online payment links** (a customer pays a public page) | No |
| **Email templates** with preview | Partly: a plain email message |
| Invoice PDF with the logo | Partly |
| **Per-line sales tax**: taxable and untaxed lines, rates to four decimals, tax-exempt customers | No |
| Sales tax report; **Pay Sales Tax** by jurisdiction; reseller permits | Partly: a sales tax report read from the liability accounts |

## Purchases (money out)

| SlowBooks | NZOSA |
|---|---|
| Vendor records, W-9 on file, 1099 flag, usual account | Yes |
| Purchase orders converted into bills | Yes |
| Vendor credits | Partly: credit notes |
| **Pay bills screen and printed checks** | No. Bills are matched to bank lines |
| Expenses and card charges entered as documents | Partly: bills paid outside the bank; otherwise bank and card lines are the entries |
| **Receipt intake** (scan a receipt into a bill or expense) | No |
| **Attachments** kept with bills, expenses, journals and employees | No: a link to a document only |

## Inventory and projects

| SlowBooks | NZOSA |
|---|---|
| Items and services with price, cost and accounts; stock on hand | Yes: stock at average cost, counted |
| **Reorder points** and low-stock lists; stock movement reports | No |
| Jobs with **cost codes**, job costing, job budget vs actual | Partly: jobs are classes, with P&L by class |
| Classes on every transaction, P&L by class | Yes |
| Time entries | Yes, invoiced by customer; **no approval step** |
| Budgets with budget vs actual | Yes |
| Equipment register | Partly: the fixed asset register |

## Banking

| SlowBooks | NZOSA |
|---|---|
| Bank rules from a statement line | Partly: rules and suggestions learnt from coding |
| **Bank feeds through SimpleFIN** (United States banks) | No. Akahu (New Zealand) and Wise only |
| US bank CSV, QFX and OFX | Yes: OFX, QFX and any CSV through the column picker |
| Reconcile to a statement, mark all, lock what it closed | Yes |
| **Check register** per account with a running balance | Partly: account transactions |
| Transfers and card payments | Yes |

## Accounting

| SlowBooks | NZOSA |
|---|---|
| Chart of accounts: add, edit, deactivate, delete | Partly: no delete |
| Journal entries, opening balances, fixed assets, backups | Yes |
| Financial statements pack | Partly (year-end packs) |
| **Saved reports** with their own addresses | No; drill-down from every row, yes |
| **Dashboard** and **analytics** with an AI brief | No: Actions required, and AI suggestions and checks |
| Audit log with document hashes | Partly: History and undo |
| Multi-user with roles | Partly: roles on online books |
| API tokens and a documented API | Partly: an MCP server, read-only |

## Payroll and HR (United States)

NZOSA has New Zealand payroll (PAYE, KiwiSaver, student loan, payday filing)
and Australian payroll (PAYG withholding, super, STP figures). For the United
States it reads payroll from a payroll service's journals into a Form 941
worksheet. SlowBooks runs US payroll itself: federal and **all 50 states'
withholding**, **Forms 941, 940, W-2, W-3, 1099-NEC and 1096**, benefits,
garnishments, PTO, time off, an employee portal, new-hire reports and NACHA
direct-deposit files.

## Nonprofit (United States)

NZOSA has grants, donation receipts and the New Zealand society reports.
SlowBooks has **funds with donor restrictions**, the **Statement of
Activities**, **functional expenses** (Form 990 Part IX), pledges, in-kind
gifts and year-end giving statements.

## Moving in from QuickBooks and others

| SlowBooks | NZOSA |
|---|---|
| IIF import, classes on every line (2.23.1) | Yes: chart, customers, vendors, transactions and classes |
| **IIF export** | No |
| **QuickBooks Online's "Export data" zip** (2.23.2): its Journal, chart from the statements, customer and vendor lists, no Intuit app | No: the chart and a General Ledger report, exported one by one |
| **QuickBooks Desktop Transaction Detail by Account** (2.23.4): every Desktop transaction, checked against QuickBooks' totals | No: Desktop's transactions do not come across |
| QuickBooks Desktop Transaction Detail to invoices with open balances | Partly: invoices from a QuickBooks Online ledger |
| **Desktop timesheets as time entries** (2.23.4) | No |
| **Wave** import | No |
| Xero | Partly in SlowBooks; NZOSA's Xero migration is complete, checked against Xero's own reports |

## What NZOSA has that SlowBooks does not

- New Zealand bank feeds (Akahu), Wise, and coding rules that learn.
- Known-business lists for New Zealand, Australia and the United States that code fuel, phone, power and the rest before any AI is asked.
- AI suggestions and an AI check against tax authority guidance and OpenAccountants, off until asked.
- Many entities in one set of books, with shared bank accounts, money between entities and owner shares.
- New Zealand returns (GST, IR3, IR4, IR6, IR7, IR9, IR10, rental schedules, payday filing); Australia's BAS, payroll and tax estimates; the United States' Schedule C, Schedule E, 1099-NEC, Form 941 worksheet and Form 1120 estimate.
- Lock dates, per-line confirmation, and History with undo on every change.
- Hosted books with sign-in, invitations and roles; free software under the AGPL.

## Worth taking, in order

1. **QuickBooks Desktop Transaction Detail by Account.** Desktop users can bring only their lists today; this one report carries every transaction, and SlowBooks checks it against the totals QuickBooks prints.
2. **QuickBooks Online's Export data zip.** One download any user can make, in place of exporting reports one by one.
3. **SimpleFIN bank feeds** for United States books: Akahu is New Zealand only.
4. **Per-line sales tax on invoices** for United States books.
5. **Undeposited funds and deposit slips**, for businesses that bank cheques and cash in batches.
6. Smaller: reorder points, saved reports, IIF export, Desktop timesheets.
