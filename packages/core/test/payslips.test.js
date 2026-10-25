import { test } from "node:test";
import assert from "node:assert/strict";
import { auPayslip, buildPayRun, lastDigits, nzPayslip, payslipText, payslipsHtml } from "../dist/index.js";

const money = (c) => (c / 100).toFixed(2);

function employee(id, extra = {}) {
  return {
    id,
    name: `Worker ${id}`,
    irdNumber: "049091850",
    taxCode: "M",
    payFrequency: "weekly",
    kiwiSaverRate: 0.035,
    kiwiSaverEmployerRate: 0.035,
    esctRate: 0.175,
    bankAccount: "12-3456-0123456-001",
    ...extra,
  };
}

/** Every kind of line a pay run can hold, at once. */
function bigRun(history = []) {
  const employees = [
    employee("hourly", { hourlyRate: 2_750 }),
    employee("loan", { taxCode: "M SL", annualSalary: 6_500_000 }),
    employee("template", {
      annualSalary: 6_000_000,
      kiwiSaverRate: 0.03,
      kiwiSaverEmployerRate: 0.05,
      allowances: [{ name: "Accommodation allowance", units: 1, rate: 20_000 }],
      reimbursements: [{ name: "Mileage", units: 100, rate: 95 }],
      deductions: [{ name: "Rent", amount: 20_000 }],
    }),
    employee("gross", { annualSalary: 5_200_000, employerKiwiSaverAsSalary: "gross" }),
    employee("net", { annualSalary: 5_200_000, employerKiwiSaverAsSalary: "net" }),
    employee("director", {
      annualSalary: 5_200_000,
      allowances: [{ name: "Directors fees", units: 1, rate: 100_000, category: "withholding" }],
    }),
    employee("nokiwi", { annualSalary: 3_900_000, kiwiSaverRate: 0, kiwiSaverEmployerRate: 0 }),
  ];
  return buildPayRun({
    id: `r${history.length + 1}`,
    employerIrd: "49091850",
    periodStart: "2026-09-14",
    periodEnd: "2026-09-20",
    payDate: "2026-09-22",
    employees,
    inputs: [
      { employeeId: "hourly", hoursWorked: 38 },
      { employeeId: "loan", childSupport: 5_000, payrollDonation: 3_000, extraPay: 150_000, extraPayKind: "bonus" },
      { employeeId: "template" },
      { employeeId: "gross" },
      { employeeId: "net" },
      { employeeId: "director" },
      { employeeId: "nokiwi", priorGross: 10_000, priorPaye: 1_750 },
    ],
    history,
  });
}

test("every payslip adds up to the net pay on the pay run, to the cent", () => {
  const run = bigRun();
  const ids = [...new Set(run.lines.map((l) => l.employeeId))];
  assert.equal(ids.length, 7);
  for (const id of ids) {
    const slip = nzPayslip({ run, employeeId: id, employer: "Kea Coffee", runs: [run], money });
    const reimbursed = slip.reimbursements.reduce((s, r) => s + r.amount, 0);
    assert.equal(slip.totalEarnings - slip.totalDeductions + reimbursed, slip.netPay, `${id}: earnings less deductions plus reimbursements is net pay`);
    const net = run.lines.filter((l) => l.employeeId === id).reduce((s, l) => s + l.netPay, 0);
    assert.equal(slip.netPay, net, `${id}: the pay run's own net pay`);
    assert.equal(slip.earnings.reduce((s, r) => s + r.amount, 0), slip.totalEarnings);
  }
});

test("an hourly worker's pay says the hours and the rate", () => {
  const run = bigRun();
  const slip = nzPayslip({ run, employeeId: "hourly", employer: "Kea Coffee", employee: employee("hourly", { hourlyRate: 2_750 }), runs: [run], money });
  assert.deepEqual(slip.earnings[0], { label: "Ordinary pay", detail: "38 hours at 27.50", amount: 104_500 });
  assert.ok(slip.deductions.some((d) => d.label === "KiwiSaver" && d.detail === "3.5%"));
  assert.ok(slip.employerPaid.some((d) => d.label === "Employer KiwiSaver"));
  assert.ok(slip.employerPaid.some((d) => d.label.startsWith("Less ESCT") && d.amount < 0));
});

test("allowances, reimbursements and deductions each have their line", () => {
  const run = bigRun();
  const slip = nzPayslip({ run, employeeId: "template", employer: "Kea Coffee", runs: [run], money });
  assert.ok(slip.earnings.some((e) => e.label === "Accommodation allowance" && e.amount === 20_000));
  assert.deepEqual(slip.reimbursements, [{ label: "Mileage", amount: 9_500 }]);
  assert.ok(slip.deductions.some((d) => d.label === "Rent" && d.amount === 20_000));
});

test("student loan, child support, giving and an extra pay", () => {
  const run = bigRun();
  const slip = nzPayslip({ run, employeeId: "loan", employer: "Kea Coffee", runs: [run], money });
  const labels = slip.deductions.map((d) => d.label);
  assert.ok(labels.includes("Student loan"));
  assert.ok(labels.includes("Child support"));
  assert.ok(labels.includes("Payroll giving"));
  assert.ok(slip.deductions.some((d) => d.label === "Payroll giving tax credit" && d.amount < 0));
  assert.ok(slip.earnings.some((e) => e.label === "Extra pay" && e.amount === 150_000));
});

test("employer KiwiSaver paid as salary is pay, and goes to the fund out of it", () => {
  const run = bigRun();
  for (const id of ["gross", "net"]) {
    const slip = nzPayslip({ run, employeeId: id, employer: "Kea Coffee", runs: [run], money });
    assert.ok(slip.earnings.some((e) => e.label === "Employer KiwiSaver, paid as salary"), id);
    assert.ok(slip.deductions.some((d) => d.label === "Employer KiwiSaver, to the fund"), id);
    assert.ok(!slip.employerPaid.some((d) => d.label === "Employer KiwiSaver"), `${id}: not counted twice`);
  }
});

