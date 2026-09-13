import assert from "node:assert/strict";
import test from "node:test";
import { invoiceBalances, isCreditNote } from "../dist/index.js";

const doc = (number, total, over = {}) => ({
  number, kind: "sales", contact: "Sample Customer", reference: "", issued: "2026-03-31",
  due: null, total, tax: 0, paid: 0, outstanding: 0, currency: "NZD", status: "", ...over,
});

test("a credit note is told by the direction it is billed in", () => {
  assert.equal(isCreditNote(doc("CN-0154", -15000)), true);
  assert.equal(isCreditNote(doc("INV-0001", 15000)), false);
});

test("a credit note on its own is not overpaid", () => {
  // The bug this replaces: a credit note is billed in the opposite direction,
  // so `total - paid` was negative before any money had moved, and every one
  // of them read as overpaid the moment it arrived. Both of the real ones on
  // these books were mislabelled that way.
  const balances = invoiceBalances([doc("CN-0154", -15000), doc("CN-0134", -500)], []);
  assert.equal(balances.get("CN-0154").status, "credit note");
  assert.equal(balances.get("CN-0134").status, "credit note");
});

test("a credit note settles the invoice it is pointed at", () => {
  const balances = invoiceBalances(
    [doc("INV-0100", 15000), doc("CN-0154", -15000)],
    [],
    undefined,
    { "CN-0154": "INV-0100" },
  );
  const invoice = balances.get("INV-0100");
  assert.equal(invoice.credited, 15000, "the credit is recorded against it");
  assert.equal(invoice.remaining, 0, "and it is no longer owing");
  assert.equal(invoice.status, "paid");
});

test("a part credit leaves the rest owing", () => {
  const balances = invoiceBalances(
    [doc("INV-0100", 15000), doc("CN-0134", -500)],
    [],
    undefined,
    { "CN-0134": "INV-0100" },
  );
  assert.equal(balances.get("INV-0100").remaining, 14500);
  assert.equal(balances.get("INV-0100").status, "part paid");
});

test("money and a credit note settle an invoice between them", () => {
  const balances = invoiceBalances(
    [doc("INV-0100", 15000), doc("CN-0134", -500)],
    [{ invoiceNumber: "INV-0100", amount: 14500 }],
    undefined,
    { "CN-0134": "INV-0100" },
  );
  const invoice = balances.get("INV-0100");
  assert.equal(invoice.assigned, 14500);
  assert.equal(invoice.credited, 500);
  assert.equal(invoice.remaining, 0);
  assert.equal(invoice.status, "paid");
});

test("an unlinked credit note changes no invoice", () => {
  // Until somebody says which invoice it credits, it credits none of them.
  // Guessing from the contact and the amount would settle the wrong invoice
  // quietly, which is worse than leaving it unapplied.
  const balances = invoiceBalances([doc("INV-0100", 15000), doc("CN-0154", -15000)], []);
  assert.equal(balances.get("INV-0100").credited, 0);
  assert.equal(balances.get("INV-0100").remaining, 15000);
  assert.equal(balances.get("INV-0100").status, "unpaid");
});

test("a credit note naming an invoice that is not there is ignored", () => {
  const balances = invoiceBalances(
    [doc("INV-0100", 15000)],
    [],
    undefined,
    { "CN-9999": "INV-0100" },
  );
  assert.equal(balances.get("INV-0100").credited, 0, "the note itself is not in the books");
});

test("an empty nomination is not a link", () => {
  const balances = invoiceBalances(
    [doc("INV-0100", 15000), doc("CN-0134", -500)],
    [],
    undefined,
    { "CN-0134": "" },
  );
  assert.equal(balances.get("INV-0100").credited, 0);
});

test("two credit notes can be applied to one invoice", () => {
  const balances = invoiceBalances(
    [doc("INV-0100", 15000), doc("CN-0134", -500), doc("CN-0154", -1000)],
    [],
    undefined,
    { "CN-0134": "INV-0100", "CN-0154": "INV-0100" },
  );
  assert.equal(balances.get("INV-0100").credited, 1500);
  assert.equal(balances.get("INV-0100").remaining, 13500);
});

test("a credit note paid out in cash is settled, not overpaid", () => {
  // A refund actually leaving the bank reduces what the credit note is owed,
  // in the same direction the note itself runs.
  const balances = invoiceBalances(
    [doc("CN-0154", -15000)],
    [{ invoiceNumber: "CN-0154", amount: -15000 }],
  );
  assert.equal(balances.get("CN-0154").remaining, 0);
  assert.equal(balances.get("CN-0154").status, "credit note");
});
