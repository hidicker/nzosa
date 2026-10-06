import assert from "node:assert/strict";
import test from "node:test";
import {
  agedReport,
  billWarnings,
  documentStatus,
  gstReturn,
  invoiceBalances,
  outsidePaymentJournals,
  outsidePurchases,
  postLedger,
  standardAccounts,
  trialBalance,
} from "../dist/index.js";

// Invented suppliers and figures throughout.
const bill = (over = {}) => ({
  number: "BILL-0001", kind: "purchase", contact: "Kowhai Plumbing", reference: "K-101",
  issued: "2025-05-01", due: "2025-05-20", total: 11500, tax: 1500, paid: 0, outstanding: 0,
  currency: "NZD", status: "Awaiting Payment",
  lines: [{ description: "Tap washer", accountCode: "473", taxType: "15% GST on Expenses",
    gross: 11500, tax: 1500, net: 10000 }],
  ...over,
});

const balanceOf = (doc, assignments = []) =>
  invoiceBalances([doc], assignments).get(doc.number);

test("a bill's status: draft and voided are decisions, the rest are the money", () => {
  assert.equal(documentStatus(balanceOf(bill({ status: "Draft" })), "2025-05-10"), "Draft");
  assert.equal(documentStatus(balanceOf(bill({ status: "Voided" })), "2025-05-10"), "Voided");
  assert.equal(documentStatus(balanceOf(bill()), "2025-05-10"), "Awaiting payment");
  assert.equal(documentStatus(balanceOf(bill()), "2025-05-21"), "Overdue");
  assert.equal(
    documentStatus(balanceOf(bill(), [{ invoiceNumber: "BILL-0001", amount: -5000 }]), "2025-05-10"),
    "Part paid",
  );
  assert.equal(
    documentStatus(balanceOf(bill(), [{ invoiceNumber: "BILL-0001", amount: -11500 }]), "2025-06-10"),
    "Paid",
  );
});

test("a payment outside the bank lines settles the bill", () => {
  const paid = bill({ paidOutside: [{ date: "2025-05-05", amount: 11500, accountCode: "881" }] });
  const balance = balanceOf(paid);
  assert.equal(balance.remaining, 0);
  assert.equal(balance.paidOutside, 11500);
  assert.equal(balance.status, "paid");
});

test("paid by a shareholder: payable cleared against their account, tax where it fell due", () => {
  const paid = bill({ paidOutside: [{ date: "2025-05-05", amount: 11500, accountCode: "881", note: "Paid by Ana" }] });
  const [journal] = outsidePaymentJournals(paid, { control: { code: "800", name: "Accounts Payable" } });
  assert.equal(journal.lines.reduce((s, l) => s + l.amount, 0), 0);
  const payable = journal.lines.find((l) => l.accountCode === "800");
  assert.equal(payable.amount, 11500, "debit the payable");
  assert.equal(payable.taxType, "INPUT2");
  assert.equal(payable.taxBase, -11500, "money out, as a settling bank line has it");
  assert.equal(journal.lines.find((l) => l.accountCode === "881").amount, -11500);
  assert.equal(journal.taxBasis, "payments");
  assert.equal(journal.date, "2025-05-05");
});

test("a draft bill's payments post nothing, as the draft does not", () => {
  const draft = bill({ status: "Draft", paidOutside: [{ date: "2025-05-05", amount: 11500, accountCode: "881" }] });
  assert.deepEqual(outsidePaymentJournals(draft, { control: { code: "800", name: "AP" } }), []);
});

test("the ledger posts the bill to its entity's payable, and the payment clears the same one", () => {
  const t = { id: "pay", date: "2025-05-10", account: "BNZ 01", amount: -11500, otherParty: "Kowhai",
    particulars: "", code: "", reference: "", description: "", currency: "NZD", source: "bank" };
  const journals = postLedger({
    transactions: [t], codeOf: () => null, classify: () => ({ treatment: "standard", side: "purchases" }),
    chart: [], bankLabels: new Map(), byId: new Map([["pay", t]]),
    invoices: [bill({ entityId: "shop" })], settled: new Map([["pay", "BILL-0001"]]),
    transfers: {}, manualJournals: [],
    controlFor: (doc) => (doc.entityId === "shop" ? { code: "800TS", name: "Accounts Payable" } : undefined),
  });
  const lines = journals.flatMap((j) => j.lines);
  assert.equal(lines.filter((l) => l.accountCode === "800").length, 0, "not the shared 800");
  const payable = lines.filter((l) => l.accountCode === "800TS").reduce((s, l) => s + l.amount, 0);
  assert.equal(payable, 0, "raised by the bill, cleared by the payment");
  assert.equal(trialBalance(journals).imbalance, 0);
});

test("outside payments reach the ledger through postLedger", () => {
  const t = { id: "x", date: "2025-05-10", account: "BNZ 01", amount: 100, otherParty: "",
    particulars: "", code: "", reference: "", description: "", currency: "NZD", source: "bank" };
  const journals = postLedger({
    transactions: [t], codeOf: () => "200", classify: () => ({ treatment: "out-of-scope", side: "none" }),
    chart: [], bankLabels: new Map(), byId: new Map([["x", t]]),
    invoices: [bill({ paidOutside: [{ date: "2025-05-05", amount: 11500, accountCode: "881" }] })],
    settled: new Map(), transfers: {}, manualJournals: [],
  });
  const payable = journals.flatMap((j) => j.lines).filter((l) => l.accountCode === "800")
    .reduce((s, l) => s + l.amount, 0);
  assert.equal(payable, 0);
  assert.equal(trialBalance(journals).imbalance, 0);
});

