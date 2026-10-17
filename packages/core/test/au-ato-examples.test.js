import assert from "node:assert/strict";
import test from "node:test";
import { depreciationSchedule } from "../dist/assets.js";

// Worked examples from the ATO's Guide to depreciating assets 2025 ("Working
// out decline in value"), each run through NZOSA's own schedule. The ATO
// rounds to the dollar; NZOSA keeps the cents.

const asset = (method, rate, purchased, cost) => ({
  number: "1",
  name: "Asset",
  type: "Plant",
  status: "Registered",
  purchased,
  depreciationFrom: purchased,
  cost,
  rate,
  method,
  averaging: "Actual Days",
  disposed: null,
});
const year = (y) => ({ from: `${y - 1}-07-01`, to: `${y}-06-30` });
const run = (a, y) => depreciationSchedule([a], year(y), { byDays: true }).rows[0];

test("Laura's photocopier: $1,500 from 1 July 2024, effective life 5 years", () => {
  // Diminishing value: 1,500 x 365/365 x 200%/5 = $600, adjustable value $900.
  const dv = run(asset("Diminishing Value", 40, "2024-07-01", 150_000), 2025);
  assert.equal(dv.depreciation, 60_000);
  assert.equal(dv.closing, 90_000);
  // Prime cost: 1,500 x 365/365 x 100%/5 = $300, adjustable value $1,200.
  const pc = run(asset("Prime Cost", 20, "2024-07-01", 150_000), 2025);
  assert.equal(pc.depreciation, 30_000);
  assert.equal(pc.closing, 120_000);
});

test("Leo's computer: $4,000 bought halfway through the year, 182 days held", () => {
  // A full year's decline is $1,000; for 182 days, 1,000 x 182/365 = $499.
  const leo = run(asset("Diminishing Value", 25, "2024-01-01", 400_000), 2024);
  assert.equal(leo.depreciation, Math.round((400_000 * 0.25 * 182) / 365));
  assert.equal(Math.round(leo.depreciation / 100), 499);
  // The second year's base is what is left: $3,501.
  assert.equal(Math.round(run(asset("Diminishing Value", 25, "2024-01-01", 400_000), 2025).opening / 100), 3_501);
});

test("Paul's refrigerator: a leap year is 366 days over 365", () => {
  // $2,000, prime cost over 10 years from 1 July 2021: $200, $200, then
  // 2,000 x 366/365 x 10% = $201 in 2023-24.
  const fridge = asset("Prime Cost", 10, "2021-07-01", 200_000);
  assert.equal(run(fridge, 2022).depreciation, 20_000);
  assert.equal(run(fridge, 2023).depreciation, 20_000);
  assert.equal(Math.round(run(fridge, 2024).depreciation / 100), 201);
});

test("Medicare levy, 2025-26: nothing to $28,011, 10c in the dollar above it, then 2%", async () => {
  const { medicareLevy } = await import("../dist/au-tax.js");
  assert.equal(medicareLevy(2_801_100, 2026), 0);
  // $29,011: 10% of the $1,000 over the threshold is $100, not 2% ($580.22).
  assert.equal(medicareLevy(2_901_100, 2026), 10_000);
  // From the upper threshold, $35,013, the full 2%.
  assert.equal(medicareLevy(4_000_000, 2026), 80_000);
});

test("Resident tax and the low income offset, 2025-26", async () => {
  const { auResidentTax, auLowIncomeOffset } = await import("../dist/au-tax.js");
  // 16% of what is over $18,200: on $45,000, $4,288.
  assert.equal(auResidentTax(4_500_000, 2026), 428_800);
  // The low income offset: $700 to $37,500, less 5c a dollar to $45,000 ($325), then 1.5c to $66,667.
  assert.equal(auLowIncomeOffset(3_750_000, 2026), 70_000);
  assert.equal(auLowIncomeOffset(4_500_000, 2026), 32_500);
  assert.equal(auLowIncomeOffset(6_666_700, 2026), 0);
});

test("An Australian residential rental's standard accounts each land on their own rental schedule line", async () => {
  const { standardAccounts, formLineFor, AU_RENTAL_SCHEDULE } = await import("../dist/index.js");
  const accounts = standardAccounts("residential", { gstRegistered: false, country: "au" });
  const lines = accounts.filter((a) => /Expense|Depreciation/.test(a.type)).map((a) => formLineFor(AU_RENTAL_SCHEDULE, a.name, "expense"));
  // Council rates, water and land tax apart; no travel account at all.
  for (const line of ["council-rates", "water", "land-tax", "body-corporate", "borrowing", "capital-works", "capital-allowances", "agent", "interest"]) {
    assert.ok(lines.includes(line), line);
  }
  assert.ok(!accounts.some((a) => /travel/i.test(a.name)));
  // New Zealand's set is untouched.
  assert.ok(standardAccounts("residential", { gstRegistered: false }).some((a) => a.name === "Rates and water"));
});

// ATO, "Medicare levy reduction for low-income earners" (updated 30 June
// 2026): single thresholds $28,011 and $35,013 for 2025-26; Angie, on $29,000,
// pays $98.90.
test("Medicare levy: the ATO's Angie, $29,000 in 2025-26, pays $98.90", async () => {
  const { medicareLevy } = await import("../dist/index.js");
  assert.equal(medicareLevy(2_900_000, 2026), 9_890);
  assert.equal(medicareLevy(2_801_100, 2026), 0);
});
