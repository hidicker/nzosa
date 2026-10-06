import assert from "node:assert/strict";
import test from "node:test";
import { cashFlowActivity, cashFlowStatement } from "../dist/index.js";

const line = (id, account, date, amount, code) => ({ id, account, date, amount, otherParty: "", code });
const types = {
  "Sales - 200": "Revenue",
  "Rates - 420": "Expense",
  "GST - 820": "Current Liability",
  "Computer Equipment - 720": "Fixed Asset",
  "Loan - 900": "Current Liability",
  "Owner Drawings - 980": "Equity",
};

const transactions = [
  line("a", "bank1", "2025-04-10", 100000, "Sales - 200"),
  line("b", "bank1", "2025-05-01", -20000, "Rates - 420"),
  line("c", "bank1", "2025-06-01", -15000, "GST - 820"),
  line("d", "bank1", "2025-07-01", -250000, "Computer Equipment - 720"),
  line("e", "bank1", "2025-08-01", 500000, "Loan - 900"),
  line("f", "bank1", "2025-09-01", -30000, "Owner Drawings - 980"),
  line("g", "bank1", "2025-10-01", -5000, null),
  // A transfer between the entity's own accounts, and one to another entity's.
  line("t1", "bank1", "2025-11-01", -40000, null),
  line("t2", "bank2", "2025-11-01", 40000, null),
  line("x1", "bank1", "2025-12-01", -10000, null),
  line("x2", "other", "2025-12-01", 10000, null),
  // Before the period: carries the opening balance forward.
  line("p", "bank1", "2025-03-15", 7000, "Sales - 200"),
];

const statement = () =>
  cashFlowStatement({
    transactions,
    codeOf: (t) => t.code,
    typeOf: (code) => types[code] ?? null,
    period: { from: "2025-04-01", to: "2026-03-31" },
    banks: new Set(["bank1", "bank2"]),
    transfers: { t1: "t2", t2: "t1", x1: "x2", x2: "x1" },
    opening: { asAt: "2025-03-01", accounts: { bank1: 50000, bank2: 0 } },
  });

test("bank lines fall under operating, investing and financing by their account", () => {
  const s = statement();
  const [operating, investing, financing] = s.sections;
  assert.equal(operating.total, 100000 - 20000 - 15000 - 5000);
  assert.equal(s.uncodedCount, 1);
  assert.equal(investing.total, -250000);
  assert.equal(financing.total, 500000 - 30000 - 10000);
});

test("own transfers drop out, and the statement adds up from opening to closing cash", () => {
  const s = statement();
  assert.equal(s.openingCash, 57000);
  const sum = s.sections.reduce((t, x) => t + x.total, 0);
  assert.equal(sum, s.netChange);
  assert.equal(s.closingCash, s.openingCash + s.netChange);
  assert.equal(s.openingKnown, true);
});

test("a loan or drawings is financing whatever type it was given; money lent out is investing", () => {
  assert.equal(cashFlowActivity("Current Liability", "Loan - 900"), "financing");
  assert.equal(cashFlowActivity("Current Asset", "Loan to Tui Ridge"), "investing");
  assert.equal(cashFlowActivity("Equity", "Owner Funds Introduced"), "financing");
  assert.equal(cashFlowActivity("Expense", "Rates"), "operating");
});

test("a loan account is not cash: money moved to it is financing, by loan", () => {
  const s = cashFlowStatement({
    transactions: [
      line("r", "bank1", "2025-05-01", 200000, "Sales - 200"),
      line("l1", "bank1", "2025-06-01", -97170, null),
      line("l2", "home-loan", "2025-06-01", 97170, null),
      line("i", "home-loan", "2025-06-30", -50000, "Interest - 437"),
    ],
    codeOf: (t) => t.code,
    typeOf: (code) => types[code] ?? (code === "Interest - 437" ? "Expense" : null),
    period: { from: "2025-04-01", to: "2026-03-31" },
    banks: new Set(["bank1", "home-loan"]),
    loanAccounts: new Set(["home-loan"]),
    accountName: (a) => (a === "home-loan" ? "Home Loan" : a),
    transfers: { l1: "l2", l2: "l1" },
  });
  const financing = s.sections[2];
  assert.equal(financing.lines[0].label, "Loan repayments and drawdowns: Home Loan");
  assert.equal(financing.total, -97170);
  // The loan's own lines -- interest charged to it -- are not cash moving.
  assert.equal(s.netChange, 200000 - 97170);
});
