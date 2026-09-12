import assert from "node:assert/strict";
import test from "node:test";
import { invoiceCandidates, invoiceBalancesFor, nextInvoiceNumber } from "../dist/index.js";

const inv = (over = {}) => ({
  number: "INV-0001", kind: "sales", contact: "Mere Tautahi", reference: "",
  issued: "2025-06-01", due: "2025-06-20", total: 11500, tax: 1500, paid: 11500,
  outstanding: 0, currency: "NZD", status: "Paid",
  lines: [{ description: "", accountCode: "200", taxType: "", gross: 11500, tax: 1500, net: 10000 }],
  ...over,
});

const txn = (over = {}) => ({
  id: "t", date: "2025-06-10", account: "BNZ 01", amount: 11500,
  otherParty: "", particulars: "", code: "", reference: "",
  description: "", currency: "NZD", source: "bank", ...over,
});

/** Balances with nothing paid, so every invoice is owing in full. */
const owingAll = (invoices) =>
  invoiceBalancesFor({ invoices, transactions: [], splits: {}, assignments: new Map() });

const find = (transaction, invoices, over = {}) =>
  invoiceCandidates(transaction, { invoices, balances: owingAll(invoices), ...over });

test("with no invoices, or a zero amount, there is nothing to offer", () => {
  assert.deepEqual(find(txn(), []), []);
  assert.deepEqual(find(txn({ amount: 0 }), [inv()]), []);
});

test("money in looks at sales, money out at purchases", () => {
  const sale = inv({ number: "INV-1" });
  const bill = inv({ number: "BILL-1", kind: "purchase" });
  assert.deepEqual(find(txn({ amount: 11500 }), [sale, bill]).map((i) => i.number), ["INV-1"]);
  assert.deepEqual(find(txn({ amount: -11500 }), [sale, bill]).map((i) => i.number), ["BILL-1"]);
});

test("an exact amount is a candidate on its own", () => {
  assert.deepEqual(find(txn({ amount: 11500 }), [inv()]).map((i) => i.number), ["INV-0001"]);
});

test("a coincidental amount with no contact and no number is not offered", () => {
  // Nothing here says this receipt is that invoice except the figure, and a
  // round figure repeats. Offering it invites a wrong match.
  assert.deepEqual(find(txn({ amount: 9999 }), [inv()]), []);
});

test("the number quoted on the bank line outranks everything", () => {
  const named = inv({ number: "INV-0042", total: 50000 });
  const exact = inv({ number: "INV-0001", total: 11500 });
  const found = find(txn({ amount: 11500, reference: "Payment INV-0042" }), [named, exact]);
  assert.equal(found[0].number, "INV-0042", "named beats exact");
  assert.equal(found.length, 2, "and the exact one is still offered");
});

test("the contact's first word is enough, because bank lines abbreviate", () => {
  // "TAUTAHI,MERE" has to recognise "Mere Tautahi". Matching the whole name
  // would find nothing.
  const found = find(
    txn({ amount: 5000, otherParty: "TAUTAHI,MERE" }),
    [inv({ total: 11500 })],
  );
  assert.equal(found.length, 1, "a part payment, recognised by contact");
});

test("a part payment needs the contact; the amount alone is not enough", () => {
  assert.deepEqual(find(txn({ amount: 5000 }), [inv({ total: 11500 })]), []);
});

test("an invoice with nothing owing is not what this receipt is for", () => {
  const invoice = inv({ total: 11500 });
  const paid = invoiceBalancesFor({
    invoices: [invoice],
    transactions: [txn({ id: "paid", amount: 11500 })],
    splits: {},
    assignments: new Map([["paid", "INV-0001"]]),
  });
  assert.deepEqual(invoiceCandidates(txn({ amount: 11500 }), { invoices: [invoice], balances: paid }), []);
});

test("a part-paid invoice is matched on what is still owing, not the total", () => {
  // The bug this carries: judged against the full amount, the second half of a
  // half-paid invoice is neither exact nor well ranked, so it never came up.
  const invoice = inv({ total: 20000 });
  const balances = invoiceBalancesFor({
    invoices: [invoice],
    transactions: [txn({ id: "first", amount: 12000 })],
    splits: {},
    assignments: new Map([["first", "INV-0001"]]),
  });
  const found = invoiceCandidates(txn({ amount: 8000 }), { invoices: [invoice], balances });
  assert.equal(found.length, 1, "8,000 is exactly what is left of 20,000");
});

test("a split part counts as a payment against its own invoice", () => {
  const a = inv({ number: "INV-1", total: 15100 });
  const b = inv({ number: "INV-2", total: 4900 });
  const balances = invoiceBalancesFor({
    invoices: [a, b],
    transactions: [txn({ id: "pay", amount: 20000 })],
    splits: { pay: [{ amount: 15100 }, { amount: 4900 }] },
    assignments: new Map([["pay:1", "INV-1"], ["pay:2", "INV-2"]]),
  });
  assert.equal(balances.get("INV-1").remaining, 0);
  assert.equal(balances.get("INV-2").remaining, 0);
});

test("an invoice raised long ago is out of the window", () => {
  assert.deepEqual(find(txn({ date: "2026-06-10" }), [inv()]), []);
});

test("the next number keeps the width already in use", () => {
  // Padding is what keeps a list sorting: INV-0010 after INV-0009, where
  // INV-10 would sort before INV-9.
  assert.equal(nextInvoiceNumber("sales", []), "INV-0001");
  assert.equal(nextInvoiceNumber("purchase", []), "BILL-0001");
  assert.equal(nextInvoiceNumber("sales", [inv({ number: "INV-0009" })]), "INV-0010");
  assert.equal(nextInvoiceNumber("sales", [inv({ number: "INV-7" })]), "INV-8");
});

test("the highest number wins, not the last one in the list", () => {
  const found = nextInvoiceNumber("sales", [
    inv({ number: "INV-0100" }), inv({ number: "INV-0007" }),
  ]);
  assert.equal(found, "INV-0101");
});
