import assert from "node:assert/strict";
import test from "node:test";
import { decideTime, timeApproved, timeAwaitingApproval, unbilledTime } from "../dist/index.js";

const entry = (id, over = {}) => ({ id, date: "2026-05-01", customer: "Kea", hours: 2, rate: 9_500, description: "Work", ...over });

test("only approved time, or time kept before approval, can be invoiced", () => {
  const entries = [
    entry("old"),
    entry("ok", { approval: "approved" }),
    entry("waiting", { approval: "submitted" }),
    entry("no", { approval: "rejected" }),
  ];
  assert.deepEqual(unbilledTime(entries).get("Kea").map((e) => e.id), ["old", "ok"]);
  assert.deepEqual(entries.map(timeApproved), [true, true, false, false]);
  assert.deepEqual(timeAwaitingApproval(entries).map((e) => e.id), ["waiting"]);
});

test("approving and sending back say who, and why", () => {
  const waiting = entry("w", { approval: "submitted", worker: "Sam" });
  const ok = decideTime(waiting, "approved", " Ana ");
  assert.equal(ok.approval, "approved");
  assert.equal(ok.approvedBy, "Ana");
  assert.equal(ok.rejectedBecause, undefined);
  const back = decideTime(waiting, "rejected", "Ana", "Wrong customer");
  assert.equal(back.approval, "rejected");
  assert.equal(back.rejectedBecause, "Wrong customer");
});

test("only time waiting can be decided, and never time already invoiced", () => {
  const done = entry("d", { approval: "approved" });
  assert.equal(decideTime(done, "rejected", "Ana", "x"), done);
  const billed = entry("b", { approval: "submitted", invoice: "INV-1" });
  assert.equal(decideTime(billed, "approved", "Ana"), billed);
});
