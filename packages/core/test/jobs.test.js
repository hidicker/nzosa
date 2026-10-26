import assert from "node:assert/strict";
import test from "node:test";
import { jobAssignments, jobLabel, jobProfits } from "../dist/index.js";

// Invented customers and figures.
const journal = (id, date, lines) => ({ transactionId: id, date, narration: "", source: "invoice", taxBasis: "payments", lines });
const line = (accountCode, amount) => ({ accountCode, accountName: accountCode, amount, taxType: "NONE" });
const journals = [
  // The invoice: income 1,000 for the deck.
  journal("INV-0001", "2026-05-01", [line("610", 115000), line("200", -100000), line("820", -15000)]),
  // Its payment goes with it, and moves no income or cost.
  journal("INV-0001:paid:1", "2026-05-20", [line("610", -115000), line("090", 115000)]),
  // Timber for the deck, a bill.
  journal("BILL-0007", "2026-04-20", [line("800", -46000), line("310", 40000), line("820", 6000)]),
  // A bank line for screws.
  journal("t-55", "2026-04-22", [line("090", -5750), line("310", 5000), line("820", 750)]),
  // Not the deck's.
  journal("INV-0002", "2026-05-02", [line("610", 23000), line("200", -20000), line("820", -3000)]),
];
const held = {
  jobs: [
    { id: "j1", name: "Deck", customer: "Rata Builders" },
    { id: "j2", name: "Fence", customer: "Rata Builders", closed: true },
  ],
  assigned: { "INV-0001": "j1", "BILL-0007": "j1", "t-55": "j1" },
};
const side = (code) => (code === "200" ? "income" : code === "310" ? "cost" : null);

test("a job's income, costs and profit come from the sources given to it", () => {
  const [deck, fence] = jobProfits(journals, held, side);
  assert.deepEqual([deck.income, deck.costs, deck.profit, deck.sources], [100000, 45000, 55000, 3]);
  assert.equal(deck.margin, 0.55);
  assert.deepEqual([fence.income, fence.costs, fence.margin, fence.sources], [0, 0, null, 0]);
});

test("a span leaves out what fell outside it", () => {
  const [deck] = jobProfits(journals, held, side, { from: "2026-05-01", to: "2026-05-31" });
  assert.deepEqual([deck.income, deck.costs], [100000, 0]);
});

test("for a report by job, each source is headed by the job and whose it is", () => {
  assert.equal(jobLabel(held.jobs[0]), "Deck (Rata Builders)");
  assert.deepEqual(jobAssignments(held), { "INV-0001": "Deck (Rata Builders)", "BILL-0007": "Deck (Rata Builders)", "t-55": "Deck (Rata Builders)" });
});
