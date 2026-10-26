import assert from "node:assert/strict";
import test from "node:test";
import { furthestLocks, lockedDifferences, lockedFigures } from "../dist/index.js";

test("the furthest each lock has reached is kept", () => {
  assert.deepEqual(furthestLocks({ year: "2025-03-31", gst: "2025-05-31" }, { year: "2024-03-31" }), {
    year: "2025-03-31",
    gst: "2025-05-31",
  });
  assert.deepEqual(furthestLocks(undefined, { gst: "2025-07-31" }), { gst: "2025-07-31" });
  assert.deepEqual(furthestLocks(undefined, undefined), {});
});

test("what moved in a locked year is said account by account, and a return box by box", () => {
  const journal = (amount) => ({
    transactionId: "t1", date: "2025-03-10", narration: "", source: "bank", taxBasis: "payments",
    lines: [
      { accountCode: "429", accountName: "General", amount, taxType: "NONE" },
      { accountCode: "090", accountName: "Bank", amount: -amount, taxType: "NONE" },
    ],
  });
  const ret = (box5) => ({ period: { from: "2025-02-01", to: "2025-03-31" }, boxes: { box5, box6: 0 } });
  const locks = { year: "2025-03-31", gst: "2025-03-31" };
  const before = lockedFigures(locks, [journal(10000)], [ret(23000)]);
  const after = lockedFigures(locks, [journal(15000)], [ret(34500)]);
  assert.deepEqual(lockedDifferences(before, after), [
    "2025-03-10 090: -100.00 to -150.00",
    "2025-03-10 429: 100.00 to 150.00",
    "GST return 2025-02-01 to 2025-03-31: Box 5 230.00 to 345.00",
  ]);
  assert.deepEqual(lockedDifferences(before, before), []);
});
