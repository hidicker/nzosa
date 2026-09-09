import assert from "node:assert/strict";
import test from "node:test";
import { identifyExport } from "../dist/index.js";

const csv = (rows) => rows.map((r) => r.join(",")).join("\r\n") + "\r\n";

// The real heading rows, as each of these reports actually comes out.
const ACCOUNT_TRANSACTIONS = csv([
  ["Account Transactions"],
  ["Example Holdings Limited"],
  [""],
  ["Date", "Source", "Contact", "Description", "Reference", "Debit", "Credit", "Account"],
  ["15/04/2024", "Spend Money", "Ozone Supplies", "Toner", "INV-101", "", "120.75", "Office Expenses"],
]);

const JOURNAL_REPORT = csv([
  ["Journal Report"],
  ["Example Holdings Limited"],
  [""],
  ["Date", "Journal ID", "Account", "Description", "Reference", "Debit", "Credit"],
  ["15/04/2024", "JRN-9", "429 Office Expenses", "Toner", "", "120.75", ""],
]);

const CHART = csv([
  ["*Code", "*Name", "*Type", "*Tax Code", "Description"],
  ["200", "Sales", "Revenue", "15% GST on Income", "Income"],
]);

const ASSETS = csv([
  ["*AssetName", "*AssetNumber", "*PurchaseDate", "*PurchasePrice"],
  ["Van", "FA-0001", "01/04/2024", "25000.00"],
]);

const INVOICES = csv([
  ["ContactName", "InvoiceNumber", "InvoiceDate", "DueDate", "Total", "LineAmount", "AccountCode"],
  ["Kea Cafe", "INV-1001", "01/05/2026", "31/05/2026", "230.00", "200.00", "200"],
]);

const DAILY_BALANCES = csv([
  ["Business Bank Account"],
  ["01/05/2026", "1234.56"],
  ["02/05/2026", "1100.00"],
  ["05/05/2026", "980.25"],
  ["06/05/2026", "-45.10"],
]);

const BANK = csv([
  ["Date", "Amount", "Payee", "Particulars", "Code", "Reference", "Tran Type",
   "This Party Account", "Other Party Account"],
  ["01/05/2026", "-115.00", "Tui Glider Works", "", "", "", "DEB",
   "02-1100-0022001-000", ""],
]);

test("each report is recognised by its own heading row", () => {
  for (const [text, kind] of [
    [ACCOUNT_TRANSACTIONS, "account-transactions"],
    [JOURNAL_REPORT, "journal-report"],
    [CHART, "chart"],
    [ASSETS, "fixed-assets"],
    [INVOICES, "invoices"],
    [DAILY_BALANCES, "daily-balances"],
    [BANK, "bank"],
  ]) {
    assert.equal(identifyExport(text).kind, kind);
  }
});

test("the journal report is not mistaken for account transactions", () => {
  // They share Date, Account, Debit and Credit. Only the journal report has a
  // Journal ID, which is why it is tried first.
  assert.equal(identifyExport(JOURNAL_REPORT).kind, "journal-report");
  assert.equal(identifyExport(ACCOUNT_TRANSACTIONS).kind, "account-transactions");
});

test("an account transactions export is offered for invoice payments too", () => {
  // A payment appears in it twice, once against the receivable and once
  // against the bank, so the same file says which receipt settled which
  // invoice. Asking for it once and using it twice is the point.
  assert.equal(identifyExport(ACCOUNT_TRANSACTIONS).alsoUseFor, "allocations");
  assert.equal(identifyExport(JOURNAL_REPORT).alsoUseFor, undefined);
  assert.equal(identifyExport(CHART).alsoUseFor, undefined);
});

test("something it does not know is said to be unknown, not guessed at", () => {
  // Loading a journal report as a chart of accounts would not fail. It would
  // quietly produce nonsense, which is worse.
  const notOurs = csv([["Name", "Quantity", "Colour"], ["Widget", "3", "Blue"]]);
  const identified = identifyExport(notOurs);
  assert.equal(identified.kind, "unknown");
  assert.match(identified.what, /not recognised/);
});

test("an empty file is unknown rather than an error", () => {
  assert.equal(identifyExport("").kind, "unknown");
  assert.equal(identifyExport("\r\n\r\n").kind, "unknown");
});

test("every kind says what it is in words", () => {
  for (const text of [ACCOUNT_TRANSACTIONS, JOURNAL_REPORT, CHART, ASSETS, INVOICES, BANK]) {
    const { what } = identifyExport(text);
    assert.ok(what.length > 3 && what === what.toLowerCase(), what);
  }
});

// The two reports that were not recognised, as each actually comes out.
const TRIAL_BALANCE = csv([
  ["Trial Balance"],
  ["Example Holdings Limited"],
  ["As at 31 March 2026"],
  [
    "Account Code", "Account", "Account Type", "Account Class",
    "Debit - Month", "Credit - Month", "Debit - Year to date", "Credit - Year to date",
    "31 Mar 2025", "31 Mar 2024", "31 Mar 2023",
  ],
  ["200", "Sales", "Revenue", "Revenue", "", "20481.62", "", "84969.61", "-29098.81", "0", "0"],
]);

const GENERAL_LEDGER_DETAIL = csv([
  ["General Ledger Detail"],
  ["Example Holdings Limited"],
  ["For the period 1 September 2026 to 30 September 2026"],
  [
    "Date", "Account Code", "Account Type", "Account", "Source", "Description",
    "Invoice Number", "Reference", "Journal ID",
    "Debit", "Credit", "Gross", "GST", "Net", "GST Rate", "GST Rate Name",
  ],
  [
    "2026-09-02", "400", "Overhead", "Advertising", "Spend Money", "Google", "", "", "3513",
    "29.90", "0", "34.39", "4.49", "29.90", "15.0000", "15% GST on Expenses",
  ],
]);

test("a trial balance is recognised, which is what opening balances come from", () => {
  // It was recognised by nothing at all, so the one file the opening balances
  // need was the one file the drop zone refused -- and setting up told people
  // to fetch it.
  assert.equal(identifyExport(TRIAL_BALANCE).kind, "trial-balance");
});

test("a general ledger detail is not mistaken for a journal report", () => {
  // It carries a Journal ID and the same Date/Account/Debit/Credit, so the
  // journal report's signature claims it. What separates them is that this one
  // values every line -- gross, tax and net.
  assert.equal(identifyExport(GENERAL_LEDGER_DETAIL).kind, "general-ledger-detail");
  assert.equal(identifyExport(JOURNAL_REPORT).kind, "journal-report");
});

test("the trial balance does not claim the general ledger detail, or the chart", () => {
  // Both name an Account Code and an Account. Only a trial balance adds the
  // class an account belongs to.
  assert.notEqual(identifyExport(GENERAL_LEDGER_DETAIL).kind, "trial-balance");
  assert.notEqual(identifyExport(CHART).kind, "trial-balance");
});
