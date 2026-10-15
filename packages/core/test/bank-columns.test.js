import { test } from "node:test";
import assert from "node:assert/strict";
import { bankFileSignature, guessBankLayout, importWithLayout, layoutProblem } from "../dist/index.js";

const UK = [
  "Account statement,,,,",
  "Sort code 12-34-56,,,,",
  "Date,Description,Debit,Credit,Balance",
  "02/03/2026,TESCO STORES,23.45,,976.55",
  "15/03/2026,SALARY ACME LTD,,2500.00,3476.55",
].join("\n");

const US = [
  "Posted Date,Payee,Memo,Amount",
  "03/14/2026,Verizon,Phone bill,-89.99",
  "03/15/2026,Client Co,Invoice 1001,1500.00",
].join("\n");

const BRACKETS = [
  "Txn date,Details,Ref,Value",
  "2026-04-01,Bank fee,,(12.00)",
  "2026-04-02,Refund,R1,30.00",
  ",Total,,18.00",
].join("\n");

const read = (text, layout) => importWithLayout(text, layout, { file: "f.csv", account: "acct", currency: "NZD" });

test("a debit and credit pair under title rows, dates day first", () => {
  const { layout, columns } = guessBankLayout(UK);
  assert.equal(layout.headerRow, 2);
  assert.deepEqual([layout.date, layout.description, layout.moneyOut, layout.moneyIn, layout.balance, layout.amount], [0, 1, 2, 3, 4, -1]);
  assert.equal(layout.dayFirst, true);
  assert.equal(columns[1], "Description");
  assert.equal(layoutProblem(layout), null);
  assert.deepEqual(read(UK, layout).transactions.map((t) => [t.date, t.amount, t.otherParty]), [
    ["2026-03-02", -2345, "TESCO STORES"],
    ["2026-03-15", 250000, "SALARY ACME LTD"],
  ]);
});

test("one signed amount, a payee and a memo, dates month first", () => {
  const { layout } = guessBankLayout(US);
  assert.deepEqual([layout.date, layout.payee, layout.description, layout.amount], [0, 1, 2, 3]);
  assert.equal(layout.dayFirst, false);
  assert.deepEqual(read(US, layout).transactions.map((t) => [t.date, t.amount, t.otherParty, t.particulars]), [
    ["2026-03-14", -8999, "Verizon", "Phone bill"],
    ["2026-03-15", 150000, "Client Co", "Invoice 1001"],
  ]);
});

test("money out in brackets, and a total line that is not a transaction", () => {
  const { layout } = guessBankLayout(BRACKETS);
  assert.equal(layout.reference, 2);
  const result = read(BRACKETS, layout);
  assert.deepEqual(result.transactions.map((t) => [t.amount, t.reference]), [[-1200, ""], [3000, "R1"]]);
  assert.equal(result.problems.length, 1);
});

test("a layout is known again by its headings, and the same lines get the same ids", () => {
  assert.equal(bankFileSignature(UK), "date|description|debit|credit|balance");
  const { layout } = guessBankLayout(US);
  assert.deepEqual(read(US, layout).transactions.map((t) => t.id), read(US, layout).transactions.map((t) => t.id));
  assert.match(layoutProblem({ ...layout, date: -1 }) ?? "", /date/);
});
