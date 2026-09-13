import assert from "node:assert/strict";
import test from "node:test";
import { chargeIdIn, stripeSettlements } from "../dist/index.js";

// The shape the Account Transactions export really has: all three postings of
// one card payment carry the charge id as their reference, and name the
// invoice as well.
const line = (over) => ({
  date: "2026-06-13", amount: 0, code: "200 Sales", label: "200 Sales",
  source: "Account Transactions.xlsx", account: "BNZ 01", ...over,
});

const CHARGE = "ch_3ThcGtS4yCINmf4d0KuJQRuW";
const realOne = [
  line({ amount: 100000, code: "610 - Accounts Receivable", reference: CHARGE }),
  line({ amount: 2900, code: "200 Sales", reference: CHARGE, invoiceNumber: "INV-0151" }),
  line({ amount: -2757, code: "506 Stripe Fees", reference: CHARGE, invoiceNumber: "INV-0151" }),
];

test("a charge id is found inside a description", () => {
  assert.equal(chargeIdIn("Transaction fees for ch_ABC123"), "ch_ABC123");
  assert.equal(chargeIdIn("nothing to see"), null);
});

test("the three postings of one card payment are gathered by their reference", () => {
  // A real settlement from real books: 1,000.00 settled, 29.00 surcharged to
  // cover the fee, 27.57 kept by the processor, 1,001.43 reaching the bank.
  const found = stripeSettlements(realOne);
  assert.equal(found.length, 1);
  const one = found[0];
  assert.equal(one.charge, CHARGE);
  assert.equal(one.invoiceNumber, "INV-0151", "the export says which invoice");
  assert.equal(one.payment, 100000);
  assert.equal(one.surcharge, 2900);
  assert.equal(one.fee, 2757);
  assert.equal(one.net, 100143, "and that is the bank line to look for");
});

test("the largest arriving posting is the invoice, not the surcharge", () => {
  // Told apart by size rather than by account code, because a chart names its
  // fee and income accounts whatever it likes and this has to work on any.
  const found = stripeSettlements([
    line({ amount: 200, code: "anything at all", reference: "ch_x" }),
    line({ amount: 50000, code: "something else", reference: "ch_x" }),
    line({ amount: -180, code: "a fee by any name", reference: "ch_x" }),
  ]);
  assert.equal(found[0].payment, 50000);
  assert.equal(found[0].surcharge, 200);
  assert.equal(found[0].fee, 180);
});

test("a fee with nothing arriving beside it is not a settlement", () => {
  // A refund, or a charge standing on its own. Forcing it into a settlement
  // would invent a split that never happened.
  assert.deepEqual(stripeSettlements([line({ amount: -1382, reference: "ch_orphan" })]), []);
});

test("a payment with no fee is left alone", () => {
  // An ordinary transfer settling an invoice needs no splitting.
  assert.deepEqual(stripeSettlements([line({ amount: 50000, reference: "ch_nofee" })]), []);
});

test("a posting with no charge reference is ignored", () => {
  assert.deepEqual(stripeSettlements([line({ amount: 5000, reference: "INTERNET XFR" })]), []);
  assert.deepEqual(stripeSettlements([line({ amount: 5000 })]), []);
});

test("two charges of the same size on the same day stay apart", () => {
  // The reason for keying on the reference at all: no rule built from amounts
  // and dates can separate these, and guessing would split the wrong line.
  const found = stripeSettlements([
    line({ amount: 10000, reference: "ch_a", invoiceNumber: "INV-1" }),
    line({ amount: -300, reference: "ch_a" }),
    line({ amount: 10000, reference: "ch_b", invoiceNumber: "INV-2" }),
    line({ amount: -400, reference: "ch_b" }),
  ]);
  assert.equal(found.length, 2);
  const byCharge = new Map(found.map((s) => [s.charge, s]));
  assert.equal(byCharge.get("ch_a").fee, 300);
  assert.equal(byCharge.get("ch_b").fee, 400);
  assert.equal(byCharge.get("ch_a").invoiceNumber, "INV-1");
  assert.equal(byCharge.get("ch_b").invoiceNumber, "INV-2");
});

