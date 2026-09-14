import assert from "node:assert/strict";
import test from "node:test";
import { IR10_LAYOUT, ir10BoxForAccount, ir10Summary } from "../dist/index.js";

/**
 * A sample chart. It types Sales, Interest Income and a capital gain all as
 * "Revenue", which is ordinary, and is why the resolver reads the code first.
 */
const CHART = [
  { code: "200", name: "Sales", type: "Revenue" },
  { code: "270", name: "Interest Income", type: "Revenue" },
  { code: "300", name: "Depreciation Recovered", type: "Other Income" },
  { code: "301", name: "Capital Gain (Loss) on Disposal of Assets", type: "Revenue" },
  { code: "310", name: "Cost of Goods Sold", type: "Direct Costs" },
  { code: "400", name: "Advertising", type: "Overhead" },
  { code: "413", name: "Subcontractors", type: "Expense" },
  { code: "416", name: "Depreciation", type: "Overhead" },
  { code: "424", name: "Entertainment - Non deductible", type: "Overhead" },
  { code: "433", name: "Insurance", type: "Overhead" },
  { code: "470", name: "Loss on sale of Fixed Assets", type: "Expense" },
  { code: "610", name: "Accounts Receivable", type: "Accounts Receivable" },
  { code: "730", name: "Roasting Equipment", type: "Fixed Asset" },
  { code: "731", name: "Less Accumulated Depreciation on Roasting Equipment", type: "Fixed Asset" },
  { code: "740", name: "Motor Vehicle", type: "Fixed Asset" },
  { code: "741", name: "Less Accumulated Depreciation - Vehicles", type: "Fixed Asset" },
  { code: "800", name: "Accounts Payable", type: "Accounts Payable" },
  { code: "820", name: "GST", type: "GST" },
  { code: "910", name: "Loan from Director", type: "Non-current Liability" },
  { code: "960", name: "Retained Earnings", type: "Retained Earnings" },
  { code: "970", name: "Owner Funds Introduced", type: "Equity" },
  { code: "980", name: "Owner Drawings", type: "Equity" },
];

const jn = (date, lines) => ({
  transactionId: date, date, narration: "", lines, source: "manual", taxBasis: "both",
});
const ln = (code, amount) => ({
  accountCode: code, accountName: code, amount, taxType: "NONE", description: "",
});
const YEAR = { yearEnding: "2026-03-31", yearStarting: "2025-04-01", chart: CHART };
const box = (summary, n) => summary.boxes[n].amount;

test("the form has every box, in order, with its totals marked", () => {
  assert.deepEqual(IR10_LAYOUT.map((l) => l.box), Array.from({ length: 60 }, (_, i) => i + 1));
  assert.deepEqual(IR10_LAYOUT.filter((l) => l.total).map((l) => l.box), [6, 11, 25, 29, 43, 50]);
  const s = ir10Summary({ ...YEAR, journals: [] });
  assert.equal(Object.keys(s.boxes).length, 60);
  assert.equal(s.boxes[1].text, "No");
});

test("each account lands in the box the form expects", () => {
  for (const [code, type, name, expected] of [
    ["200", "Revenue", "Sales", 2],
    ["270", "Revenue", "Interest Income", 7],
    ["300", "Other Income", "Depreciation Recovered", 10],
    ["301", "Revenue", "Capital Gain (Loss) on Disposal", 53],
    ["310", "Direct Costs", "Cost of Goods Sold", 4],
    ["412", "Overhead", "Consulting & Accounting", 16],
    ["413", "Expense", "Subcontractors", 23],
    ["416", "Overhead", "Depreciation", 13],
    ["433", "Overhead", "Insurance", 14],
    ["437", "Overhead", "Interest Expense", 15],
    ["469", "Overhead", "Rent", 18],
    ["473", "Overhead", "Repairs and Maintenance", 19],
    ["477", "Overhead", "Salaries", 22],
    ["400", "Overhead", "Advertising", 24],
    ["401", "Overhead", "ACC Levy Expenses", 24],
    ["610", "Accounts Receivable", "Accounts Receivable", 30],
    ["BNK", "Bank", "Business Account", 31],
    ["620", "Current Asset", "Prepayments", 32],
    ["740", "Fixed Asset", "Motor Vehicle", 33],
    ["741", "Fixed Asset", "Less Accumulated Depreciation - Vehicles", 33],
    ["730", "Fixed Asset", "Roasting Equipment", 34],
    ["800", "Accounts Payable", "Accounts Payable", 45],
    ["900", "Non-current Liability", "Loan", 49],
    ["910", "Non-current Liability", "Loan from Director", 47],
    ["980", "Equity", "Owner Drawings", 47],
    ["960", "Retained Earnings", "Retained Earnings", 51],
  ]) {
    assert.equal(ir10BoxForAccount(code, type, 0, name), expected, `${code} ${name}`);
  }
  assert.equal(ir10BoxForAccount("505", "Expense", 0, "Income Tax Expense"), null, "income tax is in no box");
});

test("a capital gain is an untaxed realised gain, not income", () => {
  const s = ir10Summary({
    ...YEAR,
    journals: [
      jn("2025-06-01", [ln("BNK", 500000), ln("200", -500000)]),
      jn("2025-08-01", [ln("BNK", 30000), ln("301", -30000)]),
    ],
  });
  assert.equal(box(s, 10), 0, "not other income");
  assert.equal(box(s, 11), 500000, "not in total income");
  assert.equal(box(s, 53), 30000, "box 53");
});

