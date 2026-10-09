import assert from "node:assert/strict";
import test from "node:test";
import { defaultIr9Class, emptyIr9Inputs, incomeAndExpenses, ir9Rows, ir9Worksheet } from "../dist/index.js";

const chart = [
  { code: "200", name: "Subscriptions", type: "Revenue", taxCode: "", description: "" },
  { code: "210", name: "Donations", type: "Revenue", taxCode: "", description: "" },
  { code: "250", name: "Hall hire", type: "Revenue", taxCode: "", description: "" },
  { code: "270", name: "Interest received", type: "Other Income", taxCode: "", description: "" },
  { code: "469", name: "Rent and rates", type: "Expense", taxCode: "", description: "" },
  { code: "477", name: "Coaching", type: "Expense", taxCode: "", description: "" },
];

function line(code, amount) {
  return { accountCode: code, accountName: code, amount, taxType: "NONE", description: "" };
}
function journal(date, ...lines) {
  return { transactionId: date + lines[0].accountCode, date, narration: "", lines, source: "bank", taxBasis: "both" };
}

const journals = [
  journal("2026-05-01", line("cheque", 300_000), line("200", -300_000)), // subscriptions
  journal("2026-05-02", line("cheque", 50_000), line("210", -50_000)), // donations
  journal("2026-06-01", line("cheque", 240_000), line("250", -240_000)), // hall hire
  journal("2026-09-30", line("cheque", 6_000), line("270", -6_000)), // interest
  journal("2026-08-05", line("469", 120_000), line("cheque", -120_000)), // rent and rates
  journal("2026-08-10", line("477", 80_000), line("cheque", -80_000)), // coaching
  journal("2025-12-01", line("cheque", 99_999), line("250", -99_999)), // last year
];
const { income, expenses } = incomeAndExpenses({ journals, chart, from: "2026-04-01", to: "2027-03-31" });

test("the year's income and expense accounts come from its postings", () => {
  assert.deepEqual(income.map((a) => [a.name, a.amount]).sort(), [["Donations", 50_000], ["Hall hire", 240_000], ["Interest received", 6_000], ["Subscriptions", 300_000]]);
  assert.deepEqual(expenses.map((a) => [a.name, a.amount]).sort(), [["Coaching", 80_000], ["Rent and rates", 120_000]]);
});

test("subscriptions and gifts are not income; interest is interest; the rest is trading", () => {
  assert.equal(defaultIr9Class({ name: "Subscriptions" }), "notIncome");
  assert.equal(defaultIr9Class({ name: "Membership levies" }), "notIncome");
  assert.equal(defaultIr9Class({ name: "Donations" }), "notIncome");
  assert.equal(defaultIr9Class({ name: "Grants" }), "notIncome");
  assert.equal(defaultIr9Class({ name: "Interest received" }), "interest");
  assert.equal(defaultIr9Class({ name: "Dividends" }), "dividends");
  assert.equal(defaultIr9Class({ name: "Hall hire" }), "other");
});

test("taxable income is the taxable sources less the costs of earning them", () => {
  const inputs = { ...emptyIr9Inputs(), shares: { "469": 50 } }; // half of the rent and rates went on the hall
  const sheet = ir9Worksheet({ income, expenses, inputs });
  assert.equal(sheet.incomeBy.notIncome, 350_000, "subscriptions and donations are left out");
  assert.equal(sheet.deductibleExpenses, 60_000);
  assert.equal(sheet.box.interest, 6_000);
  assert.equal(sheet.box.otherNet, 240_000 - 60_000);
  assert.equal(sheet.box.totalIncome, 186_000);
  assert.equal(sheet.box.taxableIncome, 186_000, "no deduction approved, no losses");
});

test("the $1,000 deduction is the smaller of income and $1,000, and only if approved", () => {
  const base = { income, expenses, inputs: { ...emptyIr9Inputs(), shares: {} } };
  assert.equal(ir9Worksheet({ ...base, inputs: { ...base.inputs, deductionApproved: false } }).box.nonProfitDeduction, 0);
  const approved = ir9Worksheet({ ...base, inputs: { ...base.inputs, deductionApproved: true } });
  assert.equal(approved.box.nonProfitDeduction, 100_000);
  assert.equal(approved.box.afterDeduction, 246_000 - 100_000);
  // Income under $1,000: no taxable income.
  const small = ir9Worksheet({ income: [{ code: "270", name: "Interest received", amount: 80_000 }], expenses: [], inputs: { ...emptyIr9Inputs(), deductionApproved: true } });
  assert.equal(small.box.nonProfitDeduction, 80_000);
  assert.equal(small.box.taxableIncome, 0);
  // A loss: nothing to deduct, and the loss stays a loss.
  const loss = ir9Worksheet({ income: [], expenses: [{ code: "469", name: "Rent", amount: 50_000 }], inputs: { ...emptyIr9Inputs(), shares: { "469": 100 }, deductionApproved: true } });
  assert.equal(loss.box.nonProfitDeduction, 0);
  assert.equal(loss.box.taxableIncome, -50_000);
});

test("the exempt kinds have no deduction, and no return when none of the funds can benefit members", () => {
  const exempt = ir9Worksheet({ income, expenses, inputs: { ...emptyIr9Inputs(), exemptKind: true, privateBenefit: false } });
  assert.equal(exempt.exempt, true);
  assert.match(exempt.exemptReason, /does not need to file/);
  const benefit = ir9Worksheet({ income, expenses, inputs: { ...emptyIr9Inputs(), exemptKind: true, privateBenefit: true, deductionApproved: true } });
  assert.equal(benefit.exempt, false);
  assert.equal(benefit.box.nonProfitDeduction, 0, "not available to the exempt kinds");
});

test("donations are deducted up to income after expenses, for the societies that may", () => {
  const inputs = { ...emptyIr9Inputs(), donationsAllowed: true, donations: 500_000 };
  const sheet = ir9Worksheet({ income, expenses, inputs });
  assert.equal(sheet.box.donations, 246_000, "capped at the net income");
  assert.equal(sheet.box.netIncome, 0);
  assert.equal(ir9Worksheet({ income, expenses, inputs: { ...inputs, donationsAllowed: false } }).box.donations, 0);
  assert.equal(ir9Worksheet({ income, expenses, inputs: { ...emptyIr9Inputs(), donationsAllowed: true, donations: 5_000 } }).box.donations, 5_000);
});

test("losses brought forward come off, and an incorporated body pays 28%", () => {
  const inputs = { ...emptyIr9Inputs(), incorporated: true, lossBroughtForward: 46_000, rwt: 1_000 };
  const sheet = ir9Worksheet({ income, expenses, inputs });
  assert.equal(sheet.box.taxableIncome, 246_000 - 46_000);
  assert.equal(sheet.tax, 56_000);
  assert.equal(sheet.toPay, 55_000, "after the tax already deducted");
  assert.match(sheet.taxNote, /28 cents/);
  const plain = ir9Worksheet({ income, expenses, inputs: { ...emptyIr9Inputs(), incorporated: false } });
  assert.equal(plain.tax, null);
  assert.match(plain.taxNote, /individual tax rates/);
});

test("the rows follow the form's order", () => {
  const rows = ir9Rows(ir9Worksheet({ income, expenses, inputs: emptyIr9Inputs() }));
  assert.deepEqual(rows.map((r) => r.box), ["14", "14A", "14B", "14C", "14D", "14E", "14F", "15", "16", "17", "18", "19"]);
});
