import assert from "node:assert/strict";
import test from "node:test";
import { parseTrialBalance, openingBalancesFrom } from "../dist/index.js";

const NL = String.fromCharCode(10);

/** A trial balance in the shape Xero writes: movements first, then balances. */
const REPORT = [
  "Trial Balance,,,,,,,,,",
  "Sample Trading Entity,,,,,,,,,",
  "As at 31 March 2026,,,,,,,,,",
  "Account Code,Account,Account Type,Account Class,Debit - Month,Credit - Month," +
    "Debit - Year to date,Credit - Year to date,31 Mar 2025,31 Mar 2024",
  "200,Sales,Revenue,Revenue,,20481.62,,84969.61,-29098.81,0",
  "610,Accounts Receivable,Accounts Receivable,Asset,,,,,2280.00,0",
  "730,Equipment,Fixed Asset,Asset,,,,,36244.74,0",
  "731,Less Accumulated Depreciation,Fixed Asset,Asset,,,,,-14458.92,0",
  "800,Accounts Payable,Accounts Payable,Liability,,,,,-153.28,0",
  "910,Loan from Director,Current Liability,Liability,,,,,-60700.00,0",
  "980,Owner Drawings,Current Liability,Equity,,,,,2488.68,0",
  ",BNZ 01 - Trading Account,Bank,Asset,,,,,355.94,0",
].join(NL);

test("the report's own date and every balance column are read", () => {
  const tb = parseTrialBalance(REPORT);
  assert.equal(tb.asAt, "2026-03-31");
  assert.deepEqual(tb.dates, ["2025-03-31", "2024-03-31"]);
  assert.equal(tb.problems.length, 0);
});

test("movement columns are not mistaken for balances", () => {
  // "Debit - Year to date" is a year's turnover. Taken for a balance it would
  // state 84,969.61 of sales as an opening figure.
  const tb = parseTrialBalance(REPORT);
  const sales = tb.accounts.find((a) => a.code === "200");
  assert.deepEqual(Object.keys(sales.byDate), ["2025-03-31", "2024-03-31"]);
  assert.equal(sales.byDate["2025-03-31"], -2909881);
});

test("revenue and expense accounts are left out of opening balances", () => {
  // A new year starts them at nothing, and their closing figures are already
  // inside retained earnings. Carrying them would count a year twice.
  const built = openingBalancesFrom(parseTrialBalance(REPORT), "2025-03-31");
  assert.equal(built.balances.accounts["200"], undefined);
  assert.deepEqual(built.skipped, ["Sales"]);
});

test("retained earnings is the figure that makes the rest balance", () => {
  const built = openingBalancesFrom(parseTrialBalance(REPORT), "2025-03-31");
  const total = Object.values(built.balances.accounts).reduce((sum, v) => sum + v, 0);
  assert.equal(total, 0, "opening balances must balance or they are not balances");
  assert.equal(built.retainedEarningsGiven, false, "the report did not carry one");
  // 2,280.00 + 36,244.74 - 14,458.92 - 153.28 - 60,700.00 + 2,488.68 + 355.94
  assert.equal(built.retainedEarnings, 3394284);
  assert.equal(built.balances.accounts["960"], 3394284);
});

test("a bank account is keyed by the account it is, not the name printed", () => {
  const built = openingBalancesFrom(parseTrialBalance(REPORT), "2025-03-31", {
    bankAccountFor: (name) =>
      name.includes("BNZ 01") ? "02-1100-0022001-001" : undefined,
  });
  assert.equal(built.balances.accounts["02-1100-0022001-001"], 35594);
  assert.equal(built.balances.accounts["BNZ 01 - Trading Account"], undefined);
});

test("without a mapping the bank figure is kept under its printed name", () => {
  // Losing it would silently understate the assets, which is worse than a key
  // somebody has to tidy up.
  const built = openingBalancesFrom(parseTrialBalance(REPORT), "2025-03-31");
  assert.equal(built.balances.accounts["BNZ 01 - Trading Account"], 35594);
});

test("a retained earnings figure already in the report is added to, not replaced", () => {
  const withRetained = REPORT + NL + "960,Retained Earnings,Retained Earnings,Equity,,,,,-1000.00,0";
  const built = openingBalancesFrom(parseTrialBalance(withRetained), "2025-03-31");
  assert.equal(built.retainedEarningsGiven, true);
  // The report's own -1,000.00 plus the 34,942.84 the rest leaves over: the
  // same 33,942.84 as when the report named none, because the balancing figure
  // takes account of what was already there.
  assert.equal(built.balances.accounts["960"], 3394284);
  const total = Object.values(built.balances.accounts).reduce((sum, v) => sum + v, 0);
  assert.equal(total, 0, "it still balances");
});

test("a file that is not a trial balance is refused rather than half-read", () => {
  const parsed = parseTrialBalance("Date,Amount,Payee" + NL + "2026-01-01,10.00,Someone");
  assert.equal(parsed.accounts.length, 0);
  assert.ok(parsed.problems.length > 0);
});
