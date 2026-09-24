import type { Cents } from "./money.js";
import type { IsoDate } from "./dates.js";
import type { Account } from "./chart.js";
import type { Journal, JournalLine } from "./journals.js";
import { earnerLevyOn, incomeTaxOn, ietcOn } from "./rental-schedules.js";

/**
 * Supported tax codes for New Zealand employees under the IR330 form.
 */
export type TaxCode =
  | "M"
  | "ME"
  | "M SL"
  | "ME SL"
  | "SB"
  | "S"
  | "SH"
  | "ST"
  | "SA"
  | "SB SL"
  | "S SL"
  | "SH SL"
  | "ST SL"
  | "SA SL"
  | "WT"
  | "CAE"
  | "EDW"
  | "ND";

export type PayFrequency = "weekly" | "fortnightly" | "monthly";

export interface Employee {
  id: string;
  name: string;
  irdNumber: string;
  taxCode: TaxCode;
  payFrequency: PayFrequency;
  hourlyRate?: Cents | undefined;
  annualSalary?: Cents | undefined;
  standardHours?: number | undefined;
  /** KiwiSaver employee deduction rate, e.g. 0.03, 0.04, 0.06, 0.08, 0.10, or 0 if not enrolled. */
  kiwiSaverRate: number;
  /** Compulsory employer contribution rate, typically 0.03 (3%) if enrolled. */
  kiwiSaverEmployerRate: number;
  /** Employer Superannuation Contribution Tax rate tier: 0.105, 0.175, 0.30, 0.33, 0.39. */
  esctRate: number;
  bankAccount: string;
  startDate?: IsoDate | undefined;
  finishDate?: IsoDate | undefined;
}

export interface PayLineInput {
  employeeId: string;
  hoursWorked?: number | undefined;
  grossOverride?: Cents | undefined;
  earningsNotLiableAcc?: Cents | undefined;
  childSupport?: Cents | undefined;
}

export interface PayLine {
  employeeId: string;
  employeeName: string;
  irdNumber: string;
  taxCode: TaxCode;
  gross: Cents;
  earningsNotLiableAcc: Cents;
  paye: Cents;
  studentLoan: Cents;
  kiwiSaverEmployee: Cents;
  kiwiSaverEmployer: Cents;
  esct: Cents;
  childSupport: Cents;
  netPay: Cents;
  startDate?: IsoDate | undefined;
  finishDate?: IsoDate | undefined;
}

export interface PayRun {
  id: string;
  employerIrd: string;
  periodStart: IsoDate;
  periodEnd: IsoDate;
  payDate: IsoDate;
  lines: PayLine[];
  totalGross: Cents;
  totalPaye: Cents;
  totalStudentLoan: Cents;
  totalKiwiSaverEmployee: Cents;
  totalKiwiSaverEmployer: Cents;
  totalEsct: Cents;
  totalChildSupport: Cents;
  totalNetPay: Cents;
}

/**
 * Inland Revenue weighted modulus-11 check-digit algorithm.
 *
 * Validates 8- or 9-digit New Zealand IRD numbers against official primary
 * and secondary weight sets and allocation range limits (10-000-000 to 150-000-000).
 */
export function isValidIrdNumber(raw: string): boolean {
  const digits = raw.replace(/\D/g, "");
  if (digits.length !== 8 && digits.length !== 9) return false;

  const padded = digits.padStart(9, "0");
  const num = Number(padded);
  if (num < 10_000_000 || num > 150_000_000) return false;

  const d = padded.split("").map(Number);
  const checkDigit = d[8] ?? 0;

  const primaryWeights = [3, 2, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 8; i++) {
    const digit = d[i] ?? 0;
    const weight = primaryWeights[i] ?? 0;
    sum += digit * weight;
  }

  let remainder = sum % 11;
  let calculated = remainder === 0 ? 0 : 11 - remainder;

  if (calculated === 10) {
    const secondaryWeights = [7, 4, 3, 2, 5, 2, 7, 6];
    let sum2 = 0;
    for (let i = 0; i < 8; i++) {
      const digit = d[i] ?? 0;
      const weight = secondaryWeights[i] ?? 0;
      sum2 += digit * weight;
    }
    let remainder2 = sum2 % 11;
    calculated = remainder2 === 0 ? 0 : 11 - remainder2;
    if (calculated === 10) return false;
  }

  return calculated === checkDigit;
}

