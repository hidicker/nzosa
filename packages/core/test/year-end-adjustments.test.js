import test from "node:test";
import assert from "node:assert/strict";
import {
  E12_ROWS,
  prepaymentAdjustments,
  unexpiredAt,
  vehicleAdjustment,
} from "../dist/index.js";

// A $230 fuel purchase: $200 to motor vehicle, $30 GST claimed.
function fuel(date, gross = 23_000) {
  const gst = Math.round((gross * 3) / 23);
  return {
    transactionId: `fuel:${date}`,
    date,
    narration: "Fuel",
    source: "bank",
    taxBasis: "both",
    lines: [
      { accountCode: "449", accountName: "Motor Vehicle Expenses", amount: gross - gst, taxType: "INPUT2", taxBase: -gross, description: "" },
      { accountCode: "820", accountName: "GST", amount: gst, taxType: "INPUT2", description: "" },
      { accountCode: "090", accountName: "Bank", amount: -gross, taxType: "NONE", description: "" },
    ],
  };
}

const balanced = (journal) => journal.lines.reduce((s, l) => s + l.amount, 0);

test("private use takes the private share off the vehicle account and the GST back", () => {
  const result = vehicleAdjustment(
    { entityId: "e1", year: 2026, businessPercent: 70, logbookFrom: "2025-05-01", accounts: ["449"], counterCode: "980" },
    [fuel("2025-06-01"), fuel("2025-09-01"), fuel("2026-04-02")],
  );
  assert.equal(result.businessPercent, 70);
  // Two fills in the year: $400 ex GST, $60 GST. Private 30%.
  assert.deepEqual(result.byAccount, [{ code: "449", name: "Motor Vehicle Expenses", privateShare: 12_000 }]);
  assert.equal(result.privateGst, 1_800);
  assert.equal(result.journal.date, "2026-03-31");
  assert.equal(result.journal.source, "adjustment");
  assert.equal(balanced(result.journal), 0);
  const drawings = result.journal.lines.find((l) => l.accountCode === "980");
  assert.equal(drawings.amount, 13_800);
  const gst = result.journal.lines.find((l) => l.accountCode === "820");
  assert.equal(gst.amount, -1_800);
});

test("without a logbook, business use is limited to 25%", () => {
  const result = vehicleAdjustment(
    { entityId: "e1", year: 2026, businessPercent: 80, accounts: ["449"], counterCode: "980" },
    [fuel("2025-06-01")],
  );
  assert.equal(result.businessPercent, 25);
  assert.equal(result.byAccount[0].privateShare, 15_000);
  assert.match(result.notes.join(" "), /section DE 4/);
});

test("a logbook more than three years old no longer counts", () => {
  const result = vehicleAdjustment(
    { entityId: "e1", year: 2026, businessPercent: 60, logbookFrom: "2021-06-01", accounts: ["449"], counterCode: "980" },
    [fuel("2025-06-01")],
  );
  assert.equal(result.businessPercent, 25);
  assert.match(result.notes.join(" "), /more than three years old/);
});

test("a line with no GST claimed gives none back", () => {
  const rego = {
    transactionId: "rego",
    date: "2025-07-01",
    narration: "Rego",
    source: "bank",
    taxBasis: "both",
    lines: [
      { accountCode: "449", accountName: "Motor Vehicle Expenses", amount: 10_000, taxType: "NONE", description: "" },
      { accountCode: "090", accountName: "Bank", amount: -10_000, taxType: "NONE", description: "" },
    ],
  };
  const result = vehicleAdjustment(
    { entityId: "e1", year: 2026, businessPercent: 50, logbookFrom: "2025-04-01", accounts: ["449"], counterCode: "980" },
    [rego],
  );
  assert.equal(result.privateGst, 0);
  assert.equal(result.byAccount[0].privateShare, 5_000);
  assert.equal(balanced(result.journal), 0);
});

test("vehicle depreciation shares the private use, with no GST", () => {
  const dep = {
    transactionId: "depreciation:416:2026-03-31",
    date: "2026-03-31",
    narration: "Depreciation — Motor Vehicles",
    source: "depreciation",
    taxBasis: "both",
    lines: [
      { accountCode: "416", accountName: "Depreciation", amount: 300_000, taxType: "NONE", description: "" },
      { accountCode: "711", accountName: "Accumulated depreciation", amount: -300_000, taxType: "NONE", description: "" },
    ],
  };
  const result = vehicleAdjustment(
    { entityId: "e1", year: 2026, businessPercent: 60, logbookFrom: "2025-04-01", accounts: ["449"], assetTypes: ["Motor Vehicles"], counterCode: "980" },
    [dep],
  );
  assert.deepEqual(result.byAccount, [{ code: "416", name: "Depreciation", privateShare: 120_000 }]);
  assert.equal(result.privateGst, 0);
});

