import { redraw } from "../app.js";
import { record } from "../books.js";
import { booksCurrency, booksMoney, noSalesTax } from "../country.js";
import { $, state } from "../state.js";
import { savePart } from "../store.js";
import { note } from "../ui.js";
import { findContact, nextInvoiceNumber, parseAmount, timeInvoiceLines, timeValue, unbilledTime } from "@nzosa/core";
import type { Invoice, TimeEntry } from "@nzosa/core";

/**
 * Time: hours worked for customers, and the invoice drafted from the hours
 * not yet billed.
 */

/** Entries drawn in the list at once. */
const SHOWN = 200;

// The day where the person is: these books are kept in their own country.
const today = (): string => new Date().toLocaleDateString("en-CA");

/**
 * The entries, with an invoice that has since been deleted forgotten: its
 * time is unbilled again.
 */
function held(): TimeEntry[] {
  const numbers = new Set((state.ledger.invoices ?? []).map((i) => i.number));
  return (state.ledger.timeEntries ?? []).map((e) => {
    if (e.invoice === undefined || numbers.has(e.invoice)) return e;
    const { invoice: _gone, ...rest } = e;
    return rest;
  });
}

async function keep(next: TimeEntry[], what: string): Promise<void> {
  const before = state.ledger.timeEntries ?? [];
  state.ledger = { ...state.ledger, timeEntries: next };
  state.persistent = await savePart(state.ledger);
  await record("time", what, before, next);
  redraw("time");
}

function hoursSaid(hours: number): string {
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(2);
}

/** "Net 30" as 30 days; 30 days when the terms say nothing readable. */
function termsDays(customer: string): number {
  const terms = findContact(state.ledger.contacts ?? [], customer)?.terms ?? "";
  if (/receipt/i.test(terms)) return 0;
  const days = /(\d+)/.exec(terms);
  return days !== null ? Number(days[1]) : 30;
}

