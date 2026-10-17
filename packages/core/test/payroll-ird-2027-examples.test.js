import test from "node:test";
import assert from "node:assert/strict";
import { calculatePayLine, esctRateFor } from "../dist/index.js";

// Inland Revenue, "Payroll calculations and business rules specification",
// 1 April 2026 to 31 March 2027: its formulas (5.2, 5.3) and its examples.
const employee = (over) => ({
  id: "e",
  name: "A",
  irdNumber: "123-456-789",
  taxCode: "M",
  payFrequency: "weekly",
  kiwiSaverRate: 0.035,
  kiwiSaverEmployerRate: 0.035,
  esctRate: 0.175,
  ...over,
});

test("M code, 2026-27: tax and the 1.75% earners' levy on the year, a weekly figure, then the pay's own", () => {
  // $52,000 a year: 17.5% less $1,092, plus $910 levy, over 52: $171.50.
  assert.equal(calculatePayLine(employee({}), 100_000, 2027).paye, 17_150);
  assert.equal(calculatePayLine(employee({ payFrequency: "fortnightly" }), 200_000, 2027).paye, 34_300);
  // $72,000: no independent earner credit at $70,000 or more.
  assert.equal(calculatePayLine(employee({ payFrequency: "monthly", taxCode: "ME" }), 600_000, 2027).paye, 125_666);
  // $208,000: the levy capped at $2,741.22 on $156,641.
  assert.equal(calculatePayLine(employee({}), 400_000, 2027).paye, 121_036);
});

test("NSW: Mike's $960 holiday pay is taxed 10.5% plus the levy, $117.60", () => {
  const line = calculatePayLine(
    employee({ taxCode: "NSW", kiwiSaverRate: 0, kiwiSaverEmployerRate: 0 }),
    120_000,
    2027,
    { extraPay: 96_000 },
  );
  assert.equal(line.paye, 14_700 + 11_760);
});

test("ESCT: cents dropped from the contribution first, $79.04 at 17.5% is $13.82 (5.21.4)", () => {
  const line = calculatePayLine(employee({ payFrequency: "monthly", kiwiSaverEmployerRate: 0.02 }), 395_200, 2027);
  assert.equal(line.kiwiSaverEmployer, 7_904);
  assert.equal(line.esct, 1_382);
});

test("ESCT rate thresholds, the specification's examples (5.21.1, 5.21.2)", () => {
  assert.equal(esctRateFor(5_421_600), 0.175);
  assert.equal(esctRateFor(1_442_588), 0.105);
  assert.equal(esctRateFor(2_357_743), 0.175);
  assert.equal(esctRateFor(3_862_500), 0.175);
});

test("extra pay (5.11): the specification's bonus examples", async () => {
  const { extraPayTax } = await import("../dist/index.js");
  // Example 1: $30,000.56 on $130,000 annualised: 33%, levy only up to $156,641.
  // IR's text shows $10,366.39, truncating each part; its own steps (5.1, 5.2)
  // add them unrounded and truncate once, which gives $10,366.40.
  assert.equal(extraPayTax({ code: "M", extraPay: 3_000_056, kind: "bonus", annualised: 13_000_000, year: 2027 }).tax, 1_036_640);
  // Example 2: $15,000 on $195,000 annualised: 39%, no levy.
  assert.equal(extraPayTax({ code: "M", extraPay: 1_500_000, kind: "bonus", annualised: 19_500_000, year: 2027 }).tax, 585_000);
  // Example 3: a $10,000 signing bonus before any pay: 10.5% plus the levy.
  const signing = extraPayTax({ code: "M", extraPay: 1_000_000, kind: "bonus", annualised: 0, year: 2027 });
  assert.equal(signing.tax, 122_500);
  assert.equal(signing.lowRate, true);
});
