import { test } from "node:test";
import assert from "node:assert/strict";
import { changesIntoLocked, laterLocks, locksMovedBack, reopenedLocks } from "../dist/index.js";

test("the later of two lock settings, lock by lock", () => {
  assert.deepEqual(laterLocks({ gst: "2026-03-31", year: "2025-03-31" }, { gst: "2026-01-31", year: "2026-03-31" }), {
    gst: "2026-03-31",
    year: "2026-03-31",
  });
  assert.deepEqual(laterLocks(undefined, { year: "2026-03-31" }), { year: "2026-03-31" });
  assert.deepEqual(laterLocks({ gst: "" }, undefined), {});
});

test("a lock behind where it has been is reopened at the date it reached", () => {
  assert.equal(reopenedLocks({ year: "2026-03-31" }, { year: "2026-03-31" }), null);
  assert.equal(reopenedLocks({ year: "2026-03-31" }, undefined), null);
  assert.deepEqual(reopenedLocks({ year: "2025-03-31" }, { year: "2026-03-31" }), { year: "2026-03-31" });
  assert.deepEqual(reopenedLocks({}, { gst: "2026-03-31", year: "2026-03-31" }), { gst: "2026-03-31", year: "2026-03-31" });
  // Moved on past where it was: nothing open that had been locked.
  assert.equal(reopenedLocks({ year: "2027-03-31" }, { year: "2026-03-31" }), null);
});

test("moving a lock back or taking it off is a move back; forward is not", () => {
  assert.equal(locksMovedBack({ year: "2026-03-31" }, { year: "2025-03-31" }), true);
  assert.equal(locksMovedBack({ year: "2026-03-31" }, null), true);
  assert.equal(locksMovedBack({ year: "2025-03-31" }, { year: "2026-03-31" }), false);
  assert.equal(locksMovedBack(null, { gst: "2026-03-31" }), false);
});

test("the report keeps the lock moves back and the changes that reached a locked period", () => {
  const events = [
    { id: 4, kind: "lockDates", before: { year: "2025-03-31" }, after: { year: "2026-03-31" } },
    { id: 3, kind: "override", before: null, after: {}, intoLocked: { year: "2026-03-31" } },
    { id: 2, kind: "override", before: null, after: {} },
    { id: 1, kind: "lockDates", before: { year: "2026-03-31" }, after: { year: "2025-03-31" } },
  ];
  assert.deepEqual(changesIntoLocked(events).map((e) => e.id), [3, 1]);
});
