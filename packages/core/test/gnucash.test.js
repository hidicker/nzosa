import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isGnuCashXml, parseGnuCash, parseGnuCashBooks } from "../dist/index.js";

const xml = readFileSync(new URL("./fixtures/small.gnucash.xml", import.meta.url), "utf8");

test("recognised by its root element", () => {
  assert.equal(isGnuCashXml(xml), true);
  assert.equal(isGnuCashXml("<?xml version='1.0'?><gnc-account-example>"), false);
});

test("the chart: headings left out of names and the chart, types and codes", () => {
  const file = parseGnuCash(xml, { currency: "NZD" });
  assert.deepEqual(
    file.chart.accounts.map((a) => [a.name, a.type, a.code]),
    [
      ["Cheque Account", "Bank", ""],
      ["Equipment", "Fixed Asset", "1500"],
      ["Visa", "Bank", ""],
      ["Fuel", "Overhead", "6000"],
      ["Office", "Overhead", "6010"],
      ["Office:Fuel", "Overhead", "6020"],
      ["Consulting", "Revenue", "4000"],
      ["Opening Balances", "Equity", "3000"],
    ],
  );
  assert.deepEqual(file.chart.cardNames, ["Visa"]);
});

test("transactions: debits positive, entities decoded, templates and other currencies and unbalanced ones left out", () => {
  const file = parseGnuCash(xml, { currency: "NZD" });
  assert.deepEqual(file.entries.map((e) => [e.date, e.name, e.type, e.legs.map((l) => [l.account, l.debit])]), [
    ["2026-04-01", "Opening balance", "Transaction", [["Cheque Account", 500000], ["Opening Balances", -500000]]],
    ["2026-04-03", "Z Energy", "Transaction", [["Fuel", 8550], ["Visa", -8550]]],
    ["2026-04-05", "Kea Ltd & Co", "Transaction", [["Cheque Account", 115000], ["Consulting", -115000]]],
    ["2026-04-06", "Laptop", "Transaction", [["Equipment", 250000], ["Cheque Account", -200000], ["Visa", -50000]]],
  ]);
  assert.equal(file.entries[1].legs[0].memo, "Fuel for the van");
  assert.deepEqual(file.problems.map((p) => p.message), [
    "2026-04-07 Paid in US dollars: in USD, not NZD; left out",
    "2026-04-08 Unbalanced: does not balance by 0.01; left out",
  ]);
});

test("as books: bank and card lines from the bank-side postings, money out negative, the split entry split", () => {
  const books = parseGnuCashBooks(xml, null, { currency: "NZD", file: "small.gnucash" });
  assert.deepEqual(
    books.transactions.map((t) => [t.date, t.extras.accountLabel, t.amount]).sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1])),
    [
      ["2026-04-01", "Cheque Account", 500000],
      ["2026-04-03", "Visa", -8550],
      ["2026-04-05", "Cheque Account", 115000],
      ["2026-04-06", "Cheque Account", -200000],
      ["2026-04-06", "Visa", -50000],
    ],
  );
});