/** Normalise an IRD number to 8 or 9 bare digits. */
export function cleanIrdNumber(raw: string): string {
  return raw.replace(/\D/g, "");
}

/** Format an IRD number into standard hyphenated representation (e.g. 12-345-678 or 123-456-789). */
export function formatIrdNumber(raw: string): string {
  const digits = cleanIrdNumber(raw);
  if (digits.length === 8) {
    return `${digits.slice(0, 2)}-${digits.slice(2, 5)}-${digits.slice(5)}`;
  }
  if (digits.length === 9) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return raw;
}

/** Pay frequency annualisation multiplier. */
function frequencyFactor(frequency: PayFrequency): number {
  switch (frequency) {
    case "weekly":
      return 52;
    case "fortnightly":
      return 26;
    case "monthly":
      return 12;
  }
}

/**
 * Annual student loan repayment threshold in cents ($24,128 for 2025/2026/2027).
 */
const ANNUAL_STUDENT_LOAN_THRESHOLD: Cents = 24_128_00;

/**
 * Secondary tax flat rates (excluding ACC earner levy).
 */
const SECONDARY_RATES: Record<string, number> = {
  SB: 0.105,
  S: 0.175,
  SH: 0.3,
  ST: 0.33,
  SA: 0.39,
};

/**
 * Calculate PAYE and statutory deductions for an employee's pay line.
 */
export function calculatePayLine(
  employee: Employee,
  gross: Cents,
  year = 2026,
  options?: {
    earningsNotLiableAcc?: Cents | undefined;
    childSupport?: Cents | undefined;
  },
): PayLine {
  const code = employee.taxCode;
  const factor = frequencyFactor(employee.payFrequency);
  const earningsNotLiableAcc = options?.earningsNotLiableAcc ?? 0;
  const childSupport = options?.childSupport ?? 0;

  // 1. PAYE Calculation
  let paye = 0;
  const isSecondary = code.startsWith("S");

  if (isSecondary) {
    const baseCode = code.replace(/\s*SL$/, "");
    const taxRate = SECONDARY_RATES[baseCode] ?? 0.175;
    const accRate = 0.0167; // ACC earner levy for 2026
    const combinedRate = taxRate + accRate;
    paye = Math.round(gross * combinedRate);
  } else {
    // Primary tax code (M, ME, M SL, ME SL)
    const annualGross = gross * factor;
    const annualIncomeTax = incomeTaxOn(annualGross, year) ?? 0;
    const annualAcc = earnerLevyOn(annualGross, year);
    let annualTotal = annualIncomeTax + annualAcc;

    if (code.startsWith("ME")) {
      const annualIetc = ietcOn(annualGross, year);
      annualTotal = Math.max(0, annualTotal - annualIetc);
    }
    paye = Math.round(annualTotal / factor);
  }

  // 2. Student Loan (12% of gross earnings over threshold)
  let studentLoan = 0;
  if (code.includes("SL")) {
    const periodThreshold = Math.round(ANNUAL_STUDENT_LOAN_THRESHOLD / factor);
    if (gross > periodThreshold) {
      studentLoan = Math.floor((gross - periodThreshold) * 0.12);
    }
  }

  // 3. KiwiSaver (Employee & Employer)
  const kiwiSaverEmployee =
    employee.kiwiSaverRate > 0 ? Math.round(gross * employee.kiwiSaverRate) : 0;
  const kiwiSaverEmployer =
    employee.kiwiSaverEmployerRate > 0
      ? Math.round(gross * employee.kiwiSaverEmployerRate)
      : 0;

  // 4. ESCT (Employer Superannuation Contribution Tax)
  const esctRate = employee.esctRate > 0 ? employee.esctRate : 0.175;
  const esct = kiwiSaverEmployer > 0 ? Math.round(kiwiSaverEmployer * esctRate) : 0;

  // 5. Net Pay
  const netPay = gross - paye - studentLoan - kiwiSaverEmployee - childSupport;

  return {
    employeeId: employee.id,
    employeeName: employee.name,
    irdNumber: cleanIrdNumber(employee.irdNumber),
    taxCode: code,
    gross,
    earningsNotLiableAcc,
    paye,
    studentLoan,
    kiwiSaverEmployee,
    kiwiSaverEmployer,
    esct,
    childSupport,
    netPay,
    startDate: employee.startDate,
    finishDate: employee.finishDate,
  };
}

