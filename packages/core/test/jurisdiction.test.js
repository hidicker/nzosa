import test from "node:test";
import assert from "node:assert/strict";
import { JURISDICTIONS, financialYear, financialYearOf, jurisdictionOf } from "../dist/index.js";

test("books with no country are New Zealand's", () => {
  assert.equal(jurisdictionOf(undefined).id, "nz");
  assert.equal(jurisdictionOf("").id, "nz");
  assert.equal(jurisdictionOf("atlantis").id, "nz");
});

test("New Zealand's year is 1 April to 31 March, as it always was", () => {
  const nz = jurisdictionOf("nz");
  assert.deepEqual(financialYear(2026, nz.yearEnd), { from: "2025-04-01", to: "2026-03-31" });
  assert.equal(financialYearOf("2025-04-01", nz.yearEnd), 2026);
  assert.equal(financialYearOf("2026-03-31", nz.yearEnd), 2026);
  assert.deepEqual(nz.salesTax, { name: "GST", rate: 0.15, fraction: { num: 3, den: 23 } });
  assert.equal(nz.currency, "NZD");
});

test("Australia's year ends 30 June, the United States' 31 December", () => {
  assert.deepEqual(financialYear(2026, JURISDICTIONS.au.yearEnd), { from: "2025-07-01", to: "2026-06-30" });
  assert.equal(financialYearOf("2025-07-01", JURISDICTIONS.au.yearEnd), 2026);
  assert.deepEqual(financialYear(2026, JURISDICTIONS.us.yearEnd), { from: "2026-01-01", to: "2026-12-31" });
  assert.equal(financialYearOf("2026-12-31", JURISDICTIONS.us.yearEnd), 2026);
  assert.equal(JURISDICTIONS.us.salesTax, null);
  assert.equal(JURISDICTIONS.us.dayFirst, false);
});
