import type { Cents } from "./money.js";
import type { IsoDate } from "./dates.js";
import type { Invoice, InvoiceKind } from "./invoices.js";
import { gstContent } from "./gst.js";
import { nextInvoiceNumber } from "./invoice-candidates.js";

/**
 * Quick entry: a backlog of paper invoices or bills typed in a row each, and
 * made into documents of one line, numbered in turn.
 */

/** One row as typed. */
export interface QuickEntryRow {
  date: IsoDate;
  contact: string;
  reference: string;
  description: string;
  accountCode: string;
  taxType: string;
  /** What the paper says is owed, tax included. */
  gross: Cents;
  due: IsoDate | null;
}

/** Days to pay from terms written "Net 20" or "20 days", or null. */
export function termsDays(terms: string | undefined): number | null {
  const found = /(\d{1,3})\s*days?\b|net\s*(\d{1,3})\b/i.exec(terms ?? "");
  if (found === null) return null;
  const days = Number(found[1] ?? found[2]);
  return Number.isFinite(days) ? days : null;
}

/** The documents typed in, each given the next number of its kind. */
export function documentsFromRows(
  rows: readonly QuickEntryRow[],
  kind: InvoiceKind,
  existing: readonly Invoice[],
  options: { taxed: (taxType: string) => boolean; currency: string; status: string; entityId?: string },
): Invoice[] {
  const made: Invoice[] = [];
  for (const row of rows) {
    const number = nextInvoiceNumber(kind, [...existing, ...made]);
    const tax = options.taxed(row.taxType) ? gstContent(row.gross) : 0;
    made.push({
      number,
      kind,
      contact: row.contact,
      reference: row.reference,
      issued: row.date,
      due: row.due,
      total: row.gross,
      tax,
      paid: 0,
      // As the editor writes it: the total less what was paid.
      outstanding: row.gross,
      currency: options.currency,
      status: options.status,
      lines: [{ description: row.description, accountCode: row.accountCode, taxType: row.taxType, net: row.gross - tax, tax, gross: row.gross }],
      ...(options.entityId !== undefined ? { entityId: options.entityId } : {}),
    });
  }
  return made;
}

