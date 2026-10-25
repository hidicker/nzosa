/**
 * Payslips: what each person was paid, and why, for a pay run.
 *
 * Built from the pay run as it was saved -- never worked out again -- so a
 * payslip cannot disagree with what was paid, filed and posted. Its rows add
 * up: earnings less deductions, plus reimbursements, is the net pay on the
 * pay run, to the cent (and the tests hold it to that).
 *
 * New Zealand: what an employer must be able to give an employee on request
 * (Employment Relations Act s 130: the pay, how it was worked out, the
 * deductions) and what a payslip usually carries besides -- year-to-date
 * totals, KiwiSaver both ways and the leave balance. Australia: what the Fair
 * Work Regulations ask of a pay slip -- the employer, the period, gross and
 * net, every deduction, and the super paid and to which fund.
 */

import type { Cents } from "./money.js";
import type { IsoDate } from "./dates.js";
import type { Employee, PayLine, PayRun } from "./payroll.js";
import type { AuEmployee, AuPayLine, AuPayRun } from "./au-payroll.js";

export interface PayslipRow {
  label: string;
  /** How it was worked out, where that helps: "38 hours at $27.50". */
  detail?: string;
  amount: Cents;
}

export interface Payslip {
  country: "nz" | "au";
  employer: string;
  /** The employer's IRD number or ABN, as the country has it. */
  employerNumber?: string;
  employee: string;
  /** Only the last three digits of an IRD number: enough to tell, not enough to use. */
  employeeNumber?: string;
  taxCode?: string;
  periodStart: IsoDate;
  periodEnd: IsoDate;
  payDate: IsoDate;
  earnings: PayslipRow[];
  totalEarnings: Cents;
  deductions: PayslipRow[];
  totalDeductions: Cents;
  reimbursements: PayslipRow[];
  netPay: Cents;
  /** The bank account paid, shown by its last digits only. */
  paidTo?: string;
  /** What the employer paid on top, which is not in the pay: KiwiSaver, ESCT, super. */
  employerPaid: PayslipRow[];
  yearToDate: PayslipRow[];
  /** "Year to 31 March 2026": what the year-to-date figures cover. */
  yearToDateLabel: string;
  leave?: PayslipLeave;
  notes: string[];
}

export interface PayslipLeave {
  asAt: IsoDate;
  annualWeeks: number;
  annualHours?: number;
  sickDays: number;
  alternativeDays?: number;
  /** Paid holiday pay as it goes (8% on each pay) instead of annual holidays. */
  payAsYouGo?: boolean;
}

const sum = (rows: readonly PayslipRow[]): Cents => rows.reduce((s, r) => s + r.amount, 0) as Cents;
const percent = (rate: number): string => `${Math.round(rate * 1000) / 10}%`;

/** The last few characters of a number, the rest hidden: "•••-001". */
export function lastDigits(value: string, keep = 3): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length <= keep) return digits;
  return `•••${digits.slice(-keep)}`;
}

/** The New Zealand tax year a date is in, by the 31 March it ends on. */
function nzTaxYear(date: IsoDate): number {
  const [y = 0, m = 1] = date.split("-").map(Number);
  return m >= 4 ? y + 1 : y;
}

/**
 * One person's payslip for a New Zealand pay run.
 *
 * `runs` is every pay run, for the year-to-date figures: those paid in the
 * same tax year, on or before this one's pay date.
 */
