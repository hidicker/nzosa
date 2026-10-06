import test from "node:test";
import assert from "node:assert/strict";
import { NZ_GST, NO_SALES_TAX, grossFromTax, gstContent, setSalesTaxFraction, taxWithin } from "../dist/index.js";

test("New Zealand's GST rounds exactly as 3/23 always did, cent for cent", () => {
  setSalesTaxFraction(NZ_GST);
  for (let amount = -250_000; amount <= 250_000; amount += 7) {
    assert.equal(taxWithin(amount), Math.round((amount * 3) / 23));
    assert.equal(grossFromTax(amount), Math.round((amount * 23) / 3));
  }
  assert.equal(taxWithin(23_000), 3_000);
  assert.equal(gstContent(-23_000), -3_000);
});

test("Australia's 10% is 1/11 of the total", () => {
  setSalesTaxFraction({ num: 1, den: 11 });
  try {
    assert.equal(taxWithin(11_000), 1_000);
    assert.equal(grossFromTax(1_000), 11_000);
    assert.equal(gstContent(-11_000), -1_000);
  } finally {
    setSalesTaxFraction(NZ_GST);
  }
});

test("no sales tax means none inside anything, and nothing to work back from", () => {
  setSalesTaxFraction(NO_SALES_TAX);
  try {
    assert.equal(taxWithin(11_000), 0);
    assert.equal(grossFromTax(1_000), 0);
  } finally {
    setSalesTaxFraction(NZ_GST);
  }
});
