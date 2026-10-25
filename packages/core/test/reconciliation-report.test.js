import assert from "node:assert/strict";
import test from "node:test";
import { reconciliationReport } from "../dist/index.js";

const t = (id, date, amount, account = "chq") => ({ id, date, amount, account, otherParty: id, particulars: "", reference: "", code: "", currency: "NZD", serial: "", trn: "", origin: "", type: "", batch: "", otherPartyAccount: "", occurrence: 1, source: "", extras: {} });

const lines = [
  t("a", "2026-04-02", 10_000),
  t("b", "2026-04-20", -2_500),
  t("c", "2026-04-29", -1_000),
  t("d", "2026-05-03", 4_000),
  t("e", "2026-05-25", -500),
  t("x", "2026-04-10", 99_999, "card"),
];
const done = [
  { id: "apr", account: "chq", statementDate: "2026-04-30", statementBalance: 57_500, owed: false, cleared: ["a", "b"], finishedAt: "2026-05-01T00:00:00Z" },
  { id: "card", account: "card", statementDate: "2026-04-30", statementBalance: 1, owed: true, cleared: ["x"], finishedAt: "2026-05-01T00:00:00Z" },
  { id: "may", account: "chq", statementDate: "2026-05-31", statementBalance: 60_000, owed: false, cleared: ["c", "d", "e"], finishedAt: "2026-06-01T00:00:00Z" },
];

test("a statement's report: where it began, what it cleared, what was still outstanding", () => {
  const april = reconciliationReport(lines, done, "apr", 50_000);
  assert.equal(april.beginning, 50_000);
  assert.deepEqual(april.cleared.map((l) => l.id), ["a", "b"]);
  assert.equal(april.clearedTotal, 7_500);
  assert.equal(april.statement, 57_500);
  assert.equal(april.beginning + april.clearedTotal, april.statement);
  assert.deepEqual(april.outstanding.map((l) => l.id), ["c"], "dated in April, cleared only in May");
  assert.equal(april.outstandingTotal, -1_000);
});

test("a later statement begins from the earlier one, and other accounts stay out", () => {
  const may = reconciliationReport(lines, done, "may", 50_000);
  assert.equal(may.beginning, 57_500);
  assert.deepEqual(may.cleared.map((l) => l.id), ["c", "d", "e"]);
  assert.deepEqual(may.outstanding, []);
  assert.equal(may.beginning + may.clearedTotal, may.statement);
});

test("a card's statement is owed, so it reads negative", () => {
  assert.equal(reconciliationReport(lines, done, "card").statement, -1);
  assert.equal(reconciliationReport(lines, done, "missing"), null);
});