export function nzPayslip(options: {
  run: PayRun;
  employeeId: string;
  employer: string;
  employee?: Employee;
  runs: readonly PayRun[];
  leave?: PayslipLeave;
  money: (cents: Cents) => string;
}): Payslip | null {
  const { run, employeeId, money } = options;
  const lines = run.lines.filter((l) => l.employeeId === employeeId);
  const first = lines[0];
  if (first === undefined) return null;

  const earnings: PayslipRow[] = [];
  const deductions: PayslipRow[] = [];
  const reimbursements: PayslipRow[] = [];
  const employerPaid: PayslipRow[] = [];
  const notes: string[] = [];

  for (const line of lines) {
    if (line.withholding === true) {
      // A schedular payment on its own line: its gross, and the tax on it.
      earnings.push({ label: "Schedular payment", detail: "taxed as withholding income", amount: line.gross });
      deductions.push({ label: "Withholding tax", amount: line.paye });
      continue;
    }
    const allowances = line.allowances ?? [];
    const extra = line.extraPay ?? 0;
    // The contribution paid as salary, inside gross. Pay runs saved before
    // it was recorded: paid "gross", it is what reached the fund; paid "net",
    // it is not known and stays inside ordinary pay.
    const asSalary =
      line.employerKiwiSaverAsSalary === undefined
        ? 0
        : (line.kiwiSaverAsSalary ?? (line.employerKiwiSaverAsSalary === "gross" ? (line.kiwiSaverEmployerNet ?? 0) : 0));
    const ordinary = line.gross - allowances.reduce((s, a) => s + a.amount, 0) - extra - asSalary;
    const rate = options.employee?.hourlyRate;
    const hours = line.hours;
    earnings.push({
      label: "Ordinary pay",
      ...(hours !== undefined && hours > 0
        ? { detail: `${hours} hour${hours === 1 ? "" : "s"}${rate !== undefined && rate > 0 ? ` at ${money(rate as Cents)}` : ""}` }
        : {}),
      amount: ordinary as Cents,
    });
    if (extra > 0) {
      earnings.push({ label: "Extra pay", detail: "a bonus or lump sum, taxed as an extra pay", amount: extra as Cents });
    }
    for (const allowance of allowances) earnings.push({ label: allowance.name, amount: allowance.amount });
    if (asSalary > 0) {
      earnings.push({ label: "Employer KiwiSaver, paid as salary", amount: asSalary as Cents });
    }
    if ((line.priorGross ?? 0) !== 0) {
      earnings.push({ label: "Correction to an earlier pay", amount: line.priorGross as Cents });
    }

    deductions.push({ label: "PAYE", detail: "income tax, with the ACC earners' levy", amount: line.paye });
    if ((line.donationCredit ?? 0) > 0) {
      deductions.push({ label: "Payroll giving tax credit", detail: "a third of the donation, back off PAYE", amount: -(line.donationCredit as Cents) as Cents });
    }
    if ((line.priorPaye ?? 0) !== 0) deductions.push({ label: "PAYE on the correction", amount: line.priorPaye as Cents });
    if (line.studentLoan > 0) deductions.push({ label: "Student loan", amount: line.studentLoan });
    if ((line.slcir ?? 0) > 0) deductions.push({ label: "Student loan, Inland Revenue's deduction notice", amount: line.slcir as Cents });
    if ((line.slbor ?? 0) > 0) deductions.push({ label: "Student loan, extra asked for", amount: line.slbor as Cents });
    if (line.kiwiSaverEmployee > 0) {
      const rate = options.employee?.kiwiSaverRate;
      deductions.push({
        label: "KiwiSaver",
        ...(rate !== undefined && rate > 0 ? { detail: percent(rate) } : {}),
        amount: line.kiwiSaverEmployee,
      });
    }
    if (line.employerKiwiSaverAsSalary !== undefined) {
      deductions.push({
        label: "Employer KiwiSaver, to the fund",
        detail: "paid as salary, so it goes to the fund out of pay",
        amount: (line.kiwiSaverEmployerNet ?? line.kiwiSaverEmployer) as Cents,
      });
    }
    if (line.childSupport > 0) {
      deductions.push({
        label: "Child support",
        ...(line.childSupportCode === "P" ? { detail: "less than asked, to protect 60% of net pay" } : {}),
        amount: line.childSupport,
      });
    }
    if ((line.payrollDonation ?? 0) > 0) deductions.push({ label: "Payroll giving", amount: line.payrollDonation as Cents });
    for (const d of line.deductions ?? []) deductions.push({ label: d.name, amount: d.amount });
    for (const r of line.reimbursements ?? []) reimbursements.push({ label: r.name, amount: r.amount });

    if (line.employerKiwiSaverAsSalary === undefined && line.kiwiSaverEmployer > 0) {
      const rate = options.employee?.kiwiSaverEmployerRate;
      employerPaid.push({
        label: "Employer KiwiSaver",
        ...(rate !== undefined && rate > 0 ? { detail: percent(rate) } : {}),
        amount: line.kiwiSaverEmployer,
      });
      if (line.esct > 0) {
        employerPaid.push({
          label: "Less ESCT (tax on the employer's contribution)",
          amount: -line.esct as Cents,
        });
      }
    }
    if ((line.ess ?? 0) > 0) notes.push(`An employee share scheme benefit of ${money(line.ess as Cents)} is reported for this pay; no tax is taken from it here.`);
  }

  const totalEarnings = sum(earnings);
  const totalDeductions = sum(deductions);
  const netPay = lines.reduce((s, l) => s + l.netPay, 0) as Cents;

  // The year so far: this tax year's pay runs, paid on or before this one.
  const year = run.taxYear ?? nzTaxYear(run.payDate);
  const ytdLines = options.runs
    .filter((r) => (r.taxYear ?? nzTaxYear(r.payDate)) === year && r.payDate <= run.payDate)
    .flatMap((r) => r.lines.filter((l) => l.employeeId === employeeId));
  const total = (pick: (l: PayLine) => number): Cents => ytdLines.reduce((s, l) => s + pick(l), 0) as Cents;
  const yearToDate: PayslipRow[] = [
    { label: "Gross pay", amount: total((l) => l.gross + (l.priorGross ?? 0)) },
    { label: "PAYE", amount: total((l) => l.paye + (l.priorPaye ?? 0)) },
  ];
  const ytdKiwiSaver = total((l) => l.kiwiSaverEmployee);
  if (ytdKiwiSaver > 0) yearToDate.push({ label: "KiwiSaver", amount: ytdKiwiSaver });
  const ytdEmployer = total((l) => (l.employerKiwiSaverAsSalary === undefined ? l.kiwiSaverEmployer : 0));
  if (ytdEmployer > 0) yearToDate.push({ label: "Employer KiwiSaver", amount: ytdEmployer });
  const ytdLoan = total((l) => l.studentLoan + (l.slcir ?? 0) + (l.slbor ?? 0));
  if (ytdLoan > 0) yearToDate.push({ label: "Student loan", amount: ytdLoan });
  yearToDate.push({ label: "Net pay", amount: total((l) => l.netPay) });

  const bank = options.employee?.bankAccount ?? "";
  return {
    country: "nz",
    employer: options.employer,
    ...(run.employerIrd !== "" ? { employerNumber: run.employerIrd } : {}),
    employee: first.employeeName,
    ...(first.irdNumber !== "" ? { employeeNumber: lastDigits(first.irdNumber) } : {}),
    taxCode: first.taxCode,
    periodStart: run.periodStart,
    periodEnd: run.periodEnd,
    payDate: run.payDate,
    earnings,
    totalEarnings,
    deductions,
    totalDeductions,
    reimbursements,
    netPay,
    ...(bank.trim() !== "" ? { paidTo: lastDigits(bank, 4) } : {}),
    employerPaid,
    yearToDate,
    yearToDateLabel: `Tax year to 31 March ${year}`,
    ...(options.leave !== undefined ? { leave: options.leave } : {}),
    notes,
  };
}

