import test from "node:test";
import assert from "node:assert/strict";
import { splitByShareholding } from "../dist/index.js";

const schedule = {
  from: "2025-04-01",
  to: "2026-03-31",
  opening: 5_821_132,
  introduced: 230_505,
  drawings: 2_089_339,
  closing: 3_962_298,
  movements: [],
  overdrawn: false,
};

test("halves add back to the whole, as the IR4 shows them", () => {
  const [a, b] = splitByShareholding(schedule, [
    { name: "A", percent: 50 },
    { name: "B", percent: 50 },
  ]);
  assert.equal(a.closing + b.closing, schedule.closing);
  assert.equal(a.opening + b.opening, schedule.opening);
  assert.equal(a.drawings + b.drawings, schedule.drawings);
  assert.ok(Math.abs(a.closing - 1_981_149) <= 1);
});

test("uneven shares, and none at all", () => {
  const parts = splitByShareholding(schedule, [
    { name: "A", percent: 60 },
    { name: "B", percent: 40 },
  ]);
  assert.equal(parts[0].opening, Math.round(schedule.opening * 0.6));
  assert.equal(parts.reduce((s, p) => s + p.closing, 0), schedule.closing);
  assert.deepEqual(splitByShareholding(schedule, []), []);
});
