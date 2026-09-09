import assert from "node:assert/strict";
import test from "node:test";
import { ir10BoxForAccount, ir10Summary } from "../dist/index.js";

/**
 * The chart these were written against types Sales, Interest Income and
 * Capital Gain on Disposal all as "Revenue". That is ordinary, and it is why
 * the resolver must read the code before the type.
 */
const CHART = [
  ["200", "Revenue", 2, "Sales"],
  ["260", "Revenue", 10, "Other Revenue"],
  ["270", "Revenue", 7, "Interest Income"],
  ["300", "Other Income", 10, "Depreciation Recovered"],
  ["301", "Revenue", 10, "Capital Gain (Loss) on Disposal"],
  ["310", "Direct Costs", 4, "Cost of Goods Sold"],
  ["630", "Inventory", 5, "Inventory"],
  ["412", "Overhead", 16, "Consulting & Accounting"],
  ["413", "Expense", 23, "Subcontractors (GST Registered)"],
  ["414", "Expense", 23, "Subcontractors (Not GST Registered)"],
  ["416", "Overhead", 13, "Depreciation"],
  ["433", "Overhead", 14, "Insurance"],
  ["437", "Overhead", 15, "Interest Expense"],
  ["441", "Overhead", 16, "Legal expenses"],
  ["469", "Overhead", 18, "Rent"],
  ["473", "Overhead", 19, "Repairs and Maintenance"],
  ["477", "Overhead", 22, "Salaries"],
  ["478", "Overhead", 22, "KiwiSaver Employer Contributions"],
  ["400", "Overhead", 24, "Advertising"],
  ["446", "Expense", 24, "Low Value Assets <1K"],
  ["470", "Expense", 24, "Loss on sale of Fixed Assets"],
  ["506", "Expense", 24, "Stripe Fees"],
  ["507", "Expense", 24, "PayPal fees"],
  ["610", "Accounts Receivable", 27, "Accounts Receivable"],
  ["611", "Current Asset", 27, "less Provision for Doubtful Debts"],
  ["620", "Current Asset", 29, "Prepayments"],
  ["625", "Current Asset", 29, "Withholding tax paid"],
  ["730", "Fixed Asset", 31, "Paragliding Equipment"],
  ["800", "Accounts Payable", 34, "Accounts Payable"],
  ["900", "Non-current Liability", 35, "Loan"],
  ["910", "Non-current Liability", 37, "Loan from Director"],
  ["960", "Retained Earnings", 38, "Retained Earnings"],
  ["980", "Equity", 37, "Owner Drawings"],
  ["860", "Rounding", 38, "Rounding"],
  ["840", "Historical", 38, "Historical Adjustment"],
];

test("every account in a real chart lands in the box the IR10 expects", () => {
  const wrong = [];
  for (const [code, type, want, name] of CHART) {
    const got = ir10BoxForAccount(code, type);
    if (got !== want) wrong.push(`${code} ${name} (${type}): box ${got}, expected ${want}`);
  }
  assert.deepEqual(wrong, [], `mappings disagree:\n  ${wrong.join("\n  ")}`);
});

test("a specific code beats the account's type, or three revenues become sales", () => {
  // The bug this replaces: a type-first test returned box 2 for all three,
  // reporting interest received and a non-assessable capital gain as sales.
  assert.equal(ir10BoxForAccount("270", "Revenue"), 7, "interest received is box 7");
  assert.equal(ir10BoxForAccount("260", "Revenue"), 10, "other income is box 10");
  assert.equal(ir10BoxForAccount("301", "Revenue"), 10, "a capital gain is box 10, not sales");
  assert.equal(ir10BoxForAccount("200", "Revenue"), 2, "sales is still sales");
});

test("GST follows the side it is actually on", () => {
  // A refund owed by Inland Revenue is an asset; a return owed to them is a
  // liability. The same account carries both across one year.
  assert.equal(ir10BoxForAccount("820", "GST", 325500), 29, "a refund owed is an asset");
  assert.equal(ir10BoxForAccount("820", "GST", -120000), 34, "a return owed is a liability");
  assert.equal(ir10BoxForAccount("820", "GST", 0), 34, "nothing owed either way sits with liabilities");
});

