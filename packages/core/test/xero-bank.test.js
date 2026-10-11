import assert from "node:assert/strict";
import test from "node:test";
import { detect, identifyExport, importFile } from "../dist/index.js";

// Xero's Account Transactions report, as it exports: a title, the
// organisation, the period, then the columns. Invented figures.
const HEAD = [
  "Account Transactions,,,,,,,,,,",
  "Kowhai Trading Limited,,,,,,,,,,",
  "For the period 1 April 2025 to 31 March 2026,,,,,,,,,,",
  "Date,Description,Contact,Source,Reference,Debit,Credit,Gross,Related Account,Account Code,Account,Account Type",
];
const row = (date, description, contact, source, reference, debit, credit, related, code, account, type) =>
  [date, description, contact, source, reference, debit, credit, debit - credit, related, code, account, type].join(",");
const file = (rows) => [...HEAD, ...rows].join("\n");

test("a bank account's report is its bank lines: debit in, credit out", () => {
  const text = file([
    row("2025-08-03", "Payment: Rimu Supplies", "Rimu Supplies", "Payable Payment", "", 0, 120.5, "800 - Accounts Payable", "090", "Business Bank Account", "Asset"),
    row("2025-09-20", "Payment: Totara Cafe", "Totara Cafe", "Receivable Payment", "INV-0001", 500, 0, "610 - Accounts Receivable", "090", "Business Bank Account", "Asset"),
  ]);
  assert.equal(detect(text)?.importer, "xero-bank");
  const result = importFile(text, { file: "bank.csv" });
  assert.deepEqual(
    result.transactions.map((t) => [t.date, t.amount, t.otherParty, t.reference, t.type]),
    [
      ["2025-08-03", -12050, "Rimu Supplies", "", "Payable Payment"],
      ["2025-09-20", 50000, "Totara Cafe", "INV-0001", "Receivable Payment"],
    ],
  );
  assert.equal(result.transactions[0].account, "business-bank-account", "named as Xero names it");
  assert.equal(result.transactions[0].extras.accountLabel, "Business Bank Account");
});

test("from a report of every account, only the bank accounts' rows", () => {
  // Bank Fees is named like a bank and is an expense; its rows are the other
  // side of the same payments and must not become bank lines.
  const text = file([
    row("2025-08-03", "Bank fee", "Kowhai Bank", "Spend Money", "", 0, 15, "404 - Bank Fees", "090", "Business Bank Account", "Asset"),
    row("2025-08-03", "Bank fee", "Kowhai Bank", "Spend Money", "", 15, 0, "Business Bank Account", "404", "Bank Fees", "Expense"),
    row("2025-08-04", "Coffee", "Totara Cafe", "Spend Money", "", 0, 6.5, "420 - Entertainment", "", "Business Visa", "Liability"),
    row("2025-08-04", "Coffee", "Totara Cafe", "Spend Money", "", 6.5, 0, "Business Visa", "420", "Entertainment", "Expense"),
  ]);
  const result = importFile(text, { file: "all.csv", importer: "xero-bank" });
  assert.deepEqual(
    result.transactions.map((t) => [t.extras.accountLabel, t.amount]),
    [["Business Bank Account", -1500], ["Business Visa", -650]],
  );
});

test("a bank's own CSV is still read by its own importer", () => {
  const bnz = [
    "Date,Amount,Payee,Particulars,Code,Reference,Tran Type,This Party Account,Other Party Account,Serial,Transaction Code,Batch Number,Originating Bank/Branch,Processed Date",
    "03/08/2025,-120.50,Rimu Supplies,,,,DD,02-0900-0000090-000,,,,,,03/08/2025",
  ].join("\n");
  assert.equal(detect(bnz)?.importer, "bnz-account");
});

test("among Xero's exports, the report is still the coding history", () => {
  // Taken as a bank statement on Start here, it put Xero's copy of every bank
  // line beside the bank feed's.
  const text = file([
    row("2025-08-03", "Payment: Rimu Supplies", "Rimu Supplies", "Payable Payment", "", 0, 120.5, "800 - Accounts Payable", "090", "Business Bank Account", "Asset"),
  ]);
  assert.notEqual(identifyExport(text).kind, "bank");
});
