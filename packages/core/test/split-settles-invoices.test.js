import assert from "node:assert/strict";
import test from "node:test";
import { expandSplits, postInvoice, postTransaction, splitPartId } from "../dist/index.js";

const payment = {
  id: "pay1", date: "2026-04-05", account: "02-1100-0022001-001", amount: 80000,
  otherParty: "SAMPLE CUSTOMER #9001/9002", particulars: "", reference: "", otherPartyAccount: "",
  source: "bnz", extras: {},
};

const invoice = (number, total) => ({
  number, kind: "sales", contact: "Sample Customer", issued: "2026-03-30", total,
  lines: [{
    accountCode: "200", description: "Course", net: Math.round(total / 1.15),
    tax: total - Math.round(total / 1.15), gross: total, taxType: "15% GST on Income",
  }],
});

const INV_A = invoice("INV-9001", 50000);
const INV_B = invoice("INV-9002", 30000);

/** One payment divided so each part settles its own invoice. */
const splits = {
  pay1: [
    { amount: 50000, treatment: "standard", side: "sales", note: "Settles INV-9001", code: "Sales - 200" },
    { amount: 30000, treatment: "standard", side: "sales", note: "Settles INV-9002", code: "Sales - 200" },
  ],
};
const matches = { [splitPartId("pay1", 0)]: "INV-9001", [splitPartId("pay1", 1)]: "INV-9002" };

const journals = () => {
  const expanded = expandSplits([payment], splits, {});
  const out = [postInvoice(INV_A), postInvoice(INV_B)];
  for (const t of expanded.transactions) {
    const number = matches[t.id];
    const inv = number === "INV-9001" ? INV_A : number === "INV-9002" ? INV_B : undefined;
    assert.ok(inv, `every part settles an invoice, but ${t.id} did not`);
    out.push(postTransaction(t, [], {
      settles: { number: inv.number, kind: inv.kind, taxType: "OUTPUT2", total: inv.total },
    }));
  }
  return out;
};

const sum = (lines) => lines.reduce((total, l) => total + l.amount, 0);

test("a payment split across two invoices replaces the payment, it does not join it", () => {
  const expanded = expandSplits([payment], splits, {});
  assert.equal(expanded.transactions.length, 2, "the parent is replaced by its parts");
  assert.equal(sum(expanded.transactions), payment.amount, "the parts are the payment");
});

test("each part clears its own receivable, and every journal balances", () => {
  for (const journal of journals()) {
    assert.equal(sum(journal.lines), 0, `journal ${journal.transactionId ?? "invoice"} does not balance`);
  }
});

test("the whole ledger is flat: two invoices raised, one payment settling both", () => {
  const all = journals().flatMap((j) => j.lines);
  assert.equal(sum(all), 0, "trial balance is not flat");

  // Receivables must come back to nothing: raised 800.00, cleared 800.00.
  const receivable = all.filter((l) => l.accountCode === "610");
  assert.equal(sum(receivable), 0, "Accounts Receivable does not clear");
  assert.equal(receivable.filter((l) => l.amount > 0).reduce((t, l) => t + l.amount, 0), 80000);
});

test("the sale is counted once, on the invoices, never again on the payment", () => {
  const all = journals().flatMap((j) => j.lines);
  const sales = all.filter((l) => l.accountCode === "200");
  // Both invoices credit sales; nothing else touches it. A part carrying a code
  // as well as an invoice must not post that code -- the settles branch wins.
  assert.equal(sales.length, 2, "only the two invoices post to sales");
  assert.equal(sum(sales), -(Math.round(50000 / 1.15) + Math.round(30000 / 1.15)));
});

test("the bank receives exactly what arrived", () => {
  const all = journals().flatMap((j) => j.lines);
  const bank = all.filter((l) => l.accountCode === payment.account);
  assert.equal(sum(bank), payment.amount, "the bank side is not the payment");
  assert.equal(bank.length, 2, "one bank line per part");
});