test("GST on a bill paid outside the bank is claimed when paid, in the bill's proportion", () => {
  // Rates carry no GST; the repair does. Half paid claims half of the repair's tax.
  const mixed = bill({
    total: 21500, tax: 1500,
    lines: [
      { description: "Repair", accountCode: "473", taxType: "15% GST on Expenses", gross: 11500, tax: 1500, net: 10000 },
      { description: "Rates", accountCode: "420", taxType: "No GST", gross: 10000, tax: 0, net: 10000 },
    ],
    paidOutside: [{ date: "2025-06-02", amount: 10750, accountCode: "881" }],
  });
  const period = { from: "2025-06-01", to: "2025-07-31" };
  assert.deepEqual(outsidePurchases([mixed], period), [
    { gross: 5750, gst: 750, date: "2025-06-02", label: "BILL-0001 Kowhai Plumbing" },
  ]);
  assert.deepEqual(outsidePurchases([mixed], { from: "2025-04-01", to: "2025-05-31" }), []);
  assert.deepEqual(outsidePurchases([{ ...mixed, status: "Draft" }], period), []);

  const result = gstReturn([], { from: period.from, to: period.to }, {
    resolve: () => ({ treatment: "standard", side: "purchases" }),
    basis: "payments",
    otherPurchases: outsidePurchases([mixed], period),
  });
  assert.equal(result.boxes.box12, 750);
  assert.equal(result.boxes.box11, 5750);
  assert.equal(result.otherPurchases.length, 1, "listed with the return, so the lines add up to the box");
});

test("aged payables: owing on the day asked, by days past due", () => {
  const docs = [
    bill({ number: "B1", contact: "Kowhai Plumbing", issued: "2025-01-10", due: "2025-01-20", total: 1000, tax: 0 }),
    bill({ number: "B2", contact: "Kowhai Plumbing", issued: "2025-03-01", due: "2025-03-20", total: 2000, tax: 0 }),
    bill({ number: "B3", contact: "Rimu Electrical", issued: "2025-03-25", due: "2025-04-20", total: 3000, tax: 0 }),
    bill({ number: "B4", contact: "Rimu Electrical", issued: "2025-03-26", due: null, total: 500, tax: 0, status: "Draft" }),
    bill({ number: "B5", contact: "Totara Supplies", issued: "2025-04-02", due: "2025-04-20", total: 700, tax: 0 }),
  ];
  const report = agedReport({
    invoices: docs, kind: "purchase", asAt: "2025-03-31",
    // Paid after the day asked about, so still owing then.
    payments: [{ invoiceNumber: "B2", date: "2025-04-03", amount: -2000 }],
  });
  assert.equal(report.total, 6000, "B1 + B2 + B3; not the draft, not next month's bill");
  const kowhai = report.contacts.find((c) => c.contact === "Kowhai Plumbing");
  assert.equal(kowhai.buckets["61-90"], 1000, "B1 is 70 days past due");
  assert.equal(kowhai.buckets["1-30"], 2000, "B2 is 11 days past due");
  assert.equal(report.contacts.find((c) => c.contact === "Rimu Electrical").buckets.current, 3000);

  const later = agedReport({
    invoices: docs, kind: "purchase", asAt: "2025-04-30",
    payments: [{ invoiceNumber: "B2", date: "2025-04-03", amount: -2000 }],
  });
  assert.equal(later.total, 1000 + 3000 + 700);
});

test("aged payables: an unapplied credit note reduces what is owed, an applied one is in its bill", () => {
  const docs = [
    bill({ number: "B1", total: 5000, tax: 0 }),
    bill({ number: "CN1", total: -1000, tax: 0, issued: "2025-05-02" }),
    bill({ number: "CN2", total: -500, tax: 0, issued: "2025-05-03" }),
  ];
  const report = agedReport({
    invoices: docs, kind: "purchase", asAt: "2025-05-10", payments: [], credits: { CN1: "B1" },
  });
  assert.equal(report.total, 5000 - 1000 - 500);
  const items = report.contacts[0].items.map((i) => [i.invoice.number, i.owing]);
  assert.deepEqual(items, [["B1", 4000], ["CN2", -500]]);
});

test("bill warnings: lines, GST, due date and the same bill twice", () => {
  assert.deepEqual(billWarnings(bill(), []), []);
  const fields = (w) => w.map((x) => x.field).sort();
  assert.deepEqual(fields(billWarnings(bill({ total: 12000 }), [])), ["lines"]);
  const wrongTax = bill({ lines: [{ description: "Tap", accountCode: "473", taxType: "15% GST on Expenses",
    gross: 11500, tax: 1200, net: 10300 }] });
  assert.deepEqual(fields(billWarnings(wrongTax, [])), ["tax"]);
  assert.deepEqual(fields(billWarnings(bill({ due: "2025-04-01" }), [])), ["due"]);
  const twin = bill({ number: "BILL-0002" });
  assert.deepEqual(fields(billWarnings(twin, [bill()])), ["duplicate"]);
  assert.deepEqual(billWarnings(twin, [bill({ status: "Voided" })]), [], "a voided one is not a twin");
});

test("a commercial rental's standard accounts include Accounts Payable", () => {
  const set = standardAccounts("commercial", { suffix: "TS" });
  assert.ok(set.some((a) => a.code === "800TS" && a.type === "Accounts Payable"));
  assert.ok(!standardAccounts("residential").some((a) => a.type === "Accounts Payable"));
});
