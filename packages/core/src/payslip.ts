import type { Cents } from "./money.js";
import { formatAmount } from "./money.js";
import type { IsoDate } from "./dates.js";
import type { PayRun } from "./payroll.js";
import { payrollTaxYear } from "./payroll.js";
import type { AuEmployee, AuPayLine, AuPayRun } from "./au-payroll.js";
import { auFinancialYear } from "./au-payroll.js";
import type { InvoiceSupplier } from "./invoice-document.js";
import { cleanLogo } from "./invoice-document.js";
import { asLines, DOCUMENT_STYLE, escapeHtml, written } from "./document-html.js";

/**
 * A payslip: what one employee was paid in one pay run, as a document they
 * can keep.
 *
 * The figures are the pay run's own, as saved, never worked out again. A
 * payslip that recomputed would tell the employee something different from
 * what was filed with Inland Revenue and posted to the books. The pieces
 * shown are checked to add up to the net pay recorded, and where they do not
 * the slip says so instead of quietly adjusting a line.
 *
 * HTML, like the invoices: it prints to PDF from a browser and goes as an
 * attachment from the person's own mail program.
 */

/** A row on a payslip: what it is, and the amount. */
export interface PayslipRow {
  label: string;
  amount: Cents;
  /** A small note beside the label: "38 hours at $28.50". */
  detail?: string;
}

/** A payslip's content, before it is written as a document. */
export interface Payslip {
  employeeName: string;
  payDate: IsoDate;
  periodStart: IsoDate;
  periodEnd: IsoDate;
  /** Name and value pairs under the employee's name: tax code, IRD number. */
  facts: [string, string][];
  earnings: PayslipRow[];
  gross: Cents;
  deductions: PayslipRow[];
  /** Paid on top of net pay, not taxed. */
  reimbursements: PayslipRow[];
  netPay: Cents;
  /** What the employer paid on top: KiwiSaver, ESCT, super. Not taken from pay. */
  employer: PayslipRow[];
  /** The tax year so far, up to and including this pay. */
  yearToDate: PayslipRow[];
  yearToDateLabel: string;
  /** Anything else worth printing: leave balances, say. */
  other: PayslipRow[];
  /** The pieces shown do not add up to the net pay recorded. */
  disagrees: boolean;
  /** Where the net pay went, by its last digits only. */
  paidTo: string;
}

/** A bank account by its last four digits, for a slip that may be emailed. */
export function maskedAccount(account: string): string {
  const digits = account.replace(/\D/g, "");
  return digits.length < 4 ? "" : `account ending ${digits.slice(-4)}`;
}

const sum = (rows: readonly PayslipRow[]): Cents => rows.reduce((s, r) => s + r.amount, 0);

/** A New Zealand employee's year to date at a pay, inside its tax year (to 31 March). */
export function nzYearToDate(
  runs: readonly PayRun[],
  employeeId: string,
  upTo: PayRun,
): { gross: Cents; paye: Cents; studentLoan: Cents; kiwiSaverEmployee: Cents; kiwiSaverEmployer: Cents; netPay: Cents } {
  const year = payrollTaxYear(upTo.payDate);
  const total = { gross: 0, paye: 0, studentLoan: 0, kiwiSaverEmployee: 0, kiwiSaverEmployer: 0, netPay: 0 };
  // The run itself counts even if it is not yet saved among the others.
  const all = runs.some((r) => r.id === upTo.id) ? runs : [...runs, upTo];
  for (const run of all) {
    if (payrollTaxYear(run.payDate) !== year || run.payDate > upTo.payDate) continue;
    // Two runs on one payday: only those saved up to this one count.
    if (run.payDate === upTo.payDate && all.indexOf(run) > all.indexOf(upTo)) continue;
    for (const line of run.lines) {
      if (line.employeeId !== employeeId) continue;
      total.gross += line.gross + (line.priorGross ?? 0);
      total.paye += line.paye + (line.priorPaye ?? 0);
      total.studentLoan += line.studentLoan + (line.slcir ?? 0) + (line.slbor ?? 0);
      total.kiwiSaverEmployee += line.kiwiSaverEmployee;
      total.kiwiSaverEmployer += line.kiwiSaverEmployer;
      total.netPay += line.netPay;
    }
  }
  return total;
}

/**
 * A New Zealand payslip from a saved pay run.
 *
 * Every line of the run for the employee is taken in, so a schedular payment
 * (withholding income, on its own WT line) is on the same slip as the wages.
 */
