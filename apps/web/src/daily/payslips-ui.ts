import { auPayslip, leaveBalance, nzPayslip, ordinaryWeeklyPayOf, payslipText, payslipsHtml } from "@nzosa/core";
import type { AuPayRun, AuPayroll, Cents, IsoDate, PayRun, Payslip, PayslipLeave } from "@nzosa/core";
import { booksMoney } from "../country.js";
import { state } from "../state.js";
import type { PayrollData } from "../store.js";
import { download, tellOnPage } from "../ui.js";

/**
 * Payslips from the Payroll page: printed (or saved as a PDF from the print
 * dialog), or emailed to the employee from their own email program.
 *
 * Nothing is sent from here: an email opens addressed and written, for the
 * employer to read and send. The slip itself is built in core (payslips.ts)
 * from the pay run as saved.
 */

/**
 * Who the employer is, for the top of a payslip: the entity whose GST number
 * is the employer's IRD number, else the only business or company, else the
 * books' first entity.
 */
export function employerName(payroll: PayrollData): string {
  const entities = state.ledger.entities?.entities ?? [];
  const ird = (payroll.employerIrd ?? "").replace(/\D/g, "");
  const byIrd = ird === "" ? undefined : entities.find((e) => (e.gstNumber ?? "").replace(/\D/g, "") === ird);
  if (byIrd !== undefined) return byIrd.name;
  const trading = entities.filter((e) => (e.kind ?? "business") === "business" || e.kind === "nonprofit");
  if (trading.length === 1 && trading[0] !== undefined) return trading[0].name;
  return entities[0]?.name ?? "Employer";
}

/**
 * An Australian employer, for a pay slip: the only business entity (or the
 * first), and its ABN where the GST number box holds one.
 */
export function auEmployer(): { name: string; abn: string } {
  const entities = state.ledger.entities?.entities ?? [];
  const trading = entities.filter((e) => (e.kind ?? "business") === "business" || e.kind === "nonprofit");
  const chosen = trading.length === 1 ? trading[0] : entities[0];
  return { name: chosen?.name ?? "Employer", abn: (chosen?.gstNumber ?? "").trim() };
}

/** Every pay slip for an Australian pay run. */
export function auPayslipsFor(run: AuPayRun, payroll: AuPayroll): Payslip[] {
  const { name, abn } = auEmployer();
  const slips: Payslip[] = [];
  for (const line of run.lines) {
    const employee = payroll.employees.find((e) => e.id === line.employeeId);
    const slip = auPayslip({
      run,
      employeeId: line.employeeId,
      employer: name,
      ...(abn !== "" ? { abn } : {}),
      ...(employee !== undefined ? { employee } : {}),
      runs: payroll.payRuns,
    });
    if (slip !== null) slips.push(slip);
  }
  return slips;
}

/** Leave owed at a date, as a payslip shows it; none without a start date to count from. */
function leaveAt(payroll: PayrollData, employeeId: string, asAt: IsoDate): PayslipLeave | undefined {
  const employee = payroll.employees.find((e) => e.id === employeeId);
  if (employee === undefined || employee.startDate === undefined || employee.startDate === "") return undefined;
  const pays: { date: IsoDate; gross: Cents }[] = [];
  for (const run of payroll.payRuns) {
    for (const line of run.lines) {
      if (line.employeeId === employeeId && line.withholding !== true && run.payDate <= asAt) {
        pays.push({ date: run.payDate, gross: line.gross });
      }
    }
  }
  const settings = (payroll.leaveSettings ?? []).find((s) => s.employeeId === employeeId);
  const b = leaveBalance({
    employeeId,
    startDate: employee.startDate,
    asAt,
    ...(settings !== undefined ? { settings } : {}),
    pays,
    taken: payroll.leave ?? [],
    ordinaryWeeklyPay: ordinaryWeeklyPayOf(employee),
  });
  return {
    asAt,
    annualWeeks: b.annualWeeks,
    annualHours: b.annualWeeks * b.hoursPerWeek,
    sickDays: b.sickDays,
    alternativeDays: b.alternativeDays,
    payAsYouGo: b.payAsYouGo,
  };
}

/** The payslips for a pay run: everyone on it, or the people named. */
export function payslipsFor(run: PayRun, payroll: PayrollData, employeeIds?: readonly string[]): Payslip[] {
  const ids = employeeIds ?? [...new Set(run.lines.map((l) => l.employeeId))];
  const employer = employerName(payroll);
  const slips: Payslip[] = [];
  for (const id of ids) {
    const employee = payroll.employees.find((e) => e.id === id);
    const leave = leaveAt(payroll, id, run.payDate);
    const slip = nzPayslip({
      run,
      employeeId: id,
      employer,
      ...(employee !== undefined ? { employee } : {}),
      runs: payroll.payRuns,
      ...(leave !== undefined ? { leave } : {}),
      money: booksMoney,
    });
    if (slip !== null) slips.push(slip);
  }
  return slips;
}

/**
 * Show payslips on the page, ready to print or save.
 *
 * In a dialog over the page rather than a window of its own: browsers block
 * a new window, and an embedded one (the desktop app's pane) never shows it.
 * Print prints the payslips alone, one to a page -- or saves them as a PDF
 * from the print dialog -- and Save as file keeps the same page to open later.
 */
export function openPayslips(slips: readonly Payslip[], fileName: string): void {
  if (slips.length === 0) return;
  const html = payslipsHtml(slips, booksMoney);
  const box = document.createElement("dialog");
  box.className = "ask-on-page payslip-view";
  const frame = document.createElement("iframe");
  frame.className = "payslip-frame";
  frame.title = slips.length === 1 ? `Payslip for ${slips[0]?.employee ?? ""}` : `${slips.length} payslips`;
  frame.srcdoc = html;
  const actions = document.createElement("div");
  actions.className = "ask-on-page-actions";
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "Close";
  const save = document.createElement("button");
  save.type = "button";
  save.textContent = "Save as file";
  const print = document.createElement("button");
  print.type = "button";
  print.className = "primary";
  print.textContent = "Print";
  actions.append(close, save, print);
  box.append(frame, actions);
  const finish = (): void => {
    box.close();
    box.remove();
  };
  close.addEventListener("click", finish);
  box.addEventListener("cancel", (event) => {
    event.preventDefault();
    finish();
  });
  save.addEventListener("click", () => download(html, fileName, "text/html"));
  print.addEventListener("click", () => {
    try {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    } catch {
      void tellOnPage("This browser would not print from here. Save as file, open it, and print that.");
    }
  });
  document.body.append(box);
  box.showModal();
  print.focus();
}

/** An email to the employee with the payslip written out, for the employer to send. */
export async function emailPayslip(slip: Payslip, email: string): Promise<void> {
  if (email.trim() === "") {
    await tellOnPage(`${slip.employee} has no email address. Add one on the Employees tab, under their details.`);
    return;
  }
  const subject = `Payslip for ${slip.periodStart} to ${slip.periodEnd}`;
  const body = payslipText(slip, booksMoney);
  window.location.href = `mailto:${encodeURIComponent(email.trim())}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
