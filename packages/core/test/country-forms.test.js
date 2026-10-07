import test from "node:test";
import assert from "node:assert/strict";
import {
  AU_RENTAL_SCHEDULE,
  SCHEDULE_C,
  SCHEDULE_E,
  auResidentTax,
  basDueDate,
  basQuarters,
  contractorTotals,
  estimatedTaxDates,
  formLineFor,
  formSchedule,
  medicareLevy,
  nec1099Threshold,
  simplerBas,
} from "../dist/index.js";

/** A profit and loss as the reports build it: income positive, expenses negative. */
function report(income, expenses) {
  const line = ([code, net]) => ({ code, net, transactionIds: [] });
  return {
    period: { from: "2026-01-01", to: "2026-12-31" },
    income: income.map(line),
    expenses: expenses.map(([code, net]) => line([code, -net])),
    unclassified: [],
    totalIncome: 0,
    totalExpenses: 0,
    netProfit: 0,
    uncoded: { count: 0, gross: 0 },
  };
}
const names = {
  "200": "Rent received",
  "437": "Mortgage interest",
  "433": "Insurance",
  "473": "Repairs and maintenance",
  "420": "Property taxes",
  "445": "Property management fees",
  "490": "Gardening",
  "499": "Sundries",
  "300": "Sales",
  "310": "Cost of goods sold",
  "429": "Business meals",
  "460": "Contract labor",
  "470": "Software subscriptions",
};
const nameOf = (code) => names[code] ?? code;

test("Schedule E puts a rental's accounts on the form's lines", () => {
  const filled = formSchedule(
    SCHEDULE_E,
    report(
      [["200", 2_400_000]],
      [
        ["437", 900_000],
        ["433", 120_000],
        ["473", 80_000],
        ["420", 300_000],
        ["445", 192_000],
        ["490", 20_000],
        ["499", 5_000],
      ],
    ),
    nameOf,
  );
  const line = (id) => filled.lines.find((one) => one.id === id).amount;
  assert.equal(line("3"), 2_400_000);
  assert.equal(line("12"), 900_000);
  assert.equal(line("9"), 120_000);
  assert.equal(line("14"), 80_000);
  assert.equal(line("16"), 300_000);
  assert.equal(line("11"), 192_000);
  assert.equal(line("7"), 20_000);
  assert.equal(line("19"), 5_000);
  assert.equal(filled.totalExpenses, 1_617_000);
  assert.equal(filled.net, 783_000);
});

test("a person's choice of line wins over the guess from the name", () => {
  const filled = formSchedule(SCHEDULE_E, report([], [["499", 5_000]]), nameOf, (code) => (code === "499" ? "15" : undefined));
  assert.equal(filled.lines.find((one) => one.id === "15").amount, 5_000);
  assert.equal(filled.lines.find((one) => one.id === "19").amount, 0);
});

test("Schedule C takes cost of goods off gross income, and half of meals", () => {
  const filled = formSchedule(
    SCHEDULE_C,
    report(
      [["300", 10_000_000]],
      [
        ["310", 4_000_000],
        ["429", 100_000],
        ["460", 300_000],
        ["470", 60_000],
      ],
    ),
    nameOf,
  );
  const line = (id) => filled.lines.find((one) => one.id === id);
  assert.equal(line("1").amount, 10_000_000);
  assert.equal(filled.costOfSales, 4_000_000);
  assert.equal(line("24b").amount, 100_000);
  assert.equal(line("24b").allowed, 50_000);
  assert.equal(line("11").amount, 300_000);
  assert.equal(line("18").amount, 60_000);
  assert.equal(filled.totalExpenses, 410_000);
  assert.equal(filled.net, 5_590_000);
});

