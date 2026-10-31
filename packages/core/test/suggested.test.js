import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addSuggestedSet,
  readSuggestedFile,
  suggestedSetId,
  suggesterName,
  suggestionKey,
  suggestionsWaiting,
  SUGGESTED_SETS_KEPT,
} from "../dist/index.js";

const fuel = { kind: "coding", transaction: "t1", code: "Motor Vehicle Expenses - 449", because: "fuel" };
const rent = { kind: "coding", transaction: "t2", code: "Rent - 469", because: "landlord" };

test("a set is named by what is in it, and the same set is kept once", () => {
  assert.equal(suggestedSetId([fuel]), suggestedSetId([{ ...fuel }]));
  assert.notEqual(suggestedSetId([fuel]), suggestedSetId([rent]));
  const first = addSuggestedSet(readSuggestedFile(undefined), [fuel], "claude-ai", "2026-10-31T09:00:00Z");
  assert.equal(first.already, false);
  const again = addSuggestedSet(first.file, [fuel], "claude-ai", "2026-10-31T09:05:00Z");
  assert.equal(again.already, true);
  assert.equal(again.file.sets.length, 1);
  assert.equal(again.set.at, "2026-10-31T09:00:00Z");
});

test("newest first, and only so many kept", () => {
  let file = readSuggestedFile({ sets: [] });
  for (let i = 0; i < SUGGESTED_SETS_KEPT + 5; i++) {
    file = addSuggestedSet(file, [{ ...fuel, because: `n${i}` }], "x", `t${i}`).file;
  }
  assert.equal(file.sets.length, SUGGESTED_SETS_KEPT);
  assert.equal(file.sets[0].items[0].because, `n${SUGGESTED_SETS_KEPT + 4}`);
});

test("waiting leaves out what was used, declined or passed over, oldest first", () => {
  const a = addSuggestedSet(readSuggestedFile(null), [fuel, rent], "x", "1");
  const b = addSuggestedSet(a.file, [{ ...rent, because: "again" }], "x", "2");
  const waiting = suggestionsWaiting(b.file, { [suggestionKey(a.set.id, 0)]: "used" });
  assert.deepEqual(waiting.map((w) => w.item.because), ["landlord", "again"]);
});

test("a file that is not one is read as empty", () => {
  assert.deepEqual(readSuggestedFile("nonsense"), { version: 1, sets: [] });
  assert.deepEqual(readSuggestedFile({ sets: [null, { items: [] }] }).sets.length, 1);
});

test("the app is named as a person would name it", () => {
  assert.equal(suggesterName("claude-ai"), "Claude");
  assert.equal(suggesterName("Claude Desktop"), "Claude");
  assert.equal(suggesterName("cursor-vscode"), "Cursor");
  assert.equal(suggesterName(""), "your AI app");
});
