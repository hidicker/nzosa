import assert from "node:assert/strict";
import test from "node:test";
import { documentsFromRows, termsDays } from "../dist/index.js";

// Invented suppliers and figures.
const row = (over = {}) => ({
  date: "2026-03-15", contact: "Kowhai Plumbing", reference: "K-201", description: "Tap washer",
  accountCode: "473", taxType: "15% GST on Expenses", gross: 11500, due: null, ...over,
});
const taxed = (t) => /15%/.test(t);

test("each row is a document of one line, numbered in turn after those on file", () => {
  const existing = [{ number: "BILL-0041", kind: "purchase", contact: "x", reference: "", issued: "2026-01-01", due: null,
    total: 100, tax: 0, paid: 0, outstanding: 100, currency: "NZD", status: "Awaiting Payment", lines: [] }];
  const made = documentsFromRows(
    [row(), row({ contact: "Rimu Electrical", reference: "R-77", taxType: "No GST", gross: 46000, due: "2026-04-15" })],
    "purchase", existing, { taxed, currency: "NZD", status: "Awaiting Payment", entityId: "shop" },
  );
  assert.deepEqual(made.map((d) => d.number), ["BILL-0042", "BILL-0043"]);
  assert.deepEqual([made[0].total, made[0].tax, made[0].lines[0].net], [11500, 1500, 10000]);
  assert.deepEqual([made[1].tax, made[1].due, made[1].entityId], [0, "2026-04-15", "shop"]);
  assert.equal(made[0].lines.length, 1);
  assert.equal(made[0].outstanding, 11500);
});

test("terms give the days to pay when they say a number of days", () => {
  assert.equal(termsDays("Net 20"), 20);
  assert.equal(termsDays("30 days"), 30);
  assert.equal(termsDays("20th of the month following"), null);
  assert.equal(termsDays(undefined), null);
});
