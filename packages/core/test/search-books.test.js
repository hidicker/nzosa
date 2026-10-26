import assert from "node:assert/strict";
import test from "node:test";
import { searchBooks } from "../dist/index.js";

// Invented names and figures.
const line = (over) => ({
  id: "t1", date: "2026-05-20", amount: 23000, currency: "NZD", serial: "", trn: "", particulars: "INV-0001",
  code: "", reference: "", otherParty: "Kea Cafe", origin: "", type: "", batch: "", otherPartyAccount: "", account: "bnz", ...over,
});
const from = {
  contacts: [{ name: "Kea Cafe", email: "accounts@kea.example" }, { name: "Rimu Electrical" }],
  invoices: [
    { number: "INV-0001", kind: "sales", contact: "Kea Cafe", reference: "PO 88", issued: "2026-05-01", due: null, total: 23000, tax: 3000,
      paid: 0, outstanding: 23000, currency: "NZD", status: "Awaiting Payment", lines: [{ description: "Tandem flight", accountCode: "200", taxType: "", net: 0, tax: 0, gross: 23000 }] },
    { number: "BILL-0007", kind: "purchase", contact: "Rimu Electrical", reference: "R-77", issued: "2026-04-01", due: null, total: 46000, tax: 6000,
      paid: 0, outstanding: 46000, currency: "NZD", status: "Awaiting Payment", lines: [] },
  ],
  transactions: [line(), line({ id: "t2", amount: -46000, otherParty: "Rimu Electrical", particulars: "R-77", date: "2026-04-20" })],
  journals: [{ id: "m1", date: "2026-03-31", narration: "Accrued accountancy fee", lines: [{ code: "429", amount: 50000 }, { code: "800", amount: -50000 }] }],
  money: (c) => (c / 100).toFixed(2),
};

test("a name finds the contact first, then what carries it", () => {
  const hits = searchBooks("kea", from);
  assert.deepEqual(hits.map((h) => h.kind), ["contact", "invoice", "line"]);
  assert.equal(hits[0].id, "Kea Cafe");
});

test("a number is tried as an amount, either way round", () => {
  const hits = searchBooks("460", from);
  assert.deepEqual(hits.map((h) => `${h.kind}:${h.id}`).sort(), ["bill:BILL-0007", "line:t2"]);
  assert.deepEqual(searchBooks("500.00", from).map((h) => h.kind), ["journal"]);
});

test("every word has to be found, in a reference or a line's description too", () => {
  assert.deepEqual(searchBooks("tandem kea", from).map((h) => h.id), ["INV-0001"]);
  assert.deepEqual(searchBooks("R-77", from).map((h) => h.id).sort(), ["BILL-0007", "t2"]);
  assert.deepEqual(searchBooks("accrued", from).map((h) => h.id), ["m1"]);
  assert.deepEqual(searchBooks("   ", from), []);
});
