import assert from "node:assert/strict";
import test from "node:test";
import { invoiceAssignments } from "../dist/index.js";

const txn = (id, amount, date = "2025-06-10") => ({
  id, date, account: "BNZ 01", amount, otherParty: "Sample Customer", particulars: "",
  code: "", reference: "", description: "", currency: "NZD", source: "bank",
});

// Marked paid by the system it was imported from: the matcher reconciles a
// bank line against an invoice that system already settled, so one it still
// shows as outstanding is not a candidate.
const invoice = (number, total, issued = "2025-06-01") => ({
  number, kind: "sales", contact: "Sample Customer", reference: "", issued,
  due: "2025-06-20", total, tax: 0, paid: total, outstanding: 0, currency: "NZD",
  status: "Paid",
  lines: [{ description: "", accountCode: "200", taxType: "", gross: total, tax: 0, net: total }],
});

const unpaidInvoice = (number, total) => ({ ...invoice(number, total), paid: 0, outstanding: total, status: "Unpaid" });

const run = (over = {}) =>
  invoiceAssignments({
    invoices: [], transactions: [], accepted: {}, splits: {}, ...over,
  });

test("with no invoices there is nothing to assign", () => {
  assert.deepEqual([...run({ transactions: [txn("a", 10000)] })], []);
});

test("what a person accepted is kept", () => {
  const map = run({
    invoices: [invoice("INV-1", 10000)],
    transactions: [txn("a", 10000)],
    accepted: { a: "INV-1" },
  });
  assert.equal(map.get("a"), "INV-1");
});

test("an accepted assignment beats what the matcher would have said", () => {
  // Somebody looked. The matcher is a suggestion and this is a decision.
  const map = run({
    invoices: [invoice("INV-1", 10000), invoice("INV-2", 10000)],
    transactions: [txn("a", 10000)],
    accepted: { a: "INV-2" },
  });
  assert.equal(map.get("a"), "INV-2");
});

test("a refusal is not an assignment", () => {
  // An empty string is recorded so the matcher stops offering a line somebody
  // has rejected. It must not leave here looking like an answer.
  const map = run({
    invoices: [invoice("INV-1", 10000)],
    transactions: [txn("a", 10000)],
    accepted: { a: "" },
  });
  assert.equal(map.has("a"), false);
});

test("the matcher fills in what nobody has answered", () => {
  const map = run({
    invoices: [invoice("INV-1", 10000)],
    transactions: [txn("a", 10000)],
  });
  assert.equal(map.get("a"), "INV-1");
});

test("a payment whose parts settle invoices is not also claimed whole", () => {
  // The expensive one. The parts have answered more precisely than the matcher
  // could; letting it also claim the parent counts the same money twice --
  // once as the whole payment against one invoice, and again as its parts
  // against several.
  const map = run({
    invoices: [invoice("INV-1", 15100), invoice("INV-2", 4900), invoice("INV-3", 20000)],
    transactions: [txn("pay", 20000)],
    splits: { pay: [{ amount: 15100 }, { amount: 4900 }] },
    accepted: { "pay:1": "INV-1", "pay:2": "INV-2" },
  });
  assert.equal(map.get("pay:1"), "INV-1");
  assert.equal(map.get("pay:2"), "INV-2");
  assert.equal(map.has("pay"), false, "the parent is not claimed as well");
});

test("a split whose parts settle nothing is still matchable as a whole", () => {
  // The guard is about parts that *are* assigned. A payment divided for coding
  // reasons has answered nothing about invoices.
  const map = run({
    invoices: [invoice("INV-3", 20000)],
    transactions: [txn("pay", 20000)],
    splits: { pay: [{ amount: 15100 }, { amount: 4900 }] },
  });
  assert.equal(map.get("pay"), "INV-3");
});

test("an invoice the source system still shows outstanding is not matched", () => {
  // The matcher pairs a bank line with an invoice already settled elsewhere.
  // One with nothing paid against it has not been settled by anything, so a
  // receipt of the same amount is a coincidence rather than a payment.
  const map = run({
    invoices: [unpaidInvoice("INV-9", 10000)],
    transactions: [txn("a", 10000)],
  });
  assert.equal(map.has("a"), false);
});
