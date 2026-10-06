import assert from "node:assert/strict";
import test from "node:test";
import { leaveBalance, ordinaryWeeklyPayOf } from "../dist/index.js";

// Someone on $52,000 a year, paid fortnightly from 1 April 2024: $2,000 a
// fortnight, $1,000 a week.
const pays = [];
for (let d = new Date(Date.UTC(2024, 3, 12)); d <= new Date(Date.UTC(2026, 2, 31)); d.setUTCDate(d.getUTCDate() + 14)) {
  pays.push({ date: d.toISOString().slice(0, 10), gross: 200000 });
}
const base = {
  employeeId: "e1",
  startDate: "2024-04-01",
  pays,
  taken: [],
  ordinaryWeeklyPay: ordinaryWeeklyPayOf({ annualSalary: 5200000, payFrequency: "fortnightly" }),
};

test("four weeks of annual holidays at each anniversary, less what was taken", () => {
  const b = leaveBalance({
    ...base,
    asAt: "2026-03-31",
    taken: [{ employeeId: "e1", kind: "annual", from: "2025-12-22", days: 10 }],
  });
  // One anniversary (1 April 2025) by 31 March 2026: 4 weeks, 2 taken.
  assert.equal(b.annualEntitledWeeks, 4);
  assert.equal(b.annualTakenWeeks, 2);
  assert.equal(b.annualWeeks, 2);
  assert.equal(b.lastAnniversary, "2025-04-01");
  assert.equal(b.nextAnniversary, "2026-04-01");
});

test("holiday pay owing: weeks owed at the greater weekly rate, plus 8% since the anniversary", () => {
  const b = leaveBalance({ ...base, asAt: "2026-03-31" });
  assert.equal(b.ordinaryWeeklyPay, 100000);
  assert.ok(b.averageWeeklyEarnings >= 100000);
  // 4 weeks at the weekly rate, plus 8% of the year's gross since 1 April 2025.
  assert.equal(b.owing, Math.round(4 * b.weeklyRate) + Math.round(b.grossSinceAnniversary * 0.08));
  assert.equal(b.accruedSinceAnniversary, Math.round(b.grossSinceAnniversary * 0.08));
});

test("sick leave: 10 days at six months, 10 more each year, the balance held to 20", () => {
  // 1 Oct 2024 and 1 Oct 2025: 10 + 10, none taken -> 20.
  assert.equal(leaveBalance({ ...base, asAt: "2026-03-31" }).sickDays, 20);
  // Before six months: none yet.
  const early = leaveBalance({ ...base, asAt: "2024-09-01" });
  assert.equal(early.sickDays, 0);
  assert.equal(early.nextSickEntitlement, "2024-10-01");
  // Three days taken in between: 10 - 3 + 10 = 17.
  const used = leaveBalance({
    ...base,
    asAt: "2026-03-31",
    taken: [{ employeeId: "e1", kind: "sick", from: "2025-02-10", days: 3 }],
  });
  assert.equal(used.sickDays, 17);
  // A third year would take 20 past 20: it stays at 20.
  assert.equal(leaveBalance({ ...base, asAt: "2027-01-01" }).sickDays, 20);
});

test("pay as you go: no annual balance and nothing owing", () => {
  const b = leaveBalance({ ...base, asAt: "2026-03-31", settings: { employeeId: "e1", payAsYouGo: true } });
  assert.equal(b.annualWeeks, 0);
  assert.equal(b.owing, 0);
});

test("an opening balance counts, and only later anniversaries add to it", () => {
  const b = leaveBalance({
    ...base,
    asAt: "2026-03-31",
    settings: { employeeId: "e1", opening: { asAt: "2025-06-30", annualWeeks: 3.5, sickDays: 8 } },
  });
  assert.equal(b.annualEntitledWeeks, 3.5);
  // The 1 Oct 2025 sick entitlement adds 10 to the 8 held.
  assert.equal(b.sickDays, 18);
});

test("a leave request counts working days, as Xero did for 3 to 8 October 2026", async () => {
  const { workingDaysBetween, regionalAnniversary } = await import("../dist/index.js");
  // Saturday 3 to Thursday 8 October: Monday to Thursday, 4 days -- 32 hours at 8 a day.
  assert.equal(workingDaysBetween("2026-10-03", "2026-10-08"), 4);
  // Regional anniversary days, as MBIE lists them observed in 2026.
  assert.equal(regionalAnniversary("Wellington", 2026), "2026-01-19");
  assert.equal(regionalAnniversary("Auckland", 2026), "2026-01-26");
  assert.equal(regionalAnniversary("Canterbury", 2026), "2026-11-13");
  // Canterbury Show Day is not a working day there.
  assert.equal(workingDaysBetween("2026-11-09", "2026-11-13", "Canterbury"), 4);
  assert.equal(workingDaysBetween("2026-11-09", "2026-11-13"), 5);
});

test("family violence leave is 10 days a year, and alternative holidays are earned and taken", () => {
  const b = leaveBalance({
    ...base,
    asAt: "2026-03-31",
    settings: { employeeId: "e1", hoursPerWeek: 40 },
    taken: [
      { employeeId: "e1", kind: "family-violence", from: "2025-11-03", days: 2 },
      { employeeId: "e1", kind: "family-violence", from: "2025-05-03", days: 4 },
      { employeeId: "e1", kind: "alternative-earned", from: "2025-12-25", days: 1 },
    ],
  });
  // Only what was taken since the 1 October 2025 entitlement counts against this year's 10.
  assert.equal(b.familyViolenceDays, 8);
  assert.equal(b.alternativeDays, 1);
  assert.equal(b.hoursPerDay, 8);
});

test("regional anniversary days match Xero's 2026 holiday list", async () => {
  const { regionalAnniversary } = await import("../dist/index.js");
  assert.equal(regionalAnniversary("Wellington", 2026), "2026-01-19");
  assert.equal(regionalAnniversary("Auckland", 2026), "2026-01-26");
  assert.equal(regionalAnniversary("Nelson", 2026), "2026-02-02");
  assert.equal(regionalAnniversary("Taranaki", 2026), "2026-03-09");
  assert.equal(regionalAnniversary("Otago", 2026), "2026-03-23");
});
