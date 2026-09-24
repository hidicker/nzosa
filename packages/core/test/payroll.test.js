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
