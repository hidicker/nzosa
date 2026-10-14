import { test } from "node:test";
import assert from "node:assert/strict";
import { timeInvoiceLines, timeValue, unbilledTime } from "../dist/index.js";

const entries = [
  { id: "a", date: "2026-09-03", customer: "Acme", hours: 2.5, rate: 9500, description: "Logo concepts" },
  { id: "b", date: "2026-09-01", customer: "Acme", hours: 1, rate: 9500, description: "Kick-off call" },
  { id: "c", date: "2026-09-02", customer: "Acme", hours: 3, rate: 9500, description: "Old", invoice: "INV-9" },
  { id: "d", date: "2026-09-02", customer: "Beta", hours: 1, rate: 9500, description: "Admin", nonBillable: true },
  { id: "e", date: "2026-09-04", customer: "Beta", hours: 0.333, rate: 10000, description: "Email" },
];

test("time not invoiced yet, by customer, oldest first", () => {
  const open = unbilledTime(entries);
  assert.deepEqual([...open.keys()], ["Acme", "Beta"]);
  assert.deepEqual(open.get("Acme").map((e) => e.id), ["b", "a"]);
  assert.deepEqual(open.get("Beta").map((e) => e.id), ["e"]);
  assert.equal(timeValue(entries[0]), 23750);
  assert.equal(timeValue(entries[4]), 3330);
});

test("a line an entry, with its hours and rate", () => {
  const lines = timeInvoiceLines(unbilledTime(entries).get("Acme"), "4000", (c) => (c / 100).toFixed(2));
  assert.equal(lines[0].description, "2026-09-01 Kick-off call (1 h at 95.00)");
  assert.equal(lines[1].description, "2026-09-03 Logo concepts (2.50 h at 95.00)");
  assert.equal(lines[1].gross, 23750);
  assert.equal(lines[1].quantity, 2.5);
});
