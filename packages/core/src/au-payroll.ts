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
 * The ATO's Schedule 1 coefficients (Statement of formulas, weekly): for
 * weekly earnings less than each limit, withholding is a times x less b.
 * 1 July 2024 to 30 June 2026 (published 17 June 2024) and from 1 July 2026
 * (published 17 June 2026, with the 15% rate). Scale 1 is no tax-free
 * threshold, scale 2 claims it, scale 3 is a foreign resident.
 */
type Coefficients = readonly (readonly [number, number, number])[];
const SCHEDULE_1: readonly { from: IsoDate; scale1: Coefficients; scale2: Coefficients; scale3: Coefficients }[] = [
  {
    from: "2026-07-01",
    scale1: [[188, 0.15, 0.15], [371, 0.2084, 11.0185], [515, 0.179, 0.1066], [932, 0.3227, 74.1674], [2246, 0.32, 71.6508], [3303, 0.39, 228.8816], [Infinity, 0.47, 493.1893]],
    scale2: [[362, 0, 0], [538, 0.15, 54.3462], [673, 0.25, 108.2135], [721, 0.17, 54.3473], [865, 0.179, 60.8377], [1282, 0.3227, 185.1935], [2596, 0.32, 181.7319], [3653, 0.39, 363.4627], [Infinity, 0.47, 655.7704]],
    scale3: [[2596, 0.3, 0.3], [3653, 0.37, 181.7308], [Infinity, 0.45, 474.0385]],
  },
  {
    from: "2024-07-01",
    scale1: [[150, 0.16, 0.16], [371, 0.2117, 7.755], [515, 0.189, -0.6702], [932, 0.3227, 68.2367], [2246, 0.32, 65.7202], [3303, 0.39, 222.951], [Infinity, 0.47, 487.2587]],
    scale2: [[361, 0, 0], [500, 0.16, 57.8462], [625, 0.26, 107.8462], [721, 0.18, 57.8462], [865, 0.189, 64.3365], [1282, 0.3227, 180.0385], [2596, 0.32, 176.5769], [3653, 0.39, 358.3077], [Infinity, 0.47, 650.6154]],
    scale3: [[2596, 0.3, 0.3], [3653, 0.37, 181.7308], [Infinity, 0.45, 474.0385]],
  },
];

/**
 * The ATO's Schedule 8 coefficients: the study and training support loans
 * component, worked on the same weekly earnings as Schedule 1. From 24
 * September 2025 (the marginal system) and from 1 July 2026 (published 17
 * June 2026). One table where the tax-free threshold is claimed or the payee
 * is a foreign resident, the other where it is not.
 */
const SCHEDULE_8: readonly { from: IsoDate; claimed: Coefficients; notClaimed: Coefficients }[] = [
  {
    from: "2026-07-01",
    claimed: [[1337, 0, 0], [2494, 0.15, 200.5615], [3577, 0.17, 250.4527], [Infinity, 0.1, 0]],
    notClaimed: [[987, 0, 0], [2144, 0.15, 148.0615], [2727, 0.17, 190.9527], [Infinity, 0.1, 0]],
  },
  {
    from: "2025-09-24",
    claimed: [[1288, 0, 0], [2403, 0.15, 193.2692], [3447, 0.17, 241.3462], [Infinity, 0.1, 0]],
    notClaimed: [[938, 0, 0], [2053, 0.15, 140.7692], [2597, 0.17, 181.8462], [Infinity, 0.1, 0]],
  },
];

/** A pay as the ATO's weekly earnings: whole dollars of the week's share, plus 99 cents. */
function weeklyEarnings(gross: Cents, frequency: AuPayFrequency): number {
  let dollars = gross / 100;
  if (frequency === "monthly" && Math.round(gross % 100) === 33) dollars += 0.01;
  const weekly = frequency === "weekly" ? dollars : frequency === "fortnightly" ? dollars / 2 : (dollars * 3) / 13;
  return Math.floor(weekly + 1e-9) + 0.99;
}

/** A week's withholding taken back to the pay's period, in cents. */
function perPay(week: number, frequency: AuPayFrequency): Cents {
  const pay = frequency === "weekly" ? week : frequency === "fortnightly" ? week * 2 : Math.round((week * 13) / 3);
  return pay * 100;
}

/** a times x less b for the row x falls in, rounded to the dollar and never below nothing. */
function formula(rows: Coefficients, x: number): number {
  const row = rows.find(([limit]) => x < limit) ?? rows[rows.length - 1];
  return row === undefined ? 0 : Math.max(0, Math.round(row[1] * x - row[2]));
}

/**
 * The study and training support loans component for one pay by the ATO's
 * Schedule 8, in whole dollars (as cents), added to the Schedule 1 amount.
 * Null before 24 September 2025, whose coefficients are not held.
 */
export function auSchedule8(gross: Cents, frequency: AuPayFrequency, thresholdClaimed: boolean, payDate: IsoDate): Cents | null {
  const table = SCHEDULE_8.find((t) => payDate >= t.from);
  if (table === undefined) return null;
  if (gross <= 0) return 0;
  return perPay(formula(thresholdClaimed ? table.claimed : table.notClaimed, weeklyEarnings(gross, frequency)), frequency);
}

/**
 * Withholding by the ATO's Schedule 1 formula for one pay, in whole dollars
 * (as cents). The pay is turned into weekly earnings the ATO's way -- half a
 * fortnight's, three thirteenths of a month's (33 cents made 34), a
 * thirteenth of a quarter's, cents ignored and 99 cents added -- the week's
 * withholding rounded to the dollar, then taken back to the pay's period.
 * Null before 1 July 2024, whose coefficients are not held.
 */
export function auSchedule1(gross: Cents, frequency: AuPayFrequency, scale: 1 | 2 | 3, payDate: IsoDate): Cents | null {
  const table = SCHEDULE_1.find((t) => payDate >= t.from);
  if (table === undefined) return null;
  if (gross <= 0) return 0;
  const rows = scale === 1 ? table.scale1 : scale === 2 ? table.scale2 : table.scale3;
  return perPay(formula(rows, weeklyEarnings(gross, frequency)), frequency);
}

/**
 * The PAYG to withhold from one pay, in whole dollars as the ATO's tables
 * give it: the ATO's Schedule 1 formula from 1 July 2024, NZOSA's estimate
 * from the year's rates before then. Null for a year whose rates are not held.
 */
export function auPaygEstimate(gross: Cents, employee: AuEmployee, payDate: IsoDate): Cents | null {
  if (gross <= 0) return 0;
  // No TFN: 47%, or 45% for a foreign resident, of the pay ignoring cents.
  if (!employee.tfnProvided) return Math.floor((gross * (employee.foreignResident === true ? 0.45 : 0.47)) / 100) * 100;
  const scale = employee.foreignResident === true ? 3 : employee.taxFreeThreshold ? 2 : 1;
  const formula = auSchedule1(gross, employee.payFrequency, scale, payDate);
  if (formula !== null) {
    if (employee.studyLoan !== true) return formula;
    const component = auSchedule8(gross, employee.payFrequency, employee.taxFreeThreshold || employee.foreignResident === true, payDate);
    if (component !== null) return formula + component;
    const periods = AU_PERIODS[employee.payFrequency];
    const loan = studyLoanRepayment(gross * periods + (employee.taxFreeThreshold ? 0 : 1_820_000), payDate);
    return formula + Math.round(loan / periods / 100) * 100;
  }
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