/** The Australian financial year a date is in, by the 30 June it ends on. */
function auYear(date: IsoDate): number {
  const [y = 0, m = 1] = date.split("-").map(Number);
  return m >= 7 ? y + 1 : y;
}

/** One person's pay slip for an Australian pay run. */
export function auPayslip(options: {
  run: AuPayRun;
  employeeId: string;
  employer: string;
  /** The employer's ABN, which a pay slip must show. */
  abn?: string;
  employee?: AuEmployee;
  runs: readonly AuPayRun[];
}): Payslip | null {
  const { run, employeeId } = options;
  const line: AuPayLine | undefined = run.lines.find((l) => l.employeeId === employeeId);
  if (line === undefined) return null;
  const earnings: PayslipRow[] = [{ label: "Ordinary time earnings", amount: line.gross }];
  const deductions: PayslipRow[] = [
    { label: "PAYG withholding", ...(line.paygEstimated ? { detail: "worked out from the ATO's tables" } : {}), amount: line.payg },
  ];
  // Anything else taken out, so the slip adds up to what was paid.
  const other = line.gross - line.payg - line.net;
  if (other !== 0) deductions.push({ label: "Other deductions", amount: other as Cents });
  const fund = options.employee?.superFund ?? "";
  const employerPaid: PayslipRow[] = [
    { label: "Superannuation guarantee", ...(fund.trim() !== "" ? { detail: `to ${fund}` } : {}), amount: line.superGuarantee },
  ];
  const year = auYear(run.payDate);
  const ytd = options.runs
    .filter((r) => auYear(r.payDate) === year && r.payDate <= run.payDate)
    .flatMap((r) => r.lines.filter((l) => l.employeeId === employeeId));
  const total = (pick: (l: AuPayLine) => number): Cents => ytd.reduce((s, l) => s + pick(l), 0) as Cents;
  return {
    country: "au",
    employer: options.employer,
    ...(options.abn !== undefined && options.abn.trim() !== "" ? { employerNumber: `ABN ${options.abn.trim()}` } : {}),
    employee: options.employee?.name ?? employeeId,
    periodStart: run.periodStart,
    periodEnd: run.periodEnd,
    payDate: run.payDate,
    earnings,
    totalEarnings: sum(earnings),
    deductions,
    totalDeductions: sum(deductions),
    reimbursements: [],
    netPay: line.net,
    employerPaid,
    yearToDate: [
      { label: "Gross pay", amount: total((l) => l.gross) },
      { label: "PAYG withholding", amount: total((l) => l.payg) },
      { label: "Superannuation", amount: total((l) => l.superGuarantee) },
      { label: "Net pay", amount: total((l) => l.net) },
    ],
    yearToDateLabel: `Financial year to 30 June ${year}`,
    notes: line.paygEstimated ? ["PAYG withholding was worked out from the ATO's tables; check it before relying on it."] : [],
  };
}

