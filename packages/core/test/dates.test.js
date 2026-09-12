import test from "node:test";
import assert from "node:assert/strict";
import { parseDate, fromExcelSerial, daysBetween, financialYear, financialYearOf } from "../dist/index.js";

test("parses ISO dates", () => {
  assert.equal(parseDate("2024-07-01"), "2024-07-01");
  assert.equal(parseDate("2024-7-1"), "2024-07-01");
  assert.equal(parseDate("2024-07-01T09:14:02Z"), "2024-07-01");
  assert.equal(parseDate("2024-07-01 09:14:02"), "2024-07-01");
});

test("parses day-first dates by default, as NZ banks export them", () => {
  assert.equal(parseDate("01/07/2024"), "2024-07-01");
  assert.equal(parseDate("1/7/24"), "2024-07-01");
  assert.equal(parseDate("01-07-2024"), "2024-07-01");
  assert.equal(parseDate("01.07.2024"), "2024-07-01");
});

test("honours month-first when asked", () => {
  assert.equal(parseDate("01/07/2024", { dayFirst: false }), "2024-01-07");
});

test("lets an impossible day overrule the configured order", () => {
  // 13 cannot be a month, so this is 13 April however the flag is set.
  assert.equal(parseDate("13/04/2024", { dayFirst: false }), "2024-04-13");
  assert.equal(parseDate("13/04/2024", { dayFirst: true }), "2024-04-13");
});

test("parses textual months", () => {
  assert.equal(parseDate("3 Apr 2024"), "2024-04-03");
  assert.equal(parseDate("03-APR-24"), "2024-04-03");
  assert.equal(parseDate("Apr 3 2024"), "2024-04-03");
  assert.equal(parseDate("September 9 2024"), "2024-09-09");
});

test("converts Excel serials, including the Lotus leap-year offset", () => {
  // 45174 is a serial taken straight from the source workbook. Note the
  // workbook labels this row "2023August": that is its own budget month, which
  // starts before the calendar month. Its YearMonthTrue column says 202309.
  assert.equal(fromExcelSerial(45174), "2023-09-05");
  assert.equal(parseDate(45174), "2023-09-05");
  assert.equal(parseDate("45174"), "2023-09-05");
  // A fractional serial carries a time of day; only the date is kept.
  assert.equal(parseDate(46116.32072916667), "2026-04-04");
  // Day 60 is Excel's phantom 29 February 1900, inherited from Lotus 1-2-3.
  // Anchoring on 1899-12-30 is what makes every modern date land correctly.
  assert.equal(fromExcelSerial(44927), "2023-01-01");
});

test("rejects impossible and out-of-range dates rather than rolling over", () => {
  assert.equal(parseDate("31/02/2024"), null);
  assert.equal(parseDate("00/07/2024"), null);
  assert.equal(parseDate("32/13/2024"), null);
  assert.equal(parseDate("Total:"), null);
  assert.equal(parseDate(""), null);
  assert.equal(parseDate(null), null);
  assert.equal(parseDate(5), null);
});

test("accepts a real leap day and rejects a fake one", () => {
  assert.equal(parseDate("29/02/2024"), "2024-02-29");
  assert.equal(parseDate("29/02/2023"), null);
});

test("counts whole days between dates", () => {
  assert.equal(daysBetween("2024-07-01", "2024-07-02"), 1);
  assert.equal(daysBetween("2024-07-02", "2024-07-01"), -1);
  assert.equal(daysBetween("2024-07-01", "2024-07-01"), 0);
  // Across a DST boundary in NZ, which is the classic off-by-one.
  assert.equal(daysBetween("2024-09-28", "2024-09-30"), 2);
});

test("a date knows which financial year it falls in", () => {
  // The inverse of financialYear(). April starts a new one; March ends it.
  assert.equal(financialYearOf("2025-04-01"), 2026, "the first day of the 2026 year");
  assert.equal(financialYearOf("2026-03-31"), 2026, "the last day of it");
  assert.equal(financialYearOf("2026-04-01"), 2027, "and the next one begins");
});

test("the year boundary follows the year end that was configured", () => {
  // A US year ends in December, so every date is in its own calendar year.
  assert.equal(financialYearOf("2025-04-01", { endMonth: 12 }), 2025);
  assert.equal(financialYearOf("2025-12-31", { endMonth: 12 }), 2025);
  // A date placed in the wrong year moves income between tax returns, which is
  // why this is configurable rather than assumed.
  assert.equal(financialYearOf("2025-04-01"), 2026);
});

test("it agrees with the range financialYear gives for the same year", () => {
  for (const year of [2024, 2025, 2026, 2027]) {
    const { from, to } = financialYear(year);
    assert.equal(financialYearOf(from), year, `${from} opens the ${year} year`);
    assert.equal(financialYearOf(to), year, `${to} closes it`);
  }
});
