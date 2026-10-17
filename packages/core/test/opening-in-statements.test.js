import test from "node:test";
import assert from "node:assert/strict";
import { smallSocietyStatements, shareholderSchedule, balancesAt } from "../dist/index.js";

const journal = (date, lines) => ({ transactionId: date, date, narration: "", source: "bank", taxBasis: "payments", lines });

test("a society's statements start from the opening balances, and count a bank account the chart does not list", () => {
  const st = smallSocietyStatements({
    journals: [journal("2025-05-01", [
      { accountCode: "03-0702", accountName: "Cheque", amount: 50_000, taxType: "NONE" },
      { accountCode: "400", accountName: "Subscriptions", amount: -50_000, taxType: "NONE" },
    ])],
    chart: [
      { code: "400", name: "Subscriptions", type: "Revenue" },
      { code: "960", name: "Accumulated funds", type: "Retained Earnings" },
    ],
    from: "2025-04-01",
    to: "2026-03-31",
    openingBalances: { asAt: "2025-04-01", accounts: { "03-0702": 2_428_640, "960": -2_428_640 } },
    banks: [{ account: "03-0702", name: "Cheque" }],
  });
  assert.equal(st.totalAssets, 2_478_640);
  assert.equal(st.netAssets, 2_478_640);
  assert.equal(st.surplus, 50_000);
});

test("a journal before the opening balances is already inside them", () => {
  const b = balancesAt([journal("2025-03-01", [{ accountCode: "x", accountName: "", amount: 100, taxType: "NONE" }])], "2026-03-31", { asAt: "2025-04-01", accounts: { x: 500 } });
  assert.equal(b.get("x"), 500);
});

test("shareholder current accounts are found by name where the chart has none of Xero's codes", () => {
  const s = shareholderSchedule({
    from: "2025-04-01",
    to: "2026-03-31",
    journals: [journal("2025-06-01", [
      { accountCode: "881", accountName: "", amount: 2_000_00, taxType: "NONE" },
      { accountCode: "bank", accountName: "", amount: -2_000_00, taxType: "NONE" },
    ])],
    openingBalances: { asAt: "2025-04-01", accounts: { "881": -15_000_00, bank: 15_000_00 } },
    chart: [{ code: "881", name: "Shareholder current account, Rewi Moana", type: "Current Liability" }],
  });
  assert.equal(s.opening, 15_000_00);
  assert.equal(s.drawings, 2_000_00);
  assert.equal(s.closing, 13_000_00);
});
