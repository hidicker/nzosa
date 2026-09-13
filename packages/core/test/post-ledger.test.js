import assert from "node:assert/strict";
import test from "node:test";
import { postLedger, trialBalance } from "../dist/index.js";

const txn = (over) => ({
  id: over.id, date: over.date ?? "2025-06-01", account: over.account ?? "BNZ 01",
  amount: over.amount, otherParty: over.who ?? "Somebody", particulars: "",
  code: "", reference: "", description: "", currency: "NZD", source: "bank",
});

const CHART = [
  { code: "090", name: "BNZ 01", type: "Bank", taxCode: "No GST", description: "" },
  { code: "200", name: "Sales", type: "Revenue", taxCode: "15% GST on Income", description: "" },
  { code: "610", name: "Accounts Receivable", type: "Current Asset", taxCode: "No GST", description: "" },
];

const standard = { treatment: "standard", side: "sales" };
const base = (over = {}) => ({
  transactions: [], codeOf: () => "200 Sales", classify: () => standard,
  chart: CHART, bankLabels: new Map(), byId: new Map(),
  invoices: [], settled: new Map(), transfers: {}, manualJournals: [], ...over,
});

const INVOICE = {
  number: "INV-0001", kind: "sales", contact: "Sample Customer", reference: "", issued: "2025-05-01",
  due: "2025-05-15", total: 115000, tax: 15000, paid: 115000, outstanding: 0, currency: "NZD",
  status: "Paid", lines: [{ description: "Work", accountCode: "200", taxType: "15% GST on Income",
    gross: 115000, tax: 15000, net: 100000 }],
};

test("nothing in, nothing out", () => {
  assert.deepEqual(postLedger(base()), []);
});

test("every journal balances, and so does the ledger", () => {
  const t = txn({ id: "a", amount: 115000 });
  const journals = postLedger(base({ transactions: [t], byId: new Map([["a", t]]) }));
  for (const j of journals) {
    assert.equal(j.lines.reduce((s, l) => s + l.amount, 0), 0, j.narration ?? j.transactionId);
  }
  assert.equal(trialBalance(journals).imbalance, 0);
});

test("a receipt that settles an invoice does not credit income again", () => {
  // The invoice already recorded the sale. Coding the receipt to income too
  // counts the same money twice -- on one real ledger, a third of the year's.
  const t = txn({ id: "pay", amount: 115000 });
  const journals = postLedger(base({
    transactions: [t], byId: new Map([["pay", t]]),
    invoices: [INVOICE], settled: new Map([["pay", "INV-0001"]]),
  }));
  const salesLines = journals.flatMap((j) => j.lines).filter((l) => l.accountCode === "200");
  assert.equal(salesLines.length, 1, "income is recorded once, by the invoice");

  const receivable = journals
    .flatMap((j) => j.lines)
    .filter((l) => l.accountCode === "610")
    .reduce((s, l) => s + l.amount, 0);
  assert.equal(receivable, 0, "the invoice raised the debtor and the receipt cleared it");
});

test("without the match, the same receipt does credit income - and doubles it", () => {
  // The failure this guards, stated as a test so the guard cannot be removed
  // quietly: the only difference is whether the receipt is matched.
  const t = txn({ id: "pay", amount: 115000 });
  const journals = postLedger(base({
    transactions: [t], byId: new Map([["pay", t]]), invoices: [INVOICE], settled: new Map(),
  }));
  const salesLines = journals.flatMap((j) => j.lines).filter((l) => l.accountCode === "200");
  assert.equal(salesLines.length, 2, "once from the invoice, once from the receipt");
});

test("a transfer is posted once, from the leg the money left", () => {
  const out = txn({ id: "out", amount: -50000, account: "BNZ 01" });
  const back = txn({ id: "in", amount: 50000, account: "BNZ Visa" });
  const journals = postLedger(base({
    transactions: [out, back],
    byId: new Map([["out", out], ["in", back]]),
    transfers: { out: "in", in: "out" },
  }));
  assert.equal(journals.length, 1, "one journal for two bank lines");
  assert.equal(journals[0].lines.reduce((s, l) => s + l.amount, 0), 0);
});

test("neither leg of a transfer is also posted as an ordinary coding", () => {
  // Posted separately as well, the movement is counted twice and shows up as
  // income on the receiving side.
  const out = txn({ id: "out", amount: -50000 });
  const back = txn({ id: "in", amount: 50000, account: "BNZ Visa" });
  const journals = postLedger(base({
    transactions: [out, back],
    byId: new Map([["out", out], ["in", back]]),
    transfers: { out: "in", in: "out" },
  }));
  const sales = journals.flatMap((j) => j.lines).filter((l) => l.accountCode === "200");
  assert.deepEqual(sales, [], "no income from either leg");
});

test("judgements come last, because they correct what is above them", () => {
  const t = txn({ id: "a", amount: 115000 });
  const journals = postLedger(base({
    transactions: [t], byId: new Map([["a", t]]),
    manualJournals: [{
      id: "1", date: "2026-03-31", narration: "YE26 - reclassify",
      lines: [{ code: "200 Sales", amount: -1000 }, { code: "610 Accounts Receivable", amount: 1000 }],
    }],
  }));
  assert.equal(journals[journals.length - 1].source, "manual");
});

test("an unbalanced judgement is refused, not posted with the difference hidden", () => {
  const t = txn({ id: "a", amount: 115000 });
  const journals = postLedger(base({
    transactions: [t], byId: new Map([["a", t]]),
    manualJournals: [{
      id: "1", date: "2026-03-31", narration: "wrong",
      lines: [{ code: "200", amount: -1000 }, { code: "610", amount: 500 }],
    }],
  }));
  assert.ok(!journals.some((j) => j.source === "manual"), "refused");
  assert.equal(trialBalance(journals).imbalance, 0, "and the ledger still balances");
});
