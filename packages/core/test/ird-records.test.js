import assert from "node:assert/strict";
import test from "node:test";
import {
  checkAccountTransactions,
  checkEmployerMonths,
  checkGstReturns,
  checkIr3,
  irdPeriodBoxes,
  readIr3Confirmation,
  readIrdExport,
  taxTypeOfAccount,
} from "../dist/index.js";

// Invented throughout: no real IRD number, name or figure.
const top = (id) =>
  `Account ID:,${id},,,\nName:,KOWHAI COFFEE LIMITED,,,\nFrom:,2025-04-01,,,\nTo:,2026-03-31,,,\n` +
  `"Disclaimer: This information is correct as at 29-Sep-2026 12:00:00.",,,,\n`;

const GST_SUMMARY =
  top("111-222-333-GST001") +
  "Period ending,Total sales,Zero-rated supplies,Debit adjustments,Total GST collected,Total expenses,Credit adjustments,Total GST paid,Payment / Refund\n" +
  "2025-05-31,11500,0,0,1500,4600,0,600,900\n" +
  "2025-07-31,2300,0,0,300,9200,0,1200,-900\n";

const GST_ACCOUNT =
  top("111-222-333-GST001") +
  "Period ending,Account type,Date,Transaction,Amount\n" +
  "2025-05-31,GST,2025-06-28,Assessment,900\n" +
  "2025-05-31,GST,2025-06-27,Payment,-900\n" +
  "2025-07-31,GST,2025-08-29,Assessment,-900\n" +
  "2025-07-31,GST,2025-09-04,Direct credit refund,900\n" +
  "2025-07-31,GST,2025-09-10,Late payment penalty,12.5\n";

const EMPLOYER =
  "Account ID:,111-222-333-EMP001,,,\nName:,KOWHAI COFFEE LIMITED,,,\nFrom:,2025-04-01,,,\nTo:,2025-05-31,,,\n" +
  "\"This information is correct as at 29-Sep-2026.\",,,\n" +
  "Month ending,Gross earnings and/or schedular payments,Not liable for ACC earners’ levy,PAYE (incl. tax on schedular payments)," +
  "Child support deductions,Student loan deductions,KiwiSaver deductions,Net KiwiSaver employer contributions,ESCT deductions," +
  "ESS benefits component included in Gross earnings,Total prior period gross adjustments,Total prior period PAYE adjustments,Total Deductions\n" +
  "2025-04-30,4000,0,700,0,0,120,105,15,0,0,0,940\n" +
  "2025-05-31,4000,0,700,0,0,120,105,15,0,0,0,940\n";

test("reads the GST return summary; Box 15 is Box 10 less Box 14", () => {
  const { record } = readIrdExport(GST_SUMMARY);
  assert.equal(record.kind, "gst-returns");
  assert.equal(record.periods.length, 2);
  assert.equal(record.from, "2025-04-01");
  const boxes = irdPeriodBoxes(record.periods[0]);
  assert.deepEqual(
    [boxes.box5, boxes.box10, boxes.box11, boxes.box14, boxes.box15],
    [1150000, 150000, 460000, 60000, 90000],
  );
  assert.equal(irdPeriodBoxes(record.periods[1]).box15, -90000, "a refund is negative");
});

test("reads any tax account's transactions, and names the tax from the account", () => {
  const { record } = readIrdExport(GST_ACCOUNT);
  assert.equal(record.kind, "account");
  assert.equal(record.taxType, "GST");
  assert.equal(record.rows.length, 5);
  assert.equal(taxTypeOfAccount("111-222-333-FBT001"), "FBT");
});

test("reads the employer summary", () => {
  const { record } = readIrdExport(EMPLOYER);
  assert.equal(record.kind, "employer");
  assert.deepEqual(
    [record.months[0].gross, record.months[0].paye, record.months[0].esct, record.months[0].totalDeductions],
    [400000, 70000, 1500, 94000],
  );
});

test("something that is not a myIR export is said to be so", () => {
  assert.equal(readIrdExport("Date,Amount\n2025-01-01,5\n").record, null);
});

test("GST periods: agree within a dollar, differ beyond it, and say when the books cannot answer", () => {
  const { record } = readIrdExport(GST_SUMMARY);
  const checks = checkGstReturns(record.periods, (end) =>
    end === "2025-05-31"
      ? { box5: 1150050, box6: 0, box9: 0, box10: 150000, box11: 460000, box13: 0, box14: 55000, box15: 95000 }
      : "outside-books",
  );
  const may = checks.filter((c) => c.group.includes("2025-05-31"));
  assert.equal(may.find((c) => c.label.startsWith("Box 5 ")).status, "agrees", "50 cents is rounding");
  assert.equal(may.find((c) => c.label.startsWith("Box 14")).status, "differs");
  assert.equal(may.find((c) => c.label.startsWith("Box 15")).status, "differs");
  assert.ok(checks.filter((c) => c.group.includes("2025-07-31")).every((c) => c.status === "outside-books"));
});