function addDays(iso: string, days: number): string {
  const at = new Date(`${iso}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

async function invoiceTime(customer: string, entries: readonly TimeEntry[]): Promise<void> {
  const income = state.chart.filter((a) => /revenue|income|sales/i.test(a.type));
  const account = income.find((a) => /service|fee|consult|labou?r/i.test(a.name)) ?? income[0];
  // GST on top of the hourly rate, where there is GST.
  const lines = timeInvoiceLines(
    entries,
    account?.code.trim() ?? "",
    booksMoney,
    noSalesTax() ? undefined : { taxType: "15% GST on Income", rate: 0.15 },
  );
  const total = lines.reduce((sum, l) => sum + l.gross, 0);
  const gst = lines.reduce((sum, l) => sum + l.tax, 0);
  const issued = today();
  const number = nextInvoiceNumber("sales", state.ledger.invoices ?? []);
  const draft: Invoice = {
    number,
    kind: "sales",
    contact: customer,
    reference: "Time",
    issued,
    due: addDays(issued, termsDays(customer)),
    total,
    tax: gst,
    paid: 0,
    outstanding: total,
    currency: booksCurrency(),
    status: "Draft",
    lines,
  };
  const email = findContact(state.ledger.contacts ?? [], customer)?.email;
  if (email !== undefined) draft.email = email;
  const ids = new Set(entries.map((e) => e.id));
  const before = state.ledger.timeEntries ?? [];
  const after = held().map((e) => (ids.has(e.id) ? { ...e, invoice: number } : e));
  state.ledger = { ...state.ledger, invoices: [...(state.ledger.invoices ?? []), draft], timeEntries: after };
  // Time all for one class: the invoice goes under it too.
  const classNames = new Set(entries.map((e) => e.className ?? ""));
  const only = classNames.size === 1 ? [...classNames][0] : "";
  if (only !== undefined && only !== "" && state.ledger.classes !== undefined) {
    const classes = state.ledger.classes;
    state.ledger = { ...state.ledger, classes: { ...classes, assigned: { ...classes.assigned, [number]: only } } };
  }
  state.persistent = await savePart(state.ledger, "invoices");
  state.persistent = await savePart(state.ledger);
  await record("invoice", `Created ${number} — ${customer} ${booksMoney(total)} from time`, null, draft, number);
  await record("time", `${entries.length} entries put on ${number}`, before, after);
  window.alert(`${number} for ${booksMoney(total)} is drafted on Invoices. Approve it there to post it.`);
  redraw("time");
  redraw("invoices");
}

function entryForm(body: HTMLElement): void {
  const box = document.createElement("div");
  box.className = "contact-form";
  const label = (text: string, control: HTMLElement): HTMLElement => {
    const wrap = document.createElement("label");
    wrap.className = "contact-field";
    const span = document.createElement("span");
    span.textContent = text;
    wrap.append(span, control);
    return wrap;
  };
  const all = held();
  const last = all[all.length - 1];
  const date = document.createElement("input");
  date.type = "date";
  date.value = today();
  const customer = document.createElement("input");
  customer.type = "text";
  customer.placeholder = "Who the work was for";
  const names = new Set<string>();
  for (const c of state.ledger.contacts ?? []) if (c.kind !== "vendor" && c.active !== false) names.add(c.name);
  for (const e of all) names.add(e.customer);
  const list = document.createElement("datalist");
  list.id = "time-customers";
  for (const name of [...names].sort((a, b) => a.localeCompare(b))) {
    const option = document.createElement("option");
    option.value = name;
    list.append(option);
  }
  customer.setAttribute("list", list.id);
  const hours = document.createElement("input");
  hours.type = "text";
  hours.inputMode = "decimal";
  hours.placeholder = "1.5";
  const rate = document.createElement("input");
  rate.type = "text";
  rate.inputMode = "decimal";
  rate.value = last === undefined ? "" : (last.rate / 100).toFixed(2);
  // The rate last used for a customer, when one is picked.
  customer.addEventListener("change", () => {
    const theirs = [...all].reverse().find((e) => e.customer.toLowerCase() === customer.value.trim().toLowerCase());
    if (theirs !== undefined) rate.value = (theirs.rate / 100).toFixed(2);
  });
  const description = document.createElement("input");
  description.type = "text";
  description.placeholder = "What was done";
  // A class, where the books have them: the job or department the time is for.
  const classNames = state.ledger.classes?.names ?? [];
  const klass = document.createElement("select");
  for (const name of ["", ...classNames]) {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name === "" ? "No class" : name;
    klass.append(option);
  }
  const billable = document.createElement("input");
  billable.type = "checkbox";
  billable.checked = true;
  const billableLabel = document.createElement("label");
  billableLabel.append(billable, document.createTextNode(" Billable"));
  const problem = document.createElement("p");
  problem.className = "cloud-said";
  const add = document.createElement("button");
  add.type = "button";
  add.className = "primary";
  add.textContent = "Add time";
  add.addEventListener("click", () => {
    const who = customer.value.trim();
    const h = Number(hours.value.replace(",", ".").trim());
    const r = parseAmount(rate.value, booksCurrency());
    if (date.value === "") problem.textContent = "The date the work was done.";
    else if (who === "") problem.textContent = "Who the work was for.";
    else if (!Number.isFinite(h) || h <= 0 || h > 24) problem.textContent = "Hours as a number, such as 1.5.";
    else if (r === null || r < 0) problem.textContent = "A rate per hour, such as 95.00.";
    else {
      const entry: TimeEntry = {
        id: `time-${Date.now().toString(36)}`,
        date: date.value,
        customer: who,
        hours: Math.round(h * 100) / 100,
        rate: r,
        description: description.value.trim(),
        ...(klass.value !== "" ? { className: klass.value } : {}),
        ...(billable.checked ? {} : { nonBillable: true }),
      };
      void keep([...held(), entry], `${hoursSaid(entry.hours)} h for ${who}`);
    }
  });
  const row = document.createElement("div");
  row.className = "migration-actions";
  row.append(add);
  box.append(
    label("Date", date),
    label("Customer", customer),
    list,
    label("Hours", hours),
    label("Rate per hour", rate),
    label("Description", description),
    ...(classNames.length > 0 ? [label("Class", klass)] : []),
    billableLabel,
    problem,
    row,
  );
  body.append(box);
}

export function renderTime(): void {
  const body = $("time-body");
  body.textContent = "";
  entryForm(body);
  const all = held();
  if (all.length === 0) {
    body.append(note("No time yet."));
    return;
  }

  const open = unbilledTime(all);
  if (open.size > 0) {
    const title = document.createElement("h3");
    title.textContent = "Not invoiced yet";
    body.append(title);
    const table = document.createElement("table");
    table.className = "report-table owner-table";
    table.innerHTML = "<thead><tr><th>Customer</th><th>Entries</th><th>Hours</th><th>Value</th><th></th></tr></thead>";
    const tbody = document.createElement("tbody");
    for (const [customer, entries] of [...open].sort((a, b) => a[0].localeCompare(b[0]))) {
      const tr = document.createElement("tr");
      const hours = entries.reduce((sum, e) => sum + e.hours, 0);
      const value = entries.reduce((sum, e) => sum + timeValue(e), 0);
      for (const [text, cls] of [
        [customer, "report-name"],
        [String(entries.length), "report-amount"],
        [hoursSaid(hours), "report-amount"],
        [booksMoney(value), "report-amount"],
      ] as const) {
        const td = document.createElement("td");
        td.className = cls;
        td.textContent = text;
        tr.append(td);
      }
      const cell = document.createElement("td");
      const make = document.createElement("button");
      make.type = "button";
      make.className = "small primary";
      make.textContent = "Make invoice";
      make.addEventListener("click", () => void invoiceTime(customer, entries));
      cell.append(make);
      tr.append(cell);
      tbody.append(tr);
    }
    table.append(tbody);
    body.append(table);
  }

  const title = document.createElement("h3");
  title.textContent = "All time";
  body.append(title);
  const table = document.createElement("table");
  table.className = "report-table owner-table";
  table.innerHTML =
    "<thead><tr><th>Date</th><th>Customer</th><th>Description</th><th>Hours</th><th>Rate</th><th>Value</th><th>Invoice</th><th></th></tr></thead>";
  const tbody = document.createElement("tbody");
  const sorted = [...all].sort((a, b) => b.date.localeCompare(a.date));
  for (const entry of sorted.slice(0, SHOWN)) {
    const tr = document.createElement("tr");
    for (const [text, cls] of [
      [entry.date, "report-name"],
      [entry.customer, "report-name"],
      [entry.description + (entry.className !== undefined ? ` · ${entry.className}` : ""), "report-name"],
      [hoursSaid(entry.hours), "report-amount"],
      [booksMoney(entry.rate), "report-amount"],
      [booksMoney(timeValue(entry)), "report-amount"],
      [entry.invoice ?? (entry.nonBillable === true ? "Not billable" : ""), "report-name"],
    ] as const) {
      const td = document.createElement("td");
      td.className = cls;
      td.textContent = text;
      tr.append(td);
    }
    const cell = document.createElement("td");
    if (entry.invoice === undefined) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "small";
      remove.textContent = "Delete";
      remove.addEventListener("click", () => {
        void keep(
          held().filter((e) => e.id !== entry.id),
          `Deleted ${hoursSaid(entry.hours)} h for ${entry.customer} on ${entry.date}`,
        );
      });
      cell.append(remove);
    }
    tr.append(cell);
    tbody.append(tr);
  }
  table.append(tbody);
  const scroller = document.createElement("div");
  scroller.className = "table-scroll";
  scroller.append(table);
  body.append(scroller);
  if (sorted.length > SHOWN) body.append(note(`The ${SHOWN} most recent of ${sorted.length} are shown.`));
}