test("Australia's rental schedule labels", () => {
  assert.equal(formLineFor(AU_RENTAL_SCHEDULE, "Council rates", "expense"), "council-rates");
  assert.equal(formLineFor(AU_RENTAL_SCHEDULE, "Land tax", "expense"), "land-tax");
  assert.equal(formLineFor(AU_RENTAL_SCHEDULE, "Strata levies", "expense"), "body-corporate");
  assert.equal(formLineFor(AU_RENTAL_SCHEDULE, "Loan interest", "expense"), "interest");
  assert.equal(formLineFor(AU_RENTAL_SCHEDULE, "Capital works (Div 43)", "expense"), "capital-works");
  assert.equal(formLineFor(AU_RENTAL_SCHEDULE, "Depreciation on plant", "expense"), "capital-allowances");
  assert.equal(formLineFor(AU_RENTAL_SCHEDULE, "Water", "expense"), "water");
  assert.equal(formLineFor(AU_RENTAL_SCHEDULE, "Rent received", "income"), "gross-rent");
  assert.equal(formLineFor(AU_RENTAL_SCHEDULE, "Something else", "expense"), "sundry");
});

test("simpler BAS from a GST return's boxes", () => {
  assert.deepEqual(simplerBas({ box5: 1_100_000, box8: 100_000, box12: 30_000, box13: 2_000 }), {
    g1: 1_100_000,
    a1: 100_000,
    b1: 32_000,
    net: 68_000,
  });
});

test("BAS quarters and due dates, lodging yourself", () => {
  assert.deepEqual(
    basQuarters(2026).map((q) => `${q.from}..${q.to} due ${basDueDate(q.to)}`),
    [
      "2025-07-01..2025-09-30 due 2025-10-28",
      "2025-10-01..2025-12-31 due 2026-03-02",
      "2026-01-01..2026-03-31 due 2026-04-28",
      "2026-04-01..2026-06-30 due 2026-07-28",
    ],
  );
});

test("Australian resident tax at each threshold", () => {
  assert.equal(auResidentTax(1_820_000, 2026), 0);
  assert.equal(auResidentTax(4_500_000, 2026), 428_800);
  assert.equal(auResidentTax(13_500_000, 2026), 3_128_800);
  assert.equal(auResidentTax(19_000_000, 2026), 5_163_800);
  assert.equal(auResidentTax(20_000_000, 2026), 5_613_800);
  // From 1 July 2026 the first rate is 15%.
  assert.equal(auResidentTax(4_500_000, 2027), 402_000);
  assert.equal(auResidentTax(5_000_000, 2030), null);
  assert.equal(medicareLevy(10_000_000), 200_000);
});

test("US estimated tax dates move off weekends", () => {
  // 15 June 2025 was a Sunday, 15 January 2028 a Saturday.
  assert.deepEqual(estimatedTaxDates(2025), ["2025-04-15", "2025-06-16", "2025-09-15", "2026-01-15"]);
  assert.deepEqual(estimatedTaxDates(2027), ["2027-04-15", "2027-06-15", "2027-09-15", "2028-01-17"]);
});

test("1099-NEC: who was paid over the year's threshold", () => {
  assert.equal(nec1099Threshold(2025), 60_000);
  assert.equal(nec1099Threshold(2026), 200_000);
  const totals = contractorTotals(
    [
      { payee: "Ana Plumbing", date: "2026-03-01", amount: 150_000 },
      { payee: "Ana Plumbing", date: "2026-07-01", amount: 60_000 },
      { payee: "Bo Painting", date: "2026-05-01", amount: 90_000 },
      { payee: "Bo Painting", date: "2025-05-01", amount: 900_000 },
    ],
    2026,
  );
  assert.deepEqual(
    totals.map((t) => [t.payee, t.total, t.due]),
    [
      ["Ana Plumbing", 210_000, true],
      ["Bo Painting", 90_000, false],
    ],
  );
});

