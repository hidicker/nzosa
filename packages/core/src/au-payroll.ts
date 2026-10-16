import type { Cents } from "./money.js";
import type { IsoDate } from "./dates.js";
import type { PostedJournal, PostedLine } from "./posting.js";
import { auLowIncomeOffset, auResidentTax, medicareLevy } from "./au-tax.js";

/**
 * Australian payroll for a small employer: who is paid, each pay run's gross,
 * the PAYG withheld from it, and the super guarantee on it -- what the BAS's
 * W1 and W2 report, what is owed to the ATO and to each fund, and what Single
 * Touch Payroll reports for each pay event.
 *
 * From the OpenAccountants guides `australia-payroll` and `au-super-guarantee`
 * (source-cited drafts, checked 16 October 2026).
 *
 * The PAYG withheld is an estimate. The ATO works it from the Schedule 1
 * coefficients for the pay period; this works the year's tax on the pay
 * annualised -- resident rates, the Medicare levy and the low income offset
 * where the tax-free threshold is claimed -- and divides it back. The two
 * agree to within a few dollars for an ordinary pay, and the amount is the
 * employer's to change to the ATO's own figure before the pay goes out.
 */

export type AuPayFrequency = "weekly" | "fortnightly" | "monthly";

export const AU_PERIODS: Readonly<Record<AuPayFrequency, number>> = { weekly: 52, fortnightly: 26, monthly: 12 };

export interface AuEmployee {
  id: string;
  name: string;
  /** Claims the tax-free threshold from this employer (on the TFN declaration). */
  taxFreeThreshold: boolean;
  /** A tax file number was given. Without one, 47% is withheld. The number itself is not kept here. */
  tfnProvided: boolean;
  /** A foreign resident for tax: no tax-free threshold and no Medicare levy. */
  foreignResident?: boolean;
  /** Has a study or training support loan (HELP and the like): extra is withheld per Schedule 8. */
  studyLoan?: boolean;
  superFund: string;
  payFrequency: AuPayFrequency;
  /** Gross pay for an ordinary period, to start each pay run with. */
  usualGross?: Cents;
  /** The last day worked, once they have left. */
  ended?: IsoDate;
}

export interface AuPayLine {
  employeeId: string;
  /** Gross pay, all ordinary time earnings here. */
  gross: Cents;
  /** PAYG withheld. */
  payg: Cents;
  /** True when `payg` is NZOSA's estimate rather than a figure entered. */
  paygEstimated: boolean;
  /** Super guarantee on the gross: paid on top, to the fund. */
  superGuarantee: Cents;
  /** What goes to the employee's bank account. */
  net: Cents;
}

export interface AuPayRun {
  id: string;
  payDate: IsoDate;
  periodStart: IsoDate;
  periodEnd: IsoDate;
  lines: AuPayLine[];
}

export interface AuPayroll {
  employees: AuEmployee[];
  payRuns: AuPayRun[];
  /** Chart codes: wages, super expense, PAYG withholding payable, super payable, net pay clearing. */
  accounts?: { wages?: string; superExpense?: string; paygPayable?: string; superPayable?: string; wagesPayable?: string };
}

/** The financial year a date falls in, by the year it ends: 2026-07-01 is 2027. */
export function auFinancialYear(date: IsoDate): number {
  const year = Number(date.slice(0, 4));
  return Number(date.slice(5, 7)) >= 7 ? year + 1 : year;
}

/** Foreign residents' rates, 2026-27 (au-rates-2026-27): 30% to $135,000, then the resident bands. */
function foreignResidentTax(annual: Cents): Cents {
  const income = Math.floor(Math.max(0, annual) / 100) * 100;
  const bands: [Cents, number][] = [
    [0, 0.3],
    [13_500_000, 0.37],
    [19_000_000, 0.45],
  ];
  let tax = 0;
  bands.forEach(([from, rate], i) => {
    const next = bands[i + 1]?.[0] ?? Number.POSITIVE_INFINITY;
    if (income > from) tax += (Math.min(income, next) - from) * rate;
  });
  return Math.round(tax);
}

/**
 * NZOSA's estimate of the PAYG to withhold from one pay, in whole dollars as
 * the ATO's tables give it. Null for a year whose rates are not held.
 */
