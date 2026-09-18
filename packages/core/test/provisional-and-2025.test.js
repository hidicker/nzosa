import assert from "node:assert/strict";
import test from "node:test";
import { incomeTaxOn, ir3Return, provisionalStandardOption } from "../dist/index.js";

/**
 * The two gaps an outside review of this engine found, against the years and
 * rules they belong to.
 */

test("the year ended 31 March 2025 uses the composite bands", () => {
  // 2024-25 straddles the threshold change of 31 July 2024, so Inland Revenue
  // published one blended set of bands for it.
  //   14,533 at 10.5%   = 1,525.965
  //   35,300 at 17.5%   = 6,177.50
  //   10,167 at 30%     = 3,050.10
  assert.equal(incomeTaxOn(6_000_000, 2025), 1_075_357);

  // The first band alone, where the old and new thresholds differ most.
  assert.equal(incomeTaxOn(1_000_000, 2025), 105_000);

  // And the year after it is the enacted set, unchanged by this.
  assert.equal(incomeTaxOn(6_000_000, 2026), 1_022_050);
  assert.notEqual(incomeTaxOn(6_000_000, 2025), incomeTaxOn(6_000_000, 2026));
});

test("a year whose levy and credit are not held says so rather than showing nothing", () => {
  const filed = ir3Return({
    owner: "Ana Whitcombe",
    year: 2025,
    extras: [
      {
        owner: "Ana Whitcombe",
        year: 2025,
        category: "salary",
        payer: "Kea Coffee Roasters",
        gross: 9_000_000,
        credits: 1_800_000,
      },
    ],
    rentals: [],
  });
  assert.ok(filed.taxOnIncome !== null, "2025 now has income tax rates");
  assert.match(filed.notes.join(" "), /No ACC earner levy rate is held for 2025/);
  assert.match(filed.notes.join(" "), /No independent earner tax credit thresholds are held for 2025/);
});

test("the standard option is 105% of last year, in whole dollars", () => {
  const next = provisionalStandardOption({ lastYear: 1_234_567 });
  assert.equal(next.basis, "105% of last year");
  // 12,345.67 x 1.05 = 12,962.95, stated in whole dollars.
  assert.equal(next.amount, 1_296_200);
  assert.deepEqual(next.instalments, [432_000, 432_000, 432_200]);
  assert.equal(
    next.instalments.reduce((a, b) => a + b, 0),
    next.amount,
    "the instalments add back to the year",
  );
});

test("until last year's return is filed, it is 110% of the year before", () => {
  const next = provisionalStandardOption({
    lastYear: 1_234_567,
    yearBefore: 1_000_000,
    lastYearFiled: false,
  });
  assert.equal(next.basis, "110% of the year before");
  assert.equal(next.amount, 1_100_000);
  assert.deepEqual(next.instalments, [366_600, 366_600, 366_800]);
  assert.match(next.why, /not filed yet/);
});

test("under five thousand dollars, provisional tax is not due at all", () => {
  const under = provisionalStandardOption({ lastYear: 500_000 });
  assert.equal(under.basis, "not due");
  assert.equal(under.amount, 0);
  assert.deepEqual(under.instalments, []);
  assert.match(under.why, /not due/);

  // And with nothing known either way, it does not invent a figure.
  const unknown = provisionalStandardOption({ lastYear: null });
  assert.equal(unknown.basis, "not due");
  assert.equal(unknown.amount, 0);
});

test("a year with no rates at all still refuses to guess", () => {
  assert.equal(incomeTaxOn(6_000_000, 2019), null);
});
