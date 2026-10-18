import test from "node:test";
import assert from "node:assert/strict";
import {
  isQuickBooksDesktopDetail,
  parseQuickBooksDesktopDetail,
  parseQuickBooksDesktopDetailBooks,
} from "../dist/index.js";

// Invented books in the layout QuickBooks Desktop gives Transaction Detail by
// Account: headings in the first columns (sub-accounts one further), an empty
// column between each field, a Total row closing each account.
const H = ",,,,,Type,,Date,,Num,,Adj,,Name,,Memo,,Clr,,Split,,Debit,,Credit,,Original Amount,,Balance";
const head = (depth, text) => `${",".repeat(depth + 1)}${text}${",".repeat(27 - depth)}`;
const row = (type, date, num, name, memo, split, debit, credit) =>
  `,,,,,${type},,${date},,${num},,,,${name},,${memo},,,,${split},,${debit},,${credit},,,,`;
const total = (depth, text, debit, credit) => `${",".repeat(depth + 1)}Total ${text}${",".repeat(20 - depth)}${debit},,${credit},,,,`;

const report = (rentTotal = "1200.00") =>
  [
    H,
    head(0, "10100 · Checking"),
    row("Payment", "03/02/2026", "", "Kowhai Cafe", "", "Accounts Receivable", "550.00", ""),
    row("Bill Pmt -Check", "03/05/2026", "2001", "Totara Supplies", "", "Accounts Payable", "", "330.00"),
    row("Check", "03/10/2026", "2002", "Rimu Property", "March rent", "Rent", "", "1200.00"),
    total(0, "10100 · Checking", "550.00", "1530.00"),
    head(0, "11000 · Accounts Receivable"),
    row("Invoice", "03/01/2026", "1001", "Kowhai Cafe", "", "Sales", "550.00", ""),
    row("Payment", "03/02/2026", "", "Kowhai Cafe", "", "Checking", "", "550.00"),
    total(0, "11000 · Accounts Receivable", "550.00", "550.00"),
    head(0, "20000 · Accounts Payable"),
    row("Bill", "03/03/2026", "B-77", "Totara Supplies", "", "-SPLIT-", "", "330.00"),
    row("Bill Pmt -Check", "03/05/2026", "2001", "Totara Supplies", "", "Checking", "330.00", ""),
    total(0, "20000 · Accounts Payable", "330.00", "330.00"),
    head(0, "40000 · Sales"),
    row("Invoice", "03/01/2026", "1001", "Kowhai Cafe", "Coffee beans", "Accounts Receivable", "", "550.00"),
    total(0, "40000 · Sales", "0.00", "550.00"),
    head(0, "60000 · Supplies"),
    head(1, "60100 · Packaging"),
    row("Bill", "03/03/2026", "B-77", "Totara Supplies", "Boxes", "Accounts Payable", "200.00", ""),
    total(1, "60100 · Packaging", "200.00", "0.00"),
    head(1, "60200 · Cleaning"),
    row("Bill", "03/03/2026", "B-77", "Totara Supplies", "Cloths", "Accounts Payable", "130.00", ""),
    total(1, "60200 · Cleaning", "130.00", "0.00"),
    total(0, "60000 · Supplies", "330.00", "0.00"),
    head(0, "62000 · Rent"),
    row("Check", "03/10/2026", "2002", "Rimu Property", "March rent", "Checking", "1200.00", ""),
    total(0, "62000 · Rent", rentTotal, "0.00"),
    "TOTAL,,,,,,,,,,,,,,,,,,,,,2630.00,,2630.00,,,,0.00",
  ].join("\n");

test("QuickBooks Desktop's Transaction Detail by Account is recognised", () => {
  assert.equal(isQuickBooksDesktopDetail(report()), true);
  assert.equal(isQuickBooksDesktopDetail("Date,Amount,Payee\n2026-03-01,10,X"), false);
});

test("each transaction is put back together from the accounts it touches", () => {
  const read = parseQuickBooksDesktopDetail(report());
  assert.deepEqual(read.problems, []);
  const names = read.chart.accounts.map((a) => a.name);
  assert.ok(names.includes("Supplies:Packaging") && names.includes("Supplies:Cleaning"));
  assert.equal(read.chart.accounts.find((a) => a.name === "Rent")?.code, "62000");
  const bill = read.entries.find((e) => e.type === "Bill");
  assert.deepEqual(
    bill.legs.map((l) => [l.account, l.debit]),
    [["Accounts Payable", -33000], ["Supplies:Packaging", 20000], ["Supplies:Cleaning", 13000]],
  );
  // The payment's number is on none of its rows: told apart by type, date and name.
  const payment = read.entries.find((e) => e.type === "Payment");
  assert.deepEqual(payment.legs.map((l) => l.debit).sort(), [-55000, 55000]);
  assert.equal(read.entries.length, 5);
  for (const entry of read.entries) assert.equal(entry.legs.reduce((s, l) => s + l.debit, 0), 0);
});

test("an account whose lines do not come to QuickBooks' total refuses the file whole", () => {
  const read = parseQuickBooksDesktopDetail(report("1250.00"));
  assert.equal(read.entries.length, 0);
  assert.match(read.problems[0].message, /Rent: its lines come to 1200\.00 debit/);
});

test("made into books: the bank lines, and the invoice and bill as journals", () => {
  const books = parseQuickBooksDesktopDetailBooks(report(), null, {});
  assert.equal(books.transactions.length, 3);
  assert.equal(books.problems.length, 0);
});

test("five-digit account numbers, as Desktop numbers them, are codes", async () => {
  const { splitAccountLabel } = await import("../dist/index.js");
  assert.deepEqual(splitAccountLabel("Sales - 40000"), { code: "40000", name: "Sales" });
  assert.deepEqual(splitAccountLabel("40000 Sales"), { code: "40000", name: "Sales" });
  assert.deepEqual(splitAccountLabel("Rates - 420MS"), { code: "420MS", name: "Rates" });
});