test("a schedular payment beside wages is on the same payslip, with its own tax", () => {
  const run = bigRun();
  const slip = nzPayslip({ run, employeeId: "director", employer: "Kea Coffee", runs: [run], money });
  assert.ok(slip.earnings.some((e) => e.label === "Schedular payment" && e.amount === 100_000));
  assert.ok(slip.deductions.some((d) => d.label === "Withholding tax" && d.amount === 33_000));
});

test("a correction to an earlier pay is shown, with its PAYE", () => {
  const run = bigRun();
  const slip = nzPayslip({ run, employeeId: "nokiwi", employer: "Kea Coffee", runs: [run], money });
  assert.ok(slip.earnings.some((e) => e.label === "Correction to an earlier pay" && e.amount === 10_000));
  assert.ok(slip.deductions.some((d) => d.label === "PAYE on the correction" && d.amount === 1_750));
  assert.ok(!slip.deductions.some((d) => d.label === "KiwiSaver"), "no KiwiSaver line for a non-member");
});

test("year to date counts this tax year's pays to this one, and not the next", () => {
  const first = bigRun();
  const second = { ...bigRun([first]), id: "r2", payDate: "2026-09-29" };
  const nextYear = { ...bigRun([first]), id: "r3", payDate: "2027-04-06", taxYear: 2028 };
  const runs = [first, second, nextYear];
  const slip = nzPayslip({ run: second, employeeId: "hourly", employer: "Kea Coffee", runs, money });
  const gross = slip.yearToDate.find((r) => r.label === "Gross pay").amount;
  const one = first.lines.find((l) => l.employeeId === "hourly").gross;
  assert.equal(gross, one * 2);
  assert.equal(slip.yearToDateLabel, "Tax year to 31 March 2027");
  const earlier = nzPayslip({ run: first, employeeId: "hourly", employer: "Kea Coffee", runs, money });
  assert.equal(earlier.yearToDate.find((r) => r.label === "Gross pay").amount, one, "a later pay is not in an earlier slip");
});

test("numbers shown by their last digits only", () => {
  assert.equal(lastDigits("049-091-850"), "•••850");
  assert.equal(lastDigits("12-3456-0123456-001", 4), "•••6001");
  const run = bigRun();
  const slip = nzPayslip({ run, employeeId: "hourly", employer: "Kea Coffee", employee: employee("hourly"), runs: [run], money });
  assert.equal(slip.employeeNumber, "•••850");
  assert.equal(slip.paidTo, "•••6001");
  assert.ok(!payslipsHtml([slip], money).includes("049091850"), "the full IRD number is never printed");
});

test("an Australian pay slip: PAYG, super to the fund, ABN, and adds up", () => {
  const run = {
    id: "a1",
    payDate: "2026-07-14",
    periodStart: "2026-07-01",
    periodEnd: "2026-07-14",
    lines: [{ employeeId: "e1", gross: 300_000, payg: 51_200, paygEstimated: true, superGuarantee: 36_000, net: 248_800 }],
  };
  const slip = auPayslip({
    run,
    employeeId: "e1",
    employer: "Wattle Pty Ltd",
    abn: "51 824 753 556",
    employee: { id: "e1", name: "Sam Lee", superFund: "AustralianSuper", payFrequency: "fortnightly", taxFreeThreshold: true, tfnProvided: true },
    runs: [run],
  });
  assert.equal(slip.employerNumber, "ABN 51 824 753 556");
  assert.equal(slip.totalEarnings - slip.totalDeductions, slip.netPay);
  assert.deepEqual(slip.employerPaid[0], { label: "Superannuation guarantee", detail: "to AustralianSuper", amount: 36_000 });
  assert.equal(slip.yearToDateLabel, "Financial year to 30 June 2027");
  assert.ok(slip.notes.length === 1);
});

test("printable and plain-text forms carry the figures", () => {
  const run = bigRun();
  const slips = ["hourly", "template"].map((id) => nzPayslip({ run, employeeId: id, employer: "Kea <Coffee>", employee: employee(id), runs: [run], money }));
  const html = payslipsHtml(slips, money);
  assert.equal((html.match(/class="slip"/g) ?? []).length, 2);
  assert.ok(html.includes("Kea &lt;Coffee&gt;"), "escaped");
  assert.ok(html.includes("page-break-after"), "one per printed page");
  assert.ok(html.includes(money(slips[0].netPay)));
  const text = payslipText(slips[0], money);
  assert.ok(text.includes(`Net pay (to account •••6001): ${money(slips[0].netPay)}`));
  assert.ok(text.includes("Tax year to 31 March 2027"));
});

test("leave at the pay date, or paid as it goes", () => {
  const run = bigRun();
  const slip = nzPayslip({ run, employeeId: "hourly", employer: "Kea", runs: [run], money, leave: { asAt: "2026-09-22", annualWeeks: 2.5, annualHours: 100, sickDays: 7 } });
  const html = payslipsHtml([slip], money);
  assert.ok(html.includes("2.50 weeks (100.00 hours)"));
  assert.ok(html.includes("7 days"));
  const casual = nzPayslip({ run, employeeId: "hourly", employer: "Kea", runs: [run], money, leave: { asAt: "2026-09-22", annualWeeks: 0, sickDays: 0, payAsYouGo: true } });
  assert.ok(payslipsHtml([casual], money).includes("Paid with each pay (8%)"));
});
