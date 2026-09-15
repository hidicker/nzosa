import assert from "node:assert/strict";
import test from "node:test";
import {
  agentStatementJournal,
  agentStatementProblems,
  agentStatementTotals,
  checkManualJournal,
} from "../dist/index.js";

const STATEMENT = {
  id: "s1",
  entity: "totara-place",
  agent: "Kowhai Property Management",
  from: "2025-04-01",
  to: "2025-12-31",
  heldCode: "Held by property manager - 615",
  heldAtStart: 50_000,
  income: [
    { code: "Rent - Totara Place - 210", description: "Rent", amount: 1_200_000 },
    { code: "Rent - Totara Place - 210", description: "Tenant reimbursements", amount: 20_000 },
  ],
  expenses: [
    { code: "Property management - 616", description: "Management fees", amount: 120_000 },
    { code: "Property repairs - 600", description: "Tap washer", amount: 30_000 },
  ],
  paidToOwner: 1_000_000,
  heldAtEnd: 120_000,
};

test("a statement adds up: held at the start, plus collected, less paid out, less paid to the owner", () => {
  const totals = agentStatementTotals(STATEMENT);
  assert.equal(totals.income, 1_220_000);
  assert.equal(totals.expenses, 150_000);
  assert.equal(totals.expectedHeldAtEnd, 120_000);
  assert.equal(totals.difference, 0);
  assert.deepEqual(agentStatementProblems(STATEMENT), []);
});

test("a statement that does not add up says by how much, and is not posted quietly", () => {
  const problems = agentStatementProblems({ ...STATEMENT, heldAtEnd: 119_000 });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /should be 1200\.00, not 1190\.00/);
  assert.ok(agentStatementProblems({ ...STATEMENT, heldCode: "" }).some((p) => /account/.test(p)));
  assert.ok(agentStatementProblems({ ...STATEMENT, from: "2026-01-01" }).some((p) => /ends before/.test(p)));
});

test("the journal posts what the agent did, and leaves the rest in the property manager account", () => {
  const journal = agentStatementJournal(STATEMENT);
  assert.equal(journal.date, "2025-12-31");
  assert.deepEqual(
    journal.lines.map((l) => [l.code, l.amount]),
    [
      ["Rent - Totara Place - 210", -1_200_000],
      ["Rent - Totara Place - 210", -20_000],
      ["Property management - 616", 120_000],
      ["Property repairs - 600", 30_000],
      ["Held by property manager - 615", 1_070_000],
    ],
  );
  assert.deepEqual(checkManualJournal(journal), [], "a balanced manual journal");
  // What the account holds at the end: the start, this journal, less the
  // owner's payments the bank carries.
  assert.equal(STATEMENT.heldAtStart + 1_070_000 - STATEMENT.paidToOwner, STATEMENT.heldAtEnd);
});
