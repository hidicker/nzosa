import assert from "node:assert/strict";
import test from "node:test";
import { checkManualJournal, postManualJournal, manualJournalsIn } from "../dist/index.js";

const GOOD = {
  id: "3463",
  date: "2026-03-31",
  narration: "YE26 - Remove interest expense. This is not a loan from directors its personal",
  lines: [
    { code: "Interest Expense - 437", amount: -335478 },
    { code: "Owner Drawings - 980", amount: 335478 },
  ],
};

test("a balanced journal with a reason is accepted and posts", () => {
  assert.deepEqual(checkManualJournal(GOOD), []);
  const posted = postManualJournal(GOOD);
  assert.equal(posted.lines.reduce((s, l) => s + l.amount, 0), 0);
  assert.equal(posted.source, "manual");
  assert.equal(posted.narration, GOOD.narration);
});

test("an unbalanced journal is refused, not posted with the difference hidden", () => {
  const broken = { ...GOOD, lines: [{ code: "437", amount: -335478 }, { code: "980", amount: 300000 }] };
  const problems = checkManualJournal(broken);
  assert.equal(problems.length, 1);
  assert.match(problems[0].message, /does not balance/);
  assert.equal(postManualJournal(broken), null, "the second gate refuses it too");
});

test("a journal with no reason is refused", () => {
  // Required, and not out of tidiness: a journal nobody can explain is one
  // nobody can defend.
  const problems = checkManualJournal({ ...GOOD, narration: "   " });
  assert.match(problems[0].message, /narration/);
});

test("one line is not a journal", () => {
  const problems = checkManualJournal({ ...GOOD, lines: [{ code: "437", amount: 0 }] });
  assert.ok(problems.some((p) => /at least two lines/.test(p.message)));
});

test("a manual journal carries no GST of its own", () => {
  // The tax went with the entry being corrected; putting a rate on the
  // correction would claim it twice.
  const posted = postManualJournal(GOOD);
  assert.ok(posted.lines.every((l) => l.taxType === "NONE"));
});

const report = (id, narration, lines) => ({
  id, date: "2026-03-31", narration, postedDate: null, postedBy: "",
  lines: lines.map(([accountCode, accountName, amount]) => ({
    accountCode, accountName, description: "", amount,
  })),
});

test("manual journals are picked out of a report, and the marker is not kept", () => {
  const found = manualJournalsIn([
    report("3463", "YE26 - Remove interest expense - Manual", [["437", "Interest Expense", -335478], ["980", "Owner Drawings", 335478]]),
    report("3400", "Sales invoice INV-0101", [["610", "Accounts Receivable", 10000], ["200", "Sales", -10000]]),
  ]);
  assert.equal(found.length, 1, "only the manual one");
  assert.equal(found[0].narration, "YE26 - Remove interest expense", "the source marker is not what a person wrote");
  assert.equal(found[0].lines[0].code, "Interest Expense - 437");
});

test("a journal that was reversed is not imported", () => {
  // Importing it would apply the correction and never the reversal, which is
  // the one combination that is worse than importing neither.
  const found = manualJournalsIn([
    report("3349", "YE26 - Record GST refund - Manual", [["820", "GST", 1000], ["980", "Owner Drawings", -1000]]),
    report("3350", "Reversed: YE26 - Record GST refund - Manual, Reversal of ID 3349", [["820", "GST", -1000], ["980", "Owner Drawings", 1000]]),
  ]);
  assert.deepEqual(found, []);
});

test("the reversal itself is not imported either", () => {
  const found = manualJournalsIn([
    report("3350", "Reversed: something - Manual, Reversal of ID 9999", [["820", "GST", -1000], ["980", "X", 1000]]),
  ]);
  assert.deepEqual(found, []);
});

test("what comes out of a report still has to balance", () => {
  const found = manualJournalsIn([
    report("3463", "YE26 - Remove interest expense - Manual", [["437", "Interest Expense", -335478], ["980", "Owner Drawings", 335478]]),
  ]);
  assert.deepEqual(checkManualJournal(found[0]), []);
});
