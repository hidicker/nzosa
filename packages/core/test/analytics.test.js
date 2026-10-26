import assert from "node:assert/strict";
import test from "node:test";
import { cashForecast, changeShare, daysSalesOutstanding } from "../dist/index.js";

test("days sales outstanding: what is owed, as days of sales", () => {
  assert.equal(daysSalesOutstanding(1000000, 12000000, 365), 30);
  assert.equal(daysSalesOutstanding(0, 12000000, 365), 0);
  assert.equal(daysSalesOutstanding(5000, 0, 365), null);
});

test("three months of cash, thirty days at a time, overdue counted first", () => {
  const owing = [
    { kind: "sales", expected: "2026-09-01", remaining: 50000 }, // overdue
    { kind: "sales", expected: "2026-11-20", remaining: 20000 },
    { kind: "purchase", expected: "2026-12-10", remaining: 30000 },
    { kind: "purchase", expected: "2027-03-01", remaining: 99999 }, // after the ninety days
  ];
  const buckets = cashForecast(100000, "2026-10-27", owing);
  assert.deepEqual(
    buckets.map((b) => [b.from, b.to, b.in, b.out, b.closing]),
    [
      ["2026-10-27", "2026-11-25", 70000, 0, 170000],
      ["2026-11-26", "2026-12-25", 0, 30000, 140000],
      ["2026-12-26", "2027-01-24", 0, 0, 140000],
    ],
  );
});

test("change as a share of the year before", () => {
  assert.equal(changeShare(1000, 1100), 0.1);
  assert.equal(changeShare(0, 500), null);
});
