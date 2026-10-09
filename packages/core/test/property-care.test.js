import assert from "node:assert/strict";
import test from "node:test";
import { completeTask, monthsAfter, overdueTasks, taskOpen } from "../dist/index.js";

test("a job that does not repeat is finished when ticked", () => {
  const done = completeTask({ id: "1", what: "Fix the laundry tap", due: "2026-05-01" }, "2026-05-03");
  assert.equal(done.done, "2026-05-03");
  assert.equal(taskOpen(done), false);
});

test("a yearly service done late is still due in the same month next year", () => {
  const next = completeTask({ id: "2", what: "Heat pump service", due: "2026-03-10", repeat: "yearly" }, "2026-03-24");
  assert.equal(next.due, "2027-03-10");
  assert.equal(next.done, "2026-03-24");
  assert.equal(taskOpen(next), true);
});

test("done more than a period behind, the next is a period on from now, not one already past", () => {
  const next = completeTask({ id: "3", what: "Gutters", due: "2025-01-15", repeat: "six-monthly" }, "2026-02-01");
  assert.equal(next.due, "2026-07-15");
});

test("with no due date, a period after it was done", () => {
  assert.equal(completeTask({ id: "4", what: "Smoke alarms", repeat: "quarterly" }, "2026-01-31").due, "2026-04-30");
});

test("month ends hold, and only open jobs past their date are overdue", () => {
  assert.equal(monthsAfter("2026-01-31", 1), "2026-02-28");
  const care = {
    tasks: [
      { id: "a", what: "Overdue", due: "2026-04-01" },
      { id: "b", what: "Finished", due: "2026-04-01", done: "2026-04-02" },
      { id: "c", what: "Not yet", due: "2026-06-01" },
      { id: "d", what: "No date" },
    ],
  };
  assert.deepEqual(overdueTasks(care, "2026-05-01").map((t) => t.id), ["a"]);
});
