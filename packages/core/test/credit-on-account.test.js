import { test } from "node:test";
import assert from "node:assert/strict";
import { agedReport, allocationProblem, creditsOnAccount, invoiceBalances, proposeAllocations } from "../dist/index.js";

const doc = (number, total, issued, extra = {}) => ({
  number, kind: "sales", contact: "Acme Ltd", reference: "", issued, due: null, total, paid: 0, outstanding: 0, status: "", lines: [], ...extra,
});

// Acme: a 300 credit note, an invoice overpaid by 50, and two invoices owing.
const docs = [
  doc("CN-1", -30_000, "2026-08-01"),
  doc("INV-1", 10_000, "2026-07-01"),
  doc("INV-2", 20_000, "2026-08-10", { due: "2026-08-20" }),
  doc("INV-3", 25_000, "2026-09-01", { due: "2026-09-20" }),
  doc("INV-9", 5_000, "2026-09-01", { contact: "Other Co" }),
];
const receipts = [{ invoiceNumber: "INV-1", amount: 15_000 }];

test("credit on account: a credit note's and an overpayment's, and what could take it", () => {
  const balances = invoiceBalances(docs, receipts);
  const [acme] = creditsOnAccount(balances.values(), "sales");
  assert.equal(acme.contact, "Acme Ltd");
  assert.deepEqual(acme.sources.map((s) => [s.balance.invoice.number, s.available]), [["INV-1", 5_000], ["CN-1", 30_000]]);
  assert.equal(acme.available, 35_000);
  assert.deepEqual(acme.open.map((b) => b.invoice.number), ["INV-2", "INV-3"]);
  assert.equal(creditsOnAccount(balances.values(), "sales").length, 1, "Other Co has no credit");
  // A credit note applied whole offers nothing itself; the 300 against a 250
  // invoice leaves that invoice 50 over, which is credit, beside INV-1's 50.
  const whole = creditsOnAccount(invoiceBalances(docs, receipts, undefined, { "CN-1": "INV-3" }).values(), "sales", { "CN-1": "INV-3" })[0];
  assert.deepEqual(whole.sources.map((s) => [s.balance.invoice.number, s.available]), [["INV-1", 5_000], ["INV-3", 5_000]]);
});

test("proposed oldest due first, drawing on the oldest credit first", () => {
  const balances = invoiceBalances(docs, receipts);
  const [acme] = creditsOnAccount(balances.values(), "sales");
  const proposed = proposeAllocations(acme, undefined, "2026-10-01");
  assert.deepEqual(proposed.map((a) => [a.from, a.to, a.amount]), [
    ["INV-1", "INV-2", 5_000],
    ["CN-1", "INV-2", 15_000],
    ["CN-1", "INV-3", 15_000],
  ]);
  assert.equal(allocationProblem(proposed, balances), null);
  // Asked for less on one: only that much.
  const some = proposeAllocations(acme, new Map([["INV-2", 2_000], ["INV-3", 0]]), "2026-10-01");
  assert.deepEqual(some.map((a) => [a.from, a.to, a.amount]), [["INV-1", "INV-2", 2_000]]);
});

test("used, the credit and the documents settle, and what is left stays on account", () => {
  const allocations = [
    { from: "INV-1", to: "INV-2", amount: 5_000, date: "2026-10-01" },
    { from: "CN-1", to: "INV-2", amount: 15_000, date: "2026-10-01" },
    { from: "CN-1", to: "INV-3", amount: 10_000, date: "2026-10-01" },
  ];
  const b = invoiceBalances(docs, receipts, undefined, {}, allocations);
  assert.equal(b.get("INV-1").remaining, 0);
  assert.equal(b.get("INV-1").status, "paid");
  assert.equal(b.get("INV-2").remaining, 0);
  assert.equal(b.get("INV-2").status, "paid");
  assert.equal(b.get("INV-3").remaining, 15_000);
  assert.equal(b.get("CN-1").remaining, -5_000, "5,000 of the credit note still to use");
  assert.equal(creditsOnAccount(b.values(), "sales")[0].available, 5_000);
});

test("the aged report counts a credit used from its date, and the total is unchanged by it", () => {
  const allocations = [{ from: "CN-1", to: "INV-2", amount: 20_000, date: "2026-10-01" }];
  const payments = [{ invoiceNumber: "INV-1", date: "2026-07-15", amount: 15_000 }];
  const before = agedReport({ invoices: docs, kind: "sales", payments, allocations, asAt: "2026-09-30" });
  const after = agedReport({ invoices: docs, kind: "sales", payments, allocations, asAt: "2026-10-31" });
  assert.equal(before.total, after.total, "receivables are the same: only which document owes moved");
  const acme = after.contacts.find((c) => c.contact === "Acme Ltd");
  assert.deepEqual(acme.items.map((i) => [i.invoice.number, i.owing]), [["INV-1", -5_000], ["CN-1", -10_000], ["INV-3", 25_000]]);
  const earlier = before.contacts.find((c) => c.contact === "Acme Ltd");
  assert.ok(earlier.items.some((i) => i.invoice.number === "INV-2" && i.owing === 20_000), "not yet used on 30 September");
});

test("what cannot be allocated", () => {
  const balances = invoiceBalances(docs, receipts);
  assert.match(allocationProblem([{ from: "CN-1", to: "INV-3", amount: 40_000, date: "2026-10-01" }], balances), /credit left|still owes/);
  assert.match(allocationProblem([{ from: "CN-1", to: "INV-9", amount: 100, date: "2026-10-01" }], balances), /not the same/);
  assert.match(allocationProblem([{ from: "CN-1", to: "INV-2", amount: 100, date: "2026-07-01" }], balances), /no earlier/);
  assert.match(allocationProblem([{ from: "CN-1", to: "INV-2", amount: 0, date: "2026-10-01" }], balances), /more than nothing/);
});
