import { test } from "node:test";
import assert from "node:assert/strict";
import { identifyExport, isSlowBooksLedger, parseSlowBooksBooks } from "../dist/index.js";

// SlowBooks Pro 2026's own General Ledger CSV for eight entries entered in it:
// an owner's investment, two invoices, two bills, a payment, a bill payment
// and a bank fee. Its profit and loss said 1,235.00; its balance sheet
// Checking 5,185.00, receivables 1,500.00, payables 450.00.
const GL = [
  "Company,Test",
  "Report,General Ledger",
  "Period,2026-01-01 to 2026-12-31",
  "",
  "Date,Reference,Description,Account number,Account name,Debit,Credit,Running balance,Source type,Class",
  "2026-01-01,,Balance brought forward,1000,Checking,,,0.00,opening,",
  "2026-03-01,,Owner investment,1000,Checking,5000.00,,5000.00,manual,Uncategorized",
  "2026-03-20,2041,Payment from Acme Co,1000,Checking,500.00,,5500.00,payment,Uncategorized",
  "2026-03-25,,Bill payment to Office Depot,1000,Checking,,300.00,5200.00,bill_payment,Uncategorized",
  "2026-03-31,,Bank fee,1000,Checking,,15.00,5185.00,manual,Uncategorized",
  "2026-12-31,,Period total,1000,Checking,5500.00,315.00,5185.00,total,",
  "2026-01-01,,Balance brought forward,1100,Accounts Receivable,,,0.00,opening,",
  "2026-03-02,1001,Invoice #1001 - Acme Co,1100,Accounts Receivable,1200.00,,1200.00,invoice,Uncategorized",
  "2026-03-10,1002,Invoice #1002 - Beta LLC,1100,Accounts Receivable,800.00,,2000.00,invoice,Uncategorized",
  "2026-03-20,2041,Payment from Acme Co,1100,Accounts Receivable,,500.00,1500.00,payment,Uncategorized",
  "2026-12-31,,Period total,1100,Accounts Receivable,2000.00,500.00,1500.00,total,",
  "2026-01-01,,Balance brought forward,2000,Accounts Payable,,,0.00,opening,",
  "2026-03-05,,Bill OD-1 - Office Depot,2000,Accounts Payable,,300.00,300.00,bill,Uncategorized",
  "2026-03-12,,Bill HH-7 - Hicks Hardware,2000,Accounts Payable,,450.00,750.00,bill,Uncategorized",
  "2026-03-25,,Bill payment to Office Depot,2000,Accounts Payable,300.00,,450.00,bill_payment,Uncategorized",
  "2026-12-31,,Period total,2000,Accounts Payable,300.00,750.00,450.00,total,",
  "2026-01-01,,Balance brought forward,3000,Owner's Equity,,,0.00,opening,",
  "2026-03-01,,Owner investment,3000,Owner's Equity,,5000.00,5000.00,manual,Uncategorized",
  "2026-12-31,,Period total,3000,Owner's Equity,0.00,5000.00,5000.00,total,",
  "2026-01-01,,Balance brought forward,4000,Service Income,,,0.00,opening,",
  "2026-03-02,1001,Invoice #1001 - Acme Co,4000,Service Income,,1200.00,1200.00,invoice,Uncategorized",
  "2026-03-10,1002,Invoice #1002 - Beta LLC,4000,Service Income,,800.00,2000.00,invoice,Uncategorized",
  "2026-12-31,,Period total,4000,Service Income,0.00,2000.00,2000.00,total,",
  "2026-01-01,,Balance brought forward,6200,Bank Charges & Fees,,,0.00,opening,",
  "2026-03-31,,Bank fee,6200,Bank Charges & Fees,15.00,,15.00,manual,Uncategorized",
  "2026-12-31,,Period total,6200,Bank Charges & Fees,15.00,0.00,15.00,total,",
  "2026-01-01,,Balance brought forward,6400,Office Supplies,,,0.00,opening,",
  "2026-03-05,,Bill OD-1 - Office Depot,6400,Office Supplies,300.00,,300.00,bill,Uncategorized",
  "2026-12-31,,Period total,6400,Office Supplies,300.00,0.00,300.00,total,",
  "2026-01-01,,Balance brought forward,6600,Repairs & Maintenance,,,0.00,opening,",
  "2026-03-12,,Bill HH-7 - Hicks Hardware,6600,Repairs & Maintenance,450.00,,450.00,bill,Uncategorized",
  "2026-12-31,,Period total,6600,Repairs & Maintenance,450.00,0.00,450.00,total,",
].join("\r\n");

