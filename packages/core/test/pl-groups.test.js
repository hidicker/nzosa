import assert from "node:assert/strict";
import test from "node:test";
import { formatProfitAndLoss, groupProfitAndLoss, plClassForType } from "../dist/index.js";

const line = (code, net) => ({ code, gross: net, gst: 0, net, count: 1, transactionIds: [code] });

// The shape of a real year: sales and a gain on disposal as trading income,
// cost of goods as the cost of sales, a depreciation recovery as other income,
// and overheads. Income arrives positive, expenses negative.
const TYPES = {
  "Sales - 200": "Revenue",
  "Capital Gain (Loss) on Disposal of Assets - 301": "Revenue",
  "Cost of Goods Sold - 310": "Direct Costs",
  "Depreciation Recovered - 300": "Other Income",
  "Advertising - 400": "Overhead",
  "ACC Levy Expenses - 401": "Expense",
  "Depreciation - 416": "Depreciation",
};
const classOf = (code) => (TYPES[code] ? plClassForType(TYPES[code]) : null);

const report = (income, expenses) => {
  const totalIncome = income.reduce((s, l) => s + l.net, 0);
  const totalExpenses = expenses.reduce((s, l) => s - l.net, 0);
  return {
    period: { from: "2025-04-01", to: "2026-03-31" },
    income, expenses, unclassified: [],
    totalIncome, totalExpenses, netProfit: totalIncome - totalExpenses,
    uncoded: { count: 0, gross: 0 },
  };
};

const REAL = report(
  [line("Sales - 200", 8496961), line("Capital Gain (Loss) on Disposal of Assets - 301", 26086),
   line("Depreciation Recovered - 300", 33986)],
  [line("Cost of Goods Sold - 310", -3623210), line("Advertising - 400", -163929),
   line("ACC Levy Expenses - 401", -4459), line("Depreciation - 416", -1987726)],
);

test("each account type sits under the heading an accountant would put it", () => {
  assert.equal(plClassForType("Revenue"), "trading");
  assert.equal(plClassForType("Sales"), "trading");
  assert.equal(plClassForType("Direct Costs"), "costOfSales");
  assert.equal(plClassForType("Other Income"), "otherIncome");
  assert.equal(plClassForType("Overhead"), "operatingExpenses");
  assert.equal(plClassForType("Expense"), "operatingExpenses");
  assert.equal(plClassForType("depreciation"), "operatingExpenses", "case does not matter");
  assert.equal(plClassForType("Current Asset"), null, "a balance sheet account has no heading");
});

test("the headings carry the figures the other system prints", () => {
  // The same year in Xero: trading 85,230.47, cost of sales 36,232.10, gross
  // profit 48,998.37, other income 339.86.
  const g = groupProfitAndLoss(REAL, classOf);
  assert.equal(g.trading.total, 8523047);
  assert.equal(g.costOfSales.total, 3623210);
  assert.equal(g.grossProfit, 4899837);
  assert.equal(g.otherIncome.total, 33986);
  assert.deepEqual(g.trading.lines.map((l) => l.code),
    ["Capital Gain (Loss) on Disposal of Assets - 301", "Sales - 200"]);
});

test("the grouping is a partition, so the net profit is the report's own to the cent", () => {
  const g = groupProfitAndLoss(REAL, classOf);
  assert.equal(g.netProfit, REAL.netProfit);
  const counted = g.trading.lines.length + g.costOfSales.lines.length +
    g.otherIncome.lines.length + g.operatingExpenses.lines.length;
  assert.equal(counted, REAL.income.length + REAL.expenses.length, "every line, once");
});

test("other income is kept out of the gross profit", () => {
  // A depreciation recovery is not the business earning its keep, and folding
  // it into trading would flatter the one figure that says whether it does.
  const g = groupProfitAndLoss(REAL, classOf);
  assert.equal(g.grossProfit, g.trading.total - g.costOfSales.total);
  assert.ok(!g.trading.lines.some((l) => l.code.startsWith("Depreciation Recovered")));
});

test("lines are alphabetical within a heading, not ordered by size", () => {
  const g = groupProfitAndLoss(REAL, classOf);
  assert.deepEqual(g.operatingExpenses.lines.map((l) => l.code),
    ["ACC Levy Expenses - 401", "Advertising - 400", "Depreciation - 416"]);
});

test("a line with no known type still lands somewhere, and the totals stay whole", () => {
  const r = report([line("Mystery income", 1000)], [line("Mystery cost", -400)]);
  const g = groupProfitAndLoss(r, () => null);
  assert.equal(g.trading.lines.length, 1, "unlabelled income is trading income");
  assert.equal(g.operatingExpenses.lines.length, 1, "an unlabelled expense is an operating expense");
  assert.equal(g.netProfit, r.netProfit);
});

test("a year with no cost of sales has a gross profit equal to its trading income", () => {
  const r = report([line("Sales - 200", 5000)], [line("Advertising - 400", -1000)]);
  const g = groupProfitAndLoss(r, classOf);
  assert.equal(g.costOfSales.lines.length, 0);
  assert.equal(g.grossProfit, 5000);
  assert.equal(g.netProfit, 4000);
});

test("the export follows the headings when asked to, and keeps the old shape when not", () => {
  const grouped = formatProfitAndLoss(REAL, "Test", "note", classOf);
  for (const heading of ["Trading Income", "Total Cost of Sales", "Gross Profit",
                         "Total Other Income", "Total Operating Expenses", "Net Profit"]) {
    assert.ok(grouped.includes(heading), heading);
  }
  const plain = formatProfitAndLoss(REAL, "Test", "note");
  assert.ok(plain.includes("Total Income"));
  assert.ok(!plain.includes("Gross Profit"));
});

test("an account that nets to nothing is left off, and the totals do not move", () => {
  // Interest posted and then reversed at year end nets to zero, and printed a
  // line reading "-0.00" that the other system does not show.
  const r = report(
    [line("Sales - 200", 5000), line("Other Revenue - 260", 0)],
    [line("Advertising - 400", -1000), line("Interest Expense - 437", -0)],
  );
  const g = groupProfitAndLoss(r, (code) => (code.includes("Interest") || code.includes("Advertising")
    ? "operatingExpenses" : "trading"));
  assert.deepEqual(g.trading.lines.map((l) => l.code), ["Sales - 200"]);
  assert.deepEqual(g.operatingExpenses.lines.map((l) => l.code), ["Advertising - 400"]);
  assert.equal(g.netProfit, r.netProfit);
});
