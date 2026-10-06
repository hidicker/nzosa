import assert from "node:assert/strict";
import test from "node:test";
import { gstAccountReconciliation } from "../dist/index.js";

// Two two-monthly periods. GST collected and paid posts to the control
// account (credits owed, debits claimed); the first return is paid in the
// second period, and Inland Revenue's account assesses and records it.
const options = {
  returns: [
    { periodEnd: "2025-05-31", box15: 100000 },
    { periodEnd: "2025-07-31", box15: 80000 },
  ],
  postings: [
    { date: "2025-04-15", amount: -130000 }, // GST on sales
    { date: "2025-05-10", amount: 30000 }, // GST on purchases
    { date: "2025-06-28", amount: 100000 }, // paid the first return
    { date: "2025-07-05", amount: -80000 },
  ],
  payments: [{ date: "2025-06-28", amount: 100000 }],
  ird: [
    { date: "2025-06-28", amount: 100000 }, // assessment
    { date: "2025-06-28", amount: -100000 }, // payment
  ],
};

test("the GST account agrees with the returns less what was paid", () => {
  const [may, july] = gstAccountReconciliation(options);
  assert.equal(may.booksOwe, 100000);
  assert.equal(may.shouldOwe, 100000);
  assert.equal(may.booksDifference, 0);
  assert.equal(july.returnsToDate, 180000);
  assert.equal(july.paidToDate, 100000);
  assert.equal(july.booksOwe, 80000);
  assert.equal(july.booksDifference, 0);
});

test("Inland Revenue's balance is set beside the books' at each period end", () => {
  const [may, july] = gstAccountReconciliation(options);
  // At 31 May the first return is not assessed yet, so Inland Revenue shows nothing owing.
  assert.equal(may.irOwe, 0);
  assert.equal(may.irDifference, -100000);
  // At 31 July it is assessed and paid; the second is not yet assessed.
  assert.equal(july.irOwe, 0);
});

test("a posting to the GST account that is neither GST nor a payment shows as a difference", () => {
  const [, july] = gstAccountReconciliation({ ...options, payments: [] });
  assert.equal(july.shouldOwe, 180000);
  assert.equal(july.booksDifference, -100000);
});