export function auPaygEstimate(gross: Cents, employee: AuEmployee, payDate: IsoDate): Cents | null {
  if (gross <= 0) return 0;
  if (!employee.tfnProvided) return Math.floor((gross * 0.47) / 100) * 100;
  const periods = AU_PERIODS[employee.payFrequency];
  const annual = gross * periods;
  const year = auFinancialYear(payDate);
  let tax: Cents;
  if (employee.foreignResident === true) {
    tax = foreignResidentTax(annual);
  } else if (employee.taxFreeThreshold) {
    const base = auResidentTax(annual, year);
    if (base === null) return null;
    const lito = auLowIncomeOffset(annual, year) ?? 0;
    tax = Math.max(0, base - lito) + medicareLevy(annual, year);
  } else {
    // No tax-free threshold from this employer: taxed from the first dollar,
    // as though it is claimed against other income, with the full levy.
    const shifted = auResidentTax(annual + 1_820_000, year);
    if (shifted === null) return null;
    tax = shifted + Math.round(annual * 0.02);
  }
  // A study or training support loan: the compulsory repayment on the year's
  // pay, withheld as it is earned. Without the tax-free threshold from this
  // employer the thresholds come down by it, as Schedule 8's own columns do.
  if (employee.studyLoan === true) {
    tax += studyLoanRepayment(annual + (employee.taxFreeThreshold ? 0 : 1_820_000), payDate);
  }
  return Math.round(tax / periods / 100) * 100;
}

/**
 * The year's compulsory study and training support loan repayment on a
 * repayment income, by the marginal system from 2025-26: nothing to $67,000,
 * 15c in the dollar above it to $125,000, 17c above that, and from $179,286 a
 * flat 10% of the whole income. Nothing for a pay before 1 July 2025, whose
 * thresholds are not held.
 */
export function studyLoanRepayment(income: Cents, payDate: IsoDate): Cents {
  if (payDate < "2025-07-01" || income <= 6_700_000) return 0;
  if (income > 17_928_500) return Math.round(income * 0.1);
  if (income > 12_500_000) return 870_000 + Math.round((income - 12_500_000) * 0.17);
  return Math.round((income - 6_700_000) * 0.15);
}

/** The super guarantee rate for a payday: 11.5% in 2024-25, 12% from 1 July 2025. */
export function sgRate(payDate: IsoDate): number {
  return payDate >= "2025-07-01" ? 0.12 : 0.115;
}

/**
 * The super guarantee on a pay. From 1 July 2026 the maximum contribution
 * base is annual -- $270,830 of qualifying earnings a year -- so the pay that
 * crosses it attracts SG only on the part beneath, and later pays none. Before
 * then it was $62,500 a quarter (2025-26). `earnedBefore` is the employee's
 * qualifying earnings already paid in the same year (or quarter, before
 * 2026-27).
 */
export function superGuarantee(gross: Cents, earnedBefore: Cents, payDate: IsoDate): Cents {
  if (gross <= 0) return 0;
  const base = payDate >= "2026-07-01" ? 27_083_000 : 6_250_000;
  const room = Math.max(0, base - earnedBefore);
  return Math.round(Math.min(gross, room) * sgRate(payDate));
}

/** Monday to Friday after a date, counted forward; public holidays are not known here. */
function businessDaysAfter(date: IsoDate, days: number): IsoDate {
  const at = new Date(`${date}T00:00:00Z`);
  let left = days;
  while (left > 0) {
    at.setUTCDate(at.getUTCDate() + 1);
    const d = at.getUTCDay();
    if (d !== 0 && d !== 6) left -= 1;
  }
  return at.toISOString().slice(0, 10);
}

/**
 * When a pay's super has to be in the fund. Payday super from 1 July 2026:
 * received within 7 business days of payday (20 for a new employee or fund).
 * Before then, the 28th of the month after the quarter: 28 October, 28
 * January, 28 April, 28 July.
 */
export function superDueDate(payDate: IsoDate, firstContribution = false): IsoDate {
  if (payDate >= "2026-07-01") return businessDaysAfter(payDate, firstContribution ? 20 : 7);
  const year = Number(payDate.slice(0, 4));
  const month = Number(payDate.slice(5, 7));
  if (month <= 3) return `${year}-04-28`;
  if (month <= 6) return `${year}-07-28`;
  if (month <= 9) return `${year}-10-28`;
  return `${year + 1}-01-28`;
}

/** Qualifying earnings already paid to an employee in the year (or quarter, before 2026-27) before a payday. */
export function earnedBeforePay(runs: readonly AuPayRun[], employeeId: string, payDate: IsoDate): Cents {
  const year = auFinancialYear(payDate);
  const quarter = (d: IsoDate): string => `${d.slice(0, 4)}-${Math.ceil(Number(d.slice(5, 7)) / 3)}`;
  return runs
    .filter((r) => r.payDate < payDate)
    .filter((r) => (payDate >= "2026-07-01" ? auFinancialYear(r.payDate) === year : quarter(r.payDate) === quarter(payDate)))
    .flatMap((r) => r.lines)
    .filter((l) => l.employeeId === employeeId)
    .reduce((sum, l) => sum + l.gross, 0);
}

