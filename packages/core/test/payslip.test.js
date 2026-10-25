import assert from "node:assert/strict";
import test from "node:test";
import {
  auPayLine,
  auPayslip,
  buildPayRun,
  maskedAccount,
  nzPayslip,
  nzYearToDate,
  payslipDocument,
  payslipEmail,
  payslipFileName,
} from "../dist/index.js";

function employee(over = {}) {
  return {
    id: "e1",
    name: "Aroha Test",
    irdNumber: "49098576",
    taxCode: "M SL",
    payFrequency: "weekly",
    kiwiSaverRate: 0.035,
    kiwiSaverEmployerRate: 0.03,
    esctRate: 0.175,
    bankAccount: "12-3456-0123456-00",
    hourlyRate: 3_000,
    standardHours: 40,
    ...over,
  };
}

function run(id, payDate, employees, inputs) {
  return buildPayRun({ id, employerIrd: "49091850", periodStart: payDate, periodEnd: payDate, payDate, employees, inputs });
}

const SHAPES = [
  ["plain hours", {}, { hoursWorked: 38 }],
  ["allowances, reimbursements and deductions", {
    allowances: [{ name: "Tool allowance", units: 1, rate: 2_500 }],
    reimbursements: [{ name: "Mileage", units: 120, rate: 104 }],
    deductions: [{ name: "Staff purchase", amount: 4_000 }],
  }, {}],
  ["child support cut to protect net pay", {}, { hoursWorked: 10, childSupport: 50_000 }],
  ["a bonus, payroll giving and a correction", {}, { extraPay: 100_000, payrollDonation: 3_000, priorGross: 5_000, priorPaye: 1_000 }],
  ["employer KiwiSaver as gross salary", { employerKiwiSaverAsSalary: "gross" }, {}],
  ["employer KiwiSaver as net salary", { employerKiwiSaverAsSalary: "net" }, {}],
  ["a schedular payment beside wages", {
    allowances: [{ name: "Directors' fees", units: 1, rate: 50_000, category: "withholding", taxRate: 0.2 }],
  }, {}],
  ["student loan extras", { slcirRate: 0.02, slborAmount: 1_500 }, {}],
];

for (const [name, over, input] of SHAPES) {
  test(`a payslip adds up to the net pay recorded: ${name}`, () => {
    const r = run("r1", "2026-09-22", [employee(over)], [{ employeeId: "e1", ...input }]);
    const slip = nzPayslip(r, "e1", { hourlyRate: 3_000, bankAccount: "12-3456-0123456-00" });
    assert.ok(slip);
    const recorded = r.lines.reduce((s, l) => s + l.netPay, 0);
    assert.equal(slip.netPay, recorded);
    assert.equal(slip.disagrees, false, "the pieces shown do not add up");
    const add = (rows) => rows.reduce((s, x) => s + x.amount, 0);
    assert.equal(slip.gross - add(slip.deductions) + add(slip.reimbursements), recorded);
    const html = payslipDocument(slip, { name: "Sample & Co" });
    assert.match(html, /Sample &amp; Co/);
    assert.doesNotMatch(html, /Check this before sending/);
  });
}

test("a payslip shows the hours and rate, the employer's KiwiSaver and the account's last digits only", () => {
  const r = run("r1", "2026-09-22", [employee()], [{ employeeId: "e1", hoursWorked: 38 }]);
  const slip = nzPayslip(r, "e1", { hourlyRate: 3_000, bankAccount: "12-3456-0123456-00" });
  assert.equal(slip.earnings[0].detail, "38 hours at 30.00");
  assert.equal(slip.paidTo, "account ending 5600");
  assert.deepEqual(slip.employer.map((e) => e.label), ["Employer KiwiSaver", "Less ESCT (tax on it)"]);
  assert.deepEqual(slip.facts, [["Tax code", "M SL"], ["IRD number", "49-098-576"]]);
  const html = payslipDocument(slip, { name: "Sample Co" });
  assert.doesNotMatch(html, /0123456/);
  assert.match(html, /account ending 5600/);
});

