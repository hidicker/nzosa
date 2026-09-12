import assert from "node:assert/strict";
import test from "node:test";
import { accountsAtExportLimit, codingCounts } from "../dist/index.js";

const txn = (id, over = {}) => ({
  id, date: "2025-06-01", account: "BNZ 01", amount: -1000, otherParty: "Ozone",
  particulars: "", code: "", reference: "", description: "", currency: "NZD",
  source: "bank", ...over,
});

const rules = (list, overrides = {}) => ({ rules: list, overrides });

test("nothing coded when no rule matches", () => {
  const counts = codingCounts([txn("a"), txn("b")], rules([]));
  assert.equal(counts.coded, 0);
  assert.equal(counts.total, 2);
  assert.equal(counts.byCode.size, 0);
});

test("one pass answers both questions", () => {
  // How many are coded, and to what, from a single categorisation of each
  // line. They used to be two functions running the same loop twice.
  const counts = codingCounts(
    [txn("a"), txn("b"), txn("c", { otherParty: "Woolworths" })],
    rules([
      { keyword: "Ozone", code: "310 Cost of Goods Sold" },
      { keyword: "Woolworths", code: "420 Entertainment" },
    ]),
  );
  assert.equal(counts.coded, 3);
  assert.equal(counts.byCode.get("310 Cost of Goods Sold"), 2);
  assert.equal(counts.byCode.get("420 Entertainment"), 1);
});

test("what is counted is what the rules would decide, overrides included", () => {
  // The reconcile page reports progress on what *would* be decided if every
  // suggestion were taken, not only on what somebody has confirmed.
  const counts = codingCounts(
    [txn("a"), txn("b")],
    rules([], { a: { code: "400 Advertising", confirmed: true } }),
  );
  assert.equal(counts.coded, 1);
  assert.equal(counts.byCode.get("400 Advertising"), 1);
});

test("an uncoded line is counted in the total but not as coded", () => {
  const counts = codingCounts(
    [txn("a"), txn("b", { otherParty: "Nothing matches this" })],
    rules([{ keyword: "Ozone", code: "310" }]),
  );
  assert.equal(counts.coded, 1);
  assert.equal(counts.total, 2);
});

test("an account stopping exactly on the cap is reported", () => {
  // Banks cap a download and say nothing about having done so. Exactly a
  // thousand is suspicious in a way 999 is not.
  const many = Array.from({ length: 1000 }, (_, i) => txn("t" + i));
  assert.deepEqual(accountsAtExportLimit(many), ["BNZ 01"]);
});

test("one short of the cap is not suspicious", () => {
  const many = Array.from({ length: 999 }, (_, i) => txn("t" + i));
  assert.deepEqual(accountsAtExportLimit(many), []);
});

test("each account is counted on its own", () => {
  const a = Array.from({ length: 1000 }, (_, i) => txn("a" + i));
  const b = Array.from({ length: 5 }, (_, i) => txn("b" + i, { account: "BNZ Visa" }));
  assert.deepEqual(accountsAtExportLimit([...a, ...b]), ["BNZ 01"]);
});

test("the cap is configurable, because not every bank uses the same one", () => {
  const many = Array.from({ length: 500 }, (_, i) => txn("t" + i));
  assert.deepEqual(accountsAtExportLimit(many, 500), ["BNZ 01"]);
  assert.deepEqual(accountsAtExportLimit(many, 1000), []);
});
