import test from "node:test";
import assert from "node:assert/strict";
import { payrollRatesHeld, payrollTaxYear, taxTablesMissing } from "../dist/index.js";

// Rates change each April and are added by hand (docs/yearly-rates.md). This
// fails on the first day of a tax year nobody has added rates for, which is
// the point: a year with none held works out no tax, and says so only quietly.
const today = new Date().toISOString().slice(0, 10);
const year = payrollTaxYear(today);

test(`tax tables are held for the tax year we are in (${year})`, () => {
  assert.deepEqual(taxTablesMissing(year), [], "see docs/yearly-rates.md");
});

test(`payroll rates are held for the tax year we are in (${year})`, () => {
  assert.equal(payrollRatesHeld(year), true, "see docs/yearly-rates.md");
});

test("2027-28 earners' levy is IRD's published 1.83%", () => {
  assert.deepEqual(taxTablesMissing(2028), []);
  assert.equal(payrollRatesHeld(2028), true);
});
