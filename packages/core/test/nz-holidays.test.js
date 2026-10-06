import { test } from "node:test";
import assert from "node:assert/strict";
import { gstPayBy, gstPeriods, isWorkingDay, nextWorkingDay, nzPublicHolidays } from "../dist/index.js";

test("the 2026-27 holidays are the ones Inland Revenue's own calendar (IR328) marks", () => {
  const h2026 = nzPublicHolidays(2026);
  for (const day of [
    "2026-04-03", // Good Friday
    "2026-04-06", // Easter Monday
    "2026-04-27", // "ANZAC Day" day off (25 April is a Saturday)
    "2026-06-01", // King's Birthday
    "2026-07-10", // Matariki
    "2026-10-26", // Labour Day
    "2026-12-25", // Christmas Day
    "2026-12-28", // "Boxing Day" day off (26 December is a Saturday)
  ]) assert.ok(h2026.has(day), `${day} is a holiday`);
  assert.ok(!h2026.has("2026-04-25"), "Anzac on a Saturday is observed on the Monday");

  const h2027 = nzPublicHolidays(2027);
  for (const day of [
    "2027-01-01", // New Year's Day
    "2027-01-04", // "Day after New Year's Day" day off
    "2027-02-08", // "Waitangi Day" day off (6 February is a Saturday)
    "2027-03-26", // Good Friday
    "2027-03-29", // Easter Monday
  ]) assert.ok(h2027.has(day), `${day} is a holiday`);
});

test("a due date on a weekend or holiday moves to the next working day", () => {
  assert.equal(gstPayBy("2026-05-31"), "2026-06-29", "Sunday 28 June 2026");
  assert.equal(gstPayBy("2026-10-31"), "2026-11-30", "Saturday 28 November 2026");
  assert.equal(gstPayBy("2027-01-31"), "2027-03-01", "Sunday 28 February 2027");
  assert.equal(gstPayBy("2024-05-31"), "2024-07-01", "Matariki, Friday 28 June 2024");
  assert.equal(gstPayBy("2024-09-30"), "2024-10-29", "Labour Day, Monday 28 October 2024");
  assert.equal(gstPayBy("2026-08-31"), "2026-09-28", "a Monday that is not a holiday stays");
});

test("15 January and 7 May move only for a weekend", () => {
  // 15 January 2028 is a Saturday.
  assert.equal(gstPayBy("2027-11-30"), "2028-01-17");
  // 7 May 2027 is a Friday.
  assert.equal(gstPayBy("2027-03-31"), "2027-05-07");
});

test("periods carry both the due date and the date it can be paid by", () => {
  const [june] = gstPeriods({ from: "2026-04-01", to: "2026-05-31" }, { months: 2, anchorMonth: 3 });
  assert.equal(june.due, "2026-06-28");
  assert.equal(june.payBy, "2026-06-29");
});

test("working days", () => {
  assert.equal(isWorkingDay("2026-09-24"), true);
  assert.equal(isWorkingDay("2026-09-26"), false, "a Saturday");
  assert.equal(nextWorkingDay("2026-12-25"), "2026-12-29", "Christmas, Saturday, Sunday, Boxing Day off");
});