test("totals are rounded from the exact figures, and the other boxes take the rounding", () => {
  // Rounded one box at a time these add up to a dollar either way of their
  // totals; a signed return rounds the totals and lets the "other" boxes take
  // the difference, so every total adds up.
  const s = ir10Summary({
    ...YEAR,
    journals: [
      jn("2025-06-01", [ln("BNK", 8496961), ln("200", -8496961)]),
      jn("2025-06-02", [ln("BNK", -3623210), ln("310", 3623210)]),
      jn("2025-06-03", [ln("BNK", 33986), ln("300", -33986)]),
      jn("2025-06-04", [ln("BNK", -1987726), ln("416", 1987726)]),
      jn("2025-06-05", [ln("BNK", -58031), ln("433", 58031)]),
      jn("2025-06-06", [ln("BNK", -329000), ln("413", 329000)]),
      jn("2025-06-07", [ln("BNK", -1566394), ln("400", 1566394)]),
    ],
  });
  assert.equal(box(s, 2), 8497000);
  assert.equal(box(s, 4), 3623200);
  assert.equal(box(s, 6), 4873800, "sales less purchases");
  assert.equal(box(s, 11), 4907700, "total income rounded from 49,077.37");
  assert.equal(box(s, 10), 33900, "other income takes the rounding: 339, not 340");
  assert.equal(box(s, 25), 3941200, "total expenses rounded from 39,411.51");
  assert.equal(box(s, 24), 1566500, "other expenses take the rounding");
  assert.equal(box(s, 27), 966500, "total income less total expenses");
});

test("non-deductible expenses are added back as tax adjustments", () => {
  const s = ir10Summary({
    ...YEAR,
    journals: [
      jn("2025-06-01", [ln("BNK", 100000), ln("200", -100000)]),
      jn("2025-06-02", [ln("BNK", -16997), ln("424", 16997)]),
    ],
  });
  assert.equal(box(s, 24), 17000, "an expense in the accounts");
  assert.equal(box(s, 28), 17000, "added back for tax");
  assert.equal(box(s, 29), box(s, 27) + box(s, 28));
  assert.equal(box(s, 52), box(s, 13), "tax depreciation taken to equal the accounting figure");
});

test("a shareholder's current account is a liability for a company, and equity otherwise", () => {
  const openingBalances = {
    asAt: "2025-04-01",
    accounts: { BNK: 1000000, "910": -600000, "960": -400000 },
  };
  const journals = [jn("2025-06-01", [ln("980", 200000), ln("BNK", -200000)])];

  const company = ir10Summary({ ...YEAR, openingBalances, journals });
  assert.equal(box(company, 43), 800000, "assets");
  assert.equal(box(company, 47), 400000, "the current account, net of drawings");
  assert.equal(box(company, 50), 400000);
  assert.equal(box(company, 51), 400000, "owners equity is what is left");
  assert.equal(box(company, 57), 200000, "drawings");
  assert.equal(box(company, 58), 400000, "current account at year end");
  assert.equal(company.imbalance, 0);

  const owner = ir10Summary({ ...YEAR, openingBalances, journals, currentAccountsAsLiabilities: false });
  assert.equal(box(owner, 47), 0);
  assert.equal(box(owner, 51), 800000, "the current account is the owner's equity");
  assert.equal(box(owner, 58), 400000, "and still reported");
});

test("fixed assets go to the box for their class, with their depreciation", () => {
  const s = ir10Summary({
    ...YEAR,
    openingBalances: {
      asAt: "2025-04-01",
      accounts: { "730": 500000, "731": -200000, "740": 300000, "741": -100000, "960": -500000 },
    },
    journals: [],
  });
  assert.equal(box(s, 33), 200000, "vehicles at book value");
  assert.equal(box(s, 34), 300000, "plant and machinery at book value");
  assert.equal(box(s, 43), 500000);
});

test("GST sits on the side it is on", () => {
  const owed = ir10Summary({
    ...YEAR, journals: [], openingBalances: { asAt: "2025-04-01", accounts: { "820": -50000, BNK: 50000 } },
  });
  assert.equal(box(owed, 47), 50000);
  const refund = ir10Summary({
    ...YEAR, journals: [], openingBalances: { asAt: "2025-04-01", accounts: { "820": 50000, "960": -50000 } },
  });
  assert.equal(box(refund, 32), 50000);
});

test("additions and disposals come from the asset register", () => {
  const s = ir10Summary({
    ...YEAR,
    journals: [jn("2025-09-02", [ln("BNK", -4392), ln("470", 4392)])],
    assets: [
      { number: "FA-1", purchased: "2025-06-01", cost: 162037, disposed: null },
      { number: "FA-2", purchased: "2024-01-01", cost: 100000, disposed: "2025-09-01" },
      { number: "FA-3", purchased: "2023-01-01", cost: 90000, disposed: "2024-09-01" },
    ],
    proceeds: { "FA-2": 139956, "FA-3": 50000 },
  });
  assert.equal(box(s, 54), 162000, "bought in the year, at cost");
  assert.equal(box(s, 55), 140000, "sold in the year, at what it fetched");
  assert.equal(box(s, 59), 4400, "a loss on disposal, disclosed");
  assert.equal(box(s, 24), 4400, "and an expense");
});

test("a year of trading and a position on a day are not the same figure", () => {
  const s = ir10Summary({
    ...YEAR,
    openingBalances: { asAt: "2025-04-01", accounts: { "610": 100000, "960": -100000 } },
    journals: [jn("2025-06-01", [ln("610", 50000), ln("200", -50000)])],
  });
  assert.equal(box(s, 2), 50000, "the year's sales");
  assert.equal(box(s, 30), 150000, "debtors carried in, plus the year's");
});

test("a journal before the year is a balance, not this year's trading", () => {
  const s = ir10Summary({
    ...YEAR,
    journals: [jn("2025-01-15", [ln("BNK", 70000), ln("200", -70000)])],
  });
  assert.equal(box(s, 2), 0);
  assert.equal(box(s, 31), 70000);
});
