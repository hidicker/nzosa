import test from "node:test";
import assert from "node:assert/strict";
import {
  identifyExport,
  isQuickBooksChart,
  isQuickBooksLedger,
  parseQuickBooksBooks,
  parseQuickBooksChart,
  parseQuickBooksEntries,
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

const FULL_CHART =
  "Account name,Account type,Detail type\n" +
  "Checking,Bank,Checking\n" +
  "Savings,Bank,Savings\n" +
  "Accounts Receivable (A/R),Accounts receivable (A/R),Accounts Receivable (A/R)\n" +
  "Services,Income,Service/Fee Income\n" +
  "Landscaping,Income,Other Primary Income\n" +
  "Landscaping:Labor,Income,Other Primary Income\n" +
  "Opening Balance Equity,Equity,Opening Balance Equity\n";

const FULL_LEDGER =
  ",Distribution account,Transaction date,Transaction type,Num,Name,Description,Split,Amount,Balance\n" +
  "Checking,,,,,,,,,\n" +
  ',Checking,05/05/2026,Deposit,,,Opening Balance,Opening Balance Equity,"1,000.00","1,000.00"\n' +
  ',Checking,06/01/2026,Payment,5,Acme,,Accounts Receivable (A/R),150.00,"1,150.00"\n' +
  ",Checking,06/02/2026,Transfer,,,To savings,Savings,-200.00,950.00\n" +
  "Total for Checking,,,,,,,,$950.00,\n" +
  "Savings,,,,,,,,,\n" +
  ",Savings,06/02/2026,Transfer,,,To savings,Checking,200.00,200.00\n" +
  "Total for Savings,,,,,,,,$200.00,\n" +
  "Accounts Receivable (A/R),,,,,,,,,\n" +
  ",Accounts Receivable (A/R),05/30/2026,Invoice,1001,Acme,,Landscaping:Labor,150.00,150.00\n" +
  ",Accounts Receivable (A/R),06/01/2026,Payment,5,Acme,,Checking,-150.00,0.00\n" +
  "Total for Accounts Receivable (A/R),,,,,,,,$0.00,\n" +
  "Opening Balance Equity,,,,,,,,,\n" +
  ",Opening Balance Equity,05/05/2026,Deposit,,,Opening Balance,Checking,1000.00,1000.00\n" +
  'Total for Opening Balance Equity,,,,,,,,"$1,000.00",\n' +
  "Landscaping,,,,,,,,,\n" +
  "Total for Landscaping,,,,,,,,$0.00,\n" +
  "Labor,,,,,,,,,\n" +
  ",Labor,05/30/2026,Invoice,1001,Acme,,Accounts Receivable (A/R),150.00,150.00\n" +
  "Total for Labor,,,,,,,,$150.00,\n" +
  "Total for Landscaping with sub-accounts,,,,,,,,$150.00,\n";

test("a whole ledger comes back as bank lines, a transfer and the journals that touch no bank", () => {
  const chart = parseQuickBooksChart(FULL_CHART);
  const entries = parseQuickBooksEntries(FULL_LEDGER, chart);
  for (const e of entries.entries) {
    assert.equal(e.legs.reduce((s, l) => s + l.debit, 0), 0, `${e.type} ${e.num} balances`);
  }
  const books = parseQuickBooksBooks(FULL_LEDGER, chart);
  // The sub-account is found under its whole name, though its section says only "Labor".
  assert.equal(books.journals.length, 1);
  const invoice = books.journals[0];
  assert.match(invoice.narration, /Invoice 1001, Acme/);
  const byCode = Object.fromEntries(invoice.lines.map((l) => [l.code, l.amount]));
  assert.equal(byCode["Accounts Receivable (A/R) - 1100"], 15000);
  assert.equal(byCode["Landscaping:Labor - 4020"], -15000);
  // The move between its own accounts is a transfer, not coded to an account.
  assert.equal(books.transfers.length, 1);
  assert.equal(books.reference.some((r) => r.code === "Savings" || r.code === "Checking"), false);
});
