import assert from "node:assert/strict";
import test from "node:test";
import {
  documentsInPlay,
  identifyExport,
  invoiceBalances,
  isAgedDetail,
  openingDocumentsTotal,
  postLedger,
  readAgedDetail,
} from "../dist/index.js";

// Laid out as Xero's Aged Receivables Detail: the contact on a row of its
// own, its invoices under it with the first column empty, the amount owing in
// Total (the sum of the ageing columns).
const RECEIVABLES = [
  "Aged Receivables Detail,,,,,,,,,,,,",
  "Kowhai Trading Limited,,,,,,,,,,,,",
  "As at 31 March 2025,,,,,,,,,,,,",
  "Ageing by due date,,,,,,,,,,,,",
  "Contact Account Number,Primary Person,Invoice Date,Due Date,Invoice Number,Invoice Reference,Current,< 1 Month,1 Month,Older,Total,Outstanding GST,Invoice Seen",
  "Rimu Cafe,,,,,,,,,,,,",
  ",,2025-02-04,2025-04-22,INV-0012,,300.00,0,0,0,300.00,39.13,Not seen",
  ",,2025-03-01,2025-04-20,INV-0014,,0,0,0,0,0.00,0,Not seen",
  "Total Rimu Cafe,,,,,,300.00,0,0,0,300.00,39.13,",
  "Totara Supplies,,,,,,,,,,,,",
  ",,2025-01-10,2025-02-10,INV-0009,,0,0,125.50,0,125.50,16.37,Seen",
  "Total Totara Supplies,,,,,,0,0,125.50,0,125.50,16.37,",
  "Total,,,,,,300.00,0,125.50,0,425.50,55.50,",
  "Percentage of total,,,,,,70%,0%,30%,0%,100%,,",
].join("\n");

const invoice = (number, issued, total, kind = "sales") => ({
  number, kind, contact: "Rimu Cafe", reference: "", issued, due: issued,
  total, tax: 0, paid: 0, outstanding: total, currency: "NZD", status: "Awaiting Payment",
  lines: [{ description: "Work", accountCode: "200", taxType: "No GST", gross: total, tax: 0, net: total }],
});

test("recognises the report and reads the open documents", () => {
  assert.ok(isAgedDetail(RECEIVABLES));
  assert.equal(identifyExport(RECEIVABLES).kind, "aged-detail");
  const { record } = readAgedDetail(RECEIVABLES);
  assert.equal(record.kind, "sales");
  assert.equal(record.asAt, "2025-03-31");
  assert.deepEqual(
    record.items.map((i) => [i.number, i.contact, i.owing]),
    [["INV-0012", "Rimu Cafe", 30000], ["INV-0009", "Totara Supplies", 12550]],
    "a line owing nothing is not open, and total rows are not documents",
  );
  assert.equal(openingDocumentsTotal(record), 42550);
});

test("the payables report is bills", () => {
  const payables = RECEIVABLES.replace("Aged Receivables Detail", "Aged Payables Detail")
    .replace("Invoice Number", "Bill Number").replace("Invoice Date", "Bill Date");
  const { record } = readAgedDetail(payables);
  assert.equal(record.kind, "purchase");
  assert.equal(record.items.length, 2);
});

test("before the start: open ones carried forward, the rest left out; from the start: all", () => {
  const { record } = readAgedDetail(RECEIVABLES);
  const invoices = [
    invoice("INV-0012", "2025-02-04", 50000), // part paid before the start: 300 still owing
    invoice("INV-0010", "2025-01-20", 20000), // paid before the start
    invoice("INV-0020", "2025-04-15", 11500), // in these books
    invoice("BILL-1", "2025-02-01", 9000, "purchase"), // no payables report: kept as it was
  ];
  const inPlay = documentsInPlay(invoices, "2025-04-01", [record]);
  assert.deepEqual(inPlay.map((i) => i.number), ["INV-0012", "INV-0020", "BILL-1"]);
  assert.equal(inPlay[0].broughtForward, 30000);
  assert.equal(inPlay[1].broughtForward, undefined);
  assert.equal(documentsInPlay(invoices, undefined, [record]).length, 4, "no start, nothing decided");
});

test("a carried-forward invoice owes what the report said, and its receipt clears it", () => {
  const { record } = readAgedDetail(RECEIVABLES);
  const [carried] = documentsInPlay([invoice("INV-0012", "2025-02-04", 50000)], "2025-04-01", [record]);
  const receipt = {
    id: "r1", date: "2025-04-20", account: "BNZ 01", amount: 30000, otherParty: "Rimu Cafe",
    particulars: "", code: "", reference: "INV-0012", description: "", currency: "NZD", source: "bank",
  };
  const balances = invoiceBalances([carried], [{ invoiceNumber: "INV-0012", amount: 30000 }]);
  assert.equal(balances.get("INV-0012").remaining, 0, "paid in full, though the invoice was for more");

  const journals = postLedger({
    transactions: [receipt], codeOf: () => "200 Sales",
    classify: () => ({ treatment: "exempt", side: "sales" }),
    chart: [
      { code: "090", name: "BNZ 01", type: "Bank", taxCode: "No GST", description: "" },
      { code: "200", name: "Sales", type: "Revenue", taxCode: "15% GST on Income", description: "" },
      { code: "610", name: "Accounts Receivable", type: "Current Asset", taxCode: "No GST", description: "" },
    ],
    bankLabels: new Map(), byId: new Map([["r1", receipt]]),
    invoices: [carried], settled: new Map([["r1", "INV-0012"]]), transfers: {}, manualJournals: [],
    startDate: "2025-04-01",
  });
  const lines = journals.flatMap((j) => j.lines);
  assert.equal(lines.filter((l) => l.accountCode === "200").length, 0, "the sale was last year's: not posted again");
  assert.equal(
    lines.filter((l) => l.accountCode === "610").reduce((s, l) => s + l.amount, 0),
    -30000,
    "the receipt clears 300 of the opening receivable",
  );
});

test("an invoice dated before the start is not posted, one from the start is", () => {
  const fee = {
    id: "f1", date: "2025-04-02", account: "BNZ 01", amount: -500, otherParty: "Bank",
    particulars: "", code: "", reference: "", description: "", currency: "NZD", source: "bank",
  };
  const journals = postLedger({
    transactions: [fee], codeOf: () => "404 Bank Fees", classify: () => ({ treatment: "exempt", side: "purchases" }),
    chart: [], bankLabels: new Map(), byId: new Map([["f1", fee]]),
    invoices: [invoice("INV-0010", "2025-03-20", 20000), invoice("INV-0020", "2025-04-01", 11500)],
    settled: new Map(), transfers: {}, manualJournals: [], startDate: "2025-04-01",
  });
  const text = JSON.stringify(journals);
  assert.match(text, /INV-0020/);
  assert.doesNotMatch(text, /INV-0010/);
});
