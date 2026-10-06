import assert from "node:assert/strict";
import test from "node:test";
import { fromWise, wiseAccountId, wiseStatementWindows } from "../dist/index.js";

// Invented entries in the shape of a Wise balance statement (FLAT type).
const LINES = [
  {
    type: "CREDIT", date: "2026-08-25T21:30:00.000Z",
    amount: { value: 1000, currency: "NZD" },
    details: { type: "DEPOSIT", description: "Received money from KOWHAI COFFEE LTD", senderName: "KOWHAI COFFEE LTD", paymentReference: "top up" },
    referenceNumber: "TRANSFER-111",
  },
  {
    type: "DEBIT", date: "2026-09-03T02:00:00.000Z",
    amount: { value: -354.96, currency: "NZD" },
    details: { type: "CARD", description: "Card transaction", merchant: { name: "Totara Supplies", city: "Nelson" } },
    referenceNumber: "CARD-222",
  },
  {
    type: "DEBIT", date: "2026-09-03T02:00:00.000Z",
    amount: { value: 2.08, currency: "NZD" },
    details: { type: "FEE", description: "Wise fees" },
    referenceNumber: "CARD-222-FEE",
  },
  { type: "DEBIT", date: "not a date", amount: { value: -1 } },
];

test("a statement becomes bank lines: NZ dated, money out negative, fees their own line", () => {
  const { transactions, problems } = fromWise(LINES, { account: "wise-NZD-12345678", label: "Wise NZD" });
  assert.equal(problems.length, 1, "the unreadable date is said, not guessed");
  assert.deepEqual(
    transactions.map((t) => [t.date, t.amount, t.otherParty]),
    [
      ["2026-08-26", 100000, "KOWHAI COFFEE LTD"],
      ["2026-09-03", -35496, "Totara Supplies"],
      ["2026-09-03", -208, "Wise fees"],
    ],
  );
  assert.equal(transactions[0].account, "wise-NZD-12345678");
  assert.equal(transactions[0].extras.wiseRef, "TRANSFER-111");
  assert.equal(transactions[0].extras.accountLabel, "Wise NZD");
  assert.equal(transactions[0].reference, "top up");
});

test("each balance is its own account, named so its number can be matched", () => {
  assert.equal(wiseAccountId({ balanceId: 12345678, currency: "nzd" }), "wise-NZD-12345678");
});

test("a long history is asked for in windows Wise accepts", () => {
  const windows = wiseStatementWindows("2025-01-01T00:00:00.000Z", "2026-09-29T00:00:00.000Z");
  assert.equal(windows.length, 2);
  assert.equal(windows[0].start, "2025-01-01T00:00:00.000Z");
  assert.ok(Date.parse(windows[0].end) < Date.parse(windows[1].start));
  assert.equal(windows[1].end, "2026-09-28T23:59:59.999Z");
  assert.deepEqual(wiseStatementWindows("2026-09-29T00:00:00.000Z", "2026-09-01T00:00:00.000Z"), []);
});
