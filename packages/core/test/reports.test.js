import assert from "node:assert/strict";
import test from "node:test";
import { profitAndLoss, accrualProfitAndLoss, formatProfitAndLoss } from "../dist/reports.js";

const period = { from: "2025-04-01", to: "2026-03-31" };

const bank = (id, amount, date = "2025-06-01") => ({
  id,
  date,
  amount,
  currency: "NZD",
  account: "bank-01",
  serial: "",
  trn: "",
  particulars: "",
  code: "",
  reference: "",
  otherParty: "",
  origin: "",
  type: "",
  batch: "",
  otherPartyAccount: "",
});

// A sale of $230 banked and a cost of $115 paid, both standard-rated.
const cashOptions = (extra = {}) => ({
  period,
  codeOf: (transaction) => (transaction.amount > 0 ? "200" : "400"),
  classify: (transaction) => ({
    treatment: "standard",
    side: transaction.amount > 0 ? "sales" : "purchases",
  }),
  sectionOf: (code) => (code === "200" ? "income" : "expenses"),
  ...extra,
});

const sales = () => [bank("in", 23000), bank("out", -11500)];

test("cash basis excludes GST by default", () => {
  const report = profitAndLoss(sales(), cashOptions());

  assert.equal(report.income[0].gross, 23000);
  assert.equal(report.income[0].gst, 3000);
  assert.equal(report.income[0].net, 20000);
  assert.equal(report.expenses[0].net, -10000);

  assert.equal(report.totalIncome, 20000);
  assert.equal(report.totalExpenses, 10000);
  assert.equal(report.netProfit, 10000);
});

test("cash basis including GST reports what moved through the bank", () => {
  const report = profitAndLoss(sales(), cashOptions({ includeGst: true }));

  assert.equal(report.totalIncome, 23000);
  assert.equal(report.totalExpenses, 11500);
  assert.equal(report.netProfit, 11500);

  // The tax is still reported beside it rather than lost.
  assert.equal(report.income[0].gst, 3000);
  assert.equal(report.income[0].gross, 23000);
});

// The same two events as journals, posted the way this app posts them: the
// expense is a debit, the sale a credit, and the tax sits on its own line in
// the GST control account.
const ourJournals = () => [
  {
    id: "j1",
    date: "2025-06-01",
    narration: "Sale",
    postedDate: "2025-06-01",
    postedBy: "test",
    lines: [
      { accountCode: "200", accountName: "Sales", description: "", amount: -20000, taxBase: 23000, line: 1 },
      { accountCode: "820", accountName: "GST", description: "", amount: -3000, line: 2 },
    ],
  },
  {
    id: "j2",
    date: "2025-06-01",
    narration: "Cost",
    postedDate: "2025-06-01",
    postedBy: "test",
    lines: [
      { accountCode: "400", accountName: "Costs", description: "", amount: 10000, taxBase: -11500, line: 1 },
      { accountCode: "820", accountName: "GST", description: "", amount: 1500, line: 2 },
    ],
  },
];

const accrualOptions = (extra = {}) => ({
  period,
  sectionOf: (code) => (code === "200" ? "income" : code === "400" ? "expenses" : null),
  labelOf: (line) => line.accountCode,
  ...extra,
});

test("accrual basis is already net, and the GST account is not income or expense", () => {
  const report = accrualProfitAndLoss(ourJournals(), accrualOptions());

  assert.equal(report.totalIncome, 20000);
  assert.equal(report.totalExpenses, 10000);
  assert.equal(report.netProfit, 10000);
  assert.equal(report.income.length, 1);
  assert.equal(report.expenses.length, 1);
  // 820 has no section, so it is listed rather than dropped.
  assert.deepEqual(report.unclassified.map((line) => line.code), ["820"]);
});

test("accrual basis recovers the gross from the figure the tax was worked out from", () => {
  const report = accrualProfitAndLoss(ourJournals(), accrualOptions({ includeGst: true }));

  // The sign is the trap here: a journal line's amount reads the opposite way
  // round to a profit and loss, but its taxBase already reads the same way.
  // Getting that wrong turns income negative and costs into profit.
  assert.equal(report.totalIncome, 23000);
  assert.equal(report.totalExpenses, 11500);
  assert.equal(report.netProfit, 11500);
});

test("accrual gross equals net where nothing records what the tax came from", () => {
  // A ledger read from somebody else's file: same journals, no taxBase.
  const stripped = ourJournals().map((journal) => ({
    ...journal,
    lines: journal.lines.map(({ taxBase, ...line }) => line),
  }));

  const report = accrualProfitAndLoss(stripped, accrualOptions({ includeGst: true }));

  assert.equal(report.totalIncome, 20000);
  assert.equal(report.totalExpenses, 10000);
  for (const line of [...report.income, ...report.expenses]) {
    assert.equal(line.gross, line.net);
    assert.equal(line.gst, 0);
  }
});

test("the exported file states the basis it was built on", () => {
  const report = profitAndLoss(sales(), cashOptions({ includeGst: true }));
  const csv = formatProfitAndLoss(report, "Test — Profit and Loss", "Cash basis. GST inclusive.");

  assert.match(csv, /Cash basis\. GST inclusive\./);
  assert.doesNotMatch(csv, /GST exclusive/);
});
