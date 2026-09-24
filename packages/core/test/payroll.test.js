import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPayRun,
  calculatePayLine,
  cleanIrdNumber,
  esctRateFor,
  formatIrdNumber,
  generatePaydayFilingCsv,
  isValidIrdNumber,
  paydayFilingProblems,
  payrollJournal,
  payrollTaxYear,
} from "../dist/index.js";

test("IRD number validation with the modulus-11 check digit", () => {
  assert.equal(isValidIrdNumber("49-098-576"), true);
  assert.equal(isValidIrdNumber("49091850"), true);
  assert.equal(isValidIrdNumber("134-890-444"), true);
  assert.equal(isValidIrdNumber("049098576"), true);
  assert.equal(isValidIrdNumber("49-098-577"), false);
  assert.equal(isValidIrdNumber("123"), false);
  assert.equal(isValidIrdNumber("1234567890"), false);
  assert.equal(isValidIrdNumber("000000000"), false);
});

test("IRD number formatting and cleaning", () => {
  assert.equal(cleanIrdNumber("49-098-576"), "49098576");
  assert.equal(formatIrdNumber("49098576"), "49-098-576");
  assert.equal(formatIrdNumber("134890444"), "134-890-444");
});

test("the tax year comes from the payday", () => {
  assert.equal(payrollTaxYear("2026-03-31"), 2026);
  assert.equal(payrollTaxYear("2026-04-01"), 2027);
});

// --- Inland Revenue's casebook, 2026-27, scenario 3.1 ---------------------------
//
// Every employee is paid $926.28 a week (or the same a year at other
// frequencies), with KiwiSaver at 3.5% from both sides, an ESCT rate of 17.5%
// and child support of $20.99 a week. The figures expected are IR's.

function employee(taxCode, frequency, extra = {}) {
  return {
    id: taxCode,
    name: `Casebook ${taxCode}`,
    irdNumber: "048125360",
    taxCode,
    payFrequency: frequency,
    kiwiSaverRate: taxCode === "NSW" ? 0 : 0.035,
    kiwiSaverEmployerRate: taxCode === "NSW" ? 0 : 0.035,
    esctRate: 0.175,
    bankAccount: "",
    ...extra,
  };
}

const CASEBOOK = {
  weekly: {
    gross: 92_628,
    paye: {
      M: 15_730, "M SL": 15_730, ME: 14_730, "ME SL": 14_730,
      SB: 11_343, "SB SL": 11_343, S: 17_825, "S SL": 17_825, SH: 29_400, "SH SL": 29_400,
      ST: 32_178, "ST SL": 32_178, SA: 37_734, "SA SL": 37_734,
      CAE: 17_825, EDW: 17_825, ND: 43_290, NSW: 11_343,
    },
    primarySl: 5_544,
    secondarySl: 11_112,
    kiwiSaver: 3_241,
    esct: 560,
  },
  fortnightly: {
    gross: 185_256,
    paye: {
      M: 31_460, "M SL": 31_460, ME: 29_460, "ME SL": 29_460,
      SB: 22_687, "SB SL": 22_687, S: 35_651, "S SL": 35_651, SH: 58_801, "SH SL": 58_801,
      ST: 64_357, "ST SL": 64_357, SA: 75_469, "SA SL": 75_469,
      CAE: 35_651, EDW: 35_651, ND: 86_581, NSW: 22_687,
    },
    primarySl: 11_088,
    secondarySl: 22_224,
    kiwiSaver: 6_483,
    esct: 1_120,
  },
  monthly: {
    gross: 401_388,
    paye: {
      M: 68_163, "M SL": 68_163, ME: 63_830, "ME SL": 63_830,
      SB: 49_159, "SB SL": 49_159, S: 77_250, "S SL": 77_250, SH: 127_412, "SH SL": 127_412,
      ST: 139_451, "ST SL": 139_451, SA: 163_529, "SA SL": 163_529,
      CAE: 77_250, EDW: 77_250, ND: 187_607, NSW: 49_159,
    },
    primarySl: 24_028,
    secondarySl: 48_156,
    kiwiSaver: 14_048,
    esct: 2_450,
  },
  "four-weekly": {
    gross: 370_512,
    paye: {
      M: 62_920, "M SL": 62_920, ME: 58_920, "ME SL": 58_920,
      SB: 45_386, "SB SL": 45_386, S: 71_321, "S SL": 71_321, SH: 117_633, "SH SL": 117_633,
      ST: 128_748, "ST SL": 128_748, SA: 150_978, "SA SL": 150_978,
      CAE: 71_321, EDW: 71_321, ND: 173_208, NSW: 45_386,
    },
    primarySl: 22_188,
    secondarySl: 44_460,
    kiwiSaver: 12_967,
    esct: 2_257,
  },
};