export function nzPayslip(
  run: PayRun,
  employeeId: string,
  options: {
    history?: readonly PayRun[];
    hourlyRate?: Cents;
    bankAccount?: string;
    other?: PayslipRow[];
  } = {},
): Payslip | null {
  const lines = run.lines.filter((l) => l.employeeId === employeeId);
  const first = lines[0];
  if (first === undefined) return null;

  const earnings: PayslipRow[] = [];
  const deductions: PayslipRow[] = [];
  const reimbursements: PayslipRow[] = [];
  const employer: PayslipRow[] = [];
  let net = 0;
  let recorded = 0;

  for (const line of lines) {
    recorded += line.netPay;
    const allowances = line.allowances ?? [];
    if (line.withholding === true) {
      for (const a of allowances) earnings.push({ label: a.name, amount: a.amount, detail: "schedular payment" });
      deductions.push({ label: "Withholding tax", amount: line.paye });
      net += line.gross - line.paye;
      continue;
    }
    const allowed = allowances.reduce((s, a) => s + a.amount, 0);
    const extra = line.extraPay ?? 0;
    const ordinary = line.gross - allowed - extra;
    const detail =
      line.hours !== undefined && options.hourlyRate !== undefined
        ? `${line.hours} hours at ${formatAmount(options.hourlyRate)}`
        : line.hours !== undefined
          ? `${line.hours} hours`
          : undefined;
    if (ordinary !== 0 || (allowed === 0 && extra === 0)) {
      earnings.push({
        label: line.employerKiwiSaverAsSalary !== undefined ? "Ordinary pay, with employer KiwiSaver as salary" : "Ordinary pay",
        amount: ordinary,
        ...(detail !== undefined ? { detail } : {}),
      });
    }
    for (const a of allowances) earnings.push({ label: a.name, amount: a.amount });
    if (extra !== 0) earnings.push({ label: "Extra pay", amount: extra });
    if ((line.priorGross ?? 0) !== 0) earnings.push({ label: "Correction to an earlier pay", amount: line.priorGross ?? 0 });

    const out = (label: string, amount: Cents | undefined): void => {
      if ((amount ?? 0) !== 0) deductions.push({ label, amount: amount ?? 0 });
    };
    out("PAYE", line.paye);
    out("PAYE on the earlier pay corrected", line.priorPaye);
    if ((line.donationCredit ?? 0) !== 0) deductions.push({ label: "Payroll giving tax credit", amount: -(line.donationCredit ?? 0) });
    out("Student loan", line.studentLoan);
    out("Student loan, asked for by Inland Revenue", line.slcir);
    out("Student loan, extra by choice", line.slbor);
    out("KiwiSaver", line.kiwiSaverEmployee);
    if (line.employerKiwiSaverAsSalary !== undefined) out("Employer KiwiSaver, to the fund", line.kiwiSaverEmployerNet ?? 0);
    out(line.childSupportCode === "P" ? "Child support (reduced to protect net pay)" : "Child support", line.childSupport);
    out("Payroll giving", line.payrollDonation);
    for (const d of line.deductions ?? []) out(d.name, d.amount);
    for (const r of line.reimbursements ?? []) if (r.amount !== 0) reimbursements.push({ label: r.name, amount: r.amount });

    if (line.employerKiwiSaverAsSalary === undefined && line.kiwiSaverEmployer !== 0) {
      employer.push({ label: "Employer KiwiSaver", amount: line.kiwiSaverEmployer });
      if (line.esct !== 0) employer.push({ label: "Less ESCT (tax on it)", amount: -line.esct });
    }

    net +=
      line.gross + (line.priorGross ?? 0) - line.paye - (line.priorPaye ?? 0) + (line.donationCredit ?? 0) -
      line.studentLoan - (line.slcir ?? 0) - (line.slbor ?? 0) - line.kiwiSaverEmployee - line.childSupport -
      (line.payrollDonation ?? 0) - (line.employerKiwiSaverAsSalary !== undefined ? line.kiwiSaverEmployerNet ?? 0 : 0) -
      (line.deductions ?? []).reduce((s, d) => s + d.amount, 0) +
      (line.reimbursements ?? []).reduce((s, r) => s + r.amount, 0);
  }

  const ytd = nzYearToDate(options.history ?? [run], employeeId, run);
  const year = payrollTaxYear(run.payDate);
  const ird = first.irdNumber.replace(/\D/g, "");
  return {
    employeeName: first.employeeName,
    payDate: run.payDate,
    periodStart: run.periodStart,
    periodEnd: run.periodEnd,
    facts: [
      ["Tax code", first.taxCode],
      ...(ird !== "" ? ([["IRD number", ird.replace(/^(\d{2,3})(\d{3})(\d{3})$/, "$1-$2-$3")]] as [string, string][]) : []),
    ],
    earnings,
    gross: sum(earnings),
    deductions,
    reimbursements,
    netPay: recorded,
    employer,
    yearToDateLabel: `Year to date, tax year to 31 March ${year}`,
    yearToDate: [
      { label: "Gross pay", amount: ytd.gross },
      { label: "PAYE", amount: ytd.paye },
      ...(ytd.studentLoan !== 0 ? [{ label: "Student loan", amount: ytd.studentLoan }] : []),
      ...(ytd.kiwiSaverEmployee !== 0 ? [{ label: "KiwiSaver", amount: ytd.kiwiSaverEmployee }] : []),
      ...(ytd.kiwiSaverEmployer !== 0 ? [{ label: "Employer KiwiSaver", amount: ytd.kiwiSaverEmployer }] : []),
      { label: "Net pay", amount: ytd.netPay },
    ],
    other: options.other ?? [],
    disagrees: net !== recorded,
    paidTo: maskedAccount(options.bankAccount ?? ""),
  };
}

