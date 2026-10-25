import { test } from "node:test";
import assert from "node:assert/strict";
import { searchBooks } from "../dist/index.js";

const contacts = [
  { id: "c1", name: "Tūī Café", kind: "customer", email: "hello@tui.nz" },
  { id: "c2", name: "Rimu Roasters", kind: "vendor" },
];
const invoices = [
  { number: "INV-0012", kind: "sales", contact: "Tūī Café", reference: "October beans", issued: "2026-10-01", due: null, total: 12050, status: "Awaiting Payment" },
  { number: "BILL-7", kind: "purchase", contact: "Rimu Roasters", reference: "", issued: "2026-09-20", due: null, total: 45000, status: "Paid" },
];
const line = (id, date, amount, otherParty, reference = "") => ({ id, date, amount, otherParty, reference, particulars: "", code: "", account: "acc1" });
const transactions = [line("t1", "2026-10-03", 12050, "TUI CAFE LTD", "INV-0012"), line("t2", "2026-09-21", -45000, "Rimu Roasters"), line("t3", "2026-08-01", -2000, "Z Energy")];
const books = { contacts, invoices, transactions, accountName: () => "Cheque account" };

test("a word finds the contact, the invoice and the bank line that name it, accents or not", () => {
  const hits = searchBooks("tui", books);
  assert.deepEqual(hits.map((h) => [h.kind, h.key]), [["contact", "c1"], ["invoice", "INV-0012"], ["line", "t1"]]);
  assert.match(hits[2].detail, /120\.50 · Cheque account/);
});

test("every word must be there", () => {
  assert.deepEqual(searchBooks("rimu fuel", books), []);
  assert.deepEqual(searchBooks("rimu roasters", books).map((h) => h.kind), ["contact", "bill", "line"]);
});

test("an amount finds what is exactly that much, in or out", () => {
  assert.deepEqual(searchBooks("450", books).map((h) => h.key), ["BILL-7", "t2"]);
  assert.deepEqual(searchBooks("$120.50", books).map((h) => h.key), ["INV-0012", "t1"]);
});

test("a number finds a document by its number, and one letter finds nothing", () => {
  assert.deepEqual(searchBooks("inv-0012", books).map((h) => h.key), ["INV-0012", "t1"]);
  assert.deepEqual(searchBooks("z", books), []);
});
