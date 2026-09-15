import assert from "node:assert/strict";
import test from "node:test";
import { formatGstReturn, gstReturnBoxRows, gstTransactionGroups } from "../dist/index.js";

const txn = (id, date, amount, otherParty, particulars = "") => ({
  id, date, amount, currency: "NZD", account: "BNK", serial: "", trn: "", particulars, code: "",
  reference: "", otherParty, origin: "", type: "", batch: "", otherPartyAccount: "", occurrence: 1, extras: {},
});
const standard = (side) => ({ treatment: "standard", side, reason: "" });

const RESULT = {
  period: { from: "2025-06-01", to: "2025-07-31", label: "2025-07", due: "2025-08-28" },
  basis: "payments",
  sharePercent: 100,
  boxes: {
    box5: 115_000, box6: 20_000, box7: 95_000, box8: 12_391, box9: 0, box10: 12_391,
    box11: 230_000, box12: 30_000, box13: 0, box14: 30_000, box15: 17_609, outcome: "refund",
  },
  lines: [
    txn("s1", "2025-06-10", 115_000 - 20_000, "Harbour Cafe", "Coffee"),
    txn("z1", "2025-06-12", 20_000, "Export customer", "Export"),
    txn("p2", "2025-07-02", -115_000, "Pack It Ltd", "Boxes"),
    txn("p1", "2025-06-20", -115_000, "Highland Bean Co", "Beans"),
  ].map((transaction) => ({
    transaction,
    amount: transaction.amount,
    classification:
      transaction.id === "z1"
        ? { treatment: "zero-rated", side: "sales", reason: "" }
        : standard(transaction.amount > 0 ? "sales" : "purchases"),
  })),
  excluded: [],
  lateClaims: [],
  missingTaxPoint: [],
};

test("transactions are grouped by rate, expenses shown as what was spent", () => {
  const groups = gstTransactionGroups(RESULT.lines);
  assert.deepEqual(groups.map((g) => g.group), ["15% GST on Income", "Zero Rated", "15% GST on Expenses"]);

  const income = groups[0];
  assert.equal(income.gross, 95_000);
  assert.equal(income.gst, 12_391, "three twenty-thirds of the gross");
  assert.equal(income.net, 82_609);

  const zero = groups[1];
  assert.equal(zero.gst, 0);

  const expenses = groups[2];
  assert.deepEqual(expenses.rows.map((r) => r.date), ["2025-06-20", "2025-07-02"], "in date order");
  assert.equal(expenses.gross, 230_000, "positive under an expense heading");
  assert.equal(expenses.gst, 30_000);
  assert.equal(expenses.rows[0].contact, "Highland Bean Co");
});

test("Box 15 is named for which way it goes", () => {
  const rows = gstReturnBoxRows(RESULT);
  assert.equal(rows.length, 11);
  assert.deepEqual(rows[10], { box: "Box 15", label: "GST refund", amount: 17_609, section: "purchases" });
  assert.equal(gstReturnBoxRows({ boxes: { ...RESULT.boxes, outcome: "pay" } })[10].label, "GST to pay");
});

test("a return exports with its boxes and its transactions", () => {
  const csv = formatGstReturn(RESULT, "Kea Coffee Roasters — GST return");
  assert.match(csv, /^Kea Coffee Roasters — GST return\r\n/);
  assert.match(csv, /For the period 2025-06-01 to 2025-07-31,Due 2025-08-28/);
  assert.match(csv, /GST refund,176\.09/);
  assert.match(csv, /Box 12,Total GST credits on purchases and expenses,300\.00/);
  assert.match(csv, /15% GST on Expenses\r\nDate,Contact,Description,Gross,GST,Net\r\n2025-06-20,Highland Bean Co,Beans,1150\.00,150\.00,1000\.00/);
  assert.match(csv, /Total,,,2300\.00,300\.00,2000\.00/);
});