/** An Australian payslip from a saved pay run. */
export function auPayslip(
  run: AuPayRun,
  line: AuPayLine,
  employee: AuEmployee,
  history: readonly AuPayRun[] = [run],
): Payslip {
  const year = auFinancialYear(run.payDate);
  const all = history.some((r) => r.id === run.id) ? history : [...history, run];
  const ytd = { gross: 0, payg: 0, superGuarantee: 0, net: 0 };
  for (const r of all) {
    if (auFinancialYear(r.payDate) !== year || r.payDate > run.payDate) continue;
    if (r.payDate === run.payDate && all.indexOf(r) > all.indexOf(run)) continue;
    for (const l of r.lines) {
      if (l.employeeId !== line.employeeId) continue;
      ytd.gross += l.gross;
      ytd.payg += l.payg;
      ytd.superGuarantee += l.superGuarantee;
      ytd.net += l.net;
    }
  }
  return {
    employeeName: employee.name,
    payDate: run.payDate,
    periodStart: run.periodStart,
    periodEnd: run.periodEnd,
    facts: [["Pay frequency", employee.payFrequency]],
    earnings: [{ label: "Ordinary pay", amount: line.gross }],
    gross: line.gross,
    deductions: [{ label: "PAYG withholding", amount: line.payg }],
    reimbursements: [],
    netPay: line.net,
    employer: [
      {
        label: "Superannuation guarantee",
        amount: line.superGuarantee,
        ...(employee.superFund.trim() !== "" ? { detail: `to ${employee.superFund.trim()}` } : {}),
      },
    ],
    yearToDateLabel: `Year to date, year to 30 June ${year}`,
    yearToDate: [
      { label: "Gross pay", amount: ytd.gross },
      { label: "PAYG withheld", amount: ytd.payg },
      { label: "Superannuation guarantee", amount: ytd.superGuarantee },
      { label: "Net pay", amount: ytd.net },
    ],
    other: [],
    disagrees: line.gross - line.payg !== line.net,
    paidTo: "",
  };
}

function rows(title: string, items: readonly PayslipRow[], total?: [string, Cents]): string {
  if (items.length === 0 && total === undefined) return "";
  const body = items
    .map(
      (r) =>
        `<tr><td>${escapeHtml(r.label)}${r.detail ? ` <span class="detail">${escapeHtml(r.detail)}</span>` : ""}</td>` +
        `<td class="n">${formatAmount(r.amount)}</td></tr>`,
    )
    .join("\n      ");
  return `<table>
    <thead><tr><th>${escapeHtml(title)}</th><th class="n">Amount</th></tr></thead>
    <tbody>
      ${body}
    </tbody>${
      total === undefined
        ? ""
        : `
    <tfoot><tr class="sub"><td class="n">${escapeHtml(total[0])}</td><td class="n">${formatAmount(total[1])}</td></tr></tfoot>`
    }
  </table>`;
}

