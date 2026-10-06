import assert from "node:assert/strict";
import test from "node:test";
import { gstResolver, gstReturn, settledGst } from "../dist/index.js";

const txn = (id, amount, date = "2026-05-10") => ({
  id, date, amount, account: "090", currency: "NZD", otherParty: "Kowhai Cafe", particulars: "",
  code: "", reference: "", description: "", source: "bank", extras: {},
  otherPartyAccount: "", type: "", serial: "", trn: "", origin: "", batch: "", occurrence: 1,
});

const PERIOD = { from: "2026-04-01", to: "2026-05-31" };

const returnFor = (transactions, overrides) =>
  gstReturn(transactions, PERIOD, {
    // Coded to Accounts Receivable, as a matched receipt is: out of scope.
    resolve: gstResolver({
      ownAccounts: new Set(["090"]),
      overrides,
      codeOf: () => "610",
      chartTreatment: () => ({ treatment: "out-of-scope", side: "none" }),
    }),
    basis: "payments",
  });

test("a receipt settling an invoice counts as the sale it is paying for", () => {
  const receipt = txn("r1", 115000);
  const before = returnFor([receipt], {});
  assert.equal(before.boxes.box5, 0, "coded to receivables alone, it was out of scope");

  const settled = settledGst([receipt], {}, (id) =>
    id === "r1" ? { side: "sales", taxable: 1, number: "INV-0001" } : undefined,
  );
  const after = returnFor(settled.transactions, settled.overrides);
  assert.equal(after.boxes.box5, 115000);
  assert.equal(after.boxes.box8, 15000);
});

test("a bill's payment is a purchase, and one with no GST on it claims none", () => {
  const paid = txn("p1", -23000);
  const nil = txn("p2", -5000);
  const settled = settledGst([paid, nil], {}, (id) =>
    id === "p1"
      ? { side: "purchases", taxable: 1, number: "BILL-1" }
      : id === "p2"
        ? { side: "purchases", taxable: 0, number: "BILL-2" }
        : undefined,
  );
  const r = returnFor(settled.transactions, settled.overrides);
  assert.equal(r.boxes.box11, 23000);
  assert.equal(r.boxes.box12, 3000);
});

test("a payment on a partly taxed invoice is taxed only on the taxed part", () => {
  // Half the invoice at 15%, half exempt: $230 received, $115 of it taxable.
  const settled = settledGst([txn("r2", 23000)], {}, () => ({ side: "sales", taxable: 0.5, number: "INV-2" }));
  assert.deepEqual(settled.transactions.map((t) => [t.id, t.amount]), [["r2#taxed", 11500], ["r2#untaxed", 11500]]);
  const r = returnFor(settled.transactions, settled.overrides);
  assert.equal(r.boxes.box5, 11500);
  assert.equal(r.boxes.box8, 1500);
});

test("lines settling nothing are left as they were", () => {
  const t = txn("x", 5000);
  const settled = settledGst([t], { x: { code: "200" } }, () => undefined);
  assert.deepEqual(settled.transactions, [t]);
  assert.deepEqual(settled.overrides, { x: { code: "200" } });
});