test("an invoice number is taken from whichever posting states one", () => {
  const found = stripeSettlements([
    line({ amount: 30000, reference: "ch_q" }),
    line({ amount: -1172, reference: "ch_q", invoiceNumber: "INV-0037" }),
  ]);
  assert.equal(found[0].invoiceNumber, "INV-0037");
});

test("nothing is invented when no posting names an invoice", () => {
  const found = stripeSettlements([
    line({ amount: 20000, reference: "ch_unnamed" }),
    line({ amount: -500, reference: "ch_unnamed" }),
  ]);
  assert.equal(found[0].invoiceNumber, "");
  assert.equal(found[0].net, 19500);
});

test("the settlement takes the earliest date of its postings", () => {
  const found = stripeSettlements([
    line({ amount: 10000, reference: "ch_late", date: "2026-06-15" }),
    line({ amount: -300, reference: "ch_late", date: "2026-06-13" }),
  ]);
  assert.equal(found[0].date, "2026-06-13");
});

test("a settlement where the surcharge exactly covers the fee still nets out", () => {
  // One of the real ones: 250.00 paid, 7.25 surcharged, 7.25 taken, and the
  // bank line is the invoice to the cent. It is still three postings.
  const found = stripeSettlements([
    line({ amount: 25000, reference: "ch_even", invoiceNumber: "INV-0043" }),
    line({ amount: 725, reference: "ch_even" }),
    line({ amount: -725, reference: "ch_even" }),
  ]);
  assert.equal(found[0].net, 25000);
  assert.equal(found[0].surcharge, 725);
  assert.equal(found[0].fee, 725);
});

import { matchStripeSettlements, stripeSplitParts } from "../dist/index.js";

const settle = (over) => ({
  charge: "ch_x", date: "2026-06-13", invoiceNumber: "INV-1",
  payment: 100000, surcharge: 2900, fee: 2757, net: 100143, ...over,
});
const txn = (id, date, amount) => ({
  id, date, amount, account: "BNZ 01", otherParty: "Stripe Payments", particulars: "",
  code: "", reference: "STRIPE", description: "", currency: "NZD", source: "bank",
});

test("a payout is matched on its amount, days after the charge", () => {
  // The processor records the charge when it takes it and the bank records the
  // money when it lands: two to four days apart on real books.
  const m = matchStripeSettlements({
    settlements: [settle({})],
    transactions: [txn("a", "2026-06-17", 100143)],
  });
  assert.equal(m.length, 1);
  assert.equal(m[0].transaction.id, "a");
  assert.equal(m[0].settlements.length, 1);
});

test("a bank line a cent out is not that payout", () => {
  // The net is computed from the processor's own figures, so anything but an
  // exact agreement means it is a different payout.
  const m = matchStripeSettlements({
    settlements: [settle({})],
    transactions: [txn("a", "2026-06-17", 100144)],
  });
  assert.deepEqual(m, []);
});

test("a charge far outside the window is not matched", () => {
  const m = matchStripeSettlements({
    settlements: [settle({})],
    transactions: [txn("a", "2026-08-30", 100143)],
  });
  assert.deepEqual(m, []);
});

test("two charges paid out as one transfer are matched together", () => {
  // A real case: 800.67 and 792.44 reaching the bank as 1,593.11.
  const m = matchStripeSettlements({
    settlements: [
      settle({ charge: "ch_a", date: "2024-12-15", invoiceNumber: "INV-0015", net: 80067 }),
      settle({ charge: "ch_b", date: "2024-12-16", invoiceNumber: "INV-0017", net: 79244 }),
    ],
    transactions: [txn("payout", "2024-12-18", 159311)],
  });
  assert.equal(m.length, 1);
  assert.equal(m[0].settlements.length, 2);
  assert.deepEqual(m[0].settlements.map((s) => s.invoiceNumber).sort(), ["INV-0015", "INV-0017"]);
});

