import test from "node:test";
import assert from "node:assert/strict";
import {
  identifyExport,
  isQuickBooksExportJournal,
  isQuickBooksExportStatement,
  isZip,
  parseQuickBooksExport,
  quickBooksStatementAccounts,
} from "../dist/index.js";

// Invented books in the layout of QuickBooks Online's Export data: a blank
// first column, title rows, every figure as formula text, a totals row and a
// blank row after each journal block, an item row with no account.
const journal = [
  ",Harbour Lane Bakery,,,,,,,",
  ",Journal,,,,,,,",
  ",All Dates,,,,,,,",
  ",,,,,,,,",
  ",Date,Transaction Type,Num,Name,Memo/Description,Account,Debit,Credit",
  ",03/01/2026,Journal Entry,1,,Owner's start,Checking,=2000.00,",
  ",,,,,Owner's start,Owner's Investment,,=2000.00",
  ",,,,,,,=2000.00,=2000.00",
  ",,,,,,,,",
  ",03/04/2026,Invoice,1001,Seaside Cafe,Sourdough loaves,Accounts Receivable (A/R),=640.00,",
  ",,,,,Sourdough loaves,Sales:Bread,,=640.00",
  ",,,,,Subtotal,,,",
  ",,,,,Free delivery,,=0.00,",
  ",,,,,,,=640.00,=640.00",
  ",,,,,,,,",
  ",03/12/2026,Payment,,Seaside Cafe,Payment,Checking,=640.00,",
  ",,,,,Payment,Accounts Receivable (A/R),,=640.00",
  ",,,,,,,=640.00,=640.00",
  ",,,,,,,,",
  ",03/06/2026,Bill,B-17,Mill Road Flour,Flour,Cost of Goods Sold:Flour,=310.00,",
  ",,,,,Flour,Accounts Payable (A/P),,=310.00",
  ",,,,,,,=310.00,=310.00",
  ",,,,,,,,",
  ",03/20/2026,Bill Payment (Check),3001,Mill Road Flour,,Accounts Payable (A/P),=310.00,",
  ",,,,,,Checking,,=310.00",
  ",,,,,,,=310.00,=310.00",
  ",,,,,,,,",
  ",03/22/2026,Expense,,Harbor Gas & Electric,Ovens,Utilities,=95.50,",
  ",,,,,Ovens,Business Visa,,=95.50",
  ",,,,,,,=95.50,=95.50",
  ",,,,,,,,",
  ",03/25/2026,Invoice,1002,Dune Market,Rolls,Accounts Receivable (A/R),=180.00,",
  ",,,,,Rolls,Sales:Bread,,=180.00",
  ",,,,,,,=180.00,=180.00",
  ",,,,,,,,",
].join("\n");

const balanceSheet = [
  "Harbour Lane Bakery,",
  "Balance Sheet,",
  "All Dates,",
  ",",
  ",Total",
  "ASSETS,",
  "   Current Assets,",
  "      Bank Accounts,",
  "         Checking,=2330.00",
  "      Total Bank Accounts,=2330.00",
  "      Accounts Receivable,",
  "         Accounts Receivable (A/R),=180.00",
  "      Total Accounts Receivable,=180.00",
  "   Total Current Assets,=2510.00",
  "TOTAL ASSETS,=2510.00",
  "LIABILITIES AND EQUITY,",
  "   Liabilities,",
  "      Current Liabilities,",
  "         Credit Cards,",
  "            Business Visa,=95.50",
  "         Total Credit Cards,=95.50",
  "      Total Current Liabilities,=95.50",
  "   Total Liabilities,=95.50",
  "   Equity,",
  "      Owner's Investment,=2000.00",
  "      Net Income,=414.50",
  "   Total Equity,=2414.50",
  "TOTAL LIABILITIES AND EQUITY,=2510.00",
].join("\n");

const profitAndLoss = [
  "Harbour Lane Bakery,",
  "Profit and Loss,",
  "All Dates,",
  ",",
  ",Total",
  "Income,",
  "   Sales,",
  "      Bread,=820.00",
  "   Total Sales,=820.00",
  "Total Income,=820.00",
  "Cost of Goods Sold,",
  "   Cost of Goods Sold,",
  "      Flour,=310.00",
  "   Total Cost of Goods Sold,=310.00",
  "Total Cost of Goods Sold,=310.00",
  "Gross Profit,=510.00",
  "Expenses,",
  "   Utilities,=95.50",
  "Total Expenses,=95.50",
  "Net Income,=414.50",
].join("\n");