for (const [frequency, expected] of Object.entries(CASEBOOK)) {
  test(`PAYE matches IR's casebook for every tax code, ${frequency}`, () => {
    for (const [code, paye] of Object.entries(expected.paye)) {
      const line = calculatePayLine(employee(code, frequency), expected.gross, 2027);
      assert.equal(line.paye, paye, `${code} ${frequency}`);
    }
  });

  test(`student loan, KiwiSaver and ESCT match IR's casebook, ${frequency}`, () => {
    const m = calculatePayLine(employee("M SL", frequency), expected.gross, 2027);
    assert.equal(m.studentLoan, expected.primarySl);
    assert.equal(calculatePayLine(employee("S SL", frequency), expected.gross, 2027).studentLoan, expected.secondarySl);
    assert.equal(calculatePayLine(employee("M", frequency), expected.gross, 2027).studentLoan, 0);
    assert.equal(m.kiwiSaverEmployee, expected.kiwiSaver);
    assert.equal(m.kiwiSaverEmployer, expected.kiwiSaver);
    assert.equal(m.esct, expected.esct);
    assert.equal(m.kiwiSaverEmployerNet, expected.kiwiSaver - expected.esct);
    // A non-resident seasonal worker cannot be in KiwiSaver.
    const nsw = calculatePayLine(employee("NSW", frequency, { kiwiSaverRate: 0.035 }), expected.gross, 2027);
    assert.equal(nsw.kiwiSaverEmployee, 0);
  });
}

test("the earners' levy follows the payday's tax year", () => {
  // $1,000 a week on M: $52,000 a year, $8,008 tax.
  const e = employee("M", "weekly");
  assert.equal(calculatePayLine(e, 100_000, 2027).paye, 17_150); // levy 1.75%
  assert.equal(calculatePayLine(e, 100_000, 2026).paye, 17_070); // levy 1.67%
});

test("the earners' levy stops at the maximum", () => {
  // $4,000 a week is $208,000 a year, over $156,641.
  const line = calculatePayLine(employee("M", "weekly"), 400_000, 2027);
  const tax = 208_000 * 0.39 - 20_922.5;
  assert.equal(line.paye, Math.floor(((tax + 2_741.22) * 100) / 52 + 1e-6));
});

test("somebody with no IRD number is taxed at the no-notification rate", () => {
  const line = calculatePayLine(employee("M", "weekly", { irdNumber: "" }), 92_628, 2027);
  assert.equal(line.taxCode, "ND");
  assert.equal(line.paye, 43_290);
});

test("schedular payments: the elected rate, no levy, all not liable for it", () => {
  const line = calculatePayLine(employee("WT", "weekly", { taxRate: 0.2 }), 10_000, 2027);
  assert.equal(line.paye, 2_000);
  assert.equal(line.earningsNotLiableAcc, 10_000);
  assert.equal(line.kiwiSaverEmployee, 0);
});

test("the ESCT rate threshold bands from 1 April 2025", () => {
  assert.equal(esctRateFor(1_872_000), 0.105);
  assert.equal(esctRateFor(1_872_100), 0.175);
  assert.equal(esctRateFor(5_421_600), 0.175);
  assert.equal(esctRateFor(6_420_100), 0.3);
  assert.equal(esctRateFor(9_372_100), 0.33);
  assert.equal(esctRateFor(21_600_100), 0.39);
});

