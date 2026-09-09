import assert from "node:assert/strict";
import test from "node:test";
import { parseAccountTransactionsSheet } from "../dist/coding-check.js";

// A minimal Account Transactions export: one payment, posted to an expense
// account whose name happens to contain a payment processor's name.
const sheet = (rows) => ({
  sheets: [{ name: "Account Transactions", rows: new Map(rows.map((r, i) => [i + 1, new Map(r.map((v, c) => [c + 1, v]))])) }],
  problems: [],
});

const HEADER = [
  "Date", "Source", "Contact", "Contact Group", "Description", "Invoice Number",
  "Reference", "Debit", "Credit", "Gross", "Net", "GST", "GST Rate", "GST Rate Name",
  "Account Code", "Account", "Account Type", "Related account",
];

const row = (account, code, type, debit, credit) => [
  "01/06/2025", "Spend Money", "A Supplier", "", "A payment", "", "REF1",
  debit, credit, credit === "0" ? debit : `-${credit}`, "", "0", "0", "",
  code, account, type, "",
];

const BANKISH = /\b(bnz|visa|stripe|wise)\b/i;
const structural = (name) => name === "GST";

test("an expense account is not the bank side just because of its name", () => {
  // "Stripe Fees" is an expense. Counted as a bank account it made this entry
  // look like it had two bank postings, and the whole entry was thrown away.
  const workbook = sheet([
    ["Account Transactions"], [], [], [], HEADER,
    row("BNZ 01 - Trading Account", "", "Asset", "0", "115.00"),
    row("Stripe Fees", "506", "Expense", "115.00", "0"),
  ]);

  const byNameOnly = parseAccountTransactionsSheet(workbook, "x", (n) => BANKISH.test(n), structural);
  assert.equal(byNameOnly.length, 0, "the old rule dropped it");

  const withCode = parseAccountTransactionsSheet(
    workbook, "x", (n, code) => code === "" && BANKISH.test(n), structural,
  );
  assert.equal(withCode.length, 1, "the bank side is the one with no chart code");
  assert.match(withCode[0].label, /506|Stripe Fees/);
});

test("a real bank account is still recognised", () => {
  const workbook = sheet([
    ["Account Transactions"], [], [], [], HEADER,
    row("BNZ 01 - Trading Account", "", "Asset", "0", "115.00"),
    row("Advertising", "400", "Expense", "115.00", "0"),
  ]);
  const lines = parseAccountTransactionsSheet(
    workbook, "x", (n, code) => code === "" && BANKISH.test(n), structural,
  );
  assert.equal(lines.length, 1);
  assert.match(lines[0].label, /400|Advertising/);
});

test("the working spreadsheet is read whether it arrives as a workbook or a CSV", async () => {
  const { parseReconciledCsv } = await import("../dist/coding-check.js");

  // Date, Amount, and the coding in the last column headed "What" -- the shape
  // the spreadsheet has whether it was saved or pasted out.
  const csv = [
    "Date,Amount,Other Party,Where,What,Date,Cost,What,GST Excl or Inc",
    "5/09/2023,-23.03,Payment,Bank Account,Payment,5/09/2023,-23.03,Ignore,Excl",
    "1/08/2023,793.87,RENT,Bank Account,Rent,1/08/2023,793.87,Rimu Lane Rent,Excl",
  ].join("\r\n");

  const lines = parseReconciledCsv(csv, "workbook.csv");
  assert.equal(lines.length, 2);
  assert.equal(lines[0].label, "Ignore");
  assert.equal(lines[1].label, "Rimu Lane Rent");
  assert.equal(lines[1].amount, 79387);
  assert.equal(lines[1].date, "2023-08-01");
});

test("a coding column is found under any of the words one goes under", async () => {
  const { parseReconciledCsv } = await import("../dist/coding-check.js");

  // One spreadsheet heads it "What". Nobody else's does.
  for (const heading of ["What", "Account", "Code", "Coding", "Category"]) {
    const csv = [
      `Date,Amount,${heading}`,
      "1/08/2023,793.87,Rimu Lane Rent",
    ].join("\r\n");
    const lines = parseReconciledCsv(csv, "sheet.csv");
    assert.equal(lines.length, 1, heading);
    assert.equal(lines[0].label, "Rimu Lane Rent", heading);
  }
});

test("columns can be pointed out when nothing names them", async () => {
  const { readSheetColumns, sheetHeadings } = await import("../dist/coding-check.js");
  const { csvToSheet } = await import("../dist/xlsx.js");

  // Headings this reader has never heard of.
  const csv = [
    "When,How much,Bucket",
    "1/08/2023,793.87,Rimu Lane Rent",
    "2/08/2023,-72.09,Rimu Lane Expense",
  ].join("\r\n");

  const sheet = csvToSheet(csv, "theirs.csv");
  const headings = sheetHeadings(sheet);
  assert.deepEqual(headings.columns.map((c) => c.name), ["When", "How much", "Bucket"]);

  const lines = readSheetColumns(sheet, { date: 1, amount: 2, code: 3 }, "theirs.csv");
  assert.equal(lines.length, 2);
  assert.equal(lines[0].label, "Rimu Lane Rent");
  assert.equal(lines[0].amount, 79387);
  assert.equal(lines[1].amount, -7209);
});
