import { parseCsvRecords } from "./csv.js";
import type { ReadonlyCsvRecord } from "./csv.js";
import { parseDate } from "./dates.js";
import type { Invoice, InvoiceKind } from "./invoices.js";

/**
 * When invoices and bills are due, from a list another system exports of them
 * (SlowBooks' invoices and bills, an aging report's rows). A general ledger
 * says what each document posted but not when it falls due, and reminders,
 * late fees and the aged reports all hang off that date. Read by the headings;
 * applied to documents already brought in, by number and name.
 */

const NUMBER = ["invoice #", "invoice no.", "invoice number", "bill #", "bill no.", "bill number", "num", "number", "no."];
const CONTACT = ["customer", "vendor", "supplier", "name", "customer name", "vendor name"];
const DUE = ["due date", "due"];
const TERMS = ["terms"];

const norm = (text: string): string => text.trim().toLowerCase().replace(/\s+/g, " ");
const indexOf = (headers: readonly string[], names: readonly string[]): number => {
  for (const name of names) {
    const at = headers.indexOf(name);
    if (at >= 0) return at;
  }
  return -1;
};

function headerRow(records: readonly ReadonlyCsvRecord[]): { at: number; headers: string[] } | null {
  for (let at = 0; at < Math.min(records.length, 12); at += 1) {
    const headers = (records[at]?.fields ?? []).map(norm);
    if (indexOf(headers, NUMBER) >= 0 && indexOf(headers, CONTACT) >= 0 && indexOf(headers, DUE) >= 0) {
      return { at, headers };
    }
  }
  return null;
}

export function isDueDateList(text: string): boolean {
  return headerRow(parseCsvRecords(text.slice(0, 20000))) !== null;
}

export interface DueDate {
  kind: InvoiceKind;
  number: string;
  contact: string;
  due: string;
  terms?: string;
}

/** The due dates in a list; bills where the list names vendors or bills, invoices otherwise. */
export function parseDueDates(text: string, dayFirst = false): DueDate[] {
  const records = parseCsvRecords(text);
  const found = headerRow(records);
  if (found === null) return [];
  const { at, headers } = found;
  const numberAt = indexOf(headers, NUMBER);
  const contactAt = indexOf(headers, CONTACT);
  const dueAt = indexOf(headers, DUE);
  const termsAt = indexOf(headers, TERMS);
  const purchase = /bill|vendor|supplier/.test(`${headers[numberAt] ?? ""} ${headers[contactAt] ?? ""}`);
  const out: DueDate[] = [];
  for (const record of records.slice(at + 1)) {
    const cell = (index: number): string => (index >= 0 ? (record.fields[index] ?? "").trim() : "");
    const number = cell(numberAt);
    const due = parseDate(cell(dueAt), { dayFirst });
    if (number === "" || due === null) continue;
    out.push({
      kind: purchase ? "purchase" : "sales",
      number,
      contact: cell(contactAt),
      due,
      ...(cell(termsAt) !== "" ? { terms: cell(termsAt) } : {}),
    });
  }
  return out;
}

/**
 * The documents with their due dates filled in where the list has them and
 * they have none. Matched by kind and number, and by name where the list
 * gives one, so two systems' INV-1 for different customers are not confused.
 */
export function applyDueDates(invoices: readonly Invoice[], dates: readonly DueDate[]): { invoices: Invoice[]; filled: number } {
  let filled = 0;
  const key = (kind: string, number: string): string => `${kind}\u0000${number.trim().toLowerCase()}`;
  const byNumber = new Map<string, DueDate[]>();
  for (const d of dates) byNumber.set(key(d.kind, d.number), [...(byNumber.get(key(d.kind, d.number)) ?? []), d]);
  const next = invoices.map((invoice) => {
    if (invoice.due !== null && invoice.due !== "") return invoice;
    const candidates = byNumber.get(key(invoice.kind, invoice.number)) ?? [];
    const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();
    const match =
      candidates.find((d) => d.contact === "" || same(d.contact, invoice.contact)) ?? (candidates.length === 1 ? candidates[0] : undefined);
    if (match === undefined) return invoice;
    filled += 1;
    return { ...invoice, due: match.due };
  });
  return { invoices: next, filled };
}
