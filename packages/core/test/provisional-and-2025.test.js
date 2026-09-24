import assert from "node:assert/strict";
import test from "node:test";
import { incomeTaxOn, ir3Return, provisionalStandardOption } from "../dist/index.js";

/**
 * The two gaps an outside review of this engine found, against the years and
 * rules they belong to.
 */

test("the year ended 31 March 2025 uses Inland Revenue's composite table", () => {
  // 2024-25 straddles the threshold change of 31 July 2024. Inland Revenue's
  // table for it keeps the new thresholds and blends the rates between them.
  // This test used to pin blended *thresholds* (14,533 / 49,833 / 72,700),
  // which is a different calculation, and so pinned a wrong figure. On $60,000:
  //   14,000 at 10.5%   = 1,470.00
  //    1,600 at 12.82%  =   205.12
  //   32,400 at 17.5%   = 5,670.00
  //    5,500 at 21.64%  = 1,190.20
  //    6,500 at 30%     = 1,950.00   total 10,485.32
  assert.equal(incomeTaxOn(6_000_000, 2025), 1_048_532);
  // And on $100,000, where the old table was about $350 too high.
  assert.equal(incomeTaxOn(10_000_000, 2025), 2_322_251);

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
  // The 2024/25 levy (1.60%) is held now, so PAYE is reduced by it...
  assert.doesNotMatch(filed.notes.join(" "), /No ACC earner levy rate is held for 2025/);
  // ...but that year's independent earner credit is still not, and says so.
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

test("the year to 31 March 2027 has its rates, levy and credit", () => {
  // Inland Revenue's "From 1 April 2025" bands, unchanged for 2026-27.
  assert.equal(incomeTaxOn(10_000_000, 2027), 2_287_750);
  assert.equal(incomeTaxOn(10_000_000, 2027), incomeTaxOn(10_000_000, 2026));
});

test("a 2027 return takes the 1.75% levy out of PAYE and gives the independent earner credit", () => {
  const filed = ir3Return({
    owner: "Ana Whitcombe",
    year: 2027,
    extras: [
      { owner: "Ana Whitcombe", year: 2027, category: "salary", payer: "Kea Coffee Roasters", gross: 5_000_000, credits: 900_000 },
    ],
    rentals: [],
  });
  const notes = filed.notes.join(" ");
  assert.doesNotMatch(notes, /No ACC earner levy rate is held for 2027/);
  assert.doesNotMatch(notes, /No independent earner tax credit thresholds are held for 2027/);
  // $50,000 is inside the full-credit range: $520, in Box 33.
  assert.equal(filed.boxes.find((b) => b.box === "33")?.amount, 52_000);
});

test("the independent earner credit is lost only for the months ruled out", () => {
  const base = {
    owner: "Ana Whitcombe",
    year: 2027,
    extras: [
      { owner: "Ana Whitcombe", year: 2027, category: "salary", payer: "Kea Coffee Roasters", gross: 5_000_000, credits: 900_000 },
    ],
    rentals: [],
  };
  const credit = (r) => r.boxes.find((b) => b.box === "33")?.amount;
  // Three months of Working for Families: nine months of $520 a year.
  const part = ir3Return({ ...base, ietcMonthsOut: 3 });
  assert.equal(credit(part), 39_000);
  assert.match(part.notes.join(" "), /9 of 12 months/);
  // All twelve out is the same as not eligible.
  assert.equal(credit(ir3Return({ ...base, ietcMonthsOut: 12 })), 0);
  assert.equal(credit(ir3Return({ ...base, ietcEligible: false })), 0);
});