test("income tax is not an IR10 expense", () => {
  // The form works to profit before tax, so the provision belongs in no box.
  assert.equal(ir10BoxForAccount("505", "Expense"), null);
});

test("an account this has never seen is placed by type, then by number", () => {
  assert.equal(ir10BoxForAccount("742", "Fixed Asset"), 31);
  assert.equal(ir10BoxForAccount("742", ""), 31, "the 700s are fixed assets");
  assert.equal(ir10BoxForAccount("455", ""), 24, "an unknown 400 is another expense");
  assert.equal(ir10BoxForAccount("Donation", "Expense"), 24, "a chart may use words for codes");
  assert.equal(ir10BoxForAccount("", ""), null, "nothing at all maps to nothing");
});

test("a bank account with no chart code is cash at bank", () => {
  assert.equal(ir10BoxForAccount("02-1100-0022001-001", "Bank"), 28);
});

// --- filling the form in ---

const SUMMARY_CHART = [
  { code: "200", name: "Sales", type: "Revenue" },
  { code: "270", name: "Interest Income", type: "Revenue" },
  { code: "300", name: "Depreciation Recovered", type: "Other Income" },
  { code: "301", name: "Capital Gain (Loss) on Disposal", type: "Revenue" },
  { code: "310", name: "Cost of Goods Sold", type: "Direct Costs" },
  { code: "400", name: "Advertising", type: "Overhead" },
  { code: "416", name: "Depreciation", type: "Overhead" },
  { code: "477", name: "Salaries", type: "Overhead" },
  { code: "610", name: "Accounts Receivable", type: "Accounts Receivable" },
  { code: "630", name: "Inventory", type: "Inventory" },
  { code: "730", name: "Equipment", type: "Fixed Asset" },
  { code: "800", name: "Accounts Payable", type: "Accounts Payable" },
  { code: "910", name: "Loan from Director", type: "Current Liability" },
  { code: "960", name: "Retained Earnings", type: "Retained Earnings" },
];

const jn = (date, lines) => ({
  transactionId: date, date, narration: "", lines, source: "bank", taxBasis: "payments",
});
const ln = (code, name, amount) => ({
  accountCode: code, accountName: name, amount, taxType: "NONE", description: "",
});

const YEAR = { yearEnding: "2026-03-31", yearStarting: "2025-04-01", chart: SUMMARY_CHART };

test("income goes to the box it belongs in, not all to sales", () => {
  const s = ir10Summary({
    ...YEAR,
    journals: [
      jn("2025-06-01", [ln("BNZ", "BNZ", 200000), ln("200", "Sales", -200000)]),
      jn("2025-07-01", [ln("BNZ", "BNZ", 5000), ln("270", "Interest Income", -5000)]),
      jn("2025-08-01", [ln("BNZ", "BNZ", 30000), ln("301", "Capital Gain", -30000)]),
      jn("2025-08-02", [ln("BNZ", "BNZ", 12000), ln("300", "Depreciation Recovered", -12000)]),
    ],
  });
  assert.equal(s.boxes[2].amount, 200000, "sales");
  assert.equal(s.boxes[7].amount, 5000, "interest received, box 7");
  assert.equal(s.boxes[10].amount, 42000, "capital gain and depreciation recovered, box 10");
  assert.equal(s.totalIncome, 247000);
});

test("a year of trading, and a position on a day, are not the same figure", () => {
  // Debtors is a balance carried in; sales is a year's movement. Reading one as
  // the other is how a return reports a year of sales as a debtor balance.
  const s = ir10Summary({
    ...YEAR,
    openingBalances: { asAt: "2025-04-01", accounts: { "610": 100000, "960": -100000 } },
    journals: [jn("2025-06-01", [ln("610", "Accounts Receivable", 50000), ln("200", "Sales", -50000)])],
  });
  assert.equal(s.boxes[2].amount, 50000, "the year's sales");
  assert.equal(s.boxes[27].amount, 150000, "debtors carried in, plus the year's");
});

