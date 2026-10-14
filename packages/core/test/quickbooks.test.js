import test from "node:test";
import assert from "node:assert/strict";
import {
  identifyExport,
  isQuickBooksChart,
  isQuickBooksLedger,
  parseQuickBooksChart,
  parseQuickBooksLedger,
} from "../dist/index.js";

const CHART =
  "﻿Account name,Account type,Detail type\n" +
  "Checking,Bank,Checking\n" +
  "Visa,Credit Card,Credit Card\n" +
  "Accounts Receivable (A/R),Accounts receivable (A/R),Accounts Receivable (A/R)\n" +
  "Design income,Income,Other Primary Income\n" +
  "Automobile,Expenses,Auto\n" +
  "Automobile:Fuel,Expenses,Auto\n" +
  "Opening Balance Equity,Equity,Opening Balance Equity\n";

const LEDGER =
  "Craig's Design and Landscaping Services,,,,,,,,,\n" +
  "General Ledger,,,,,,,,,\n" +
  '"January 1, 2001-October 14, 2026",,,,,,,,,\n' +
  "\n" +
  ",Distribution account,Transaction date,Transaction type,Num,Name,Description,Split,Amount,Balance\n" +
  "Checking,,,,,,,,,\n" +
  ',Checking,05/05/2026,Deposit,,,Opening Balance,Opening Balance Equity,"5,000.00","5,000.00"\n' +
  ",Checking,07/30/2026,Check,4,Chin's Gas and Oil,,Automobile:Fuel,-54.55,\"4,945.45\"\n" +
  ",Checking,08/24/2026,Sales Receipt,1008,Kate Whelan,,-Split-,225.00,\"5,170.45\"\n" +
  "Total for Checking,,,,,,,,\"$5,170.45\",\n" +
  "Visa,,,,,,,,,\n" +
  ",Visa,09/03/2026,Expense,1,Chin's Gas and Oil,,Automobile:Fuel,65.00,65.00\n" +
  "Total for Visa,,,,,,,,$65.00,\n" +
  "Design income,,,,,,,,,\n" +
  ",Design income,08/24/2026,Sales Receipt,1008,Kate Whelan,,Checking,225.00,225.00\n";

test("both exports are recognised for what they are", () => {
  assert.equal(isQuickBooksChart(CHART), true);
  assert.equal(isQuickBooksLedger(CHART), false);
  assert.equal(isQuickBooksLedger(LEDGER), true);
  assert.equal(isQuickBooksChart(LEDGER), false);
  assert.equal(identifyExport(CHART).kind, "quickbooks-chart");
  assert.equal(identifyExport(LEDGER).kind, "quickbooks-ledger");
});

test("the chart gets codes by type, banks and cards get none, sub-accounts keep their path", () => {
  const chart = parseQuickBooksChart(CHART);
  assert.deepEqual(chart.bankNames, ["Checking", "Visa"]);
  assert.deepEqual(chart.cardNames, ["Visa"]);
  const byName = new Map(chart.accounts.map((a) => [a.name, a]));
  assert.equal(byName.get("Checking").code, "");
  assert.equal(byName.get("Checking").type, "Bank");
  assert.equal(byName.get("Accounts Receivable (A/R)").type, "Accounts Receivable");
  assert.equal(byName.get("Design income").code, "4000");
  assert.equal(byName.get("Automobile").code, "6000");
  assert.equal(byName.get("Automobile:Fuel").code, "6010");
  assert.equal(byName.get("Automobile:Fuel").type, "Overhead");
  assert.equal(byName.get("Opening Balance Equity").type, "Equity");
});

test("only bank and card postings become bank lines, with the card's sign turned round", () => {
  const chart = parseQuickBooksChart(CHART);
  const codes = new Map(chart.accounts.map((a) => [a.name, a.code]));
  const read = parseQuickBooksLedger(LEDGER, { bankNames: chart.bankNames, cardNames: chart.cardNames, codes });
  assert.equal(read.problems.length, 0);
  assert.equal(read.transactions.length, 4);
  const checking = read.transactions.filter((t) => t.account === "checking");
  assert.deepEqual(checking.map((t) => [t.date, t.amount]), [
    ["2026-05-05", 500000],
    ["2026-07-30", -5455],
    ["2026-08-24", 22500],
  ]);
  const card = read.transactions.find((t) => t.account === "visa");
  assert.equal(card.amount, -6500, "a purchase on a card is money going out");
  assert.equal(card.otherParty, "Chin's Gas and Oil");
  assert.equal(card.extras.accountLabel, "Visa");
});

test("what each line was coded to comes through, and a split entry is left alone", () => {
  const chart = parseQuickBooksChart(CHART);
  const codes = new Map(chart.accounts.map((a) => [a.name, a.code]));
  const read = parseQuickBooksLedger(LEDGER, { bankNames: chart.bankNames, cardNames: chart.cardNames, codes });
  // Four bank lines, one of them -Split-.
  assert.equal(read.reference.length, 3);
  const fuel = read.reference.find((r) => r.date === "2026-07-30");
  assert.equal(fuel.code, "6010 Automobile:Fuel");
  assert.equal(fuel.account, "Checking");
  assert.equal(fuel.contact, "Chin's Gas and Oil");
});

test("a day past 12 settles which way round the dates go", () => {
  const dayFirst = LEDGER.replace("07/30/2026", "30/07/2026").replace("05/05/2026", "05/05/2026");
  const read = parseQuickBooksLedger(dayFirst, { bankNames: ["Checking"], dayFirst: false });
  assert.equal(read.transactions.find((t) => t.amount === -5455).date, "2026-07-30");
  // And with nothing in the file to settle it, the books' own order is used.
  const ambiguous =
    ",Distribution account,Transaction date,Transaction type,Num,Name,Description,Split,Amount,Balance\n" +
    "Checking,,,,,,,,,\n" +
    ",Checking,03/04/2026,Deposit,,,x,Design income,10.00,10.00\n";
  assert.equal(parseQuickBooksLedger(ambiguous, { bankNames: ["Checking"], dayFirst: true }).transactions[0].date, "2026-04-03");
  assert.equal(parseQuickBooksLedger(ambiguous, { bankNames: ["Checking"], dayFirst: false }).transactions[0].date, "2026-03-04");
});
