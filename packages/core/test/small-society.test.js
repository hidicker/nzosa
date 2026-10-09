import assert from "node:assert/strict";
import test from "node:test";
import { currentAssetsAt, operatingPaymentsFrom, reportingStandard, smallSocietyProblems, smallSocietyReportHtml, smallSocietyStatements, standardName } from "../dist/index.js";

const ok = { registeredCharity: false, donee: false, operatingPayments: [4_000_000, 3_000_000], currentAssets: [2_000_000, 1_000_000] };

test("a society under $50,000 in both measures for two years is a small society", () => {
  const r = reportingStandard(ok);
  assert.equal(r.standard, "small-society");
  assert.match(r.reasons.join(" "), /under \$50,000/);
});

test("failing either measure in either year takes it to Tier 4", () => {
  assert.equal(reportingStandard({ ...ok, operatingPayments: [5_000_000, 1_000] }).standard, "tier-4");
  assert.equal(reportingStandard({ ...ok, currentAssets: [1_000, 5_000_000] }).standard, "tier-4");
  assert.equal(reportingStandard({ ...ok, operatingPayments: [4_999_999, 4_999_999] }).standard, "small-society");
});

test("a charity or a donee organisation is never a small society", () => {
  const charity = reportingStandard({ ...ok, registeredCharity: true });
  assert.equal(charity.standard, "tier-4");
  assert.match(charity.reasons.join(" "), /registered charity/);
  assert.match(reportingStandard({ ...ok, donee: true }).reasons.join(" "), /donee organisation/);
});

test("$140,000 or more of operating payments is Tier 3", () => {
  assert.equal(reportingStandard({ ...ok, registeredCharity: true, operatingPayments: [14_000_000, 100] }).standard, "tier-3");
  assert.equal(reportingStandard({ ...ok, registeredCharity: true, operatingPayments: [100, 100], thisYearPayments: 14_000_000 }).standard, "tier-3");
  assert.equal(reportingStandard({ ...ok, registeredCharity: true, operatingPayments: [13_999_999, 100] }).standard, "tier-4");
  assert.equal(standardName("tier-3"), "Tier 3 (NFP), accrual");
});

const chart = [
  { code: "200", name: "Subscriptions", type: "Revenue", taxCode: "", description: "" },
  { code: "250", name: "Hall hire", type: "Revenue", taxCode: "", description: "" },
  { code: "469", name: "Rent", type: "Expense", taxCode: "", description: "" },
  { code: "416", name: "Depreciation", type: "Depreciation", taxCode: "", description: "" },
  { code: "100", name: "Cheque account", type: "Bank", taxCode: "", description: "" },
  { code: "610", name: "Debtors", type: "Current Asset", taxCode: "", description: "" },
  { code: "740", name: "Equipment", type: "Fixed Asset", taxCode: "", description: "" },
  { code: "800", name: "Creditors", type: "Accounts Payable", taxCode: "", description: "" },
  { code: "850", name: "Loan from the bank", type: "Non-current Liability", taxCode: "", description: "" },
  { code: "970", name: "Accumulated funds", type: "Equity", taxCode: "", description: "" },
];
const line = (code, amount) => ({ accountCode: code, accountName: code, amount, taxType: "NONE", description: "" });
const journal = (date, ...lines) => ({ transactionId: date + lines[0].accountCode, date, narration: "", lines, source: "manual", taxBasis: "both" });
const journals = [
  journal("2025-04-01", line("100", 1_000_000), line("740", 500_000), line("970", -1_500_000)),
  journal("2025-06-01", line("100", 300_000), line("200", -300_000)),
  journal("2025-07-01", line("610", 40_000), line("250", -40_000)),
  journal("2025-08-01", line("469", 120_000), line("100", -120_000)),
  journal("2025-09-01", line("416", 50_000), line("740", -50_000)),
  journal("2025-10-01", line("469", 30_000), line("800", -30_000)),
  journal("2025-11-01", line("100", 200_000), line("850", -200_000)),
  journal("2024-03-01", line("100", 999_999), line("200", -999_999)),
];
const s = smallSocietyStatements({ journals, chart, from: "2025-04-01", to: "2026-03-31" });

test("income and expenditure for the year, and assets and liabilities at its end, come from the books", () => {
  assert.equal(s.totalIncome, 340_000);
  assert.equal(s.totalExpenses, 200_000);
  assert.equal(s.surplus, 140_000);
  assert.deepEqual(s.currentAssets.map((a) => [a.name, a.amount]), [["Cheque account", 1_000_000 + 300_000 - 120_000 + 200_000 + 999_999], ["Debtors", 40_000]]);
  assert.deepEqual(s.fixedAssets.map((a) => [a.name, a.amount]), [["Equipment", 450_000]]);
  assert.deepEqual(s.currentLiabilities.map((a) => [a.name, a.amount]), [["Creditors", 30_000]]);
  assert.deepEqual(s.nonCurrentLiabilities.map((a) => [a.name, a.amount]), [["Loan from the bank", 200_000]]);
  assert.equal(s.netAssets, s.totalAssets - s.totalLiabilities);
});

test("operating payments leave out depreciation, and current assets are those at the year end", () => {
  assert.equal(operatingPaymentsFrom(s.expenses), 150_000);
  assert.equal(currentAssetsAt(s), 1_000_000 + 300_000 - 120_000 + 200_000 + 999_999 + 40_000);
});

test("the report says what the Companies Office asks for, and a line for two signatures", () => {
  const html = smallSocietyReportHtml({ name: "Kowhai Tennis Club", statements: s, securityInterests: "", signers: ["Ana Totara", "Hemi Rimu"], approvedOn: "2026-06-30" });
  for (const needle of ["Income and expenditure for the year", "Assets and liabilities at 31 March 2026", "Mortgages, charges and other security interests", "There were no mortgages, charges or other security interests", "Ana Totara", "Hemi Rimu", "Approved 30 June 2026", "Surplus for the year", "Net assets (accumulated funds)", "Non-current liabilities"]) {
    assert.ok(html.includes(needle), needle);
  }
  const held = smallSocietyReportHtml({ name: "K", statements: s, securityInterests: "A mortgage over the clubhouse", signers: ["A", "B"] });
  assert.ok(held.includes("A mortgage over the clubhouse"));
  assert.ok(!held.includes("There were no mortgages"));
  assert.ok(held.includes("Date approved: ____"));
});

test("two different committee members must sign", () => {
  assert.equal(smallSocietyProblems({ statements: s, signers: ["A B", "C D"] }).length, 0);
  assert.match(smallSocietyProblems({ statements: s, signers: ["", "C D"] }).join(" "), /Two committee members/);
  assert.match(smallSocietyProblems({ statements: s, signers: ["A B", "a b"] }).join(" "), /two different/);
});