/**
 * Assemble a full pay run from employees and their hours or gross overrides.
 */
export function buildPayRun(params: {
  id?: string | undefined;
  employerIrd: string;
  periodStart: IsoDate;
  periodEnd: IsoDate;
  payDate: IsoDate;
  employees: Employee[];
  inputs: PayLineInput[];
  year?: number | undefined;
}): PayRun {
  const id = params.id ?? `payrun-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const year = params.year ?? 2026;
  const employeeMap = new Map(params.employees.map((e) => [e.id, e]));
  const lines: PayLine[] = [];

  for (const input of params.inputs) {
    const emp = employeeMap.get(input.employeeId);
    if (!emp) continue;

    let gross = input.grossOverride ?? 0;
    if (input.grossOverride === undefined && input.hoursWorked !== undefined && emp.hourlyRate) {
      gross = Math.round(input.hoursWorked * emp.hourlyRate);
    } else if (input.grossOverride === undefined && emp.annualSalary) {
      const factor = frequencyFactor(emp.payFrequency);
      gross = Math.round(emp.annualSalary / factor);
    }

    lines.push(
      calculatePayLine(emp, gross, year, {
        earningsNotLiableAcc: input.earningsNotLiableAcc,
        childSupport: input.childSupport,
      }),
    );
  }

  const sum = (fn: (l: PayLine) => Cents): Cents => lines.reduce((acc, l) => acc + fn(l), 0);

  return {
    id,
    employerIrd: cleanIrdNumber(params.employerIrd),
    periodStart: params.periodStart,
    periodEnd: params.periodEnd,
    payDate: params.payDate,
    lines,
    totalGross: sum((l) => l.gross),
    totalPaye: sum((l) => l.paye),
    totalStudentLoan: sum((l) => l.studentLoan),
    totalKiwiSaverEmployee: sum((l) => l.kiwiSaverEmployee),
    totalKiwiSaverEmployer: sum((l) => l.kiwiSaverEmployer),
    totalEsct: sum((l) => l.esct),
    totalChildSupport: sum((l) => l.childSupport),
    totalNetPay: sum((l) => l.netPay),
  };
}

/** Format minor cents to standard 2-decimal dollar string (e.g. 125000 -> 1250.00). */
function toDollars(cents: Cents): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const remainder = abs % 100;
  return `${sign}${dollars}.${String(remainder).padStart(2, "0")}`;
}

/** Format an ISO date (YYYY-MM-DD) to IRD compact format (YYYYMMDD). */
function toIrdDate(iso: IsoDate): string {
  return iso.replace(/-/g, "");
}

/**
 * Generate official Inland Revenue Employment Information (EI) CSV format for Payday Filing.
 *
 * Produces record-typed rows (HED, DET, TRL) conforming to the IRD file-upload
 * specification for upload via myIR Express File Transfer.
 */
export function generatePaydayFilingCsv(payRun: PayRun): string {
  const rows: string[] = [];

  // Header Record: HED, Employer IRD, Pay Period End Date, Pay Date
  rows.push(
    [
      "HED",
      payRun.employerIrd,
      toIrdDate(payRun.periodEnd),
      toIrdDate(payRun.payDate),
    ].join(","),
  );

  // Detail Records: DET for each employee
  for (const line of payRun.lines) {
    rows.push(
      [
        "DET",
        line.irdNumber,
        line.taxCode,
        toDollars(line.gross),
        toDollars(line.earningsNotLiableAcc),
        toDollars(line.paye),
        toDollars(line.childSupport),
        toDollars(line.studentLoan),
        toDollars(line.kiwiSaverEmployee),
        toDollars(line.kiwiSaverEmployer),
        toDollars(line.esct),
        "0.00", // Payroll giving
        line.startDate ? toIrdDate(line.startDate) : "",
        line.finishDate ? toIrdDate(line.finishDate) : "",
        "0.00", // Prior period gross
        "0.00", // Prior period PAYE
      ].join(","),
    );
  }

  // Trailer Record: TRL, Record count, and control hash totals
  rows.push(
    [
      "TRL",
      String(payRun.lines.length),
      toDollars(payRun.totalGross),
      toDollars(payRun.totalPaye),
      toDollars(payRun.totalKiwiSaverEmployee),
      toDollars(payRun.totalKiwiSaverEmployer),
      toDollars(payRun.totalStudentLoan),
      toDollars(payRun.totalChildSupport),
      toDollars(payRun.totalEsct),
    ].join(","),
  );

  return rows.join("\r\n") + "\r\n";
}

/**
 * Find account code from chart by common naming pattern or fall back to standard code.
 */
function findAccount(
  chart: Account[],
  pattern: RegExp,
  fallbackCode: string,
  fallbackName: string,
): { code: string; name: string } {
  const found = chart.find(
    (a) => pattern.test(a.name.toLowerCase()) || a.code.trim() === fallbackCode,
  );
  return {
    code: found?.code.trim() ?? fallbackCode,
    name: found?.name.trim() ?? fallbackName,
  };
}

/**
 * Generate balanced double-entry payroll general ledger journal.
 *
 * Enforces sum(Debits) === sum(Credits) to the exact cent:
 * Dr Wages Expense (Gross)
 * Dr KiwiSaver Employer Expense
 * Cr PAYE Payable (PAYE + Student Loan)
 * Cr KiwiSaver Payable (Employee + Employer)
 * Cr Wages Payable (Net Pay)
 */
export function createPayrollJournal(
  payRun: PayRun,
  chart: Account[] = [],
): Journal {
  const wagesExpense = findAccount(chart, /wages|salaries/, "477", "Wages and Salaries");
  const kiwisaverExpense = findAccount(
    chart,
    /kiwisaver.*(employer|expense)/,
    "478",
    "KiwiSaver Employer Contribution",
  );
  const payePayable = findAccount(chart, /paye.*payable/, "825", "PAYE Payable");
  const kiwisaverPayable = findAccount(
    chart,
    /kiwisaver.*payable/,
    "826",
    "KiwiSaver Payable",
  );
  const wagesPayable = findAccount(
    chart,
    /wages.*(payable|clearing)/,
    "804",
    "Wages Payable",
  );

  const lines: JournalLine[] = [];
  let lineNumber = 1;

  // Dr Wages Gross
  if (payRun.totalGross > 0) {
    lines.push({
      accountCode: wagesExpense.code,
      accountName: wagesExpense.name,
      amount: payRun.totalGross,
      description: `Wages Gross (Payday ${payRun.payDate})`,
      line: lineNumber++,
    });
  }

  // Dr KiwiSaver Employer Expense
  if (payRun.totalKiwiSaverEmployer > 0) {
    lines.push({
      accountCode: kiwisaverExpense.code,
      accountName: kiwisaverExpense.name,
      amount: payRun.totalKiwiSaverEmployer,
      description: `KiwiSaver Employer Contribution (Payday ${payRun.payDate})`,
      line: lineNumber++,
    });
  }

  // Cr PAYE & Student Loan Payable
  const totalTaxPayable = payRun.totalPaye + payRun.totalStudentLoan + payRun.totalChildSupport;
  if (totalTaxPayable > 0) {
    lines.push({
      accountCode: payePayable.code,
      accountName: payePayable.name,
      amount: -totalTaxPayable,
      description: `PAYE & Student Loan deductions (Payday ${payRun.payDate})`,
      line: lineNumber++,
    });
  }

  // Cr KiwiSaver Payable (Employee + Employer)
  const totalKiwiSaverPayable =
    payRun.totalKiwiSaverEmployee + payRun.totalKiwiSaverEmployer;
  if (totalKiwiSaverPayable > 0) {
    lines.push({
      accountCode: kiwisaverPayable.code,
      accountName: kiwisaverPayable.name,
      amount: -totalKiwiSaverPayable,
      description: `KiwiSaver Payable (Payday ${payRun.payDate})`,
      line: lineNumber++,
    });
  }

  // Cr Wages Payable (Net Pay)
  if (payRun.totalNetPay > 0) {
    lines.push({
      accountCode: wagesPayable.code,
      accountName: wagesPayable.name,
      amount: -payRun.totalNetPay,
      description: `Net Wages Payable (Payday ${payRun.payDate})`,
      line: lineNumber++,
    });
  }

  return {
    id: `payrun-${payRun.id}`,
    date: payRun.payDate,
    narration: `Payroll Run for period ending ${payRun.periodEnd}`,
    postedDate: payRun.payDate,
    postedBy: "payroll",
    lines,
  };
}