const trialBalance = (checking = "=2330.00", basis = "Accrual") =>
  [
    "Harbour Lane Bakery,,",
    "Trial Balance,,",
    "All Dates,,",
    ",,",
    ",Debit,Credit",
    `Checking,${checking},`,
    "Accounts Receivable (A/R),=180.00,",
    "Business Visa,,=95.50",
    "Owner's Investment,,=2000.00",
    "Sales:Bread,,=820.00",
    "Cost of Goods Sold:Flour,=310.00,",
    "Utilities,=95.50,",
    "TOTAL,=2915.50,=2915.50",
    ",,",
    `"Sunday, Oct 18, 2026 09:00:00 AM GMT-7 - ${basis} Basis",,`,
  ].join("\n");

const files = (tb = trialBalance()) => [
  { name: "Journal.csv", text: journal },
  { name: "Balance Sheet.csv", text: balanceSheet },
  { name: "Profit and Loss.csv", text: profitAndLoss },
  { name: "Trial Balance.csv", text: tb },
];

test("the export's reports are told apart", () => {
  assert.equal(isQuickBooksExportJournal(journal), true);
  assert.equal(isQuickBooksExportJournal(balanceSheet), false);
  assert.equal(isQuickBooksExportStatement(balanceSheet), "balance-sheet");
  assert.equal(isQuickBooksExportStatement(profitAndLoss), "profit-and-loss");
  assert.equal(isQuickBooksExportStatement(trialBalance()), "trial-balance");
  assert.equal(identifyExport(journal).kind, "quickbooks-export");
});

test("each account is typed by the statement section it sits under", () => {
  const sheet = quickBooksStatementAccounts(balanceSheet);
  assert.equal(sheet.get("Checking"), "Bank");
  assert.equal(sheet.get("Business Visa"), "Credit Card");
  assert.equal(sheet.get("Owner's Investment"), "Equity");
  const pl = quickBooksStatementAccounts(profitAndLoss);
  assert.equal(pl.get("Sales:Bread"), "Income");
  assert.equal(pl.get("Cost of Goods Sold:Flour"), "Cost of Goods Sold");
  assert.equal(pl.has("Net Income"), false);
});

test("the Journal comes in as bank lines, documents and journals, checked against the trial balance", () => {
  const books = parseQuickBooksExport(files(), null, { currency: "USD" });
  assert.deepEqual(books.problems, []);
  assert.match(books.verified, /^every asset and liability balance agrees/);
  const byName = new Map(books.chart.accounts.map((a) => [a.name, a]));
  assert.equal(byName.get("Checking")?.type, "Bank");
  assert.equal(byName.get("Business Visa")?.type, "Bank");
  assert.equal(byName.get("Business Visa")?.description, "Credit Card");
  assert.equal(byName.get("Cost of Goods Sold:Flour")?.type, "Direct Costs");
  // Every account but the bank and the card has a number of its own.
  for (const account of books.chart.accounts) {
    if (account.type !== "Bank") assert.match(account.code, /^\d{4}$/, account.name);
  }
  assert.equal(new Set(books.chart.accounts.map((a) => a.code).filter((c) => c !== "")).size, books.chart.accounts.filter((a) => a.code !== "").length);
  // Start, payment in, bill paid, card charge.
  assert.equal(books.transactions.length, 4);
  assert.deepEqual(books.transactions.map((t) => t.amount).sort((a, b) => a - b), [-31000, -9550, 64000, 200000]);
  assert.equal(books.invoices.length, 3);
  const open = books.invoices.find((i) => i.number.startsWith("1002"));
  assert.equal(open?.contact, "Dune Market");
});

test("a trial balance the Journal does not come to is said, account by account", () => {
  const books = parseQuickBooksExport(files(trialBalance("=2300.00")), null, { currency: "USD" });
  assert.match(books.verified, /1 asset and liability balance differs.*Checking 2330\.00 against 2300\.00/);
});

test("a cash-basis trial balance is set aside rather than compared", () => {
  const books = parseQuickBooksExport(files(trialBalance("=2330.00", "Cash")), null, { currency: "USD" });
  assert.match(books.verified, /cash basis/);
});

test("an entry that does not balance is left out and said", () => {
  const broken = journal.replace(",,,,,Ovens,Business Visa,,=95.50", ",,,,,Ovens,Business Visa,,=59.50");
  const books = parseQuickBooksExport([{ name: "Journal.csv", text: broken }], null, { currency: "USD" });
  assert.equal(books.problems.length, 1);
  assert.match(books.problems[0].message, /does not balance/);
  assert.equal(books.transactions.length, 3);
});

test("a zip is known by its signature", () => {
  assert.equal(isZip(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14])), true);
  assert.equal(isZip(new TextEncoder().encode("Date,Amount")), false);
});
