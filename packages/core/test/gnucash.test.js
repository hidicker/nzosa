import assert from "node:assert/strict";
import test from "node:test";
import { identifyExport, isGnuCashAccounts, isGnuCashTransactions, parseGnuCashAccounts, parseGnuCashBooks, parseGnuCashJournal } from "../dist/index.js";

// Invented books, as GnuCash's exports write them.
const HEAD = '"Date","Transaction ID","Number","Description","Notes","Commodity/Currency","Void Reason","Action","Memo","Full Account Name","Account Name","Amount With Sym","Amount Num.","Value With Sym","Value Num.","Reconcile","Reconcile Date","Rate/Price"';
const usual = [
  HEAD,
  // A transaction row, then its splits.
  '"15/05/2026","a1","","Kowhai Fuels","","CURRENCY::NZD","","","","","","","","","","","",""',
  '"","","","","","","","","","Expenses:Auto:Fuel","Fuel","$100.00","100.00","$100.00","100.00","n","","1.00"',
  '"","","","","","","","","","Liabilities:GST","GST","$15.00","15.00","$15.00","15.00","n","","1.00"',
  '"","","","","","","","","","Assets:Current Assets:Cheque Account","Cheque Account","-$115.00","-115.00","-$115.00","-115.00","c","","1.00"',
  '"31/05/2026","a2","J7","Depreciation","","CURRENCY::NZD","","","","","","","","","","","",""',
  '"","","","","","","","","","Expenses:Depreciation","Depreciation","$50.00","50.00","$50.00","50.00","n","","1.00"',
  '"","","","","","","","","","Assets:Fixed Assets:Van","Van","-$50.00","-50.00","-$50.00","-50.00","n","","1.00"',
  '"01/06/2026","a3","","Wrong","","CURRENCY::NZD","Entered twice","","","","","","","","","","",""',
  '"","","","","","","","","","Expenses:Auto:Fuel","Fuel","$9.00","9.00","$9.00","9.00","n","","1.00"',
  '"","","","","","","","","","Assets:Current Assets:Cheque Account","Cheque Account","-$9.00","-9.00","-$9.00","-9.00","n","","1.00"',
].join("\n");

test("GnuCash's transactions and account tree are told from other files", () => {
  assert.ok(isGnuCashTransactions(usual));
  assert.ok(!isGnuCashAccounts(usual));
  assert.equal(identifyExport(usual).kind, "gnucash-transactions");
});

test("each transaction from its splits, a voided one left out, GST into the cost", () => {
  const read = parseGnuCashJournal(usual, null, { dayFirst: true });
  assert.equal(read.entries.length, 2);
  const [fuel, depreciation] = read.entries;
  assert.equal(fuel.date, "2026-05-15");
  assert.deepEqual(fuel.legs.map((l) => [l.account, l.debit]), [["Auto: Fuel", 11500], ["Current Assets: Cheque Account", -11500]]);
  assert.deepEqual(depreciation.legs.map((l) => [l.account, l.debit]), [["Depreciation", 5000], ["Fixed Assets: Van", -5000]]);
  const books = parseGnuCashBooks(usual, null, { dayFirst: true, file: "t.csv" });
  assert.equal(books.transactions.length, 1, "the bank leg is a bank line");
  assert.equal(books.transactions[0].amount, -11500);
  assert.equal(books.journals.length, 1, "the rest is a journal");
});

test("the simple layout, every row whole, reads the same", () => {
  const simple = [
    HEAD,
    '"15/05/2026","a1","","Kowhai Fuels","","CURRENCY::NZD","","","","Expenses:Auto:Fuel","Fuel","$100.00","100.00","$100.00","100.00","n","","1.00"',
    '"15/05/2026","a1","","Kowhai Fuels","","CURRENCY::NZD","","","","Assets:Current Assets:Cheque Account","Cheque Account","-$100.00","-100.00","-$100.00","-100.00","n","","1.00"',
  ].join("\n");
  const read = parseGnuCashJournal(simple, null, { dayFirst: true });
  assert.equal(read.entries.length, 1);
  assert.equal(read.entries[0].legs.length, 2);
});

test("the account tree gives types and codes, placeholders left out", () => {
  const tree = [
    "type,full_name,name,code,description,color,notes,commodity_mnemonic,commodity_namespace,hidden,tax,place_holder",
    "EXPENSE,Expenses,Expenses,,,,,NZD,CURRENCY,F,F,T",
    "EXPENSE,Expenses:Auto:Fuel,Fuel,6100,,,,NZD,CURRENCY,F,F,F",
    "BANK,Assets:Current Assets:Cheque Account,Cheque Account,,,,,NZD,CURRENCY,F,F,F",
    "INCOME,Income:Interest,Interest,4200,,,,NZD,CURRENCY,F,F,F",
    "EXPENSE,Expenses:Interest,Interest,6500,,,,NZD,CURRENCY,F,F,F",
  ].join("\n");
  assert.ok(isGnuCashAccounts(tree));
  const { chart } = parseGnuCashAccounts(tree);
  assert.deepEqual(chart.accounts.map((a) => [a.code, a.name]), [
    ["6100", "Auto: Fuel"],
    ["", "Current Assets: Cheque Account"],
    ["4200", "Income: Interest"],
    ["6500", "Expenses: Interest"],
  ]);
  assert.deepEqual(chart.bankNames, ["Current Assets: Cheque Account"]);
  const read = parseGnuCashJournal(usual, chart, { dayFirst: true });
  assert.equal(read.entries[0].legs[0].account, "Auto: Fuel", "the tree's own name");
});
