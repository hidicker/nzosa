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

test("a whole ledger comes back as bank lines, a transfer, documents and the journals for the rest", () => {
  const chart = parseQuickBooksChart(FULL_CHART);
  const entries = parseQuickBooksEntries(FULL_LEDGER, chart);
  for (const e of entries.entries) {
    assert.equal(e.legs.reduce((s, l) => s + l.debit, 0), 0, `${e.type} ${e.num} balances`);
  }
  const books = parseQuickBooksBooks(FULL_LEDGER, chart);
  // The invoice is a document, found under its whole sub-account name though
  // its section says only "Labor", and what Acme paid has been applied to it.
  assert.equal(books.invoices.length, 1);
  const invoice = books.invoices[0];
  assert.equal(invoice.number, "1001");
  assert.equal(invoice.kind, "sales");
  assert.equal(invoice.contact, "Acme");
  assert.equal(invoice.total, 15000);
  assert.deepEqual(invoice.lines.map((l) => [l.accountCode, l.net]), [["4020", 15000]]);
  assert.equal(invoice.outstanding, 0);
  assert.equal(books.payments.length, 1);
  assert.equal(books.payments[0].parts[0].invoiceNumber, "1001");
  // Nothing is left over to be a journal, and Acme is a customer.
  assert.equal(books.journals.length, 0);
  assert.deepEqual(books.contacts.map((c) => [c.name, c.kind]), [["Acme", "customer"]]);
  // The move between its own accounts is a transfer, not coded to an account.
  assert.equal(books.transfers.length, 1);
  assert.equal(books.reference.some((r) => r.code === "Savings" || r.code === "Checking"), false);
});

import { invoiceDocument, invoiceEmail } from "../dist/index.js";

test("an invoice document for books with no sales tax has no GST column and writes dates month first", () => {
  const invoice = {
    number: "1001", kind: "sales", contact: "Acme", reference: "", issued: "2026-03-04", due: "2026-04-03",
    total: 15000, tax: 0, paid: 0, outstanding: 15000, currency: "USD", status: "Authorised",
    lines: [{ description: "Work", accountCode: "4000", taxType: "No GST", net: 15000, tax: 0, gross: 15000 }],
  };
  const supplier = { name: "Ellis Design" };
  const nz = invoiceDocument(invoice, supplier);
  assert.match(nz, />GST</);
  assert.match(nz, /04\/03\/2026/);
  const us = invoiceDocument(invoice, supplier, { noTax: true, dateStyle: "mdy", lang: "en-US" });
  assert.doesNotMatch(us, />GST</);
  assert.match(us, /03\/04\/2026/);
  assert.match(us, /lang="en-US"/);
  assert.match(us, /<h1>Invoice<\/h1>/);
  assert.match(invoiceEmail(invoice, supplier, { noTax: true, dateStyle: "mdy" }).body, /Due: 04\/03\/2026/);
});

test("a payment of exactly what one bill owes pays that bill, not the oldest", async () => {
  const { parseQuickBooksBooks, parseQuickBooksChart } = await import("../dist/index.js");
  const chart = parseQuickBooksChart(
    ["Account name,Account type,Detail type", "Checking,Bank,Checking", "Accounts Payable (A/P),Accounts payable (A/P),Accounts Payable (A/P)", "Utilities,Expenses,Utilities"].join("\n"),
  );
  const gl = [
    ",Distribution account,Transaction date,Transaction type,Num,Name,Description,Split,Amount,Balance",
    "Checking,,,,,,,,,",
    ",Checking,09/17/2026,Bill Payment (Check),,PG&E,,Accounts Payable (A/P),-114.09,-114.09",
    "Total for Checking,,,,,,,,-114.09,",
    "Accounts Payable (A/P),,,,,,,,,",
    ",Accounts Payable (A/P),08/04/2026,Bill,,PG&E,,Utilities,86.44,86.44",
    ",Accounts Payable (A/P),09/02/2026,Bill,,PG&E,,Utilities,114.09,200.53",
    ",Accounts Payable (A/P),09/17/2026,Bill Payment (Check),,PG&E,,Checking,-114.09,86.44",
    "Total for Accounts Payable (A/P),,,,,,,,86.44,",
    "Utilities,,,,,,,,,",
    ",Utilities,08/04/2026,Bill,,PG&E,,Accounts Payable (A/P),86.44,86.44",
    ",Utilities,09/02/2026,Bill,,PG&E,,Accounts Payable (A/P),114.09,200.53",
    "Total for Utilities,,,,,,,,200.53,",
  ].join("\n");
  const books = parseQuickBooksBooks(gl, chart);
  assert.deepEqual(
    books.invoices.map((i) => [i.issued, i.outstanding]),
    [["2026-08-04", 8644], ["2026-09-02", 0]],
  );
});

test("with the Line open balance column, a payment goes where QuickBooks put it", async () => {
  const { parseQuickBooksBooks, parseQuickBooksChart } = await import("../dist/index.js");
  const chart = parseQuickBooksChart(
    ["Account name,Account type,Detail type", "Checking,Bank,Checking", "Accounts Receivable (A/R),Accounts receivable (A/R),Accounts Receivable (A/R)", "Services,Income,Service/Fee Income"].join("\n"),
  );
  // Two invoices to one customer and a payment of 50.00 with no number.
  // Oldest first would put it on August's; QuickBooks put it on September's,
  // and the export says so: 81.00 still open on the first, 4.00 on the second.
  const gl = [
    ",Distribution account,Transaction date,Transaction type,Num,Name,Description,Split,Amount,Balance,Line open balance",
    "Checking,,,,,,,,,,",
    ",Checking,09/18/2026,Payment,,Freeman Sporting Goods,,Accounts Receivable (A/R),50.00,50.00,",
    "Total for Checking,,,,,,,,50.00,,",
    "Accounts Receivable (A/R),,,,,,,,,,",
    ",Accounts Receivable (A/R),08/03/2026,Invoice,1028,Freeman Sporting Goods,,Services,81.00,81.00,81.00",
    ",Accounts Receivable (A/R),09/11/2026,Invoice,1005,Freeman Sporting Goods,,Services,54.00,135.00,4.00",
    ",Accounts Receivable (A/R),09/18/2026,Payment,,Freeman Sporting Goods,,Checking,-50.00,85.00,$0.00",
    "Total for Accounts Receivable (A/R),,,,,,,,85.00,,",
    "Services,,,,,,,,,,",
    ",Services,08/03/2026,Invoice,1028,Freeman Sporting Goods,,Accounts Receivable (A/R),81.00,81.00,",
    ",Services,09/11/2026,Invoice,1005,Freeman Sporting Goods,,Accounts Receivable (A/R),54.00,135.00,",
    "Total for Services,,,,,,,,135.00,,",
  ].join("\n");
  const books = parseQuickBooksBooks(gl, chart);
  assert.deepEqual(
    books.invoices.map((i) => [i.number, i.outstanding]),
    [["1028", 8100], ["1005", 400]],
  );
  // Without the column, oldest first, as before.
  const without = gl.split("\n").map((row) => row.replace(/,[^,]*$/, "")).join("\n");
  assert.deepEqual(
    parseQuickBooksBooks(without, chart).invoices.map((i) => [i.number, i.outstanding]),
    [["1028", 3100], ["1005", 5400]],
  );
});