function run() {
  return buildPayRun({
    id: "r1",
    employerIrd: "49091850",
    periodStart: "2026-09-14",
    periodEnd: "2026-09-20",
    payDate: "2026-09-22",
    employees: [
      { ...employee("M SL", "weekly"), id: "a", name: "Aroha Test", irdNumber: "49098576", startDate: "2026-09-15" },
      { ...employee("S", "weekly"), id: "b", name: "Ben, Test", irdNumber: "134890444", hourlyRate: 3_000, standardHours: 20 },
    ],
    inputs: [
      { employeeId: "a", grossOverride: 92_628, childSupport: 2_099 },
      { employeeId: "b", hoursWorked: 37.5 },
    ],
  });
}

test("a pay run takes its rates from the payday and totals its lines", () => {
  const r = run();
  assert.equal(r.taxYear, 2027);
  assert.equal(r.lines[1].gross, 112_500);
  assert.equal(r.lines[1].hours, 37.5);
  assert.equal(r.totalGross, 92_628 + 112_500);
  assert.equal(r.totalNetPay, r.lines[0].netPay + r.lines[1].netPay);
});

test("the payday filing file is IR's HEI2/DEI layout", () => {
  const r = run();
  const contact = { name: "Pat Payroll", phone: "021 555 0100", email: "pay@example.co.nz" };
  assert.deepEqual(paydayFilingProblems(r, contact), []);
  const rows = generatePaydayFilingCsv(r, contact).trimEnd().split("\r\n").map((row) => row.split(","));
  const [header, a, b] = rows;

  assert.equal(header.length, 28);
  assert.deepEqual(header.slice(0, 10), [
    "HEI2", "049091850", "20260922", "N", "N", "", "Pat Payroll", "0215550100", "pay@example.co.nz", "2",
  ]);
  assert.equal(header[10], String(r.totalGross));
  assert.equal(header[13], String(r.totalPaye));
  assert.equal(header[27], "0001");
  // Total deducted: everything that goes to IR.
  const expected =
    r.totalPaye + r.totalChildSupport + r.totalStudentLoan + r.totalKiwiSaverEmployee +
    r.totalKiwiSaverEmployerNet + r.totalEsct;
  assert.equal(header[22], String(expected));

  assert.equal(a.length, 27);
  assert.deepEqual(a.slice(0, 11), [
    "DEI", "049098576", "Aroha Test", "M SL", "20260915", "", "20260914", "20260920", "WK", "0", "92628",
  ]);
  assert.equal(a[14], "15730");
  assert.equal(a[16], "2099");
  assert.equal(a[18], "5544");
  assert.equal(a[21], "3241");
  assert.equal(a[22], "2681");
  assert.equal(a[23], "560");
  // A comma in a name would break the file.
  assert.equal(b[2], "Ben Test");
  assert.equal(b[9], "3750");
});

test("the payday filing file needs a contact", () => {
  const problems = paydayFilingProblems(run(), { name: "", phone: "", email: "nope" });
  assert.equal(problems.length, 3);
});

test("a pay run's journal balances and clears through the payables", () => {
  const r = run();
  const journal = payrollJournal(r, {
    wages: { code: "477", name: "Wages and Salaries" },
    kiwiSaverExpense: { code: "478", name: "KiwiSaver Employer Contributions" },
    wagesPayable: { code: "804", name: "Wages Payable" },
    payePayable: { code: "825", name: "PAYE Payable" },
    kiwiSaverPayable: { code: "826", name: "KiwiSaver Payable" },
  });
  assert.equal(journal.lines.reduce((s, l) => s + l.amount, 0), 0);
  const by = Object.fromEntries(journal.lines.map((l) => [l.accountCode, l.amount]));
  assert.equal(by["477"], r.totalGross);
  assert.equal(by["478"], r.totalKiwiSaverEmployer);
  assert.equal(by["804"], -r.totalNetPay);
  assert.equal(by["825"], -(r.totalPaye + r.totalStudentLoan + r.totalChildSupport + r.totalEsct));
  assert.equal(by["826"], -(r.totalKiwiSaverEmployee + r.totalKiwiSaverEmployerNet));
  assert.ok(journal.lines.every((l) => l.taxType === "NONE"));
  assert.equal(journal.date, "2026-09-22");
  assert.equal(journal.source, "payroll");
});