function escape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** A date in words: "15 August 2025". */
function said(date: IsoDate): string {
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const [y = "", m = "1", d = "1"] = date.split("-");
  return `${Number(d)} ${months[Number(m) - 1] ?? ""} ${y}`;
}

/**
 * Payslips as one printable page each: an HTML document to open and print,
 * or save as a PDF from the print dialog.
 */
export function payslipsHtml(slips: readonly Payslip[], money: (cents: Cents) => string): string {
  const rows = (items: readonly PayslipRow[]): string =>
    items
      .map(
        (r) =>
          `<tr><td>${escape(r.label)}${r.detail !== undefined ? `<span class="detail">${escape(r.detail)}</span>` : ""}</td>` +
          `<td class="amount">${escape(money(r.amount))}</td></tr>`,
      )
      .join("");
  const section = (title: string, items: readonly PayslipRow[], totalLabel?: string, total?: Cents): string =>
    items.length === 0
      ? ""
      : `<h2>${escape(title)}</h2><table>${rows(items)}${
          totalLabel !== undefined && total !== undefined
            ? `<tr class="total"><td>${escape(totalLabel)}</td><td class="amount">${escape(money(total))}</td></tr>`
            : ""
        }</table>`;
  const slipHtml = (s: Payslip): string => {
    const leave =
      s.leave === undefined
        ? ""
        : `<h2>Leave at ${escape(said(s.leave.asAt))}</h2><table>` +
          (s.leave.payAsYouGo === true
            ? `<tr><td>Annual holidays</td><td class="amount">Paid with each pay (8%)</td></tr>`
            : `<tr><td>Annual holidays</td><td class="amount">${s.leave.annualWeeks.toFixed(2)} weeks${
                s.leave.annualHours !== undefined ? ` (${s.leave.annualHours.toFixed(2)} hours)` : ""
              }</td></tr>`) +
          `<tr><td>Sick leave</td><td class="amount">${s.leave.sickDays} days</td></tr>` +
          (s.leave.alternativeDays !== undefined && s.leave.alternativeDays > 0
            ? `<tr><td>Alternative holidays</td><td class="amount">${s.leave.alternativeDays} days</td></tr>`
            : "") +
          `</table>`;
    return (
      `<section class="slip">` +
      `<header><div><div class="employer">${escape(s.employer)}</div>` +
      (s.employerNumber !== undefined ? `<div class="small">${escape(s.country === "nz" ? `IRD ${s.employerNumber}` : s.employerNumber)}</div>` : "") +
      `</div><div class="title">${s.country === "au" ? "Pay slip" : "Payslip"}</div></header>` +
      `<table class="about">` +
      `<tr><td>Employee</td><td>${escape(s.employee)}${s.employeeNumber !== undefined ? ` <span class="small">IRD ${escape(s.employeeNumber)}</span>` : ""}</td></tr>` +
      (s.taxCode !== undefined ? `<tr><td>Tax code</td><td>${escape(s.taxCode)}</td></tr>` : "") +
      `<tr><td>Pay period</td><td>${escape(said(s.periodStart))} to ${escape(said(s.periodEnd))}</td></tr>` +
      `<tr><td>Paid on</td><td>${escape(said(s.payDate))}</td></tr>` +
      `</table>` +
      section("Earnings", s.earnings, "Gross pay", s.totalEarnings) +
      section("Deductions", s.deductions, "Total deductions", s.totalDeductions) +
      section("Reimbursements", s.reimbursements) +
      `<table><tr class="net"><td>Net pay${s.paidTo !== undefined ? `<span class="detail">to account ${escape(s.paidTo)}</span>` : ""}</td>` +
      `<td class="amount">${escape(money(s.netPay))}</td></tr></table>` +
      section("Paid by the employer, on top of pay", s.employerPaid) +
      section(s.yearToDateLabel, s.yearToDate) +
      leave +
      s.notes.map((n) => `<p class="small">${escape(n)}</p>`).join("") +
      `</section>`
    );
  };
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${slips.length === 1 ? `Payslip — ${escape(slips[0]?.employee ?? "")}` : "Payslips"}</title>` +
    `<style>` +
    `body{font:13px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;color:#1d2733;margin:0;padding:24px;background:#f3f5f7}` +
    `.slip{background:#fff;max-width:640px;margin:0 auto 24px;padding:28px 32px;border:1px solid #d7dde3;border-radius:8px}` +
    `header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #1d2733;padding-bottom:10px;margin-bottom:12px}` +
    `.employer{font-size:17px;font-weight:600}.title{font-size:20px;font-weight:600}` +
    `h2{font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:#4a5866;margin:16px 0 4px}` +
    `table{width:100%;border-collapse:collapse}td{padding:3px 0;vertical-align:top}` +
    `.about td:first-child{width:110px;color:#4a5866}` +
    `.amount{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}` +
    `.detail{display:block;color:#5d6b78;font-size:12px}.small{color:#5d6b78;font-size:12px}` +
    `.total td{border-top:1px solid #c5ced6;font-weight:600}` +
    `.net td{border-top:2px solid #1d2733;border-bottom:2px solid #1d2733;font-size:15px;font-weight:700;padding:6px 0;margin-top:8px}` +
    `@media print{body{background:#fff;padding:0}.slip{border:none;max-width:none;margin:0;padding:0;page-break-after:always}.slip:last-child{page-break-after:auto}}` +
    `</style></head><body>${slips.map(slipHtml).join("")}</body></html>`
  );
}

