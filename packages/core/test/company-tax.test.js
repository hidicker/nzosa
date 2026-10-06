import assert from "node:assert/strict";
import test from "node:test";
import { companyIncomeTax } from "../dist/index.js";

test("a loss brought forward is set against profit before tax, and the rest carries on", () => {
  const tax = companyIncomeTax({ taxableProfit: 500000, lossBroughtForward: 1200000 });
  assert.equal(tax.lossClaimed, 500000);
  assert.equal(tax.taxableIncome, 0);
  assert.equal(tax.tax, 0);
  assert.equal(tax.lossCarriedForward, 700000);
});

test("profit beyond the loss is taxed at 28%", () => {
  const tax = companyIncomeTax({ taxableProfit: 3000000, lossBroughtForward: 1000000 });
  assert.equal(tax.lossClaimed, 1000000);
  assert.equal(tax.taxableIncome, 2000000);
  assert.equal(tax.tax, 560000);
  assert.equal(tax.lossCarriedForward, 0);
  assert.equal(tax.residualIncomeTax, 560000);
  assert.equal(tax.provisionalNextYear.basis, "105% of last year");
  assert.equal(tax.provisionalNextYear.amount, 588000);
});

test("a loss year adds to what carries forward", () => {
  const tax = companyIncomeTax({ taxableProfit: -250000, lossBroughtForward: 1000000 });
  assert.equal(tax.lossClaimed, 0);
  assert.equal(tax.tax, 0);
  assert.equal(tax.lossCarriedForward, 1250000);
});

test("broken continuity: no loss claimed, and none carried on", () => {
  const tax = companyIncomeTax({ taxableProfit: 500000, lossBroughtForward: 1200000, continuityMet: false });
  assert.equal(tax.lossClaimed, 0);
  assert.equal(tax.tax, 140000);
  assert.equal(tax.lossCarriedForward, 0);
  assert.ok(tax.notes.some((n) => /continuity has broken/.test(n)));
});

test("this year's provisional tax comes from last year's filed residual income tax", () => {
  const due = companyIncomeTax({ taxableProfit: 0, lastYearResidualIncomeTax: 800000 }).provisionalThisYear;
  assert.equal(due.amount, 840000);
  assert.deepEqual(due.instalments, [280000, 280000, 280000]);
  const small = companyIncomeTax({ taxableProfit: 0, lastYearResidualIncomeTax: 300000 }).provisionalThisYear;
  assert.equal(small.basis, "not due");
  assert.equal(companyIncomeTax({ taxableProfit: 0 }).provisionalThisYear, null);
});
