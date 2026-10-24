import { test } from "node:test";
import assert from "node:assert/strict";
import { periodChoiceFrom, periodOptions, periodRange, periodSaid, yearEarlier, yearMonths } from "../dist/index.js";

const NZ_FY2026 = { from: "2025-04-01", to: "2026-03-31" };
const AU_FY2026 = { from: "2025-07-01", to: "2026-06-30" };
const US_2024 = { from: "2024-01-01", to: "2024-12-31" };

test("a year's months, each its first and last day, through a leap February", () => {
  const months = yearMonths({ from: "2023-04-01", to: "2024-03-31" });
  assert.equal(months.length, 12);
  assert.deepEqual(months[0], { from: "2023-04-01", to: "2023-04-30" });
  assert.deepEqual(months[10], { from: "2024-02-01", to: "2024-02-29" });
  assert.deepEqual(months[11], { from: "2024-03-01", to: "2024-03-31" });
});

test("a year that is not twelve whole months has the months it has, cut to it", () => {
  const months = yearMonths({ from: "2025-06-15", to: "2025-09-10" });
  assert.deepEqual(months, [
    { from: "2025-06-15", to: "2025-06-30" },
    { from: "2025-07-01", to: "2025-07-31" },
    { from: "2025-08-01", to: "2025-08-31" },
    { from: "2025-09-01", to: "2025-09-10" },
  ]);
});

test("quarters follow the financial year, not the calendar", () => {
  assert.deepEqual(periodRange(NZ_FY2026, { kind: "quarter", index: 1 }, "2026-01-01"), { from: "2025-04-01", to: "2025-06-30" });
  assert.deepEqual(periodRange(NZ_FY2026, { kind: "quarter", index: 4 }, "2026-01-01"), { from: "2026-01-01", to: "2026-03-31" });
  assert.deepEqual(periodRange(AU_FY2026, { kind: "quarter", index: 2 }, "2026-01-01"), { from: "2025-10-01", to: "2025-12-31" });
  assert.deepEqual(periodRange(US_2024, { kind: "quarter", index: 1 }, "2024-06-01"), { from: "2024-01-01", to: "2024-03-31" });
});

test("a month by its place in the year", () => {
  assert.deepEqual(periodRange(NZ_FY2026, { kind: "month", index: 5 }, "2026-01-01"), { from: "2025-08-01", to: "2025-08-31" });
  assert.deepEqual(periodRange(NZ_FY2026, { kind: "month", index: 13 }, "2026-01-01"), NZ_FY2026, "a month the year lacks is the year");
});

test("year to date stops at today, and is the whole year once it is over", () => {
  assert.deepEqual(periodRange(NZ_FY2026, { kind: "ytd" }, "2025-10-24"), { from: "2025-04-01", to: "2025-10-24" });
  assert.deepEqual(periodRange(NZ_FY2026, { kind: "ytd" }, "2027-01-01"), NZ_FY2026);
});

test("chosen dates are kept inside the year and put the right way round", () => {
  assert.deepEqual(periodRange(NZ_FY2026, { kind: "custom", from: "2025-05-10", to: "2025-06-20" }, "2026-01-01"), { from: "2025-05-10", to: "2025-06-20" });
  assert.deepEqual(periodRange(NZ_FY2026, { kind: "custom", from: "2025-01-01", to: "2027-01-01" }, "2026-01-01"), NZ_FY2026);
  assert.deepEqual(periodRange(NZ_FY2026, { kind: "custom", from: "2025-06-20", to: "2025-05-10" }, "2026-01-01"), { from: "2025-05-10", to: "2025-06-20" });
});

test("a select's value read back as its choice, and an unknown one as the year", () => {
  assert.deepEqual(periodChoiceFrom("q3"), { kind: "quarter", index: 3 });
  assert.deepEqual(periodChoiceFrom("m07"), { kind: "month", index: 7 });
  assert.deepEqual(periodChoiceFrom("ytd"), { kind: "ytd" });
  assert.deepEqual(periodChoiceFrom("custom", { from: "2025-05-01", to: "2025-05-31" }), { kind: "custom", from: "2025-05-01", to: "2025-05-31" });
  assert.deepEqual(periodChoiceFrom("custom", { from: "", to: "" }), { kind: "year" });
  assert.deepEqual(periodChoiceFrom("nonsense"), { kind: "year" });
});

test("ranges in words", () => {
  assert.equal(periodSaid({ from: "2025-08-01", to: "2025-08-31" }), "August 2025");
  assert.equal(periodSaid({ from: "2025-07-01", to: "2025-09-30" }), "Jul–Sep 2025");
  assert.equal(periodSaid({ from: "2025-04-01", to: "2026-03-31" }), "Apr 2025–Mar 2026");
  assert.equal(periodSaid({ from: "2025-05-10", to: "2025-06-20" }), "10 May 2025 to 20 Jun 2025");
});

test("the choices for a year: whole year, year to date while it runs, four quarters, twelve months, chosen dates", () => {
  const during = periodOptions(NZ_FY2026, "2025-10-24");
  assert.deepEqual(during.map((o) => o.value), ["year", "ytd", "q1", "q2", "q3", "q4", ...Array.from({ length: 12 }, (_, i) => `m${String(i + 1).padStart(2, "0")}`), "custom"]);
  assert.equal(during[2].label, "Q1 (Apr–Jun 2025)");
  assert.equal(during[6].label, "April 2025");
  const after = periodOptions(NZ_FY2026, "2026-05-01");
  assert.ok(!after.some((o) => o.value === "ytd"), "no year to date once the year is over");
});

test("the same stretch a year earlier", () => {
  assert.deepEqual(yearEarlier(NZ_FY2026), { from: "2024-04-01", to: "2025-03-31" });
  assert.deepEqual(yearEarlier({ from: "2025-08-01", to: "2025-08-31" }), { from: "2024-08-01", to: "2024-08-31" });
  // February's end stays February's end across a leap year, both ways.
  assert.deepEqual(yearEarlier({ from: "2024-02-01", to: "2024-02-29" }), { from: "2023-02-01", to: "2023-02-28" });
  assert.deepEqual(yearEarlier({ from: "2025-02-01", to: "2025-02-28" }), { from: "2024-02-01", to: "2024-02-29" });
  assert.deepEqual(yearEarlier({ from: "2025-05-10", to: "2025-06-20" }), { from: "2024-05-10", to: "2024-06-20" });
});
