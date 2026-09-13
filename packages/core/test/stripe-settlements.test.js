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
