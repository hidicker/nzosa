import {
  AU_RENTAL_SCHEDULE,
  SCHEDULE_C,
  SCHEDULE_E,
  basDueDate,
  basQuarters,
  contractorTotals,
  emptyEntityModel,
  estimatedTaxDates,
  formSchedule,
  formatAmount,
  isRental,
  nec1099Threshold,
  simplerBas,
} from "@nzosa/core";
import type { ContractorPayment, Entity, FormDefinition, FormSchedule } from "@nzosa/core";
import { postedJournals, varianceInput } from "../books.js";
import { state } from "../state.js";
import { note } from "../ui.js";
import { computeOurReturns } from "../variance.js";
import { entityYearReport, scheduleName } from "./reports.js";
import { taxYearEnd, taxYearStart } from "../tax-year.js";

/**
 * The United States' and Australia's forms, as reports.
 *
 * Each is the books' own figures set out on the form's lines, from the same
 * per-entity profit and loss the rest of the reports use, so a form and the
 * profit and loss filtered to the same entity cannot disagree. Every line
 * says which accounts filled it: the line an account lands on is worked out
 * from its name, and a wrong guess has to be easy to see.
 */

const money = (cents: number): string => formatAmount(cents);

function entities(): readonly Entity[] {
  return (state.ledger.entities ?? emptyEntityModel()).entities;
}

/** One filled form as a table: line, amount (and what is allowed, where that differs), accounts. */
function formTable(filled: FormSchedule): HTMLElement {
  const table = document.createElement("table");
  table.className = "report-table";
  const body = document.createElement("tbody");
  const row = (label: string, amount: string, from = "", total = false): void => {
    const tr = document.createElement("tr");
    if (total) tr.className = "report-total";
    for (const [text, cls] of [
      [label, "report-name"],
      [amount, "report-amount"],
      [from, "report-note"],
    ] as const) {
      const td = document.createElement("td");
      td.className = cls;
      td.textContent = text;
      tr.append(td);
    }
    body.append(tr);
  };
  for (const line of filled.lines) {
    if (line.amount === 0) continue;
    const shown =
      line.allowed === line.amount ? money(line.amount) : `${money(line.allowed)} (of ${money(line.amount)})`;
    row(line.title, shown, line.accounts.map((a) => a.name).join(", "));
  }
  if (filled.costOfSales !== 0) row("Cost of goods sold", money(filled.costOfSales), "", true);
  row("Total income", money(filled.totalIncome), "", true);
  row("Total expenses", money(filled.totalExpenses), "", true);
  row(filled.net < 0 ? "Net loss" : "Net income", money(filled.net), "", true);
  table.append(body);
  return table;
}

function formFor(
  body: HTMLElement,
  year: number,
  form: FormDefinition,
  pick: (entity: Entity) => boolean,
  none: string,
): void {
  const chosen = entities().filter(pick);
  if (chosen.length === 0) {
    body.append(note(none));
    return;
  }
  for (const entity of chosen) {
    const report = entityYearReport(entity, year);
    if (report === null) continue;
    const filled = formSchedule(form, report, scheduleName);
    const heading = document.createElement("h3");
    const owners = (entity.owners ?? []).map((o) => `${o.name} ${o.percent}%`).join(" / ");
    heading.textContent = `${entity.name}${owners === "" ? "" : ` — ${owners}`}`;
    body.append(heading, formTable(filled));
  }
  for (const said of form.notes ?? []) body.append(note(said));
}

/** Schedule E, part I: one per rental property. */
export function renderScheduleE(body: HTMLElement, year: number): void {
  const title = document.createElement("h3");
  title.textContent = `Schedule E, Part I — ${year}`;
  body.append(title);
  formFor(body, year, SCHEDULE_E, isRental, "No rental properties in these books. Add one on Entities & accounts.");
}

/** Schedule C: one per business. */
export function renderScheduleC(body: HTMLElement, year: number): void {
  const title = document.createElement("h3");
  title.textContent = `Schedule C — ${year}`;
  body.append(title);
  formFor(
    body,
    year,
    SCHEDULE_C,
    (entity) => (entity.kind ?? "business") === "business",
    "No business in these books. Add one on Entities & accounts.",
  );
  const dates = estimatedTaxDates(year);
  body.append(
    note(
      `Estimated tax for ${year} is paid in four instalments: ${dates.join(", ")}. ` +
        "A date that falls on a federal holiday moves too; check the IRS calendar.",
    ),
  );
}

/**
 * Contractors paid over the year's 1099-NEC threshold: every payment posted to
 * an account Schedule C puts on line 11 (contract labor), by payee.
 */
