import { test } from "node:test";
import assert from "node:assert/strict";
import { identifyExport, openingBalancesFrom, parseQuickBooksTrialBalance } from "../dist/index.js";

// QuickBooks Online's Trial Balance, as the sample company exports it (in part).
const TB = [
  "Craig's Design and Landscaping Services,,",
  "Trial Balance,,",
  '"As of Oct 15, 2026",,',
  "",
  "Account Name,Debit,Credit",
  'Checking,"1,201.00",',
  'Accounts Receivable (A/R),"5,281.52",',
  "Truck:Original Cost,13495.00,",
  'Accounts Payable (A/P),,"1,602.67"',
  'Opening Balance Equity,,"18,374.85"',
  "Landscaping Services,,1000.00",
  "Fuel,1000.00,",
  'TOTAL,"$20,977.52","$20,977.52"',
  "",
  '"Accrual Basis Thursday, October 15, 2026 02:54 AM GMTZ",,',
].join("\n");
const chart = [
  { code: "", name: "Checking", type: "Bank" },
  { code: "1100", name: "Accounts Receivable (A/R)", type: "Accounts Receivable" },
  { code: "1520", name: "Truck:Original Cost", type: "Fixed Asset" },
  { code: "2000", name: "Accounts Payable (A/P)", type: "Accounts Payable" },
  { code: "3010", name: "Opening Balance Equity", type: "Equity" },
  { code: "4000", name: "Landscaping Services", type: "Revenue" },
  { code: "6010", name: "Fuel", type: "Overhead" },
];

test("QuickBooks Online's trial balance: its date, every account found in the chart by name", () => {
  assert.equal(identifyExport(TB).kind, "trial-balance");
  const tb = parseQuickBooksTrialBalance(TB, chart);
  assert.equal(tb.asAt, "2026-10-15");
  assert.deepEqual(tb.problems, []);
  assert.deepEqual(
    tb.accounts.map((a) => [a.code, a.name, a.klass, a.byDate["2026-10-15"]]),
    [
      ["", "Checking", "Asset", 120100],
      ["1100", "Accounts Receivable (A/R)", "Asset", 528152],
      ["1520", "Truck:Original Cost", "Asset", 1349500],
      ["2000", "Accounts Payable (A/P)", "Liability", -160267],
      ["3010", "Opening Balance Equity", "Equity", -1837485],
      ["4000", "Landscaping Services", "Revenue", -100000],
      ["6010", "Fuel", "Expense", 100000],
    ],
  );
  // The year's income and expense are left out of opening balances.
  const built = openingBalancesFrom(tb, "2026-10-15", { bankAccountFor: (n) => (n === "Checking" ? "checking" : undefined) });
  assert.equal(built.skipped.length, 2);
});