test("tax account: payments and refunds found in the bank, assessments against Box 15, penalties named", () => {
  const { record } = readIrdExport(GST_ACCOUNT);
  const bank = [
    { id: "a", date: "2025-06-25", amount: -90000, who: "INLAND REVENUE" },
    { id: "b", date: "2025-09-04", amount: 90000, who: "IRD REFUND" },
  ];
  const checks = checkAccountTransactions(record.rows, bank, {
    assessment: (end) => (end === "2025-05-31" ? 90000 : undefined),
  });
  const by = (text) => checks.find((c) => c.group.includes(text));
  assert.equal(by("Payment").status, "agrees");
  assert.equal(by("refund").status, "agrees");
  assert.equal(by("2025-06-28 Assessment").status, "agrees");
  assert.equal(by("2025-08-29 Assessment").status, "not-held");
  assert.equal(by("penalty").status, "not-held");
  assert.match(by("penalty").note, /not deductible/);

  const missing = checkAccountTransactions(record.rows, [], {});
  assert.equal(missing.find((c) => c.group.includes("Payment")).status, "differs");
  const early = checkAccountTransactions(record.rows, [], { booksStart: "2025-10-01" });
  assert.equal(early.find((c) => c.group.includes("Payment")).status, "outside-books");
});

test("employer months against pay runs, to the cent, with total deductions worked out", () => {
  const { record } = readIrdExport(EMPLOYER);
  const april = {
    gross: 400000, notLiableAcc: 0, paye: 70000, childSupport: 0, studentLoan: 0,
    kiwiSaver: 12000, employerKiwiSaverNet: 10500, esct: 1500, ess: 0, priorGross: 0, priorPaye: 0,
  };
  const checks = checkEmployerMonths(record.months, (end) =>
    end === "2025-04-30" ? april : end === "2025-05-31" ? { ...april, paye: 69999 } : null,
  );
  const apr = checks.filter((c) => c.group.includes("2025-04-30"));
  assert.ok(apr.every((c) => c.status === "agrees"), "April agrees throughout, total deductions too");
  const may = checks.filter((c) => c.group.includes("2025-05-31") && c.status === "differs").map((c) => c.label);
  assert.deepEqual(may, ["PAYE", "Total deductions (paid to Inland Revenue)"]);
  const none = checkEmployerMonths(record.months, () => null);
  assert.ok(none.every((c) => c.status === "not-held"));
});

// The confirmation as a PDF viewer's copy gives it: labels in a row, amounts
// beneath, lines broken where the page broke them.
const IR3_TEXT = `2026 individual income tax return
Submission confirmation
Name IRD Number Date received
ANA SAMPLE 111-222-333 14-Aug-2026
Income with tax deducted
Total gross income Total income not liable for ACC
earners’ levy
Total PAYE deducted
$50,000.00 $0.00 $9,000.00
Minus ACC earners’ levy
$800.00
Interest income
Total gross interest Total RWT
$100.00 $33.00
Income and expenses from residential property
Method
Portfolio
Gross residential rental income
$20,000.00
Net bright-line profit (excluding
losses)
$0.00
Other residential income
$0.00
Total combined residential income Residential rental deductions
$20,000.00 $22,000.00
Excess residental rental
deductions brought forward
Residential deductions claimed
this year
$1,000.00 $20,000.00
Net residential income Excess residential rental
deductions carried forward
$0.00 $3,000.00
Total income
Total income Total tax credits
$50,100.00 $8,233.00
Total deductions
Total deductions
$0.00
Tax calculation
Taxable income $50,100.00
Tax on taxable income $8,400.00
Residual income tax $167.00
Provisional tax
Provisional tax option Standard
Provisional tax payment $0.00`;

test("reads an IR3 confirmation, section by section, skipping what it does not show", () => {
  const { record } = readIr3Confirmation(IR3_TEXT);
  assert.equal(record.year, 2026);
  assert.equal(record.received, "2026-08-14");
  assert.equal(record.name, "ANA SAMPLE");
  const f = record.figures;
  assert.equal(f.grossEarnings, 5000000);
  assert.equal(f.paye, 900000);
  assert.equal(f.earnersLevy, 80000);
  assert.equal(f.interestRwt, 3300);
  assert.equal(f.dividendsGross, undefined, "no dividend section, so nothing borrowed from the next one");
  assert.equal(f.residentialDeductions, 2200000);
  assert.equal(f.residentialBroughtForward, 100000);
  assert.equal(f.residentialCarriedForward, 300000);
  assert.equal(f.totalIncome, 5010000);
  assert.equal(f.taxableIncome, 5010000);
  assert.equal(f.residualIncomeTax, 16700);
  assert.deepEqual(record.text, { method: "Portfolio", provisionalOption: "Standard" });
  assert.equal(readIr3Confirmation("hello").record, null);
});

test("IR3 against our boxes, and the figures we do not work out named as such", () => {
  const { record } = readIr3Confirmation(IR3_TEXT);
  const ours = { "11B": 5000000, "11A": 900000, "13B": 10000, "13A": 3300, "32": 5010000, "36A": 20000 };
  const checks = checkIr3(record, (box) => ours[box]);
  const find = (label) => checks.find((c) => c.label.startsWith(label));
  assert.equal(find("Total gross income").status, "agrees");
  assert.equal(find("Residual income tax").status, "differs");
  assert.equal(find("ACC earners' levy").status, "not-held");
  assert.equal(find("Total income").note, "Not a figure these books work out.");
  assert.ok(checkIr3(record, null).every((c) => c.status === "not-held"));
});