/** A pay line from a gross, with PAYG estimated unless one is given. */
export function auPayLine(
  employee: AuEmployee,
  gross: Cents,
  payDate: IsoDate,
  earnedBefore: Cents,
  payg?: Cents,
): AuPayLine {
  const estimate = auPaygEstimate(gross, employee, payDate) ?? 0;
  const withheld = payg ?? estimate;
  return {
    employeeId: employee.id,
    gross,
    payg: withheld,
    paygEstimated: payg === undefined,
    superGuarantee: superGuarantee(gross, earnedBefore, payDate),
    net: gross - withheld,
  };
}

/** The BAS's PAYG withholding labels for a period: W1 gross paid, W2 withheld, and the super owed on it. */
export function auWithholding(runs: readonly AuPayRun[], from: IsoDate, to: IsoDate): { w1: Cents; w2: Cents; superGuarantee: Cents } {
  const lines = runs.filter((r) => r.payDate >= from && r.payDate <= to).flatMap((r) => r.lines);
  return {
    w1: lines.reduce((s, l) => s + l.gross, 0),
    w2: lines.reduce((s, l) => s + l.payg, 0),
    superGuarantee: lines.reduce((s, l) => s + l.superGuarantee, 0),
  };
}

/**
 * Each employee's year to date at a pay event, as Single Touch Payroll reports
 * it: gross, PAYG withheld and super liability for the financial year.
 */
export function stpYearToDate(
  runs: readonly AuPayRun[],
  upTo: AuPayRun,
): { employeeId: string; gross: Cents; payg: Cents; superGuarantee: Cents }[] {
  const year = auFinancialYear(upTo.payDate);
  const held = new Map<string, { gross: Cents; payg: Cents; superGuarantee: Cents }>();
  for (const run of runs) {
    if (auFinancialYear(run.payDate) !== year || run.payDate > upTo.payDate) continue;
    for (const l of run.lines) {
      const t = held.get(l.employeeId) ?? { gross: 0, payg: 0, superGuarantee: 0 };
      t.gross += l.gross;
      t.payg += l.payg;
      t.superGuarantee += l.superGuarantee;
      held.set(l.employeeId, t);
    }
  }
  return upTo.lines.map((l) => ({ employeeId: l.employeeId, ...(held.get(l.employeeId) ?? { gross: 0, payg: 0, superGuarantee: 0 }) }));
}

export interface AuPayrollAccounts {
  wages: { code: string; name: string };
  superExpense: { code: string; name: string };
  paygPayable: { code: string; name: string };
  superPayable: { code: string; name: string };
  wagesPayable: { code: string; name: string };
}

/**
 * A pay run in the books: gross to wages and the super guarantee to its
 * expense; PAYG withheld owed to the ATO, super owed to the funds, and net pay
 * waiting to be paid. The bank lines that pay those three are coded to the
 * same three accounts and clear them. Out of GST: wages and super are not
 * supplies.
 */
export function auPayRunJournal(run: AuPayRun, accounts: AuPayrollAccounts): PostedJournal | null {
  if (run.lines.length === 0) return null;
  const sum = (pick: (l: AuPayLine) => number): Cents => run.lines.reduce((s, l) => s + pick(l), 0);
  const raw: [{ code: string; name: string }, Cents, string][] = [
    [accounts.wages, sum((l) => l.gross), "Gross pay"],
    [accounts.superExpense, sum((l) => l.superGuarantee), "Super guarantee"],
    [accounts.paygPayable, -sum((l) => l.payg), "PAYG withheld"],
    [accounts.superPayable, -sum((l) => l.superGuarantee), "Super guarantee owed to funds"],
    [accounts.wagesPayable, -sum((l) => l.net), "Net pay"],
  ];
  const byCode = new Map<string, PostedLine>();
  for (const [account, amount, description] of raw) {
    if (amount === 0) continue;
    const held = byCode.get(account.code);
    if (held !== undefined) {
      held.amount += amount;
      held.description = `${held.description}; ${description}`;
    } else {
      byCode.set(account.code, { accountCode: account.code, accountName: account.name, amount, taxType: "NONE", description });
    }
  }
  return {
    transactionId: `au-payroll:${run.id}`,
    date: run.payDate,
    narration: `Pay run, ${run.periodStart} to ${run.periodEnd}`,
    lines: [...byCode.values()].filter((l) => l.amount !== 0),
    source: "payroll",
    taxBasis: "both",
  };
}