test("without separate KiwiSaver accounts the journal still balances", () => {
  const journal = payrollJournal(run(), {
    wages: { code: "477", name: "Wages" },
    wagesPayable: { code: "804", name: "Wages Payable" },
    payePayable: { code: "825", name: "PAYE Payable" },
  });
  assert.equal(journal.lines.length, 3);
  assert.equal(journal.lines.reduce((s, l) => s + l.amount, 0), 0);
});

// --- extra pays and the other deductions (spec sections 3, 5.11-5.16) --------

import { annualisedForExtraPay, extraPayTax } from "../dist/index.js";

test("casebook 3.6: redundancy taxed at 39% on top of ordinary pay, no levy, not liable for ACC", () => {
  const gladys = { ...employee("M", "monthly"), id: "g", kiwiSaverRate: 0, kiwiSaverEmployerRate: 0 };
  const prior = (payDate) => ({
    id: payDate, employerIrd: "", periodStart: payDate, periodEnd: payDate, payDate, lines: [
      { employeeId: "g", gross: 2_154_857, paye: 0, studentLoan: 0, kiwiSaverEmployee: 0, kiwiSaverEmployer: 0, esct: 0, childSupport: 0, netPay: 0, earningsNotLiableAcc: 0, employeeName: "", irdNumber: "", taxCode: "M" },
    ],
    totalGross: 0, totalPaye: 0, totalStudentLoan: 0, totalKiwiSaverEmployee: 0, totalKiwiSaverEmployer: 0, totalEsct: 0, totalChildSupport: 0, totalNetPay: 0,
  });
  const r = buildPayRun({
    employerIrd: "49091850", periodStart: "2026-04-01", periodEnd: "2026-04-30", payDate: "2026-04-22",
    employees: [gladys],
    inputs: [{ employeeId: "g", grossOverride: 2_154_857, extraPay: 4_309_714, extraPayKind: "redundancy" }],
    history: [prior("2026-02-22"), prior("2026-03-22")],
  });
  const line = r.lines[0];
  assert.equal(line.gross, 6_464_571);
  assert.equal(line.paye, 2_369_666);
  assert.equal(line.earningsNotLiableAcc, 4_309_714);
  assert.equal(line.lumpSumLowRate, false);
});

test("casebook 3.6: 4% KiwiSaver with ESCT at 33% on whole dollars", () => {
  const stacy = { ...employee("M", "monthly"), kiwiSaverRate: 0.04, kiwiSaverEmployerRate: 0.04, esctRate: 0.33 };
  const line = calculatePayLine(stacy, 2_154_857, 2027);
  assert.equal(line.paye, 688_878);
  assert.equal(line.kiwiSaverEmployee, 86_194);
  assert.equal(line.esct, 28_413);
  assert.equal(line.kiwiSaverEmployerNet, 57_781);
});

test("spec 5.11.1 example 2: annualised over the levy ceiling, 39% and no levy", () => {
  const t = extraPayTax({ code: "M", extraPay: 1_500_000, kind: "bonus", annualised: 19_500_000, year: 2027 });
  assert.equal(t.rate, 0.39);
  assert.equal(t.tax, 585_000);
});

test("spec 5.11.1 example 1: the levy only on the part under the ceiling", () => {
  const t = extraPayTax({ code: "M", extraPay: 3_000_056, kind: "bonus", annualised: 13_000_000, year: 2027 });
  assert.equal(t.rate, 0.33);
  // 30,000.56 x 33% + (156,641 - 130,000) x 1.75%, truncated once at the end
  // as the steps say (the example's text truncates each part, a cent lower).
  assert.equal(t.tax, 1_036_640);
});

test("spec 5.11.1 example 3: a signing bonus with no pay before it is 10.5%, flagged", () => {
  const t = extraPayTax({ code: "M", extraPay: 1_000_000, kind: "bonus", annualised: 0, year: 2027 });
  assert.equal(t.rate, 0.105);
  assert.equal(t.lowRate, true);
  assert.equal(t.tax, 105_000 + 17_500);
});

