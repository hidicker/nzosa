import assert from "node:assert/strict";
import test from "node:test";
import { depreciationSchedule } from "../dist/assets.js";

const asset = (method, extra = {}) => ({
  number: "1",
  name: "Laptop",
  type: "Computer Equipment",
  status: "Registered",
  purchased: "2023-04-01",
  depreciationFrom: "2023-04-01",
  cost: 300000,
  rate: 50,
  method,
  averaging: "Full Month",
  disposed: null,
  ...extra,
});

const year = (y) => ({ from: `${y - 1}-04-01`, to: `${y}-03-31` });
const run = (a, y) => depreciationSchedule([a], year(y)).rows[0];

test("diminishing value charges on what is left, not on what it cost", () => {
  // $3,000 at 50% DV. Inland Revenue's own worked example: half of the
  // adjusted tax value each year, so it never quite reaches zero.
  const a = asset("Diminishing Value");

  const y1 = run(a, 2024);
  assert.equal(y1.opening, 300000);
  assert.equal(y1.depreciation, 150000);
  assert.equal(y1.closing, 150000);

  const y2 = run(a, 2025);
  assert.equal(y2.opening, 150000, "opens where last year closed");
  assert.equal(y2.depreciation, 75000, "half of 1,500, not half of 3,000");
  assert.equal(y2.closing, 75000);

  const y3 = run(a, 2026);
  assert.equal(y3.depreciation, 37500);
  assert.equal(y3.closing, 37500);
});

test("straight line still charges on cost, and writes off", () => {
  // Unchanged behaviour, and the reason the two must be told apart: the same
  // rate on the same asset writes it off in two years rather than never.
  const a = asset("Straight Line");
  assert.equal(run(a, 2024).depreciation, 150000);
  assert.equal(run(a, 2025).depreciation, 150000);
  assert.equal(run(a, 2025).closing, 0);
  assert.equal(run(a, 2026).depreciation, 0);
});

test("the method is read however the register spells it", () => {
  for (const spelling of ["DV", "dv", "Diminishing Value", "diminishing value"]) {
    assert.equal(run(asset(spelling), 2025).depreciation, 75000, spelling);
  }
  for (const spelling of ["Straight Line", "SL", "", "Cost"]) {
    assert.equal(run(asset(spelling), 2025).depreciation, 150000, spelling);
  }
});

test("diminishing value is capped by what is left, never negative", () => {
  const a = asset("Diminishing Value", { rate: 100 });
  const y1 = run(a, 2024);
  assert.equal(y1.depreciation, 300000);
  assert.equal(y1.closing, 0);

  const y2 = run(a, 2025);
  assert.equal(y2.opening, 0);
  assert.equal(y2.depreciation, 0);
  assert.equal(y2.closing, 0);
});

test("a part year is charged for the months owned", () => {
  // Bought part way through: full-month averaging counts the month of purchase.
  const a = asset("Diminishing Value", { purchased: "2023-10-15", depreciationFrom: "2023-10-15" });
  const y1 = run(a, 2024);
  assert.equal(y1.depreciation, Math.round((300000 * 50 * 6) / 1200), "six months");

  // And the next full year opens on what that left.
  const y2 = run(a, 2025);
  assert.equal(y2.opening, 300000 - y1.depreciation);
  assert.equal(y2.depreciation, Math.round((y2.opening * 50) / 100));
});