/** A payslip as plain text, for the body of an email. */
export function payslipText(s: Payslip, money: (cents: Cents) => string): string {
  const out: string[] = [];
  const line = (label: string, amount: Cents, detail?: string): void => {
    out.push(`${label}${detail !== undefined ? ` (${detail})` : ""}: ${money(amount)}`);
  };
  out.push(`${s.country === "au" ? "Pay slip" : "Payslip"}: ${s.employee}`);
  out.push(`${s.employer}${s.employerNumber !== undefined ? `, ${s.country === "nz" ? `IRD ${s.employerNumber}` : s.employerNumber}` : ""}`);
  out.push(`Pay period ${said(s.periodStart)} to ${said(s.periodEnd)}, paid on ${said(s.payDate)}`);
  if (s.taxCode !== undefined) out.push(`Tax code ${s.taxCode}`);
  out.push("", "Earnings");
  for (const r of s.earnings) line(`  ${r.label}`, r.amount, r.detail);
  line("Gross pay", s.totalEarnings);
  out.push("", "Deductions");
  for (const r of s.deductions) line(`  ${r.label}`, r.amount, r.detail);
  line("Total deductions", s.totalDeductions);
  if (s.reimbursements.length > 0) {
    out.push("", "Reimbursements");
    for (const r of s.reimbursements) line(`  ${r.label}`, r.amount);
  }
  out.push("");
  line("Net pay", s.netPay, s.paidTo !== undefined ? `to account ${s.paidTo}` : undefined);
  if (s.employerPaid.length > 0) {
    out.push("", "Paid by the employer, on top of pay");
    for (const r of s.employerPaid) line(`  ${r.label}`, r.amount, r.detail);
  }
  out.push("", s.yearToDateLabel);
  for (const r of s.yearToDate) line(`  ${r.label}`, r.amount);
  if (s.leave !== undefined) {
    out.push("", `Leave at ${said(s.leave.asAt)}`);
    out.push(s.leave.payAsYouGo === true ? "  Annual holidays: paid with each pay (8%)" : `  Annual holidays: ${s.leave.annualWeeks.toFixed(2)} weeks`);
    out.push(`  Sick leave: ${s.leave.sickDays} days`);
  }
  for (const n of s.notes) out.push("", n);
  return out.join("\n");
}
