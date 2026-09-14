import assert from "node:assert/strict";
import test from "node:test";
import { relabelOpeningBalances } from "../dist/index.js";

const balances = (accounts, byDate) => ({
  asAt: "2025-04-01", accounts, ...(byDate ? { byDate } : {}),
});
const link = { "BNZ 01 -  Arrow Rock Trading Account": "02-0536-0051930-001" };
const resolve = (key) => link[key];

test("a row named by the other system moves onto the account it turned out to be", () => {
  // Loaded before anybody said which bank this was, it sat under the export's
  // own name -- apart from the account it belongs to, with reports showing
  // both and neither right.
  const { balances: after, moved } = relabelOpeningBalances(
    balances({ "BNZ 01 -  Arrow Rock Trading Account": 35594, "610": 228000 }),
    resolve,
  );
  assert.deepEqual(after.accounts, { "02-0536-0051930-001": 35594, "610": 228000 });
  assert.deepEqual(moved, ["BNZ 01 -  Arrow Rock Trading Account"]);
});

test("two keys that turn out to be one account are added together", () => {
  // Which is exactly what has just been said by making the link.
  const { balances: after } = relabelOpeningBalances(
    balances({ "BNZ 01 -  Arrow Rock Trading Account": 35594, "02-0536-0051930-001": 10000 }),
    resolve,
  );
  assert.deepEqual(after.accounts, { "02-0536-0051930-001": 45594 });
});

test("every year is re-keyed, not only the current one", () => {
  const { balances: after } = relabelOpeningBalances(
    balances(
      { "BNZ 01 -  Arrow Rock Trading Account": 35594 },
      {
        "2025-03-31": { "BNZ 01 -  Arrow Rock Trading Account": 35594 },
        "2024-03-31": { "BNZ 01 -  Arrow Rock Trading Account": 100 },
      },
    ),
    resolve,
  );
  assert.deepEqual(after.byDate["2025-03-31"], { "02-0536-0051930-001": 35594 });
  assert.deepEqual(after.byDate["2024-03-31"], { "02-0536-0051930-001": 100 });
});

test("a key nothing resolves is left exactly as it was", () => {
  const { balances: after, moved } = relabelOpeningBalances(
    balances({ "Some Other Bank": 500, "610": 228000 }),
    resolve,
  );
  assert.deepEqual(after.accounts, { "Some Other Bank": 500, "610": 228000 });
  assert.deepEqual(moved, []);
});

test("resolving to itself is not a move", () => {
  const { moved } = relabelOpeningBalances(
    balances({ "610": 228000 }),
    (key) => key,
  );
  assert.deepEqual(moved, []);
});

test("the rest of the record is untouched", () => {
  const before = { asAt: "2025-04-01", source: "trial-balance.xlsx, 2025-03-31 column",
                   accounts: { "610": 100 } };
  const { balances: after } = relabelOpeningBalances(before, resolve);
  assert.equal(after.asAt, "2025-04-01");
  assert.equal(after.source, "trial-balance.xlsx, 2025-03-31 column");
});

test("the total is the same afterwards, whatever moved", () => {
  // The one thing that must never change: re-keying is a rename, not an entry.
  const accounts = { "BNZ 01 -  Arrow Rock Trading Account": 35594,
                     "02-0536-0051930-001": -35594, "610": 228000 };
  const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
  const { balances: after } = relabelOpeningBalances(balances(accounts), resolve);
  assert.equal(sum(after.accounts), sum(accounts));
});