test("spec 5.11.2 example 1: a secondary code starts from the bottom of its band", () => {
  const t = extraPayTax({ code: "SH", extraPay: 100_000, kind: "bonus", annualised: 650_000, year: 2027 });
  assert.equal(t.rate, 0.3);
  assert.equal(t.tax, 30_000 + 1_750);
});

test("an elected higher rate wins", () => {
  const t = extraPayTax({ code: "M", extraPay: 100_000, kind: "bonus", annualised: 0, electedRate: 0.33, year: 2027 });
  assert.equal(t.rate, 0.33);
});

test("annualising: four weeks times 13 for a bonus, last two periods for leaving (spec 5.12 example)", () => {
  const run = (payDate, pay) => ({ payDate, lines: [{ employeeId: "x", gross: pay }] });
  const history = [run("2026-05-01", 350_000), run("2026-05-15", 350_000), run("2026-04-17", 999_999)];
  assert.equal(
    annualisedForExtraPay({ employeeId: "x", frequency: "fortnightly", kind: "termination", payDate: "2026-05-29", thisPay: 350_000, history }),
    9_100_000,
  );
  // Weekly: this pay plus three before it in the four weeks.
  const weekly = [run("2026-05-08", 100_000), run("2026-05-15", 100_000), run("2026-05-22", 100_000), run("2026-04-30", 555)];
  assert.equal(
    annualisedForExtraPay({ employeeId: "x", frequency: "weekly", kind: "bonus", payDate: "2026-05-29", thisPay: 100_000, history: weekly }),
    5_200_000,
  );
});

test("spec 3: Commissioner deductions at 5% over the threshold, and voluntary ones", () => {
  const e = employee("M SL", "weekly", { slcirRate: 0.05, slborAmount: 2_000 });
  assert.equal(calculatePayLine(e, 87_590, 2027).slcir, 2_055);
  assert.equal(calculatePayLine(e, 42_535, 2027).slcir ?? 0, 0);
  assert.equal(calculatePayLine(e, 42_535, 2027).slbor, 2_000);
});

test("a special deduction rate replaces 12%", () => {
  const e = employee("S SL", "weekly", { studentLoanRate: 0.08 });
  assert.equal(calculatePayLine(e, 92_628, 2027).studentLoan, 7_408);
});

test("casebook 3.1: payroll giving credit is a third, truncated, and comes off what IR is paid", () => {
  const line = calculatePayLine(employee("M", "weekly"), 92_628, 2027, { payrollDonation: 2_381 });
  assert.equal(line.donationCredit, 793);
  assert.equal(line.paye, 15_730);
  const plain = calculatePayLine(employee("M", "weekly"), 92_628, 2027);
  assert.equal(line.netPay, plain.netPay - 2_381 + 793);
});

test("child support is held to 40% of net pay, and says so with code P", () => {
  const line = calculatePayLine(employee("M", "weekly"), 50_000, 2027, { childSupport: 40_000 });
  assert.ok(line.childSupport < 40_000);
  assert.equal(line.childSupportCode, "P");
});

test("a tailored tax code's rate already includes the levy", () => {
  const e = employee("STC", "weekly", { taxRate: 0.24 });
  assert.equal(calculatePayLine(e, 100_000, 2027).paye, 24_000);
  // Redundancy: the levy comes out of the certificate rate.
  const r = calculatePayLine(e, 100_000, 2027, { extraPay: 100_000, extraPayKind: "redundancy" });
  assert.equal(r.paye - 24_000, Math.floor(100_000 * (0.24 - 0.0175) + 1e-6));
});

