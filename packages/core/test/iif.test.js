import { test } from "node:test";
import assert from "node:assert/strict";
import { isIif, parseIif, parseIifBooks, identifyExport } from "../dist/index.js";

const T = (...cells) => cells.join("\t");
const FILE = [
  T("!ACCNT", "NAME", "ACCNTTYPE", "ACCNUM", "DESC"),
  T("ACCNT", "Checking", "BANK", "", ""),
  T("ACCNT", "Visa", "CCARD", "", ""),
  T("ACCNT", "Accounts Receivable", "AR", "1100", ""),
  T("ACCNT", "Sales", "INC", "4000", ""),
  T("ACCNT", "Supplies", "EXP", "", ""),
  T("ACCNT", "Owner Equity", "EQUITY", "", ""),
  T("!CUST", "NAME", "BADDR1", "BADDR2", "EMAIL", "PHONE1"),
  T("CUST", "Acme Co", "1 Main St", "Springfield", "ap@acme.test", "555-0100"),
  T("!TRNS", "TRNSID", "TRNSTYPE", "DATE", "ACCNT", "NAME", "CLASS", "AMOUNT", "DOCNUM", "MEMO"),
  T("!SPL", "SPLID", "TRNSTYPE", "DATE", "ACCNT", "NAME", "CLASS", "AMOUNT", "DOCNUM", "MEMO"),
  T("!ENDTRNS"),
  T("TRNS", "", "INVOICE", "03/02/2026", "Accounts Receivable", "Acme Co", "Shop", "500.00", "1001", ""),
  T("SPL", "", "INVOICE", "03/02/2026", "Sales", "Acme Co", "Shop", "-500.00", "1001", "Design work"),
  T("ENDTRNS"),
  T("TRNS", "", "PAYMENT", "03/20/2026", "Checking", "Acme Co", "", "300.00", "", ""),
  T("SPL", "", "PAYMENT", "03/20/2026", "Accounts Receivable", "Acme Co", "", "-300.00", "", ""),
  T("ENDTRNS"),
  T("TRNS", "", "CREDIT CARD", "03/21/2026", "Visa", "Office Depot", "", "-42.50", "", "Paper"),
  T("SPL", "", "CREDIT CARD", "03/21/2026", "Supplies", "Office Depot", "", "42.50", "", "Paper"),
  T("ENDTRNS"),
  T("TRNS", "", "CHECK", "03/25/2026", "Checking", "", "", "-100.00", "102", ""),
  T("SPL", "", "CHECK", "03/25/2026", "Visa", "", "", "100.00", "102", ""),
  T("ENDTRNS"),
  T("TRNS", "", "GENERAL JOURNAL", "03/31/2026", "Owner Equity", "", "", "-10.00", "", "Odd"),
  T("SPL", "", "GENERAL JOURNAL", "03/31/2026", "Supplies", "", "", "10.00", "", "Odd"),
  T("ENDTRNS"),
  T("TRNS", "", "GENERAL JOURNAL", "03/31/2026", "Owner Equity", "", "", "-10.00", "", "Off"),
  T("SPL", "", "GENERAL JOURNAL", "03/31/2026", "Supplies", "", "", "9.00", "", "Off"),
  T("ENDTRNS"),
].join("\r\n");

test("an IIF file is known as one, before anything else reads it", () => {
  assert.equal(isIif(FILE), true);
  assert.equal(isIif("Date,Amount\n1/1/2026,5"), false);
  assert.equal(identifyExport(FILE).kind, "quickbooks-iif");
});

test("accounts, customers and entries", () => {
  const read = parseIif(FILE);
  assert.deepEqual(read.chart.accounts.map((a) => [a.code, a.name, a.type]), [
    ["", "Checking", "Bank"],
    ["", "Visa", "Bank"],
    ["1100", "Accounts Receivable", "Accounts Receivable"],
    ["4000", "Sales", "Revenue"],
    ["6000", "Supplies", "Overhead"],
    ["3000", "Owner Equity", "Equity"],
  ]);
  assert.deepEqual(read.chart.cardNames, ["Visa"]);
  assert.equal(read.contacts[0].address, "1 Main St\nSpringfield");
  assert.equal(read.entries.length, 5);
  assert.equal(read.problems.length, 1);
  assert.match(read.problems[0].message, /does not balance/);
  assert.equal(read.classes.get(read.entries[0]), "Shop");
});

test("the books: an invoice part paid, a card charge, a transfer, a journal", () => {
  const books = parseIifBooks(FILE, null);
  assert.equal(books.invoices.length, 1);
  assert.equal(books.invoices[0].number, "1001");
  assert.equal(books.invoices[0].outstanding, 20000);
  assert.deepEqual(books.transactions.map((t) => [t.date, t.account, t.amount]), [
    ["2026-03-20", "checking", 30000],
    ["2026-03-21", "visa", -4250],
    ["2026-03-25", "checking", -10000],
    ["2026-03-25", "visa", 10000],
  ]);
  assert.equal(books.payments.length, 1);
  assert.equal(books.transfers.length, 1);
  assert.equal(books.journals.length, 1);
  assert.ok(books.reference.some((r) => r.amount === -4250 && /Supplies/.test(r.code)));
});
