import { test } from "node:test";
import assert from "node:assert/strict";
import { classSource, profitAndLossByClass, UNCLASSIFIED } from "../dist/index.js";

const journal = (transactionId, date, lines) => ({
  transactionId,
  date,
  narration: "",
  source: "bank",
  taxBasis: "payments",
  lines: lines.map(([accountCode, amount]) => ({ accountCode, accountName: accountCode, amount })),
});

test("an invoice's payment is classed with the invoice", () => {
  assert.equal(classSource({ transactionId: "INV-7:paid:2" }), "INV-7");
  assert.equal(classSource({ transactionId: "t-1" }), "t-1");
});

test("income and expense fall under the class of where they came from", () => {
  const journals = [
    journal("t-1", "2026-03-01", [["1000", 500], ["4000", -500]]),
    journal("t-2", "2026-03-02", [["6000", 120], ["1000", -120]]),
    journal("INV-1", "2026-03-03", [["1200", 300], ["4000", -300]]),
    journal("t-3", "2027-01-01", [["6000", 99], ["1000", -99]]),
  ];
  const columns = profitAndLossByClass(
    journals,
    { "t-1": "Tours", "INV-1": "Tours", "t-2": "Shop" },
    (code) => code === "4000" || code === "6000",
    { from: "2026-01-01", to: "2026-12-31" },
  );
  assert.deepEqual(
    columns.map((c) => [c.name, Object.fromEntries(c.byAccount)]),
    [
      ["Shop", { 6000: 120 }],
      ["Tours", { 4000: -800 }],
    ],
  );
  const none = profitAndLossByClass(journals, {}, (code) => code === "6000", { from: "2026-01-01", to: "2026-12-31" });
  assert.equal(none[0].name, UNCLASSIFIED);
});