test("a single match is preferred over a combination that also adds up", () => {
  // 100.00 arriving is the 100.00 charge, never the 60.00 and 40.00 beside it.
  const m = matchStripeSettlements({
    settlements: [
      settle({ charge: "ch_exact", net: 10000, invoiceNumber: "EXACT" }),
      settle({ charge: "ch_a", net: 6000 }),
      settle({ charge: "ch_b", net: 4000 }),
    ],
    transactions: [txn("a", "2026-06-14", 10000)],
  });
  assert.equal(m.length, 1);
  assert.equal(m[0].settlements.length, 1);
  assert.equal(m[0].settlements[0].invoiceNumber, "EXACT");
});

test("two different combinations adding to the same total are left alone", () => {
  // Guessing between them would put a split on the wrong payment, which is a
  // silent error. An unmatched payout is a visible one.
  const m = matchStripeSettlements({
    settlements: [
      settle({ charge: "ch_a", net: 5000 }),
      settle({ charge: "ch_b", net: 5000 }),
      settle({ charge: "ch_c", net: 2500 }),
      settle({ charge: "ch_d", net: 7500 }),
    ],
    transactions: [txn("a", "2026-06-14", 10000)],
  });
  assert.deepEqual(m, []);
});

test("one settlement is never used for two payouts", () => {
  const m = matchStripeSettlements({
    settlements: [settle({ charge: "ch_only", net: 10000 })],
    transactions: [txn("a", "2026-06-14", 10000), txn("b", "2026-06-15", 10000)],
  });
  assert.equal(m.length, 1);
});

test("the split is the three things the payout really was", () => {
  const [m] = matchStripeSettlements({
    settlements: [settle({})],
    transactions: [txn("a", "2026-06-17", 100143)],
  });
  const parts = stripeSplitParts(m, { sales: "200 Sales", fees: "506 Stripe Fees" });
  assert.equal(parts.length, 3);
  assert.equal(parts.reduce((sum, p) => sum + p.amount, 0), 100143, "the parts must sum to the line");
  assert.equal(parts[0].amount, 100000);
  assert.equal(parts[0].treatment, "out-of-scope", "settling a receivable is not a fresh sale");
  assert.equal(parts[1].code, "200 Sales");
  assert.equal(parts[2].amount, -2757);
  assert.equal(parts[2].code, "506 Stripe Fees");
  assert.ok(parts.every((p) => p.note !== ""), "every part says what it is");
});

test("a batched payout splits into the parts of both settlements", () => {
  const [m] = matchStripeSettlements({
    settlements: [
      settle({ charge: "ch_a", date: "2024-12-15", invoiceNumber: "INV-0015",
               payment: 80000, surcharge: 2320, fee: 2253, net: 80067 }),
      settle({ charge: "ch_b", date: "2024-12-16", invoiceNumber: "INV-0017",
               payment: 80000, surcharge: 2320, fee: 3076, net: 79244 }),
    ],
    transactions: [txn("payout", "2024-12-18", 159311)],
  });
  const parts = stripeSplitParts(m, { sales: "200 Sales", fees: "506 Stripe Fees" });
  assert.equal(parts.length, 6);
  assert.equal(parts.reduce((sum, p) => sum + p.amount, 0), 159311);
});

test("a settlement with no surcharge has two parts, not an empty one", () => {
  const [m] = matchStripeSettlements({
    settlements: [settle({ surcharge: 0, net: 97243, payment: 100000, fee: 2757 })],
    transactions: [txn("a", "2026-06-17", 97243)],
  });
  const parts = stripeSplitParts(m, { sales: "200 Sales", fees: "506 Stripe Fees" });
  assert.equal(parts.length, 2);
  assert.equal(parts.reduce((sum, p) => sum + p.amount, 0), 97243);
});