/** The payslip as one self-contained HTML file. */
export function payslipDocument(
  slip: Payslip,
  employer: InvoiceSupplier,
  options: { dateStyle?: "dmy" | "mdy" | "ymd"; lang?: string; taxIdLabel?: string } = {},
): string {
  const date = (iso: string): string => written(iso, options.dateStyle);
  const logo = cleanLogo(employer.logo);
  const taxId = (employer.gstNumber ?? "").trim();
  const reimbursed = sum(slip.reimbursements);
  return `<!doctype html>
<html lang="${escapeHtml(options.lang ?? "en-NZ")}">
<head>
<meta charset="utf-8">
<title>Payslip ${escapeHtml(slip.employeeName)} ${escapeHtml(slip.payDate)}</title>
<style>${DOCUMENT_STYLE}
  .detail { color: var(--muted); font-size: 0.9em; }
  tfoot .sub td { font-weight: 600; color: var(--ink); border-top: 1px solid var(--line); }
  .cols { display: flex; gap: 2em; flex-wrap: wrap; align-items: flex-start; }
  .cols > table { flex: 1 1 18em; }
</style>
</head>
<body>
  <div class="head">
    <div class="who">
      ${logo === null ? "" : `<img class="logo" src="${logo}" alt="">`}
      <strong>${escapeHtml(employer.name)}</strong>
      ${employer.address ? asLines(employer.address) : ""}
      ${options.taxIdLabel !== undefined && taxId !== "" ? `<div>${escapeHtml(options.taxIdLabel)} ${escapeHtml(taxId)}</div>` : ""}
    </div>
    <div class="meta">
      <h1>Payslip</h1>
      <div><span class="k">Paid</span>${date(slip.payDate)}</div>
      <div><span class="k">Period</span>${date(slip.periodStart)} – ${date(slip.periodEnd)}</div>
    </div>
  </div>

  <div class="to">
    <span class="k-block">Employee</span>
    ${escapeHtml(slip.employeeName)}
    ${slip.facts.map(([k, v]) => `<div class="detail">${escapeHtml(k)}: ${escapeHtml(v)}</div>`).join("\n    ")}
  </div>

  ${rows("Earnings", slip.earnings, ["Gross pay", slip.gross])}
  ${rows("Deductions", slip.deductions, ["Total deductions", sum(slip.deductions)])}
  ${slip.reimbursements.length === 0 ? "" : rows("Reimbursements, not taxed", slip.reimbursements, ["Total reimbursed", reimbursed])}

  <table>
    <tfoot><tr class="due"><td class="n">Net pay${slip.paidTo !== "" ? `, to ${escapeHtml(slip.paidTo)}` : ""}</td><td class="n">${formatAmount(slip.netPay)}</td></tr></tfoot>
  </table>

  <div class="cols">
    ${rows("Paid by the employer as well", slip.employer)}
    ${rows(slip.yearToDateLabel, slip.yearToDate)}
  </div>
  ${slip.other.length === 0 ? "" : rows("Other", slip.other)}
  ${
    slip.disagrees
      ? `<div class="check">The lines above do not add up to the net pay recorded for this pay run, ${formatAmount(slip.netPay)}. Check this before sending.</div>`
      : ""
  }
</body>
</html>
`;
}

/**
 * The subject and message for emailing a payslip, for a `mailto:` link. No
 * figures in the message itself: the slip is the attachment, and an email
 * body is read on lock screens and in previews.
 */
export function payslipEmail(
  slip: Payslip,
  employerName: string,
  to: string,
  options: { dateStyle?: "dmy" | "mdy" | "ymd" } = {},
): { to: string; subject: string; body: string } {
  const paid = written(slip.payDate, options.dateStyle);
  const firstName = slip.employeeName.trim().split(/\s+/)[0] ?? "";
  return {
    to: to.trim(),
    subject: `Payslip for ${paid} from ${employerName}`.replace(/\s+/g, " "),
    body: [`Hello ${firstName},`.replace(" ,", ","), "", `Your payslip for the pay on ${paid} is attached.`, "", "Thank you,", employerName].join("\r\n"),
  };
}

/** A file name for a payslip: the employee and the payday. */
export function payslipFileName(slip: Payslip): string {
  const who = slip.employeeName.replace(/[^\p{L}\p{N} -]+/gu, "").trim().replace(/\s+/g, " ");
  return `Payslip ${who || "employee"} ${slip.payDate}.html`;
}