test("full business use makes no journal", () => {
  const result = vehicleAdjustment(
    { entityId: "e1", year: 2026, businessPercent: 100, logbookFrom: "2025-04-01", accounts: ["449"], counterCode: "980" },
    [fuel("2025-06-01")],
  );
  assert.equal(result.journal, null);
});

// --- prepayments --------------------------------------------------------------

function paid(id, date, code, amount) {
  return {
    transactionId: id,
    date,
    narration: "",
    source: "bank",
    taxBasis: "both",
    lines: [
      { accountCode: code, accountName: code, amount, taxType: "NONE", description: "" },
      { accountCode: "090", accountName: "Bank", amount: -amount, taxType: "NONE", description: "" },
    ],
  };
}

test("unexpired portion is by days", () => {
  // 365 days, 1 Jan to 31 Dec 2026; at 31 March, 275 days remain.
  assert.equal(unexpiredAt(36_500, "2026-01-01", "2026-12-31", "2026-03-31"), 27_500);
  assert.equal(unexpiredAt(100, "2026-01-01", "2026-03-31", "2026-03-31"), 0);
});

test("E12 has every row, a to v", () => {
  assert.equal(E12_ROWS.map((r) => r.id).join(""), "abcdefghijklmnopqrstuv");
});

test("insurance of $12,000 or less running 12 months or less is excused", () => {
  const result = prepaymentAdjustments(
    [{ id: "p1", transactionId: "ins", accountCode: "433", from: "2026-01-01", to: "2026-12-31", category: "e" }],
    [paid("ins", "2026-01-05", "433", 365_000)],
    2026,
  );
  assert.equal(result.lines.length, 1);
  assert.equal(result.lines[0].unexpired, 275_000);
  assert.match(result.lines[0].excusedBy, /row \(e\)/);
  assert.equal(result.journals.length, 0);
});

test("insurance over $12,000 is added back and released on 1 April", () => {
  const result = prepaymentAdjustments(
    [{ id: "p1", transactionId: "ins", accountCode: "433", from: "2026-01-01", to: "2026-12-31", category: "e" }],
    [paid("ins", "2026-01-05", "433", 1_460_000)],
    2026,
  );
  assert.equal(result.lines[0].excusedBy, null);
  const [yearEnd, release] = result.journals;
  assert.equal(yearEnd.date, "2026-03-31");
  assert.equal(release.date, "2026-04-01");
  assert.deepEqual(
    yearEnd.lines.map((l) => [l.accountCode, l.amount]),
    [["620", 1_100_000], ["433", -1_100_000]],
  );
  assert.deepEqual(
    release.lines.map((l) => [l.accountCode, l.amount]),
    [["433", 1_100_000], ["620", -1_100_000]],
  );
  assert.equal(balanced(yearEnd), 0);
});

test("other services are excused only while the row totals $14,000 or less", () => {
  const services = [
    { id: "a", transactionId: "s1", accountCode: "485", from: "2026-03-01", to: "2026-08-31", category: "i" },
    { id: "b", transactionId: "s2", accountCode: "485", from: "2026-03-01", to: "2026-08-31", category: "i" },
  ];
  const small = prepaymentAdjustments(services, [paid("s1", "2026-03-01", "485", 600_000), paid("s2", "2026-03-01", "485", 600_000)], 2026);
  assert.ok(small.lines.every((l) => l.excusedBy !== null));
  const large = prepaymentAdjustments(services, [paid("s1", "2026-03-01", "485", 1_200_000), paid("s2", "2026-03-01", "485", 1_200_000)], 2026);
  assert.ok(large.lines.every((l) => l.excusedBy === null));
  assert.equal(large.journals.length, 2);
});

test("something not in E12 is always adjusted, and again at a second balance date", () => {
  const p = [{ id: "x", transactionId: "t", accountCode: "477", from: "2026-01-01", to: "2027-12-31", category: "none" }];
  const journals = [paid("t", "2026-01-01", "477", 730_000)];
  const first = prepaymentAdjustments(p, journals, 2026);
  const second = prepaymentAdjustments(p, journals, 2027);
  assert.equal(first.lines[0].excusedBy, null);
  // 640 of 730 days left at 31 March 2026; 275 at 31 March 2027.
  assert.equal(first.lines[0].unexpired, 640_000);
  assert.equal(second.lines[0].unexpired, 275_000);
  assert.equal(second.journals.length, 2);
});

test("rent running more than 6 months past balance date is not excused", () => {
  const p = [{ id: "r", transactionId: "rent", accountCode: "469", from: "2026-03-01", to: "2027-02-28", category: "a" }];
  const result = prepaymentAdjustments(p, [paid("rent", "2026-03-01", "469", 1_200_000)], 2026);
  assert.equal(result.lines[0].excusedBy, null);
});
