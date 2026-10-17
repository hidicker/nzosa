import test from "node:test";
import assert from "node:assert/strict";
import { selfEmploymentTax, usIncomeTaxSingle } from "../dist/index.js";

// OpenAccountants, "US Schedule C and SE computation" (accountant-checked
// method), worked examples 1, 2 and 5 for 2025: rounded to dollars there.
const dollars = (cents) => Math.round(cents / 100);

test("SE tax: $53,087 of net profit is $7,501, half deductible $3,750", () => {
  const se = selfEmploymentTax(5_308_700, 2025);
  assert.equal(dollars(se.total), 7_501);
  assert.equal(dollars(se.deduction), 3_750);
});

test("SE tax: $102,500 is $14,483", () => {
  assert.equal(dollars(selfEmploymentTax(10_250_000, 2025).total), 14_483);
});

test("SE tax: $280,000 caps Social Security at the $176,100 base, with $527 Additional Medicare on Form 8959", () => {
  const se = selfEmploymentTax(28_000_000, 2025);
  assert.equal(dollars(se.socialSecurity), 21_836);
  assert.equal(dollars(se.medicare), 7_499);
  assert.equal(dollars(se.total - se.additionalMedicare), 29_335);
  assert.equal(dollars(se.additionalMedicare), 527);
  assert.equal(dollars(se.deduction), 14_668);
});

// IRS brackets (Rev. Proc. 2024-40 for 2025, 2025-32 for 2026), single, on
// taxable income of $100,000.
test("federal income tax on $100,000 taxable: $16,914 in 2025, $16,712 in 2026", () => {
  assert.equal(usIncomeTaxSingle(11_575_000, 2025).tax, 1_691_400);
  assert.equal(usIncomeTaxSingle(11_610_000, 2026).tax, 1_671_200);
});