test("the year to date stays inside the tax year and stops at the pay itself", () => {
  const people = [employee()];
  const march = run("r0", "2026-03-24", people, [{ employeeId: "e1", hoursWorked: 40 }]);
  const april = run("r1", "2026-04-07", people, [{ employeeId: "e1", hoursWorked: 40 }]);
  const may = run("r2", "2026-05-05", people, [{ employeeId: "e1", hoursWorked: 20 }]);
  const later = run("r3", "2026-06-02", people, [{ employeeId: "e1", hoursWorked: 40 }]);
  const all = [march, april, may, later];
  const ytd = nzYearToDate(all, "e1", may);
  assert.equal(ytd.gross, april.totalGross + may.totalGross);
  assert.equal(ytd.paye, april.totalPaye + may.totalPaye);
  assert.equal(ytd.netPay, april.totalNetPay + may.totalNetPay);
  const slip = nzPayslip(may, "e1", { history: all });
  assert.equal(slip.yearToDateLabel, "Year to date, tax year to 31 March 2027");
  assert.equal(slip.yearToDate.find((r) => r.label === "Gross pay").amount, ytd.gross);
  // A run not yet saved still counts itself.
  assert.equal(nzYearToDate([april], "e1", may).gross, april.totalGross + may.totalGross);
});

test("nobody in the run, no payslip", () => {
  const r = run("r1", "2026-09-22", [employee()], [{ employeeId: "e1" }]);
  assert.equal(nzPayslip(r, "nobody"), null);
});

test("a slip whose lines do not add up says so instead of adjusting", () => {
  const r = run("r1", "2026-09-22", [employee()], [{ employeeId: "e1" }]);
  const tampered = { ...r, lines: r.lines.map((l) => ({ ...l, netPay: l.netPay + 1 })) };
  const slip = nzPayslip(tampered, "e1");
  assert.equal(slip.disagrees, true);
  assert.match(payslipDocument(slip, { name: "Sample Co" }), /Check this before sending/);
});

test("names and labels are escaped in the document", () => {
  const r = run("r1", "2026-09-22", [employee({ name: "<b>Eve</b>", allowances: [{ name: "A & <i>B</i>", units: 1, rate: 100 }] })], [{ employeeId: "e1" }]);
  const html = payslipDocument(nzPayslip(r, "e1"), { name: "Co" });
  assert.doesNotMatch(html, /<b>Eve<\/b>|<i>B<\/i>/);
  assert.match(html, /&lt;b&gt;Eve&lt;\/b&gt;/);
});

test("an Australian payslip: PAYG, super to the fund, the year to 30 June", () => {
  const alex = { id: "a", name: "Alex Tran", taxFreeThreshold: true, tfnProvided: true, superFund: "AustralianSuper", payFrequency: "monthly" };
  const june = { id: "j", payDate: "2026-06-30", periodStart: "2026-06-01", periodEnd: "2026-06-30", lines: [auPayLine(alex, 700_000, "2026-06-30", 0)] };
  const july = { id: "k", payDate: "2026-07-31", periodStart: "2026-07-01", periodEnd: "2026-07-31", lines: [auPayLine(alex, 708_333, "2026-07-31", 0)] };
  const slip = auPayslip(july, july.lines[0], alex, [june, july]);
  assert.equal(slip.netPay, 708_333 - july.lines[0].payg);
  assert.equal(slip.disagrees, false);
  assert.equal(slip.employer[0].detail, "to AustralianSuper");
  assert.equal(slip.yearToDateLabel, "Year to date, year to 30 June 2027");
  assert.equal(slip.yearToDate[0].amount, 708_333);
  const html = payslipDocument(slip, { name: "Sample Pty Ltd", gstNumber: "51 824 753 556" }, { lang: "en-AU", taxIdLabel: "ABN" });
  assert.match(html, /ABN 51 824 753 556/);
});

test("the email names the payday and carries no figures", () => {
  const r = run("r1", "2026-09-22", [employee()], [{ employeeId: "e1" }]);
  const slip = nzPayslip(r, "e1");
  const mail = payslipEmail(slip, "Sample Co", " aroha@example.com ");
  assert.equal(mail.to, "aroha@example.com");
  assert.equal(mail.subject, "Payslip for 22/09/2026 from Sample Co");
  assert.match(mail.body, /^Hello Aroha,/);
  assert.doesNotMatch(mail.body, /\d+\.\d\d/);
  assert.equal(payslipFileName(slip), "Payslip Aroha Test 2026-09-22.html");
  assert.equal(maskedAccount("12"), "");
});
