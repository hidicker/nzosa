import test from "node:test";
import assert from "node:assert/strict";
import { beginningBalance, clearedLines, reconciliationFigures } from "../dist/index.js";

const t = (id, amount, account = "checking") => ({ id, amount, account });

test("a statement is finished when the books and the bank agree", () => {
  const lines = [t("a", 500000), t("b", -5455), t("c", 22500)];
  const f = reconciliationFigures(517045, false, 0, lines);
  assert.equal(f.ticked, 517045);
  assert.equal(f.difference, 0);
  assert.equal(reconciliationFigures(517045, false, 0, lines.slice(0, 2)).difference, 22500);
});

test("the next statement starts where the last ended", () => {
  const all = [t("a", 500000), t("b", -5455), t("c", 22500), t("x", 100, "savings")];
  const done = [{ id: "1", account: "checking", statementDate: "2026-06-30", statementBalance: 494545, owed: false, cleared: ["a", "b"], finishedAt: "" }];
  assert.deepEqual([...clearedLines(done, "checking")], ["a", "b"]);
  assert.equal(beginningBalance(all, done, "checking"), 494545);
  assert.equal(beginningBalance(all, done, "savings"), 0);
  assert.equal(beginningBalance(all, done, "checking", 1000), 495545);
});

test("a card's statement is what is owed, so it is turned round", () => {
  const f = reconciliationFigures(15772, true, 0, [t("m", -15772, "mastercard")]);
  assert.equal(f.statement, -15772);
  assert.equal(f.difference, 0);
});
