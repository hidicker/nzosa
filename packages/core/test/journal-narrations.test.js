import assert from "node:assert/strict";
import test from "node:test";
import { mergeJournalNarrations, narratedJournalsLost } from "../dist/index.js";

const journal = (id, narration, over = {}) => ({
  id, date: "2026-03-31", narration, postedDate: null, postedBy: "",
  lines: [{ accountCode: "200", accountName: "Sales", description: "", amount: 100, line: 1 }],
  ...over,
});

test("a narration is carried onto the report that has none", () => {
  // General Ledger Detail values every line and carries no Narration column.
  // Loading it over the Journal Report used to lose every manual journal
  // silently -- on real books three of them, and 3,354.78 of interest that
  // came back as an expense.
  const held = [journal("3463", "YE26 - Remove interest expense - Manual")];
  const incoming = [journal("3463", "")];
  const { journals, carried } = mergeJournalNarrations(incoming, held);
  assert.equal(carried, 1);
  assert.equal(journals[0].narration, "YE26 - Remove interest expense - Manual");
});

test("the incoming values are the ones kept", () => {
  // The whole reason to load the other report is that it prices each line.
  const held = [journal("3463", "YE26 - Manual")];
  const incoming = [journal("3463", "", {
    lines: [{ accountCode: "200", accountName: "Sales", description: "", amount: 3354_78, line: 9 }],
  })];
  const { journals } = mergeJournalNarrations(incoming, held);
  assert.equal(journals[0].lines[0].amount, 335478, "the value comes from the incoming report");
  assert.equal(journals[0].narration, "YE26 - Manual", "the narration from the one held");
});

test("a narration the incoming report states is not overwritten", () => {
  // A report that says something is describing the journal it is describing.
  const held = [journal("3463", "the older account of it")];
  const incoming = [journal("3463", "what this report says")];
  const { journals, carried } = mergeJournalNarrations(incoming, held);
  assert.equal(journals[0].narration, "what this report says");
  assert.equal(carried, 0);
});

test("a journal nothing was held for is taken as it stands", () => {
  const { journals, carried } = mergeJournalNarrations([journal("999", "")], [journal("111", "x")]);
  assert.equal(journals.length, 1);
  assert.equal(journals[0].narration, "");
  assert.equal(carried, 0);
});

test("who posted it, and when, are carried on the same rule", () => {
  const held = [journal("3463", "YE26", { postedBy: "Ana", postedDate: "2026-04-02" })];
  const incoming = [journal("3463", "")];
  const { journals } = mergeJournalNarrations(incoming, held);
  assert.equal(journals[0].postedBy, "Ana");
  assert.equal(journals[0].postedDate, "2026-04-02");
});

test("nothing is carried when there is nothing to carry", () => {
  const { journals, carried } = mergeJournalNarrations([journal("1", "")], [journal("1", "   ")]);
  assert.equal(carried, 0);
  assert.equal(journals[0].narration.trim(), "");
});

test("a narrated journal the incoming report does not mention is reported as lost", () => {
  // Replacing is usually right -- a fresh export of the same period -- but one
  // year loaded over a file holding two drops the other without saying so.
  const held = [journal("3463", "YE26 - Manual"), journal("2000", "YE25 - Manual"), journal("1", "")];
  const incoming = [journal("3463", "")];
  const lost = narratedJournalsLost(incoming, held);
  assert.deepEqual(lost.map((j) => j.id), ["2000"], "only the narrated one that is going");
});

test("nothing is lost when the incoming report covers everything held", () => {
  const held = [journal("1", "a"), journal("2", "b")];
  const incoming = [journal("1", ""), journal("2", ""), journal("3", "")];
  assert.deepEqual(narratedJournalsLost(incoming, held), []);
});
