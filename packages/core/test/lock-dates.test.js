import assert from "node:assert/strict";
import test from "node:test";
import { firstOpenDay, lockBroken, lockedFigures, lockedThrough } from "../dist/index.js";

const journal = (date, lines) => ({
  transactionId: `${date}-${lines.length}`,
  date,
  narration: "",
  lines: lines.map(([accountCode, amount]) => ({ accountCode, accountName: accountCode, amount })),
  source: "bank",
  taxBasis: "none",
});

const gstReturn = (from, to, net) => ({
  period: { from, to },
  basis: "payments",
  sharePercent: 100,
  boxes: { box15: net },
  lines: [],
  excluded: [],
  lateClaims: [],
  missingTaxPoint: [],
  otherPurchases: [],
});

const books = [
  journal("2026-03-10", [["090", -11500], ["429", 10000], ["820", 1500]]),
  journal("2026-04-05", [["090", 23000], ["200", -20000], ["820", -3000]]),
];
const returns = [gstReturn("2026-02-01", "2026-03-31", -1500), gstReturn("2026-04-01", "2026-05-31", 3000)];

test("the later lock, and the day after it", () => {
  assert.equal(lockedThrough({ gst: "2026-03-31", year: "2025-03-31" }), "2026-03-31");
  assert.equal(firstOpenDay({ gst: "2026-03-31" }), "2026-04-01");
  assert.equal(lockedThrough({}), undefined);
  assert.equal(firstOpenDay(undefined), undefined);
});

test("a change after the year lock is allowed; one before it is not", () => {
  const locks = { year: "2026-03-31" };
  const before = lockedFigures(locks, books, returns);
  const later = lockedFigures(locks, [books[0], journal("2026-04-05", [["090", 23000], ["210", -23000]])], returns);
  assert.equal(lockBroken(locks, before, later), null);
  const earlier = lockedFigures(locks, [journal("2026-03-10", [["090", -11500], ["433", 11500]]), books[1]], returns);
  assert.match(lockBroken(locks, before, earlier), /up to 2026-03-31/);
});

test("the same postings reached another way are the same books", () => {
  const locks = { year: "2026-03-31" };
  const split = [
    journal("2026-03-10", [["090", -11500], ["820", 1500]]),
    journal("2026-03-10", [["429", 10000]]),
    books[1],
  ];
  assert.equal(lockBroken(locks, lockedFigures(locks, books, returns), lockedFigures(locks, split, returns)), null);
});

test("the GST lock guards the returns, not the accounts", () => {
  const locks = { gst: "2026-03-31" };
  const before = lockedFigures(locks, books, returns);
  // One expense account for another: the return is unchanged.
  const recoded = lockedFigures(locks, [journal("2026-03-10", [["090", -11500], ["433", 10000], ["820", 1500]]), books[1]], returns);
  assert.equal(lockBroken(locks, before, recoded), null);
  // The filed return's figure moves: refused.
  const moved = lockedFigures(locks, books, [gstReturn("2026-02-01", "2026-03-31", 0), returns[1]]);
  assert.match(lockBroken(locks, before, moved), /GST return up to 2026-03-31/);
  // A later period's return may change.
  const after = lockedFigures(locks, books, [returns[0], gstReturn("2026-04-01", "2026-05-31", 0)]);
  assert.equal(lockBroken(locks, before, after), null);
});

test("no locks, nothing guarded", () => {
  assert.equal(lockBroken({}, lockedFigures({}, books, returns), lockedFigures({}, [], [])), null);
});