test("SlowBooks' general ledger is known as one", () => {
  assert.equal(isSlowBooksLedger(GL), true);
  assert.equal(identifyExport(GL).kind, "slowbooks-ledger");
});

test("every posting comes across, as SlowBooks has them", () => {
  const books = parseSlowBooksBooks(GL, null);
  assert.deepEqual(books.problems, []);
  assert.deepEqual(
    books.chart.accounts.map((a) => [a.code, a.name, a.type]),
    [
      ["", "Checking", "Bank"],
      ["1100", "Accounts Receivable", "Accounts Receivable"],
      ["2000", "Accounts Payable", "Accounts Payable"],
      ["3000", "Owner's Equity", "Equity"],
      ["4000", "Service Income", "Revenue"],
      ["6200", "Bank Charges & Fees", "Overhead"],
      ["6400", "Office Supplies", "Overhead"],
      ["6600", "Repairs & Maintenance", "Overhead"],
    ],
  );
  assert.deepEqual(books.transactions.map((t) => [t.date, t.amount]), [
    ["2026-03-01", 500000],
    ["2026-03-20", 50000],
    ["2026-03-25", -30000],
    ["2026-03-31", -1500],
  ]);
  const owing = (kind) =>
    books.invoices.filter((i) => i.kind === kind).map((i) => [i.number, i.contact, i.total, i.outstanding]);
  assert.deepEqual(owing("sales"), [
    ["1001", "Acme Co", 120000, 70000],
    ["1002", "Beta LLC", 80000, 80000],
  ]);
  assert.deepEqual(owing("purchase"), [
    ["OD-1", "Office Depot", 30000, 0],
    ["HH-7", "Hicks Hardware", 45000, 45000],
  ]);
  assert.equal(books.payments.length, 2);
  assert.ok(books.reference.some((r) => r.amount === -1500 && /Bank Charges/.test(r.code)));
  assert.ok(books.reference.some((r) => r.amount === 500000 && /Owner's Equity/.test(r.code)));
});

test("added to books already in use: the same account whatever its capitals, and no number given twice", () => {
  const chart = {
    accounts: [
      { code: "2000", name: "Accounts payable", type: "Accounts Payable", taxCode: "" },
      { code: "4000", name: "Sales", type: "Revenue", taxCode: "" },
      { code: "", name: "Checking", type: "Bank", taxCode: "" },
    ],
    debitNormal: ["Checking"],
    bankNames: ["Checking"],
    cardNames: [],
  };
  const books = parseSlowBooksBooks(GL, chart);
  const codes = books.chart.accounts.map((a) => a.code).filter((c) => c !== "");
  assert.equal(new Set(codes).size, codes.length);
  assert.equal(books.chart.accounts.filter((a) => /accounts payable/i.test(a.name)).length, 1);
  assert.equal(books.chart.accounts.find((a) => a.name === "Service Income")?.code, "4001");
  assert.deepEqual(books.problems, []);
});

test("two bank fees alike in every way on one day are two bank lines, not one", () => {
  const twice = GL.replace(
    "2026-03-31,,Bank fee,1000,Checking,,15.00,5185.00,manual,Uncategorized",
    "2026-03-31,,Bank fee,1000,Checking,,15.00,5185.00,manual,Uncategorized\r\n2026-03-31,,Bank fee,1000,Checking,,15.00,5170.00,manual,Uncategorized",
  ).replace(
    "2026-03-31,,Bank fee,6200,Bank Charges & Fees,15.00,,15.00,manual,Uncategorized",
    "2026-03-31,,Bank fee,6200,Bank Charges & Fees,15.00,,15.00,manual,Uncategorized\r\n2026-03-31,,Bank fee,6200,Bank Charges & Fees,15.00,,30.00,manual,Uncategorized",
  );
  const books = parseSlowBooksBooks(twice, null);
  assert.deepEqual(books.problems, []);
  const fees = books.transactions.filter((t) => t.date === "2026-03-31");
  assert.deepEqual(fees.map((t) => t.amount), [-1500, -1500]);
  assert.equal(books.reference.filter((r) => r.amount === -1500 && /Bank Charges/.test(r.code)).length, 2);
});
