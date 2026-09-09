import test from "node:test";
import assert from "node:assert/strict";
import { financialYear, inRange } from "../dist/index.js";

test("a NZ financial year runs 1 April to 31 March, labelled by the year it ends", () => {
  assert.deepEqual(financialYear(2026), { from: "2025-04-01", to: "2026-03-31" });
  assert.deepEqual(financialYear(2025), { from: "2024-04-01", to: "2025-03-31" });
});

test("consecutive years abut exactly, with no gap and no overlap", () => {
  // A one-day gap here would silently drop transactions from both tax years.
  const previous = financialYear(2025);
  const current = financialYear(2026);
  assert.equal(previous.to, "2025-03-31");
  assert.equal(current.from, "2025-04-01");
});

test("handles a December year end", () => {
  assert.deepEqual(financialYear(2025, { endMonth: 12, endDay: 31 }), {
    from: "2025-01-01",
    to: "2025-12-31",
  });
});

test("handles the UK 5 April year end", () => {
  assert.deepEqual(financialYear(2026, { endMonth: 4, endDay: 5 }), {
    from: "2025-04-06",
    to: "2026-04-05",
  });
});

test("clamps a day that the month does not have", () => {
  // 31 June does not exist; the year should end on the 30th, not roll into July.
  assert.deepEqual(financialYear(2026, { endMonth: 6, endDay: 31 }), {
    from: "2025-07-01",
    to: "2026-06-30",
  });
});

test("handles a 29 February year end across a non-leap year", () => {
  // 2024 is a leap year and 2023 is not, so the start must be 1 March 2023.
  assert.deepEqual(financialYear(2024, { endMonth: 2, endDay: 29 }), {
    from: "2023-03-01",
    to: "2024-02-29",
  });
});

test("range membership is inclusive at both ends", () => {
  const year = financialYear(2026);
  assert.equal(inRange("2025-04-01", year), true);
  assert.equal(inRange("2026-03-31", year), true);
  assert.equal(inRange("2025-03-31", year), false);
  assert.equal(inRange("2026-04-01", year), false);
});

test("an open-ended range is allowed on either side", () => {
  assert.equal(inRange("2020-01-01", { to: "2026-03-31" }), true);
  assert.equal(inRange("2030-01-01", { from: "2025-04-01" }), true);
  assert.equal(inRange("2030-01-01", {}), true);
});
