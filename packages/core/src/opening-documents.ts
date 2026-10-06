import type { Cents } from "./money.js";
import { parseAmount } from "./money.js";
import type { IsoDate } from "./dates.js";
import { parseDate } from "./dates.js";
import { parseCsvRecords } from "./csv.js";
import type { Invoice, InvoiceKind } from "./invoices.js";

/**
 * The invoices and bills still open on the day before the books start.
 *
 * A set of books taken over from another system opens with a figure for
 * Accounts Receivable and one for Accounts Payable, and those figures are the
 * sum of particular documents. Which documents, the trial balance does not
 * say. Xero's Aged Receivables Detail and Aged Payables Detail do: each
 * invoice or bill open on the day, and how much of it was still owing.
 *
 * That settles what happens to every document dated before the books start.
 * None is posted -- its sale or cost belongs to a year the other system kept,
 * and is already in the opening retained earnings. One that was open stays in
 * play, owing what the report says, so the payment that arrives later clears
 * the receivable it is part of. Every other one was paid before the books
 * began: it is history, offered for matching to nothing.
 */

export interface OpeningDocument {
  number: string;
  contact: string;
  date: IsoDate | null;
  due: IsoDate | null;
  /** Owing on the report's date, as the report has it. Negative for a credit. */
  owing: Cents;
}

export interface OpeningDocuments {
  kind: InvoiceKind;
  asAt: IsoDate;
  items: OpeningDocument[];
  /** Where they came from, for saying so. */
  source?: string;
}

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

/** `As at 31 March 2025` as `2025-03-31`. */
function asAtFrom(text: string): IsoDate | null {
  const m = /as at\s+(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})/i.exec(text);
  if (m === null) return null;
  const month = MONTHS[(m[2] ?? "").slice(0, 3).toLowerCase()];
  return month === undefined ? null : (`${m[3]}-${month}-${(m[1] ?? "").padStart(2, "0")}` as IsoDate);
}

/** Whether text is Xero's Aged Receivables or Aged Payables Detail. */
export function isAgedDetail(text: string): boolean {
  return /^\s*"?Aged (Receivables|Payables) Detail/i.test(text) && /Invoice Number|Bill Number|Reference/i.test(text);
}

/**
 * Read Xero's Aged Receivables Detail or Aged Payables Detail.
 *
 * A contact's name stands on a row of its own, its documents follow with the
 * first column empty, and a "Total ..." row closes it. The amount owing is the
 * row's Total column.
 */
export function readAgedDetail(csv: string): { record: OpeningDocuments | null; problem?: string } {
  const rows = parseCsvRecords(csv, { skipEmptyRows: true }).map((r) => r.fields.map((f) => f.trim()));
  const title = (rows[0]?.[0] ?? "").toLowerCase();
  const kind: InvoiceKind | null = title.includes("receivables") ? "sales" : title.includes("payables") ? "purchase" : null;
  if (kind === null) return { record: null, problem: "Not an aged receivables or payables detail report." };
  const asAt = asAtFrom(rows.slice(0, 5).map((r) => r.join(" ")).join(" "));
  if (asAt === null) return { record: null, problem: "The report's date could not be read." };

  const headerAt = rows.findIndex((r) => r.some((c) => /^(invoice|bill) number$/i.test(c) || /^number$/i.test(c)));
  if (headerAt < 0) return { record: null, problem: "The report has no invoice number column." };
  const header = (rows[headerAt] ?? []).map((h) => h.toLowerCase());
  const col = (...names: string[]) => header.findIndex((h) => names.includes(h));
  const at = {
    number: col("invoice number", "bill number", "number"),
    date: col("invoice date", "bill date", "date"),
    due: col("due date"),
    total: col("total"),
  };
  if (at.number < 0 || at.total < 0) return { record: null, problem: "The report has no number or total column." };

  const items: OpeningDocument[] = [];
  let contact = "";
  for (const r of rows.slice(headerAt + 1)) {
    const first = r[0] ?? "";
    const number = r[at.number] ?? "";
    if (first !== "" && number === "") {
      if (!/^(total|percentage)/i.test(first)) contact = first;
      continue;
    }
    if (number === "") continue;
    const owing = parseAmount((r[at.total] ?? "").replace(/[$,\s]/g, "") || "0") ?? 0;
    if (owing === 0) continue;
    items.push({
      number,
      contact,
      date: parseDate(r[at.date] ?? "", { dayFirst: true }),
      due: parseDate(r[at.due] ?? "", { dayFirst: true }),
      owing,
    });
  }
  return { record: { kind, asAt, items } };
}

/**
 * The documents in play for books starting on `start`.
 *
 * Dated from the start: as they are. Dated before it, where the opening
 * documents for their kind are known: the open ones carried forward owing
 * what the report says, and the rest left out. Where they are not known,
 * every earlier document stays in play as it was -- the only thing known to
 * be wrong is posting it, which the ledger no longer does -- so nothing
 * disappears for want of a report.
 */
export function documentsInPlay(
  invoices: readonly Invoice[],
  start: IsoDate | undefined,
  opening: readonly OpeningDocuments[],
): Invoice[] {
  if (start === undefined || start === "") return [...invoices];
  const open = new Map<string, Map<string, Cents>>();
  for (const list of opening) {
    const byNumber = open.get(list.kind) ?? new Map<string, Cents>();
    for (const item of list.items) byNumber.set(item.number.trim().toLowerCase(), item.owing);
    open.set(list.kind, byNumber);
  }
  const out: Invoice[] = [];
  for (const invoice of invoices) {
    if (invoice.issued >= start) {
      out.push(invoice);
      continue;
    }
    const known = open.get(invoice.kind);
    if (known === undefined) {
      out.push(invoice);
      continue;
    }
    const owing = known.get(invoice.number.trim().toLowerCase());
    if (owing !== undefined) out.push({ ...invoice, broughtForward: owing });
  }
  return out;
}

/** What the opening documents come to, against the opening balance for their control account. */
export function openingDocumentsTotal(list: OpeningDocuments): Cents {
  return list.items.reduce((sum, item) => sum + item.owing, 0);
}
