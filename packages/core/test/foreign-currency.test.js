import { test } from "node:test";
import assert from "node:assert/strict";
import { bookedTotal, foreignRate, inBooks, invoiceBalances, postInvoice, postLedger, trialBalance } from "../dist/index.js";

const usd = {
  number: "INV-200", kind: "sales", contact: "Acme Inc", reference: "", issued: "2026-03-01", due: "2026-03-31",
  total: 100000, tax: 0, paid: 0, outstanding: 0, currency: "USD", rate: 1.6543, status: "Awaiting Payment",
  lines: [
    { description: "Consulting", accountCode: "200", taxType: "Zero Rated", net: 60001, tax: 0, gross: 60001 },
    { description: "Travel", accountCode: "200", taxType: "Zero Rated", net: 39999, tax: 0, gross: 39999 },
  ],
};

test("the rate marks a document as foreign; none, or 1, is the books' own", () => {
  assert.equal(foreignRate(usd), 1.6543);
  assert.equal(foreignRate({}), null);
  assert.equal(foreignRate({ rate: 1 }), null);
  assert.equal(inBooks({}, 12345), 12345);
  assert.equal(inBooks(usd, 10000), 16543);
});

test("posted at its rate, line by line, the receivable taking exactly what the lines come to", () => {
  const journal = postInvoice(usd, { receivableCode: "610" });
  const lines = journal.lines.map((l) => [l.accountCode, l.amount]);
  assert.deepEqual(lines, [["610", 165430], ["200", -99260], ["200", -66170]]);
  assert.equal(bookedTotal(usd), 165430);
  assert.equal(journal.lines.reduce((s, l) => s + l.amount, 0), 0);
});

test("one payment in the books' currency settles it in full; the rate's difference goes to the exchange account", () => {
  const pay = { id: "p", date: "2026-03-28", account: "BNZ", amount: 170000, otherParty: "ACME", particulars: "", code: "", reference: "", description: "", currency: "NZD", source: "bank" };
  const journals = postLedger({
    transactions: [pay], codeOf: () => null, classify: () => ({ treatment: "out-of-scope", side: "none" }),
    chart: [], bankLabels: new Map(), byId: new Map([["p", pay]]),
    invoices: [usd], settled: new Map([["p", "INV-200"]]), transfers: {}, manualJournals: [],
    exchangeAccount: { code: "499", name: "Foreign Currency Gains and Losses" },
  });
  const all = journals.flatMap((j) => j.lines);
  const sum = (code) => all.filter((l) => l.accountCode === code).reduce((s, l) => s + l.amount, 0);
  assert.equal(sum("610"), 0, "receivable raised at the rate and cleared at the same");
  assert.equal(sum("499"), -4570, "a gain of 45.70: 1,700.00 arrived for 1,654.30 booked");
  assert.equal(trialBalance(journals).imbalance, 0);

  const balance = invoiceBalances([usd], [{ invoiceNumber: "INV-200", amount: 170000 }]).get("INV-200");
  assert.equal(balance.status, "paid");
  assert.equal(balance.remaining, 0);
});

test("a bill paid at a worse rate is a loss; one with no payment is still owed in its own currency", () => {
  const bill = { ...usd, number: "B-1", kind: "purchase", rate: 1.5, lines: [{ ...usd.lines[0], net: 10000, gross: 10000 }], total: 10000 };
  const pay = { id: "q", date: "2026-03-28", account: "BNZ", amount: -16000, otherParty: "", particulars: "", code: "", reference: "", description: "", currency: "NZD", source: "bank" };
  const journals = postLedger({
    transactions: [pay], codeOf: () => null, classify: () => ({ treatment: "out-of-scope", side: "none" }),
    chart: [], bankLabels: new Map(), byId: new Map([["q", pay]]),
    invoices: [bill], settled: new Map([["q", "B-1"]]), transfers: {}, manualJournals: [],
    exchangeAccount: { code: "499", name: "FX" },
  });
  const all = journals.flatMap((j) => j.lines);
  assert.equal(all.filter((l) => l.accountCode === "800").reduce((s, l) => s + l.amount, 0), 0);
  assert.equal(all.filter((l) => l.accountCode === "499").reduce((s, l) => s + l.amount, 0), 1000, "a loss of 10.00");
  assert.equal(invoiceBalances([bill], []).get("B-1").remaining, 10000);
});

test("the aged report owes a document in another currency at what it was booked at, and nothing once paid", async () => {
  const { agedReport } = await import("../dist/index.js");
  const unpaid = agedReport({ invoices: [usd], kind: "sales", payments: [], asAt: "2026-04-15" });
  assert.equal(unpaid.contacts[0].total, 165430);
  assert.equal(unpaid.total, 165430);
  const paid = agedReport({ invoices: [usd], kind: "sales", payments: [{ invoiceNumber: "INV-200", amount: 170000, date: "2026-03-28" }], asAt: "2026-04-15" });
  assert.equal(paid.contacts.length, 0);
});
