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

test("a file with no headings, as Commonwealth Bank exports it, is read from its contents", () => {
  const text = [
    '01/07/2026,"+2,200.00","TRANSFER FROM KELLY DESIGN PTY LTD INV 1001","+2,200.00"',
    '03/07/2026,"-45.10","OFFICEWORKS 0412 SYDNEY NS AUS Card xx1234","+2,154.90"',
    '05/07/2026,"-89.00","TELSTRA PREPAID MELBOURNE AU","+2,065.90"',
    '15/07/2026,"+3,300.00","TRANSFER FROM HARBOUR CAFE INV 1002","+5,365.90"',
  ].join("\n");
  const { layout, columns } = guessBankLayout(text);
  assert.equal(layout.headerRow, -1);
  assert.deepEqual(columns, ["Column 1", "Column 2", "Column 3", "Column 4"]);
  assert.deepEqual([layout.date, layout.amount, layout.description, layout.balance], [0, 1, 2, 3]);
  assert.equal(layout.dayFirst, true);
  assert.equal(layoutProblem(layout), null);
  // Kept under the names it was chosen by, so the next file finds it.
  assert.equal(bankFileSignature(text), "column 1|column 2|column 3|column 4");
  // Every row is a line: the first is not taken for headings.
  const read = importWithLayout(text, layout, { file: "CSVData.csv", account: "cba", currency: "AUD" });
  assert.deepEqual(read.transactions.map((t) => [t.date, t.amount]), [
    ["2026-07-01", 220000],
    ["2026-07-03", -4510],
    ["2026-07-05", -8900],
    ["2026-07-15", 330000],
  ]);
  assert.equal(read.problems.length, 0);
});

const SEVERAL = [
  "Date,Amount,Payee,Description,Reference,Account",
  "01/07/2025,-45.10,Woolworths,Groceries,,Everyday Account",
  "02/07/2025,1200.00,ACME Pty Ltd,Invoice 17,INV17,Business Cheque",
  "03/07/2025,-19.99,Netflix,Subscription,,Everyday Account",
].join("\n");

test("an Account column is found, and each line goes on the account it names", () => {
  const { layout, columns } = guessBankLayout(SEVERAL);
  assert.equal(columns[layout.account], "Account");
  assert.equal(columns[layout.payee], "Payee");
  const result = importWithLayout(SEVERAL, layout, { file: "f.csv", account: "chosen", accountLabel: "Chosen", currency: "AUD" });
  assert.deepEqual(
    result.transactions.map((t) => [t.account, t.extras.accountLabel, t.amount]),
    [
      ["everyday-account", "Everyday Account", -4510],
      ["business-cheque", "Business Cheque", 120000],
      ["everyday-account", "Everyday Account", -1999],
    ],
  );
  assert.equal(result.account, "everyday-account");
  // The same line on two accounts is two lines.
  const ids = new Set(result.transactions.map((t) => t.id));
  assert.equal(ids.size, 3);
});

test("a file whose Account column names one account goes on the account chosen, as before", () => {
  const one = SEVERAL.replace(/Business Cheque/g, "Everyday Account");
  const { layout } = guessBankLayout(one);
  const result = importWithLayout(one, layout, { file: "f.csv", account: "chosen", accountLabel: "Chosen", currency: "AUD" });
  assert.ok(result.transactions.every((t) => t.account === "chosen" && t.extras.accountLabel === "Chosen"));
  assert.equal(result.account, "chosen");
});

test("the other party's account is not the account", () => {
  const text = ["Date,Amount,Other Party Account,Description", "01/07/2025,-5.00,12-3456-7890123-00,Fee"].join("\n");
  assert.equal(guessBankLayout(text).layout.account, -1);
});

test("a layout kept before there was an Account column still reads", () => {
  const { layout } = guessBankLayout(US);
  const { account: _gone, ...old } = layout;
  const result = read(US, old);
  assert.ok(result.transactions.length === 2 && result.transactions.every((t) => t.account === "acct"));
});
