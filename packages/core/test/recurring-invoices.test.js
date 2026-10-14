import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_CATCH_UP, generateDue, nextDate, occurrence, scheduleFromInvoice, scheduleProblem,
} from "../dist/index.js";

const line = { description: "Hosting", accountCode: "200", taxType: "15% GST on Income", net: 10000, tax: 1500, gross: 11500 };
const schedule = (over = {}) => ({
  id: "r1", contact: "Kea Cafe", reference: "Hosting", currency: "NZD", lines: [line],
  frequency: "monthly", start: "2026-01-31", end: null, made: 0, dueDays: 20, active: true, ...over,
});

test("monthly dates keep the day, falling back to the end of a short month", () => {
  const dates = [0, 1, 2, 3].map((n) => occurrence("2026-01-31", "monthly", n));
  assert.deepEqual(dates, ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
  assert.equal(occurrence("2028-01-31", "monthly", 1), "2028-02-29");
});

test("weekly, fortnightly, quarterly and yearly", () => {
  assert.equal(occurrence("2026-03-01", "weekly", 2), "2026-03-15");
  assert.equal(occurrence("2026-03-01", "fortnightly", 2), "2026-03-29");
  assert.equal(occurrence("2026-11-30", "quarterly", 1), "2027-02-28");
  assert.equal(occurrence("2028-02-29", "yearly", 1), "2029-02-28");
});

test("nothing is made before it is due, or after the end", () => {
  assert.equal(generateDue([schedule()], [], "2026-01-30").invoices.length, 0);
  assert.equal(nextDate(schedule({ made: 3, end: "2026-03-31" })), null);
  assert.equal(generateDue([schedule({ made: 3, end: "2026-03-31" })], [], "2026-12-31").invoices.length, 0);
});

test("a due schedule makes a draft, with its own number and due date", () => {
  const run = generateDue([schedule()], [], "2026-01-31");
  assert.equal(run.invoices.length, 1);
  const [invoice] = run.invoices;
  assert.equal(invoice.status, "Draft");
  assert.equal(invoice.issued, "2026-01-31");
  assert.equal(invoice.due, "2026-02-20");
  assert.equal(invoice.total, 11500);
  assert.equal(invoice.tax, 1500);
  assert.equal(invoice.outstanding, 11500);
  assert.equal(run.schedules[0].made, 1);
});

test("a schedule that is behind catches up, one invoice per missed date, numbered on from the books", () => {
  const existing = [{ number: "INV-0007", kind: "sales", contact: "x", reference: "", issued: "2025-12-01", due: null,
    total: 0, tax: 0, paid: 0, outstanding: 0, currency: "NZD", status: "Paid", lines: [] }];
  const run = generateDue([schedule()], existing, "2026-03-31");
  assert.deepEqual(run.invoices.map((i) => i.issued), ["2026-01-31", "2026-02-28", "2026-03-31"]);
  assert.deepEqual(run.invoices.map((i) => i.number), ["INV-0008", "INV-0009", "INV-0010"]);
  assert.equal(run.schedules[0].made, 3);
});

test("running it twice for the same day makes nothing the second time", () => {
  const first = generateDue([schedule()], [], "2026-02-28");
  const second = generateDue(first.schedules, first.invoices, "2026-02-28");
  assert.equal(second.invoices.length, 0);
});

test("a long catch-up is capped", () => {
  const run = generateDue([schedule({ frequency: "weekly", start: "2020-01-01" })], [], "2026-12-31");
  assert.equal(run.invoices.length, MAX_CATCH_UP);
});

test("a schedule that cannot make an invoice is skipped, keeps its place, and says why", () => {
  const broken = schedule({ lines: [{ ...line, net: 0, tax: 0, gross: 0 }] });
  assert.equal(scheduleProblem(broken), "its lines add up to nothing");
  const run = generateDue([broken], [], "2026-06-30");
  assert.equal(run.invoices.length, 0);
  assert.equal(run.skipped.length, 1);
  assert.equal(run.schedules[0].made, 0);
});

test("a paused schedule makes nothing", () => {
  assert.equal(generateDue([schedule({ active: false })], [], "2026-06-30").invoices.length, 0);
});

test("a schedule can be begun from an invoice already written", () => {
  const written = { number: "INV-1", kind: "sales", contact: "Kea", reference: "R", issued: "2026-05-01",
    due: "2026-05-21", total: 11500, tax: 1500, paid: 0, outstanding: 11500, currency: "NZD",
    status: "Awaiting Payment", lines: [line], email: "a@b.example" };
  const made = scheduleFromInvoice(written, "monthly", "2026-06-01", "r9");
  assert.equal(made.dueDays, 20);
  assert.equal(made.email, "a@b.example");
  assert.equal(made.made, 0);
  assert.deepEqual(made.lines, [line]);
  assert.notEqual(made.lines[0], line);
});
