import assert from "node:assert/strict";
import test from "node:test";
import { shareholderSchedule, overdrawnWarning } from "../dist/index.js";

const CHART = [
  { code: "910", name: "Loan from Director", type: "Current Liability" },
  { code: "970", name: "Owner Funds Introduced", type: "Equity" },
  { code: "980", name: "Owner Drawings", type: "Current Liability" },
  { code: "200", name: "Sales", type: "Revenue" },
];

const jn = (date, lines) => ({
  transactionId: date, date, narration: "", lines, source: "bank", taxBasis: "payments",
});
const ln = (code, amount) => ({
  accountCode: code, accountName: code, amount, taxType: "NONE", description: "",
});

const YEAR = { from: "2025-04-01", to: "2026-03-31", chart: CHART };

test("the ordinary case: the company owes the shareholder", () => {
  // Opening credit of 60,700 -- sample figure -- money in, money out.
  const s = shareholderSchedule({
    ...YEAR,
    openingBalances: { asAt: "2025-04-01", accounts: { "910": -6070000 } },
    journals: [
      jn("2025-06-01", [ln("BNZ", 500000), ln("910", -500000)]),
      jn("2025-09-01", [ln("BNZ", -200000), ln("980", 200000)]),
    ],
  });
  assert.equal(s.opening, 6070000, "credit positive: what the company owes");
  assert.equal(s.introduced, 500000);
  assert.equal(s.drawings, 200000);
  assert.equal(s.closing, 6370000, "opening plus in, less out");
  assert.equal(s.overdrawn, false);
  assert.equal(overdrawnWarning(s), null, "nothing to warn about");
});

test("the direction of the entry decides, not the account it landed in", () => {
  // A drawing posted against the loan account is still a drawing. Classifying
  // by account name would call it money introduced and double the balance in
  // the wrong direction.
  const s = shareholderSchedule({
    ...YEAR,
    journals: [
      jn("2025-06-01", [ln("BNZ", -300000), ln("910", 300000)]),
      jn("2025-07-01", [ln("BNZ", 100000), ln("980", -100000)]),
    ],
  });
  assert.equal(s.drawings, 300000, "taken out, though posted to the loan account");
  assert.equal(s.introduced, 100000, "put in, though posted to drawings");
  assert.equal(s.closing, -200000);
});

test("an overdrawn account is reported, and says why it matters", () => {
  const s = shareholderSchedule({
    ...YEAR,
    openingBalances: { asAt: "2025-04-01", accounts: { "910": -100000 } },
    journals: [jn("2025-09-01", [ln("BNZ", -450000), ln("980", 450000)])],
  });
  assert.equal(s.closing, -350000, "the shareholder owes the company");
  assert.equal(s.overdrawn, true);
  const warning = overdrawnWarning(s);
  assert.ok(warning.includes("3,500.00"), "says how much");
  assert.ok(/prescribed rate/i.test(warning), "names the rate that applies");
  assert.ok(/fringe benefit tax/i.test(warning), "and the alternative");
  // No figure is put on it: the rate changes quarterly and the treatment turns
  // on facts these books do not hold.
  assert.ok(!/%/.test(warning), "no rate is quoted");
});

test("only the shareholder accounts are counted", () => {
  const s = shareholderSchedule({
    ...YEAR,
    journals: [jn("2025-06-01", [ln("BNZ", 900000), ln("200", -900000)])],
  });
  assert.equal(s.introduced, 0, "a sale is not money the shareholder put in");
  assert.equal(s.closing, 0);
});

test("a journal before the period moves the opening balance, not the year", () => {
  const s = shareholderSchedule({
    from: "2026-04-01", to: "2027-03-31", chart: CHART,
    openingBalances: { asAt: "2025-04-01", accounts: { "910": -100000 } },
    journals: [
      jn("2025-06-01", [ln("BNZ", 500000), ln("910", -500000)]),
      jn("2026-06-01", [ln("BNZ", 200000), ln("910", -200000)]),
    ],
  });
  assert.equal(s.opening, 600000, "last year's contribution is carried in");
  assert.equal(s.introduced, 200000, "this year's is the movement");
  assert.equal(s.closing, 800000);
});

test("the accounts a chart uses can be named", () => {
  const s = shareholderSchedule({
    ...YEAR,
    accounts: { introducedCodes: ["905"], drawingsCodes: ["906"] },
    journals: [
      jn("2025-06-01", [ln("BNZ", 100000), ln("905", -100000)]),
      jn("2025-07-01", [ln("BNZ", -40000), ln("906", 40000)]),
      jn("2025-08-01", [ln("BNZ", -70000), ln("980", 70000)]),
    ],
  });
  assert.equal(s.introduced, 100000);
  assert.equal(s.drawings, 40000, "980 is not a shareholder account in this chart");
  assert.equal(s.closing, 60000);
});

test("the schedule says which account each movement came from", () => {
  const s = shareholderSchedule({
    ...YEAR,
    journals: [
      jn("2025-06-01", [ln("BNZ", 500000), ln("910", -500000)]),
      jn("2025-09-01", [ln("BNZ", -200000), ln("980", 200000)]),
    ],
  });
  assert.deepEqual(
    s.movements.map((m) => [m.code, m.name, m.introduced, m.drawings]),
    [
      ["910", "Loan from Director", 500000, 0],
      ["980", "Owner Drawings", 0, 200000],
    ],
  );
});
