import assert from "node:assert/strict";
import test from "node:test";
import { statementFromFigures, tier3ExpenseOf, tier3Problems, tier3ReportHtml, tier3RevenueOf, tier3Statements } from "../dist/index.js";

const A = (code, name, type) => ({ code, name, type, taxCode: "", description: "" });
const chart = [
  A("100", "Cheque account", "Bank"),
  A("110", "Overdraft account", "Bank"),
  A("200", "Subscriptions", "Revenue"),
  A("210", "Donations", "Revenue"),
  A("220", "Council service delivery contract", "Revenue"),
  A("225", "Capital grant for the new hall", "Revenue"),
  A("230", "Hall hire", "Revenue"),
  A("270", "Interest received", "Other Income"),
  A("412", "Fundraising costs", "Expense"),
  A("420", "Wages", "Expense"),
  A("425", "Grants paid", "Expense"),
  A("430", "Programme costs", "Expense"),
  A("416", "Depreciation", "Depreciation"),
  A("437", "Income tax", "Expense"),
  A("610", "Debtors", "Accounts Receivable"),
  A("620", "Stock on hand", "Inventory"),
  A("740", "Equipment", "Fixed Asset"),
  A("750", "Shares in a fund", "Non-current Asset"),
  A("800", "Creditors", "Accounts Payable"),
  A("810", "PAYE payable", "Current Liability"),
  A("820", "Grants received in advance", "Current Liability"),
  A("850", "Bank loan", "Non-current Liability"),
  A("960", "Special purpose fund", "Equity"),
  A("970", "Accumulated funds", "Equity"),
];
const line = (code, amount) => ({ accountCode: code, accountName: code, amount, taxType: "NONE", description: "" });
const journal = (date, ...lines) => ({ transactionId: date + lines[0].accountCode, date, narration: "", lines, source: "manual", taxBasis: "both" });
const journals = [
  journal("2025-04-01", line("100", 2_000_000), line("740", 800_000), line("970", -2_500_000), line("960", -300_000)),
  journal("2025-05-01", line("100", 100_000), line("200", -100_000)),
  journal("2025-05-02", line("100", 60_000), line("210", -60_000)),
  journal("2025-05-03", line("610", 500_000), line("220", -500_000)),
  journal("2025-05-04", line("100", 250_000), line("225", -250_000)),
  journal("2025-05-05", line("100", 40_000), line("230", -40_000)),
  journal("2025-05-06", line("100", 2_000), line("270", -2_000)),
  journal("2025-06-01", line("412", 30_000), line("100", -30_000)),
  journal("2025-06-02", line("420", 200_000), line("810", -50_000), line("100", -150_000)),
  journal("2025-06-03", line("425", 20_000), line("100", -20_000)),
  journal("2025-06-04", line("430", 100_000), line("800", -100_000)),
  journal("2025-06-05", line("416", 80_000), line("740", -80_000)),
  journal("2025-06-06", line("437", 1_000), line("100", -1_000)),
  journal("2025-07-01", line("100", 400_000), line("820", -400_000)),
  journal("2025-07-02", line("100", 300_000), line("850", -300_000)),
  journal("2025-07-03", line("620", 90_000), line("100", -90_000)),
  journal("2025-07-04", line("750", 150_000), line("100", -150_000)),
];
const s = tier3Statements({ journals, chart, from: "2025-04-01", to: "2026-03-31" });

test("accounts are sorted into the standard's revenue and expense categories", () => {
  assert.equal(tier3RevenueOf({ name: "Capital grant for the new hall", type: "Revenue" }, "generalGrants"), "capitalGrants");
  assert.equal(tier3RevenueOf({ name: "Council contract", type: "Revenue" }, "serviceGrants"), "governmentService");
  assert.equal(tier3RevenueOf({ name: "Trust contract", type: "Revenue" }, "serviceGrants"), "otherService");
  assert.equal(tier3ExpenseOf("fundraisingCosts"), "fundraising");
  assert.equal(tier3ExpenseOf("costOfSales"), "commercial");
  assert.equal(tier3ExpenseOf("gst"), "other");
  const byKey = Object.fromEntries(s.revenue.map((g) => [g.key, g.total]));
  assert.deepEqual(byKey, { donations: 60_000, capitalGrants: 250_000, governmentService: 500_000, membership: 100_000, commercial: 40_000, investment: 2_000 });
  const spent = Object.fromEntries(s.expenses.map((g) => [g.key, g.total]));
  assert.deepEqual(spent, { fundraising: 30_000, employee: 200_000, service: 100_000, grantsPaid: 20_000, other: 80_000 });
});

