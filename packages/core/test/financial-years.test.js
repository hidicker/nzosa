import assert from "node:assert/strict";
import test from "node:test";
import { financialYearBalances } from "../dist/index.js";

const CHART = [
  { code: "090", name: "Business Bank Account", type: "Bank", taxCode: "No GST", description: "" },
  { code: "200", name: "Sales", type: "Revenue", taxCode: "15% GST on Income", description: "" },
  { code: "400", name: "Advertising", type: "Overhead", taxCode: "15% GST on Expenses", description: "" },
  { code: "960", name: "Retained Earnings", type: "Equity", taxCode: "No GST", description: "" },
];

const txn = (date) => ({
  id: date, date, account: "090", amount: 10000, otherParty: "", particulars: "",
  code: "", reference: "", description: "", currency: "NZD", source: "bank",
});

const only = (options) =>
  financialYearBalances({ transactions: [], chart: CHART, journals: [], ...options });

test("with nothing at all there are no years", () => {
  assert.deepEqual(only({}), []);
});

test("the opening balances in force are a year of their own", () => {
  const years = only({
    openingBalances: { asAt: "2025-03-31", accounts: { "090": 50000, "960": -50000 } },
  });
  assert.equal(years.length, 1);
  assert.equal(years[0].year, 2025);
  assert.equal(years[0].isOpening, true, "imported, not derived");
  assert.deepEqual(years[0].accounts, { "090": 50000, "960": -50000 });
});

test("a column headed 1 April opens the year it names, not the one it falls in", () => {
  // A trial balance column dated 1 April 2025 is where the 2026 year begins.
  // Read by the ordinary rule it would be called 2026 and sit a year late.
  const years = only({
    openingBalances: {
      asAt: "2025-04-01",
      accounts: { "090": 1000 },
      byDate: { "2025-04-01": { "090": 1000, "960": -1000 } },
    },
  });
  assert.equal(years[0].year, 2025, "the year the column opens");
});

test("every imported column becomes its own year", () => {
  const years = only({
    openingBalances: {
      asAt: "2026-03-31",
      accounts: { "090": 30000, "960": -30000 },
      byDate: {
        "2024-03-31": { "090": 10000, "960": -10000 },
        "2025-03-31": { "090": 20000, "960": -20000 },
      },
    },
  });
  assert.deepEqual(years.map((y) => y.year), [2024, 2025, 2026]);
  assert.ok(years.every((y) => y.isOpening), "all three came from the import");
});

test("the balances in force win over an imported column for the same year", () => {
  // They are what the ledger actually opens from. A column for that year is
  // the same fact stated earlier, and the two can disagree.
  const years = only({
    openingBalances: {
      asAt: "2025-03-31",
      accounts: { "090": 99999 },
      byDate: { "2025-03-31": { "090": 11111 } },
    },
  });
  assert.equal(years.length, 1);
  assert.deepEqual(years[0].accounts, { "090": 99999 });
});

test("an imported year is never overwritten by a derived one", () => {
  // Derived figures are arithmetic over whatever has been coded so far. Part
  // way through a year that is not the same thing as a signed balance, and the
  // signed one is the one to keep.
  const years = only({
    openingBalances: { asAt: "2026-03-31", accounts: { "090": 42424 } },
    transactions: [txn("2025-06-01"), txn("2026-01-01")],
  });
  const y2026 = years.find((y) => y.year === 2026);
  assert.equal(y2026.isOpening, true);
  assert.deepEqual(y2026.accounts, { "090": 42424 }, "the import, not a roll-forward");
});

test("years are returned oldest first", () => {
  const years = only({
    openingBalances: {
      asAt: "2026-03-31",
      accounts: { "090": 1 },
      byDate: { "2024-03-31": { "090": 1 }, "2022-03-31": { "090": 1 }, "2023-03-31": { "090": 1 } },
    },
  });
  assert.deepEqual(years.map((y) => y.year), [2022, 2023, 2024, 2026]);
});

test("an empty imported column is not a year", () => {
  // A trial balance can carry a column of nothing for a year the company did
  // not exist. Reporting it as a year end of all zeroes invents a position.
  const years = only({
    openingBalances: {
      asAt: "2025-03-31",
      accounts: { "090": 500 },
      byDate: { "2023-03-31": {}, "2024-03-31": { "090": 100 } },
    },
  });
  assert.deepEqual(years.map((y) => y.year), [2024, 2025]);
});
