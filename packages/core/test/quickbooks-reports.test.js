import { test } from "node:test";
import assert from "node:assert/strict";
import { financialYearBalances, identifyExport, moveToAccount } from "../dist/index.js";

const empty = [
  "Craig's Design and Landscaping Services,,,",
  "Sales by  Class Detail,,,",
  '"October 1-14, 2026",,,',
  ",,,",
  "Date,Transaction Type,Num,Product/Service,Amount",
  ",,,",
  "This report contains no data.,,,",
  "Wednesday Oct 14 2026 07:52:46 PM GMT-7 - Accrual Basis,,,",
].join("\n");

test("a QuickBooks report with nothing in it is named and left alone", () => {
  const found = identifyExport(empty);
  assert.equal(found.kind, "not-needed");
  assert.match(found.what, /^QuickBooks Sales by Class Detail, with nothing in it/);
});

test("a sales report with rows is not taken for a general ledger", () => {
  const text = [
    "Craig's Design and Landscaping Services,,,,,,",
    "Sales by Product/Service Detail,,,,,,",
    '"October 1, 2021-October 15, 2026",,,,,,',
    ",,,,,,",
    "Transaction date,Transaction type,Num,Distribution account,Amount,Balance,Account type",
    "09/16/2026,Invoice,1015,Design income,954.75,954.75,Income",
  ].join("\n");
  const found = identifyExport(text);
  assert.equal(found.kind, "not-needed");
  assert.match(found.what, /not needed, the general ledger holds every sale/);
});

test("Xero's reports, dated day first, are not read as QuickBooks'", () => {
  const xero = ["Account Transactions,,", "XYZ Ltd,,", "For the period 1 April 2025 to 31 March 2026,,", ",,", "Date,Description,Amount"].join("\n");
  assert.notEqual(identifyExport(xero).kind, "not-needed");
});

test("year-end balances follow the books' year end", () => {
  const journals = [
    {
      transactionId: "t1",
      date: "2026-05-05",
      narration: "",
      source: "bank",
      taxBasis: "both",
      lines: [
        { accountCode: "chk", accountName: "Checking", amount: 500000, taxType: "NONE" },
        { accountCode: "3000", accountName: "Opening Balance Equity", amount: -500000, taxType: "NONE" },
      ],
    },
  ];
  const chart = [
    { code: "3000", name: "Opening Balance Equity", type: "Equity", taxCode: "" },
  ];
  const transactions = [{ id: "t1", date: "2026-05-05", account: "chk", amount: 500000 }];
  const us = financialYearBalances({ transactions, chart, journals, yearEnd: { endMonth: 12, endDay: 31 } });
  assert.deepEqual(us.map((y) => [y.year, y.asAt]), [[2026, "2026-12-31"]]);
  const nz = financialYearBalances({ transactions, chart, journals });
  assert.deepEqual(nz.map((y) => [y.year, y.asAt]), [[2027, "2027-03-31"]]);
});

test("lines moved to another account take ids made from it", () => {
  const line = {
    id: "x", account: "example-bank", date: "2026-09-18", amount: -22875, currency: "USD",
    serial: "", trn: "", particulars: "", code: "", reference: "", otherParty: "Hicks Hardware",
    occurrence: 1, source: { importer: "quickbooks-bank", file: "f.csv", line: 2 },
  };
  const [moved] = moveToAccount([line], "checking", "Checking");
  assert.equal(moved.account, "checking");
  assert.equal(moved.extras.accountLabel, "Checking");
  assert.notEqual(moved.id, "x");
});
