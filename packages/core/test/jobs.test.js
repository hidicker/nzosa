import { test } from "node:test";
import assert from "node:assert/strict";
import { jobColumns, jobProfitability, profitAndLossByClass } from "../dist/index.js";

const kindOf = (code) => (code.startsWith("2") ? "income" : code.startsWith("31") ? "direct" : code.startsWith("4") ? "expense" : null);
const journal = (transactionId, date, lines) => ({ transactionId, date, narration: "", source: "bank", taxBasis: "both", lines: lines.map(([accountCode, amount]) => ({ accountCode, accountName: accountCode, amount, taxType: "NONE", description: "" })) });
const journals = [
  journal("inv:INV-1", "2026-03-01", [["610", 115000], ["200", -100000], ["820", -15000]]),
  journal("inv:INV-1:paid:0", "2026-03-20", [["090", 115000], ["610", -115000]]),
  journal("t-timber", "2026-02-10", [["310", 30000], ["090", -30000]]),
  journal("t-skip", "2026-02-12", [["429", 5000], ["090", -5000]]),
  journal("t-other", "2026-02-12", [["429", 7000], ["090", -7000]]),
];
const held = {
  jobs: [
    { id: "j1", name: "Deck for the Smiths", customer: "Smith", status: "open", quoted: 125000 },
    { id: "j2", name: "Old fence", customer: "Jones", status: "closed" },
  ],
  assigned: { "inv:INV-1": "j1", "t-timber": "j1", "t-skip": "j1", gone: "nobody" },
};

test("a job's income, direct and other costs, profit, margin and share of the quote; payments go with their invoice", () => {
  const [deck, fence] = jobProfitability(journals, held, kindOf);
  assert.deepEqual(
    [deck.job.name, deck.income, deck.directCosts, deck.otherCosts, deck.profit, deck.margin, deck.ofQuote, deck.sources, deck.first, deck.last],
    ["Deck for the Smiths", 100000, 30000, 5000, 65000, 65, 80, 3, "2026-02-10", "2026-03-01"],
  );
  assert.deepEqual([fence.job.name, fence.income, fence.profit, fence.margin, fence.ofQuote], ["Old fence", 0, 0, null, null]);
});

test("by job name for the profit and loss by job, and nothing for a job that is gone", () => {
  const columns = profitAndLossByClass(journals, jobColumns(held), (code) => kindOf(code) !== null, { from: "2026-01-01", to: "2026-12-31" });
  assert.deepEqual(columns.map((c) => c.name), ["Deck for the Smiths", "Unclassified"]);
  assert.equal(columns[0].byAccount.get("200"), -100000);
});