test("extras reach the file and the journal still balances", () => {
  const r = buildPayRun({
    id: "x", employerIrd: "49091850", periodStart: "2026-09-14", periodEnd: "2026-09-20", payDate: "2026-09-22",
    employees: [employee("M SL", "weekly", { slborAmount: 1_000 })],
    inputs: [{ employeeId: "M SL", grossOverride: 92_628, extraPay: 50_000, payrollDonation: 3_000, priorGross: 10_000, priorPaye: 1_750, ess: 20_000 }],
  });
  const csv = generatePaydayFilingCsv(r, { name: "P", phone: "1", email: "a@b.co" }).trimEnd().split("\r\n");
  const header = csv[0].split(",");
  const line = csv[1].split(",");
  assert.equal(line[11], "10000");
  assert.equal(line[15], "1750");
  assert.equal(line[20], "1000");
  // $30 x 0.333333, truncated: $9.99, as the spec has it.
  assert.equal(line[24], "999");
  assert.equal(line[26], "20000");
  assert.equal(header[11], "10000");
  assert.equal(header[23], "999");
  assert.equal(header[25], "20000");
  const journal = payrollJournal(r, {
    wages: { code: "477", name: "W" }, wagesPayable: { code: "804", name: "WP" }, payePayable: { code: "825", name: "P" },
  });
  assert.equal(journal.lines.reduce((s, l) => s + l.amount, 0), 0);
});

// --- employer KiwiSaver paid as salary (spec 5.20.2) ---------------------------
//
// IR's example: $500.03 a week, KiwiSaver 4% employee and 3% employer. Its
// PAYE figures ($74.85 on $500.03, $77.72 on $515.03) are the 2025-26 levy's.

const rachel = (asSalary) =>
  employee("M", "weekly", {
    kiwiSaverRate: 0.04,
    kiwiSaverEmployerRate: 0.03,
    ...(asSalary ? { employerKiwiSaverAsSalary: asSalary } : {}),
  });

test("usual way: the contribution is the employer's, taxed by ESCT", () => {
  const line = calculatePayLine(rachel(), 50_003, 2026);
  assert.equal(line.gross, 50_003);
  assert.equal(line.paye, 7_485);
  assert.equal(line.kiwiSaverEmployer, 1_500);
  assert.ok(line.esct > 0);
});

test("paid as salary, gross: PAYE on $515.03, the full $15 to the fund out of pay, no ESCT", () => {
  const line = calculatePayLine(rachel("gross"), 50_003, 2026);
  assert.equal(line.gross, 51_503);
  assert.equal(line.paye, 7_772);
  assert.equal(line.kiwiSaverEmployee, 2_000);
  assert.equal(line.esct, 0);
  assert.equal(line.kiwiSaverEmployer, 0);
  assert.equal(line.kiwiSaverEmployerNet, 1_500);
  assert.equal(line.netPay, 40_231); // IR: $402.31
});

test("paid as salary, net: the income tax on the contribution comes out of it", () => {
  const line = calculatePayLine(rachel("net"), 50_003, 2026);
  // Tax on it $2.87 (77.72 - 74.85), less its levy (15 x 1.67% = 0.25): $2.62.
  // IR's example takes the levy at 1.75% ($0.26) for $12.39; at this year's
  // levy it is $12.38.
  assert.equal(line.kiwiSaverEmployerNet, 1_500 - (287 - 25));
  assert.equal(line.netPay, 51_503 - 7_772 - 2_000 - line.kiwiSaverEmployerNet);
});

test("paid as salary, the pay run's journal still balances with no employer KiwiSaver cost", () => {
  const r = buildPayRun({
    id: "k", employerIrd: "49091850", periodStart: "2026-03-16", periodEnd: "2026-03-22", payDate: "2026-03-24",
    employees: [rachel("gross")], inputs: [{ employeeId: "M", grossOverride: 50_003 }],
  });
  const journal = payrollJournal(r, {
    wages: { code: "477", name: "W" }, kiwiSaverExpense: { code: "478", name: "KE" },
    wagesPayable: { code: "804", name: "WP" }, payePayable: { code: "825", name: "P" }, kiwiSaverPayable: { code: "826", name: "KP" },
  });
  assert.equal(journal.lines.reduce((s, l) => s + l.amount, 0), 0);
  const by = Object.fromEntries(journal.lines.map((l) => [l.accountCode, l.amount]));
  assert.equal(by["477"], 51_503);
  assert.equal(by["478"], undefined);
  assert.equal(by["826"], -(2_000 + 1_500));
  const dei = generatePaydayFilingCsv(r, { name: "P", phone: "1", email: "a@b.co" }).split("\r\n")[1].split(",");
  assert.equal(dei[10], "51503");
  assert.equal(dei[22], "1500");
  assert.equal(dei[23], "0");
});
