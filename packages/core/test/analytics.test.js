import { test } from "node:test";
import assert from "node:assert/strict";
import { cashForecast, daysSalesOutstanding, documentCashEvents, margins, recurringCashEvents } from "../dist/index.js";

test("days sales outstanding, and none when there were no sales", () => {
  assert.equal(daysSalesOutstanding(30000, 365000, 365), 30);
  assert.equal(daysSalesOutstanding(-500, 1000, 30), 0);
  assert.equal(daysSalesOutstanding(100, 0, 30), null);
});

test("gross and net margins as whole percentages", () => {
  assert.deepEqual(margins(100000, -40000, 15000), { gross: 60, net: 15 });
  assert.deepEqual(margins(0, 0, -100), { gross: null, net: null });
});

const doc = (number, kind, status, due, total, remaining) => ({
  invoice: { number, kind, status, contact: "Kea", issued: "2026-09-01", due, total },
  remaining,
});

test("open documents become money at their due date; overdue ones now; drafts, quotes and settled ones not at all", () => {
  const events = documentCashEvents(
    [
      doc("INV-1", "sales", "Awaiting Payment", "2026-11-10", 50000, 50000),
      doc("INV-2", "sales", "Awaiting Payment", "2026-10-01", 20000, 5000),
      doc("BILL-1", "purchase", "Awaiting Payment", "2026-11-20", 30000, 30000),
      doc("INV-3", "sales", "Draft", "2026-11-10", 99900, 99900),
      doc("INV-4", "sales", "Paid", "2026-11-10", 10000, 0),
    ],
    "2026-10-25",
  );
  assert.deepEqual(events.map((e) => [e.what.split(",")[0], e.date, e.amount, e.overdue === true]), [
    ["Invoice INV-1", "2026-11-10", 50000, false],
    ["Invoice INV-2", "2026-10-25", 5000, true],
    ["Bill BILL-1", "2026-11-20", -30000, false],
  ]);
});

test("a recurring schedule's next invoices within the window, at their due dates", () => {
  const schedule = {
    id: "r", contact: "Tui", reference: "", currency: "NZD", frequency: "monthly", start: "2026-08-01", end: null,
    made: 3, dueDays: 20, active: true, lines: [{ description: "", accountCode: "200", taxType: "", net: 10000, tax: 1500, gross: 11500 }],
  };
  assert.deepEqual(recurringCashEvents([schedule], "2026-10-25", "2027-01-23").map((e) => e.date), ["2026-11-21", "2026-12-21", "2027-01-21"]);
  assert.deepEqual(recurringCashEvents([{ ...schedule, active: false }], "2026-10-25", "2027-01-23"), []);
});

test("thirteen weeks from today, the balance carried, the lowest point and what was overdue", () => {
  const out = cashForecast(10000, "2026-10-25", [
    { date: "2026-10-25", amount: 5000, what: "late", overdue: true },
    { date: "2026-11-03", amount: -40000, what: "rent" },
    { date: "2026-11-20", amount: 50000, what: "big job" },
  ]);
  assert.equal(out.weeks.length, 13);
  assert.deepEqual(out.weeks.slice(0, 4).map((w) => [w.from, w.in, w.out, w.closing]), [
    ["2026-10-25", 5000, 0, 15000],
    ["2026-11-01", 0, 40000, -25000],
    ["2026-11-08", 0, 0, -25000],
    ["2026-11-15", 50000, 0, 25000],
  ]);
  assert.deepEqual(out.lowest, { date: "2026-11-07", balance: -25000 });
  assert.equal(out.overdueIn, 5000);
  assert.equal(out.weeks[12].to, "2027-01-23");
});