test("the surplus is revenue less expenses, with income tax below it", () => {
  assert.equal(s.totalRevenue, 952_000);
  assert.equal(s.totalExpenses, 430_000);
  assert.equal(s.surplus, 522_000);
  assert.equal(s.incomeTax, 1_000);
  assert.equal(s.surplusAfterTax, 521_000);
  assert.equal(s.depreciation, 80_000);
});

test("assets and liabilities are in the standard's categories, current and non-current", () => {
  const cur = Object.fromEntries(s.currentAssets.map((g) => [g.key, g.total]));
  assert.equal(cur.debtors, 500_000);
  assert.equal(cur.inventory, 90_000);
  assert.ok(cur.cash > 0);
  const non = Object.fromEntries(s.nonCurrentAssets.map((g) => [g.key, g.total]));
  assert.equal(non.property, 720_000);
  assert.equal(non.investments, 150_000);
  const liab = Object.fromEntries(s.currentLiabilities.map((g) => [g.key, g.total]));
  assert.equal(liab.creditors, 100_000);
  assert.equal(liab.employee, 50_000);
  assert.equal(liab.deferred, 400_000);
  assert.equal(s.nonCurrentLiabilities[0].key, "loans");
  assert.equal(s.nonCurrentLiabilities[0].total, 300_000);
  assert.equal(s.deferredRevenueNeeded, true);
});

test("net assets equal the accumulated funds, which are the funds, the earlier surplus and the year's", () => {
  assert.equal(s.netAssets, s.totalAssets - s.totalLiabilities);
  assert.equal(s.funds.reduce((sum, f) => sum + f.amount, 0), s.netAssets);
  assert.deepEqual(s.funds.map((f) => f.label).slice(-1), ["Surplus or deficit for the year"]);
  assert.equal(s.propertyNote[0].closing, 720_000);
  assert.equal(s.propertyNote[0].opening, 0);
});

test("an overdrawn bank account is a liability, not a negative asset", () => {
  const over = tier3Statements({ journals: [journal("2025-05-01", line("110", -50_000), line("970", 50_000))], chart, from: "2025-04-01", to: "2026-03-31" });
  assert.equal(over.currentLiabilities[0].key, "overdraft");
  assert.equal(over.currentLiabilities[0].total, 50_000);
  assert.equal(over.totalAssets, 0);
});

const figures = (year) => statementFromFigures(year, `${year - 1}-04-01`, `${year}-03-31`, { opening: 100, donations: 50 });
const performance = { activities: [{ what: "Coaching sessions", howMuch: "120" }], relatedParties: [], approvedBy: ["Ana Totara", "Hemi Rimu"], approvedOn: "2026-06-30" };
const inputs = { purpose: "To teach tennis", governance: "A committee elected at the AGM", volunteers: "Run entirely by volunteers" };

test("the report follows the standard's order and carries what it must say", () => {
  const html = tier3ReportHtml({ entity: { name: "Kowhai Tennis Club", legalForm: "Incorporated society" }, gstRegistered: false, statements: s, previous: null, cash: figures(2026), previousCash: figures(2025), inputs, performance });
  const order = ["Entity Information", "Statement of Service Performance", "Statement of Financial Performance", "Statement of Financial Position", "Statement of Cash Flows", "Statement of Accounting Policies", "Notes to the Performance Report"];
  let at = 0;
  for (const heading of order) {
    const found = html.indexOf(heading, at);
    assert.ok(found >= at, heading);
    at = found;
  }
  for (const needle of ["Donations, koha, bequests and other general fundraising activities", "Capital grants and donations", "Government service delivery grants and contracts", "Cash and short-term deposits", "Deferred revenue", "To teach tennis", "Coaching sessions", "all transactions are reported using the accrual basis".replace("all", "All"), "going concern", "Tier 3 (NFP) Standard", "Ana Totara", "Hemi Rimu", "not registered for GST", "whole dollars", "Year ended 31 March 2026"]) {
    assert.ok(html.includes(needle), needle);
  }
});

test("what is missing is said", () => {
  const problems = tier3Problems({ statements: s, inputs: {}, performance: { activities: [], relatedParties: [], approvedBy: [] }, gstRegistered: false });
  const text = problems.join(" | ");
  for (const needle of ["what the organisation is for", "governed", "volunteers", "service performance", "deferred revenue", "Two people approve"]) assert.ok(text.includes(needle), needle);
  assert.deepEqual(tier3Problems({ statements: { ...s, deferredRevenueNeeded: false, depreciation: 1 }, inputs, performance, gstRegistered: false }), []);
});
