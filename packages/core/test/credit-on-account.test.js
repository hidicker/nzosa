import assert from "node:assert/strict";
import test from "node:test";
import { creditOnAccount, invoiceBalances } from "../dist/index.js";

const doc = (number, contact, total, over = {}) => ({
  number, kind: "sales", contact, reference: "", issued: "2026-05-01", due: null, total, tax: 0,
  paid: 0, outstanding: total, currency: "NZD", status: "Awaiting Payment", lines: [], ...over,
});
const books = [
  doc("INV-1", "Kea", 10_000),
  doc("INV-2", "Kea", 6_000),
  doc("CN-1", "Kea", -8_000),
  doc("INV-3", "Tui", 5_000),
];
const none = [];

test("a credit note held on account is credit available, until applied", () => {
  const b = invoiceBalances(books, none);
  assert.equal(b.get("CN-1").available, 8_000);
  assert.deepEqual(creditOnAccount(b.values()).map((c) => [c.contact, c.available, c.from]), [["Kea", 8_000, ["CN-1"]]]);
});

test("applied in parts to two invoices: each owes less, and the note what is left", () => {
  const b = invoiceBalances(books, none, undefined, {}, { "CN-1": [{ invoice: "INV-1", amount: 5_000 }, { invoice: "INV-2", amount: 2_000 }] });
  assert.equal(b.get("INV-1").remaining, 5_000);
  assert.equal(b.get("INV-1").status, "part paid");
  assert.equal(b.get("INV-2").remaining, 4_000);
  assert.equal(b.get("CN-1").applied, 7_000);
  assert.equal(b.get("CN-1").available, 1_000);
});

test("the whole-note link still works beside applications", () => {
  const b = invoiceBalances(books, none, undefined, { "CN-1": "INV-1" });
  assert.equal(b.get("INV-1").remaining, 2_000);
  assert.equal(b.get("CN-1").available, 0);
});

test("an overpayment is credit on account, and applying it moves it to another invoice", () => {
  const paid = [{ invoiceNumber: "INV-3", amount: 7_000 }];
  const before = invoiceBalances(books, paid);
  assert.equal(before.get("INV-3").status, "overpaid");
  assert.equal(before.get("INV-3").available, 2_000);
  const after = invoiceBalances([...books, doc("INV-4", "Tui", 3_000)], paid, undefined, {}, { "INV-3": [{ invoice: "INV-4", amount: 2_000 }] });
  assert.equal(after.get("INV-3").remaining, 0);
  assert.equal(after.get("INV-3").status, "paid");
  assert.equal(after.get("INV-3").available, 0);
  assert.equal(after.get("INV-4").remaining, 1_000);
});

test("a refund through the bank uses the credit up too", () => {
  const b = invoiceBalances(books, [{ invoiceNumber: "CN-1", amount: -3_000 }]);
  assert.equal(b.get("CN-1").available, 5_000);
});

test("the aged report takes applied credit from the day it was applied", async () => {
  const { agedReport } = await import("../dist/index.js");
  const applications = { "CN-1": [{ invoice: "INV-1", amount: 5_000, on: "2026-06-01" }] };
  const before = agedReport({ invoices: books, kind: "sales", payments: [], applications, asAt: "2026-05-15" });
  const after = agedReport({ invoices: books, kind: "sales", payments: [], applications, asAt: "2026-06-30" });
  const kea = (r) => r.contacts.find((c) => c.contact === "Kea");
  assert.equal(kea(before).total, 10_000 + 6_000 - 8_000);
  assert.equal(kea(after).total, 10_000 + 6_000 - 8_000, "applying credit moves it, it does not change what is owed in all");
  assert.equal(kea(after).items.find((i) => i.invoice.number === "INV-1").owing, 5_000);
  assert.equal(kea(after).items.find((i) => i.invoice.number === "CN-1").owing, -3_000);
});