export function renderContractors(body: HTMLElement, year: number): void {
  const title = document.createElement("h3");
  title.textContent = `Contractors and 1099-NEC — ${year}`;
  body.append(title);
  const payments: ContractorPayment[] = [];
  for (const journal of postedJournals()) {
    if (!journal.date.startsWith(String(year))) continue;
    for (const line of journal.lines) {
      if (line.amount <= 0) continue;
      const name = scheduleName(line.accountCode);
      if (!/contract|subcontract|freelanc/.test(name.toLowerCase())) continue;
      payments.push({ payee: journal.narration || "(no payee)", date: journal.date, amount: line.amount });
    }
  }
  const totals = contractorTotals(payments, year);
  if (totals.length === 0) {
    body.append(note("No payments to contract labor accounts this year."));
    return;
  }
  const table = document.createElement("table");
  table.className = "report-table";
  table.innerHTML = "<thead><tr><th>Payee</th><th>Payments</th><th>Total</th><th>1099-NEC</th></tr></thead>";
  const tbody = document.createElement("tbody");
  for (const one of totals) {
    const tr = document.createElement("tr");
    for (const [text, cls] of [
      [one.payee, "report-name"],
      [String(one.payments), "report-amount"],
      [money(one.total), "report-amount"],
      [one.due ? "Due" : "Not due", "report-note"],
    ] as const) {
      const td = document.createElement("td");
      td.className = cls;
      td.textContent = text;
      tr.append(td);
    }
    tbody.append(tr);
  }
  table.append(tbody);
  body.append(
    table,
    note(
      `A 1099-NEC is due for each non-corporate payee paid ${money(nec1099Threshold(year))} or more in ${year}, ` +
        "by 31 January of the next year, with their W-9 details. Payments by card or a payment app are " +
        "reported by the network on a 1099-K instead; take those out. Confirm the threshold for the year.",
    ),
  );
}

/** Australia's rental property schedule: one per rental. */
export function renderAuRentalSchedule(body: HTMLElement, year: number): void {
  const title = document.createElement("h3");
  title.textContent = `Rental property schedule — year to 30 June ${year}`;
  body.append(title);
  formFor(body, year, AU_RENTAL_SCHEDULE, isRental, "No rental properties in these books. Add one on Entities & accounts.");
}

/** GST on the BAS, quarter by quarter: G1, 1A, 1B and the net. */
export function renderBas(body: HTMLElement, year: number): void {
  const title = document.createElement("h3");
  title.textContent = `GST on the business activity statement — year to 30 June ${year}`;
  body.append(title);
  let returns: ReturnType<typeof computeOurReturns> = [];
  try {
    returns = computeOurReturns(varianceInput(), taxYearStart(year), taxYearEnd(year));
  } catch {
    returns = [];
  }
  const table = document.createElement("table");
  table.className = "report-table";
  table.innerHTML =
    "<thead><tr><th>Quarter</th><th>Due</th><th>G1 Total sales</th><th>1A GST on sales</th><th>1B GST on purchases</th><th>Net</th></tr></thead>";
  const tbody = document.createElement("tbody");
  for (const quarter of basQuarters(year)) {
    const inside = returns.filter((r) => r.period.to >= quarter.from && r.period.to <= quarter.to);
    const sum = (pick: (b: Record<string, number | undefined>) => number): number =>
      inside.reduce((t, r) => t + pick(r.boxes as unknown as Record<string, number | undefined>), 0);
    const bas = simplerBas({
      box5: sum((b) => b["box5"] ?? 0),
      box8: sum((b) => b["box8"] ?? 0),
      box12: sum((b) => b["box12"] ?? 0),
      box13: sum((b) => b["box13"] ?? 0),
    });
    const tr = document.createElement("tr");
    for (const [text, cls] of [
      [`${quarter.from} to ${quarter.to}`, "report-name"],
      [basDueDate(quarter.to), "report-note"],
      [money(bas.g1), "report-amount"],
      [money(bas.a1), "report-amount"],
      [money(bas.b1), "report-amount"],
      [`${money(Math.abs(bas.net))} ${bas.net >= 0 ? "to pay" : "refund"}`, "report-amount"],
    ] as const) {
      const td = document.createElement("td");
      td.className = cls;
      td.textContent = text;
      tr.append(td);
    }
    tbody.append(tr);
  }
  table.append(tbody);
  body.append(
    table,
    note(
      "The simpler BAS: G1 includes GST. Due dates are for lodging yourself; a registered tax agent " +
        "lodging electronically usually has longer. PAYG instalments and withholding are not included.",
    ),
  );
}
