import assert from "node:assert/strict";
import test from "node:test";
import { dedupeReference, inferAccountMapping } from "../dist/index.js";

const line = (over) => ({
  date: "2026-05-01", amount: -11500, code: "429", label: "429 Office Expenses",
  source: "export.xlsx", account: "Business Bank Account", ...over,
});

test("the same export loaded twice adds nothing the second time", () => {
  const once = [line(), line({ amount: 23000, code: "200" })];
  const twice = [...once, ...once];
  assert.equal(dedupeReference(twice).length, 2);
});

test("the same posting under two filenames is still one posting", () => {
  const a = line({ source: "april.xlsx" });
  const b = line({ source: "april (1).xlsx" });
  assert.equal(dedupeReference([a, b]).length, 1);
});

test("genuinely different lines all survive", () => {
  const lines = [
    line(),
    line({ date: "2026-05-02" }),
    line({ amount: -11501 }),
    line({ code: "400" }),
    line({ account: "Credit Card" }),
    line({ gstRate: "No GST" }),
  ];
  assert.equal(dedupeReference(lines).length, lines.length);
});

test("two identical postings on one day are kept as one", () => {
  // A real pair of identical postings is indistinguishable from the same
  // posting loaded twice, and treating them as two is the mistake that costs
  // something: it is what makes the account mapping ambiguous.
  assert.equal(dedupeReference([line(), line()]).length, 1);
});

test("duplicates are what stop an account being paired at all", () => {
  // The fault this exists to prevent, in miniature. The mapper only counts
  // unambiguous pairs and wants three of them, so with the reference doubled
  // every amount has two candidates, nothing is unambiguous, and the mapping
  // comes back empty -- which is the difference between coding suggestions and
  // none. On one real set of books it was two pairings against zero.
  const amounts = [-11500, 23000, -4250, 8800];
  const ours = amounts.map((amount, i) => ({
    transaction: {
      id: String(i), date: `2026-05-0${i + 1}`, amount,
      account: "02-1100-0022001-000",
    },
    code: "(uncoded)",
  }));
  const clean = amounts.map((amount, i) => line({ date: `2026-05-0${i + 1}`, amount }));
  const doubled = [...clean, ...clean];

  assert.ok(inferAccountMapping(ours, clean).size > 0, "a clean reference pairs the account");
  assert.equal(inferAccountMapping(ours, doubled).size, 0, "a doubled one pairs nothing");
  assert.ok(
    inferAccountMapping(ours, dedupeReference(doubled)).size > 0,
    "deduplicating puts it back",
  );
});
