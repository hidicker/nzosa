import assert from "node:assert/strict";
import test from "node:test";
import { dateLooksWrong } from "../dist/index.js";

test("a year typed wrong is caught, and the date it likely meant offered", () => {
  assert.equal(dateLooksWrong("2025-10-20", "2026-10-27"), "2025-10-20 is 12 months ago. Did you mean 2026-10-20?");
  assert.equal(dateLooksWrong("2027-11-02", "2026-10-27"), "2027-11-02 is 12 months from today. Did you mean 2026-11-02?");
  assert.match(dateLooksWrong("2062-10-27", "2026-10-27"), /36 years from today\. Did you mean 2026-10-27\?/);
});

test("far ahead or long ago is worth a second look; this year and last is not", () => {
  assert.equal(dateLooksWrong("2026-10-01", "2026-10-27"), null);
  assert.equal(dateLooksWrong("2026-12-15", "2026-10-27"), null, "seven weeks ahead: an invoice in advance");
  assert.equal(dateLooksWrong("2025-04-01", "2026-10-27"), null, "last year's books being finished");
  assert.match(dateLooksWrong("2027-03-31", "2026-10-27"), /5 months from today\. Check the year\./);
  assert.match(dateLooksWrong("2024-06-30", "2026-10-27"), /2 years ago\. Check the year\./);
  assert.equal(dateLooksWrong("", "2026-10-27"), null);
});
