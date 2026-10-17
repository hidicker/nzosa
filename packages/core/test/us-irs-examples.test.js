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

test("Form 8995: 20% of qualified business income, at most 20% of taxable income", async () => {
  const { usQbiDeduction } = await import("../dist/us-tax.js");
  // Scenario 12's figures: QBI = 24,328 less half the SE tax (1,719) = 22,609.
  // Taxable income before it 107,445: 20% of QBI, 4,521.80, is the smaller.
  assert.equal(usQbiDeduction(2_260_900, 10_744_500, 2025).deduction, 452_180);
  // Taxable income the smaller: 20% of 10,000.
  assert.equal(usQbiDeduction(5_000_000, 1_000_000, 2025).deduction, 200_000);
  // Over the 2025 threshold of $197,300: Form 8995-A, not worked out.
  assert.deepEqual(usQbiDeduction(5_000_000, 19_730_100, 2025), { deduction: 0, overThreshold: true, threshold: 19_730_000 });
  // 2026: the threshold is $201,750, and $1,500 of QBI gets the $400 minimum rather than $300.
  assert.equal(usQbiDeduction(5_000_000, 20_175_000, 2026).overThreshold, false);
  assert.equal(usQbiDeduction(150_000, 5_000_000, 2026).deduction, 40_000);
  assert.equal(usQbiDeduction(150_000, 5_000_000, 2025).deduction, 30_000);
});

test("Schedule C lines for QuickBooks Online's own account names", async () => {
  const { formLineFor, SCHEDULE_C } = await import("../dist/index.js");
  const line = (name) => formLineFor(SCHEDULE_C, name, "expense");
  // The sample company's chart, against the Schedule C instructions.
  assert.equal(line("Automobile"), "9");
  assert.equal(line("Automobile:Fuel"), "9");
  assert.equal(line("Meals and Entertainment"), "24b");
  assert.equal(line("Entertainment"), "entertainment");
  assert.equal(line("Job Expenses:Cost of Labor"), "4");
  assert.equal(line("Equipment Rental"), "20a");
  assert.equal(line("Rent or Lease"), "20b");
  assert.equal(line("Legal & Professional Fees:Accounting"), "17");
  assert.equal(line("Insurance:Workers Compensation"), "15");
  assert.equal(line("Utilities:Telephone"), "25");
  assert.equal(line("Taxes & Licenses"), "23");
  assert.equal(line("Commissions & fees"), "10");
  assert.equal(line("Travel Meals"), "24b");
  assert.equal(line("Bank Charges"), "27a");
});
