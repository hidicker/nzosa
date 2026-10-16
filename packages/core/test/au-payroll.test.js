import { test } from "node:test";
import assert from "node:assert/strict";
import {
  auPayLine,
  auPayRunJournal,
  auPaygEstimate,
  auWithholding,
  earnedBeforePay,
  fullBas,
  stpYearToDate,
  superDueDate,
  superGuarantee,
} from "../dist/index.js";

const employee = (over = {}) => ({
  id: "e1",
  name: "Alex Tran",
  taxFreeThreshold: true,
  tfnProvided: true,
  superFund: "AustralianSuper",
  payFrequency: "monthly",
  ...over,
});

test("PAYG estimate: $85,000 a year paid monthly in 2026-27 is about $1,475 (australia-payroll, pattern 1)", () => {
  // Tax $16,020 and Medicare levy $1,700 on $85,000, no low income offset: $1,476.67 a month.
  assert.equal(auPaygEstimate(708_333, employee(), "2026-08-31"), 147_700);
});

test("PAYG estimate: no TFN is 47% from the first dollar; no tax-free threshold taxes from the first dollar", () => {
  assert.equal(auPaygEstimate(100_000, employee({ tfnProvided: false }), "2026-08-31"), 47_000);
  const without = auPaygEstimate(200_000, employee({ payFrequency: "fortnightly", taxFreeThreshold: false }), "2026-08-31");
  const withIt = auPaygEstimate(200_000, employee({ payFrequency: "fortnightly" }), "2026-08-31");
  assert.ok(without > withIt);
});

test("super guarantee: 12%, with the annual maximum contribution base from 1 July 2026 (au-super-guarantee tests 1 and 2)", () => {
  assert.equal(superGuarantee(400_000, 0, "2026-08-14"), 48_000);
  // $268,000 earned before a $10,000 payday: SG only on the $2,830 beneath $270,830.
  assert.equal(superGuarantee(1_000_000, 26_800_000, "2027-03-15"), 33_960);
  assert.equal(superGuarantee(1_000_000, 27_083_000, "2027-04-15"), 0);
  // 2024-25 was 11.5%.
  assert.equal(superGuarantee(100_000, 0, "2025-03-14"), 11_500);
});

test("super is due 7 business days after payday from 1 July 2026, quarterly before (au-super-guarantee test 9)", () => {
  // Friday 4 September 2026: the 15th is the seventh business day; the 16th is late.
  assert.equal(superDueDate("2026-09-04"), "2026-09-15");
  // A new employee's first contribution: 20 business days.
  assert.equal(superDueDate("2026-07-10", true), "2026-08-07");
  // Earnings paid before 1 July 2026 keep the quarterly dates.
  assert.equal(superDueDate("2026-05-15"), "2026-07-28");
  assert.equal(superDueDate("2025-11-20"), "2026-01-28");
});

test("a pay run posts gross and super, and owes PAYG, super and net pay", () => {
  const e = employee();
  const line = auPayLine(e, 600_000, "2026-08-31", 0);
  assert.equal(line.superGuarantee, 72_000);
  assert.equal(line.net, line.gross - line.payg);
  assert.equal(line.paygEstimated, true);
  const given = auPayLine(e, 600_000, "2026-08-31", 0, 120_000);
  assert.equal(given.payg, 120_000);
  assert.equal(given.paygEstimated, false);
  const run = { id: "r1", payDate: "2026-08-31", periodStart: "2026-08-01", periodEnd: "2026-08-31", lines: [given] };
  const a = (code, name) => ({ code, name });
  const journal = auPayRunJournal(run, {
    wages: a("477", "Wages and Salaries"),
    superExpense: a("478", "Superannuation"),
    paygPayable: a("825", "PAYG Withholdings Payable"),
    superPayable: a("826", "Superannuation Payable"),
    wagesPayable: a("804", "Wages Payable"),
  });
  const by = Object.fromEntries(journal.lines.map((l) => [l.accountCode, l.amount]));
  assert.deepEqual(by, { 477: 600_000, 478: 72_000, 825: -120_000, 826: -72_000, 804: -480_000 });
  assert.equal(journal.lines.reduce((s, l) => s + l.amount, 0), 0);
});

test("W1 and W2 for a quarter, and STP's year to date", () => {
  const runs = [
    { id: "r1", payDate: "2026-07-31", periodStart: "2026-07-01", periodEnd: "2026-07-31", lines: [{ employeeId: "e1", gross: 500_000, payg: 90_000, paygEstimated: false, superGuarantee: 60_000, net: 410_000 }] },
    { id: "r2", payDate: "2026-08-31", periodStart: "2026-08-01", periodEnd: "2026-08-31", lines: [{ employeeId: "e1", gross: 500_000, payg: 90_000, paygEstimated: false, superGuarantee: 60_000, net: 410_000 }] },
    { id: "r3", payDate: "2026-10-31", periodStart: "2026-10-01", periodEnd: "2026-10-31", lines: [{ employeeId: "e1", gross: 600_000, payg: 110_000, paygEstimated: false, superGuarantee: 72_000, net: 490_000 }] },
  ];
  assert.deepEqual(auWithholding(runs, "2026-07-01", "2026-09-30"), { w1: 1_000_000, w2: 180_000, superGuarantee: 120_000 });
  assert.deepEqual(stpYearToDate(runs, runs[2]), [{ employeeId: "e1", gross: 1_600_000, payg: 290_000, superGuarantee: 192_000 }]);
  assert.equal(earnedBeforePay(runs, "e1", "2026-10-31"), 1_000_000);
});

test("full BAS: sales split into taxable, GST-free and input taxed; purchases into capital and not, with GST-free in G14", () => {
  const t = (id, account = "x") => ({ id, account, date: "2026-08-01", amount: 0 });
  const ret = {
    lines: [
      { transaction: t("s1"), classification: { treatment: "standard", side: "sales" }, amount: 1_100_00 },
      { transaction: t("s2", "export"), classification: { treatment: "zero-rated", side: "sales" }, amount: 500_00 },
      { transaction: t("s3"), classification: { treatment: "zero-rated", side: "sales" }, amount: 200_00 },
      { transaction: t("p1", "asset"), classification: { treatment: "standard", side: "purchases" }, amount: -2_200_00 },
      { transaction: t("p2"), classification: { treatment: "standard", side: "purchases" }, amount: -110_00 },
    ],
    excluded: [
      { transaction: t("i1"), classification: { treatment: "exempt", side: "sales" }, amount: 40_00 },
      { transaction: t("f1"), classification: { treatment: "exempt", side: "purchases" }, amount: -10_00 },
      { transaction: t("w1"), classification: { treatment: "out-of-scope", side: "purchases" }, amount: -5_000_00 },
    ],
    boxes: { box8: 100_00, box10: 100_00, box12: 210_00, box14: 210_00 },
  };
  const bas = fullBas(ret, { isCapital: (x) => x.account === "asset", isExport: (x) => x.account === "export" });
  assert.equal(bas.g1, 1_840_00); // 1,100 taxable + 500 export + 200 GST-free + 40 input taxed
  assert.deepEqual([bas.g2, bas.g3, bas.g4, bas.g5, bas.g6], [500_00, 200_00, 40_00, 740_00, 1_100_00]);
  assert.deepEqual([bas.g10, bas.g11, bas.g12, bas.g14, bas.g17], [2_200_00, 120_00, 2_320_00, 10_00, 2_310_00]);
  assert.deepEqual([bas.a1, bas.b1], [100_00, 210_00]);
});