test("the form's own arithmetic is done, not copied", () => {
  const s = ir10Summary({
    ...YEAR,
    journals: [
      jn("2025-06-01", [ln("BNZ", "BNZ", 500000), ln("200", "Sales", -500000)]),
      jn("2025-06-02", [ln("BNZ", "BNZ", -150000), ln("310", "Cost of Goods Sold", 150000)]),
      jn("2025-06-03", [ln("BNZ", "BNZ", -80000), ln("477", "Salaries", 80000)]),
      jn("2025-06-04", [ln("BNZ", "BNZ", -20000), ln("400", "Advertising", 20000)]),
    ],
  });
  assert.equal(s.boxes[4].amount, 150000, "purchases");
  assert.equal(s.grossProfit, 350000, "sales less purchases");
  assert.equal(s.boxes[22].amount, 80000, "salaries, box 22");
  assert.equal(s.boxes[24].amount, 20000, "advertising, other expenses");
  assert.equal(s.totalExpenses, 100000);
  assert.equal(s.netProfitBeforeTax, 250000);
  assert.equal(s.boxes[26].amount, s.netProfitBeforeTax);
});

test("stock is one account read at two dates", () => {
  // No mapping from a code alone can tell opening stock from closing stock:
  // it is the same account at the start and the end of the year.
  const s = ir10Summary({
    ...YEAR,
    openingBalances: { asAt: "2025-04-01", accounts: { "630": 40000, "960": -40000 } },
    journals: [jn("2025-09-01", [ln("630", "Inventory", 10000), ln("310", "Cost of Goods Sold", -10000)])],
  });
  assert.equal(s.boxes[3].amount, 40000, "opening stock");
  assert.equal(s.boxes[5].amount, 50000, "closing stock");
  // Gross profit = sales - opening + closing - purchases.
  assert.equal(s.grossProfit, 0 - 40000 + 50000 - -10000);
});

test("liabilities and equity come out positive, as the form asks", () => {
  const s = ir10Summary({
    ...YEAR,
    openingBalances: {
      asAt: "2025-04-01",
      accounts: { "730": 500000, "800": -60000, "910": -200000, "960": -240000 },
    },
    journals: [],
  });
  assert.equal(s.boxes[31].amount, 500000, "fixed assets");
  assert.equal(s.boxes[34].amount, 60000, "creditors, positive");
  assert.equal(s.boxes[37].amount, 200000, "shareholder account, positive");
  assert.equal(s.boxes[38].amount, 240000, "retained earnings, positive");
});

test("retained earnings at balance date includes the year just traded", () => {
  // Nothing has closed the year off, so the ledger still holds the opening
  // figure with the result sitting in the revenue and expense accounts. Left
  // like that, assets exceed liabilities and equity by exactly the profit.
  const s = ir10Summary({
    ...YEAR,
    openingBalances: { asAt: "2025-04-01", accounts: { "610": 100000, "960": -100000 } },
    journals: [jn("2025-06-01", [ln("BNZ", "BNZ", 60000), ln("200", "Sales", -60000)])],
  });
  assert.equal(s.netProfitBeforeTax, 60000);
  assert.equal(s.boxes[38].amount, 100000 + 60000, "opening, plus the year");
  assert.equal(
    s.totalAssets,
    s.totalLiabilities + s.totalEquity,
    "and the form's own check then holds",
  );
});

test("a journal before the year is a balance, not this year's trading", () => {
  const s = ir10Summary({
    ...YEAR,
    openingBalances: { asAt: "2024-04-01", accounts: {} },
    journals: [
      jn("2024-06-01", [ln("BNZ", "BNZ", 900000), ln("200", "Sales", -900000)]),
      jn("2025-06-01", [ln("BNZ", "BNZ", 100000), ln("200", "Sales", -100000)]),
    ],
  });
  assert.equal(s.boxes[2].amount, 100000, "only this year's sales");
  assert.equal(s.boxes[28].amount, 1000000, "but all the cash");
});

test("income tax paid is in no box at all", () => {
  const chart = [...SUMMARY_CHART, { code: "505", name: "Income Tax Expense", type: "Expense" }];
  const s = ir10Summary({
    ...YEAR,
    chart,
    journals: [jn("2025-06-01", [ln("BNZ", "BNZ", -70000), ln("505", "Income Tax Expense", 70000)])],
  });
  assert.equal(s.boxes[505], undefined);
  assert.equal(s.totalExpenses, 0, "the form works to profit before tax");
});
