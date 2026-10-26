import assert from "node:assert/strict";
import test from "node:test";
import { applyChartPlan, chartImportPlan, parseHledgerAccounts, readChartFile } from "../dist/index.js";

const account = (code, name, type, over = {}) => ({ code, name, type, taxCode: "", description: "", ...over });

test("hledger's account directives and its account list", () => {
  const journal = [
    "; my books",
    "account Assets:Bank:Cheque    ; type: C",
    "account Expenses:Office supplies",
    "account Income:Sales",
    "commodity $1,000.00",
    "",
    "2026-05-01 Kowhai Fuels",
    "    Expenses:Auto:Fuel   $100",
    "    Assets:Bank:Cheque",
  ].join("\n");
  assert.deepEqual(parseHledgerAccounts(journal).map((a) => [a.name, a.type]), [
    ["Bank: Cheque", "Bank"],
    ["Office supplies", "Expense"],
    ["Sales", "Revenue"],
  ]);
  const listed = "Assets:Receivable  ; type: A\nLiabilities:GST  ; type: L\nEquity:Opening balances  ; type: E\n";
  assert.deepEqual(parseHledgerAccounts(listed).map((a) => [a.name, a.type]), [
    ["Receivable", "Current Asset"],
    ["GST", "Current Liability"],
    ["Opening balances", "Equity"],
  ]);
});

test("a spreadsheet with a code, a name and a type is read too", () => {
  const read = readChartFile("Account Code,Account Name,Account Type\n6100,Fuel,Expense\n4000,Sales,Revenue\n");
  assert.equal(read.read, "a spreadsheet of accounts");
  assert.deepEqual(read.accounts.map((a) => [a.code, a.name, a.type]), [["6100", "Fuel", "Expense"], ["4000", "Sales", "Revenue"]]);
  assert.equal(readChartFile("nothing,here\n1,2\n").accounts.length, 0);
});

test("the plan: new accounts added, matched ones changed in place, nothing taken out", () => {
  const current = [
    account("200", "Sales", "Revenue", { entity: "shop" }),
    account("429", "General", "Expense"),
    account("", "Cheque", "Bank", { ledgerAccount: "bnz-1" }),
  ];
  const incoming = [
    account("200", "Sales", "Revenue"),
    account("429", "General Expenses", "Overhead"),
    account("6100", "Fuel", "Expense"),
    account("", "cheque", ""),
  ];
  const plan = chartImportPlan(current, incoming);
  assert.deepEqual(plan.added.map((a) => a.code), ["6100"]);
  assert.deepEqual(plan.changed.map((c) => [c.before.name, c.after.name, c.after.type]), [["General", "General", "Overhead"]]);
  assert.deepEqual(plan.named.map((n) => [n.account.code, n.fileName]), [["429", "General Expenses"]], "named differently, not renamed");
  assert.equal(plan.same, 2);
  const after = applyChartPlan(current, plan);
  assert.equal(after.length, 4);
  assert.equal(after[0].entity, "shop", "what the file does not say is kept");
  assert.equal(after[2].ledgerAccount, "bnz-1");
});
