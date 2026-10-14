import test from "node:test";
import assert from "node:assert/strict";
import { selfEmploymentTax, usIncomeTaxSingle } from "../dist/index.js";

test("self-employment tax: 92.35% of the earnings, 12.4% to the wage base and 2.9% on all", () => {
  const se = selfEmploymentTax(6_200_000, 2026);
  assert.equal(se.taxable, 5_725_700);
  assert.equal(se.socialSecurity, 709_987);
  assert.equal(se.medicare, 166_045);
  assert.equal(se.total, 876_032);
  assert.equal(se.deduction, 438_016);
});

test("nothing under $400, and the social security part stops at the wage base", () => {
  assert.equal(selfEmploymentTax(39_999, 2026).total, 0);
  const high = selfEmploymentTax(30_000_000, 2026);
  assert.equal(high.socialSecurity, Math.round(18_450_000 * 0.124));
  assert.ok(high.additionalMedicare > 0);
  assert.equal(selfEmploymentTax(1_000_000, 2019), null);
});

test("federal income tax for a single filer: the standard deduction, then the brackets", () => {
  const t = usIncomeTaxSingle(5_000_000, 2026);
  assert.equal(t.taxableIncome, 3_390_000);
  assert.equal(t.tax, 382_000);
  assert.equal(usIncomeTaxSingle(1_000_000, 2026).tax, 0);
  assert.equal(usIncomeTaxSingle(5_000_000, 2000), null);
});
