import assert from "node:assert/strict";
import test from "node:test";
import { isGstControlCode, postLedger, taxSummary } from "../dist/index.js";

// Two GST-registered entities in one set of books, each with its own GST
// control account, as Standard accounts gives them: 820KC and 820MS.
const CHART = [
  { code: "200KC", name: "Sales", type: "Revenue", taxCode: "15% GST on Income", description: "" },
  { code: "220MS", name: "Rent received", type: "Revenue", taxCode: "15% GST on Income", description: "" },
  { code: "610KC", name: "Accounts Receivable", type: "Current Asset", taxCode: "No GST", description: "" },
  { code: "820KC", name: "GST", type: "Current Liability", taxCode: "No GST", description: "" },
  { code: "820MS", name: "GST - shop", type: "Current Liability", taxCode: "No GST", description: "" },
];
const OWN = { "200KC": "820KC", "610KC": "820KC", "220MS": "820MS" };
const gstAccountFor = (code) => {
  const own = OWN[code];
  return own === undefined ? undefined : { code: own, name: CHART.find((a) => a.code === own).name };
};

const txn = (id, amount, code) => ({
  id, date: "2025-06-01", account: "BNZ 01", amount, otherParty: "Somebody", particulars: "",
  code: "", reference: "", description: "", currency: "NZD", source: "bank", wanted: code,
});
const base = (over = {}) => ({
  transactions: [], codeOf: (t) => t.wanted, classify: () => ({ treatment: "standard", side: "sales" }),
  chart: CHART, bankLabels: new Map(), byId: new Map(), invoices: [], settled: new Map(),
  transfers: {}, manualJournals: [], gstAccount: { code: "820KC", name: "GST" }, gstAccountFor, ...over,
});
const totalIn = (journals, code) =>
  journals.flatMap((j) => j.lines).filter((l) => l.accountCode === code).reduce((s, l) => s + l.amount, 0);

test("820 with or without an entity's suffix is a GST control account", () => {
  for (const code of ["820", "820KC", "820MS", "820ABC", " 820MS "]) assert.equal(isGstControlCode(code), true, code);
  for (const code of ["8200", "820ms", "820ABCD", "821", "200KC", "GST"]) assert.equal(isGstControlCode(code), false, code);
});

test("each entity's GST is posted to its own control account", () => {
  const sale = txn("sale", 115000, "Sales - 200KC");
  const rent = txn("rent", 230000, "Rent received - 220MS");
  const journals = postLedger(base({ transactions: [sale, rent], byId: new Map([["sale", sale], ["rent", rent]]) }));
  assert.equal(totalIn(journals, "820KC"), -15000, "the company's GST in 820KC");
  assert.equal(totalIn(journals, "820MS"), -30000, "the shop's GST in 820MS");
  assert.equal(totalIn(journals, "820"), 0, "nothing in a plain 820 the chart does not have");
});

test("the GST return reads every entity's GST account", () => {
  const sale = txn("sale", 115000, "Sales - 200KC");
  const rent = txn("rent", 230000, "Rent received - 220MS");
  const journals = postLedger(base({ transactions: [sale, rent], byId: new Map([["sale", sale], ["rent", rent]]) }));
  const summary = taxSummary(journals);
  assert.equal(summary.box5, 345000);
  assert.equal(summary.box8, 45000);
});

test("an invoice's GST goes to its own entity's account too", () => {
  const invoice = {
    number: "INV-1", kind: "sales", contact: "Florist", reference: "", issued: "2025-05-01", due: "2025-05-15",
    total: 230000, tax: 30000, paid: 0, outstanding: 230000, currency: "NZD", status: "Awaiting Payment",
    lines: [{ description: "Rent", accountCode: "220MS", taxType: "15% GST on Income", gross: 230000, tax: 30000, net: 200000 }],
  };
  const sale = txn("sale", 115000, "Sales - 200KC");
  const journals = postLedger(base({ transactions: [sale], byId: new Map([["sale", sale]]), invoices: [invoice] }));
  assert.equal(totalIn(journals, "820MS"), -30000);
});

test("with one GST account and no lookup, GST still goes to 820", () => {
  const sale = txn("sale", 115000, "Sales - 200KC");
  const journals = postLedger(base({
    transactions: [sale], byId: new Map([["sale", sale]]), gstAccount: undefined, gstAccountFor: undefined,
  }));
  assert.equal(totalIn(journals, "820"), -15000);
});
