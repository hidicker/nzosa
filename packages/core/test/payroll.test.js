import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPayRun,
  calculatePayLine,
  cleanIrdNumber,
  createPayrollJournal,
  formatIrdNumber,
  generatePaydayFilingCsv,
  isValidIrdNumber,
} from "../dist/index.js";

test("IRD number validation with official modulus-11 check digit", () => {
  // Valid NZ IRD numbers
  assert.equal(isValidIrdNumber("49-098-576"), true);
  assert.equal(isValidIrdNumber("49098576"), true);
  assert.equal(isValidIrdNumber("49-091-850"), true);
  assert.equal(isValidIrdNumber("49091850"), true);
  assert.equal(isValidIrdNumber("134-890-444"), true);
  assert.equal(isValidIrdNumber("134890444"), true);
  assert.equal(isValidIrdNumber("049098576"), true);

  // Invalid numbers
  assert.equal(isValidIrdNumber("49-098-577"), false); // bad check digit
  assert.equal(isValidIrdNumber("123"), false); // too short
  assert.equal(isValidIrdNumber("1234567890"), false); // too long
  assert.equal(isValidIrdNumber("000000000"), false); // out of range (< 10M)
});

test("IRD number formatting and cleaning", () => {
  assert.equal(cleanIrdNumber("49-098-576"), "49098576");
  assert.equal(cleanIrdNumber("134-890-444"), "134890444");
  assert.equal(formatIrdNumber("49098576"), "49-098-576");
  assert.equal(formatIrdNumber("134890444"), "134-890-444");
});

test("PAYE and deduction calculations for standard M tax code", () => {
  const employee = {
    id: "emp-1",
    name: "Alex Taylor",
    irdNumber: "49-098-576",
    taxCode: "M",
    payFrequency: "weekly",
    kiwiSaverRate: 0.03,
    kiwiSaverEmployerRate: 0.03,
    esctRate: 0.175,
    bankAccount: "02-1234-5678901-000",
  };

  const line = calculatePayLine(employee, 1000_00, 2026);

  assert.equal(line.gross, 1000_00);
  assert.equal(line.kiwiSaverEmployee, 30_00); // 3% of $1,000
  assert.equal(line.kiwiSaverEmployer, 30_00); // 3% of $1,000
  assert.equal(line.esct, 5_25); // 17.5% of $30 = $5.25 -> 525 cents
  assert.equal(line.studentLoan, 0); // No student loan on M
  assert.ok(line.paye > 0);
  assert.equal(line.netPay, line.gross - line.paye - line.studentLoan - line.kiwiSaverEmployee);
});

test("Student Loan deduction applies 12% on income above threshold for M SL", () => {
  const employee = {
    id: "emp-2",
    name: "Jordan Lee",
    irdNumber: "134-890-444",
    taxCode: "M SL",
    payFrequency: "weekly",
    kiwiSaverRate: 0.03,
    kiwiSaverEmployerRate: 0.03,
    esctRate: 0.175,
    bankAccount: "02-1234-5678901-000",
  };

  // Weekly threshold is $24,128 / 52 = $464.00 (464_00 cents)
  // On $1,000 gross (1000_00 cents), excess is 536_00 cents ($536.00)
  // 12% of $536 = $64.32 -> 64_32 cents
  const line = calculatePayLine(employee, 1000_00, 2026);
  assert.equal(line.studentLoan, 64_32);
});

test("Secondary tax code S applies flat rate plus ACC earner levy", () => {
  const employee = {
    id: "emp-3",
    name: "Casey Smith",
    irdNumber: "49-098-576",
    taxCode: "S",
    payFrequency: "weekly",
    kiwiSaverRate: 0,
    kiwiSaverEmployerRate: 0,
    esctRate: 0.175,
    bankAccount: "02-1234-5678901-000",
  };

  // Secondary S is 17.5% + 1.67% ACC levy = 19.17%
  // On $500 gross (500_00 cents) -> $95.85 (95_85 cents)
  const line = calculatePayLine(employee, 500_00, 2026);
  assert.equal(line.paye, 95_85);
  assert.equal(line.netPay, 500_00 - 95_85);
});

test("Payroll journal debits equal credits to the exact cent", () => {
  const emp1 = {
    id: "emp-1",
    name: "Alex Taylor",
    irdNumber: "49-098-576",
    taxCode: "M",
    payFrequency: "weekly",
    kiwiSaverRate: 0.03,
    kiwiSaverEmployerRate: 0.03,
    esctRate: 0.175,
    bankAccount: "02-1234-5678901-000",
  };

  const emp2 = {
    id: "emp-2",
    name: "Jordan Lee",
    irdNumber: "134-890-444",
    taxCode: "M SL",
    payFrequency: "weekly",
    kiwiSaverRate: 0.04,
    kiwiSaverEmployerRate: 0.03,
    esctRate: 0.175,
    bankAccount: "02-1234-5678901-001",
  };

  const payRun = buildPayRun({
    id: "PR-2026-01",
    employerIrd: "49-098-576",
    periodStart: "2026-03-01",
    periodEnd: "2026-03-07",
    payDate: "2026-03-09",
    employees: [emp1, emp2],
    inputs: [
      { employeeId: "emp-1", grossOverride: 1200_00 },
      { employeeId: "emp-2", grossOverride: 1500_00 },
    ],
  });

  const journal = createPayrollJournal(payRun, [
    { code: "477", name: "Wages & Salaries", type: "Expense" },
    { code: "478", name: "KiwiSaver Employer Contribution", type: "Expense" },
    { code: "825", name: "PAYE Payable", type: "Current Liability" },
    { code: "826", name: "KiwiSaver Payable", type: "Current Liability" },
    { code: "804", name: "Wages Payable - Payroll Clearing", type: "Current Liability" },
  ]);

  const totalDebitsAndCredits = journal.lines.reduce((sum, l) => sum + l.amount, 0);
  assert.equal(totalDebitsAndCredits, 0, "Payroll journal must mathematically balance to $0.00");
});

test("Payday filing CSV export generates valid HED, DET, and TRL rows", () => {
  const emp1 = {
    id: "emp-1",
    name: "Alex Taylor",
    irdNumber: "49-098-576",
    taxCode: "M",
    payFrequency: "weekly",
    kiwiSaverRate: 0.03,
    kiwiSaverEmployerRate: 0.03,
    esctRate: 0.175,
    bankAccount: "02-1234-5678901-000",
  };

  const payRun = buildPayRun({
    id: "PR-2026-01",
    employerIrd: "49-098-576",
    periodStart: "2026-03-01",
    periodEnd: "2026-03-07",
    payDate: "2026-03-09",
    employees: [emp1],
    inputs: [{ employeeId: "emp-1", grossOverride: 1200_00 }],
  });

  const csv = generatePaydayFilingCsv(payRun);
  const lines = csv.trim().split("\r\n");

  assert.equal(lines.length, 3, "Pay run with 1 employee should have exactly 3 lines: HED, DET, TRL");

  const [hed, det, trl] = lines;

  // Header: HED, Employer IRD, Period End (YYYYMMDD), Pay Date (YYYYMMDD)
  assert.ok(hed.startsWith("HED,49098576,20260307,20260309"));

  // Detail: DET, Employee IRD, Tax Code, Gross (1200.00)...
  assert.ok(det.startsWith("DET,49098576,M,1200.00,0.00,"));

  // Trailer: TRL, Count (1), Total Gross (1200.00)...
  assert.ok(trl.startsWith("TRL,1,1200.00,"));
});