test("South Korea: VAT return from a return's boxes, and the two VAT periods", async () => {
  const { krVatReturn, krVatPeriods, krIncomeTax, krIncomeTaxDue, KR_BUSINESS_STATEMENT, KR_RENTAL_STATEMENT, formLineFor, JURISDICTIONS } = await import("../dist/index.js");
  assert.deepEqual(krVatReturn({ box5: 1_100_000_000, box6: 0, box8: 100_000_000, box12: 30_000_000 }), {
    taxBase: 1_000_000_000,
    zeroRated: 0,
    outputVat: 100_000_000,
    inputVat: 30_000_000,
    payable: 70_000_000,
  });
  assert.deepEqual(
    krVatPeriods(2026).map((p) => `${p.from}..${p.to} due ${p.due}`),
    ["2026-01-01..2026-06-30 due 2026-07-25", "2026-07-01..2026-12-31 due 2027-01-25"],
  );
  assert.equal(krIncomeTaxDue(2026), "2027-05-31");
  // 50,000,000 won: 15% less the 1,260,000 progressive deduction = 6,240,000; local tax a tenth.
  assert.deepEqual(krIncomeTax(5_000_000_000, 2026), { incomeTax: 624_000_000, localTax: 62_400_000 });
  assert.equal(krIncomeTax(1_000_000_000, 2022), null);
  assert.equal(formLineFor(KR_BUSINESS_STATEMENT, "접대비", "expense"), "entertainment");
  assert.equal(formLineFor(KR_BUSINESS_STATEMENT, "Office rent", "expense"), "rent");
  assert.equal(formLineFor(KR_BUSINESS_STATEMENT, "통신비", "expense"), "communications");
  assert.equal(formLineFor(KR_RENTAL_STATEMENT, "재산세", "expense"), "taxes");
  assert.equal(formLineFor(KR_RENTAL_STATEMENT, "월세 수입", "income"), "rent");
  assert.equal(JURISDICTIONS.kr.currency, "KRW");
  assert.deepEqual(JURISDICTIONS.kr.salesTax.fraction, { num: 1, den: 11 });
});

test("checked against OpenAccountants: US entertainment is not deductible; meals are half", async () => {
  const { SCHEDULE_C, formLineFor } = await import("../dist/index.js");
  assert.equal(formLineFor(SCHEDULE_C, "Client entertainment", "expense"), "entertainment");
  assert.equal(formLineFor(SCHEDULE_C, "Business meals", "expense"), "24b");
  assert.equal(SCHEDULE_C.lines.find((l) => l.id === "entertainment").share, 0);
});

test("checked against OpenAccountants: Australia's LITO, Medicare low-income threshold and BAS dates off weekends", async () => {
  const { auLowIncomeOffset, medicareLevy, basDueDate } = await import("../dist/index.js");
  assert.equal(auLowIncomeOffset(3_000_000, 2026), 70_000);
  assert.equal(auLowIncomeOffset(4_500_000, 2026), 32_500);
  assert.equal(auLowIncomeOffset(6_666_700, 2026), 0);
  assert.equal(auLowIncomeOffset(5_000_000, 2030), null);
  // 2025-26 single: none at $28,011; 10c a dollar above it; the full 2% from $35,013.
  assert.equal(medicareLevy(2_801_100, 2026), 0);
  assert.equal(medicareLevy(3_000_000, 2026), 19_890);
  assert.equal(medicareLevy(10_000_000, 2026), 200_000);
  // 28 February 2027 is a Sunday: the December quarter is due 1 March 2027.
  assert.equal(basDueDate("2026-12-31"), "2027-03-01");
});

test("checked against OpenAccountants: Korea's tax base is rounded down to 10,000 won; pension is not an expense", async () => {
  const { krIncomeTax, KR_BUSINESS_STATEMENT, formLineFor } = await import("../dist/index.js");
  // 21,834,999 won rounds down to 21,830,000: 840,000 + 7,830,000 x 15% = 2,014,500.
  assert.equal(krIncomeTax(2_183_499_900, 2026).incomeTax, 201_450_000);
  assert.equal(formLineFor(KR_BUSINESS_STATEMENT, "국민연금 보험료", "expense"), "social-insurance");
  assert.equal(formLineFor(KR_BUSINESS_STATEMENT, "National health insurance", "expense"), "social-insurance");
  assert.equal(formLineFor(KR_BUSINESS_STATEMENT, "화재보험 Fire insurance", "expense"), "insurance");
});
