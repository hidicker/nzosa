import assert from "node:assert/strict";
import test from "node:test";
import { selfEmploymentTax, usIncomeTaxSingle } from "../dist/us-tax.js";

// The IRS's own test returns: Modernized e-File Assurance Testing System,
// tax year 2025, Form 1040 scenario 12 (Sam Gardenia, single, Schedule C).
// The form is in whole dollars; NZOSA keeps the cents.

test("IRS ATS 1040 scenario 12: Schedule SE on a $24,328 Schedule C profit", () => {
  const se = selfEmploymentTax(2_432_800, 2025);
  // Line 4a: 24,328 x 92.35% = 22,467.
  assert.equal(Math.round(se.taxable / 100), 22_467);
  // Line 10: 12.4% = 2,786; line 11: 2.9% = 652; line 12: 3,438.
  assert.equal(Math.round(se.socialSecurity / 100), 2_786);
  assert.equal(Math.round(se.medicare / 100), 652);
  assert.equal(Math.round(se.total / 100), 3_437);
  assert.equal(Math.round(se.socialSecurity / 100) + Math.round(se.medicare / 100), 3_438);
  // Schedule 1 line 15: half of it, 1,719.
  assert.equal(Math.round(se.deduction / 100), 1_719);
});

test("IRS ATS 1040 scenario 12: tax on $107,445 of taxable income is $18,634", () => {
  // The scenario's standard deduction is its own; the brackets are 2025's.
  const tax = usIncomeTaxSingle(10_744_500 + 1_575_000, 2025);
  assert.equal(tax.taxableIncome, 10_744_500);
  assert.equal(Math.round(tax.tax / 100), 18_634);
});
