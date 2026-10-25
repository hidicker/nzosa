import type { Cents } from "./money.js";
import type { DateRange } from "./dates.js";
import type { Invoice } from "./invoices.js";
import { isPosted } from "./invoices.js";

/**
 * Who the sales came from, and what was sold: the sales invoices dated in a
 * period, added up by customer and by item.
 *
 * Invoice dates, so this is the accrual view: a sale counts when it was
 * invoiced, paid or not. Sales that never had an invoice -- takings banked and
 * coded straight to income -- are not here; the profit and loss has them. A
 * credit note carries negative figures and so takes its sale back off.
 */

export interface SalesRow {
  /** The customer, or the item's code or description. */
  name: string;
  /** How many invoices (by customer) or lines (by item). */
  count: number;
  /** For items: the quantity sold, where the lines gave one. */
  quantity?: number;
  /** Before tax. */
  net: Cents;
  tax: Cents;
  gross: Cents;
}

export interface SalesAnalysis {
  rows: SalesRow[];
  total: { count: number; net: Cents; tax: Cents; gross: Cents };
  /** Invoices in the period, credit notes included. */
  invoices: number;
}

function inPeriod(invoices: readonly Invoice[], range: DateRange, entityId?: string): Invoice[] {
  return invoices.filter(
    (i) =>
      i.kind === "sales" &&
      isPosted(i) &&
      i.issued >= range.from &&
      i.issued <= range.to &&
      (entityId === undefined || i.entityId === entityId),
  );
}

function finish(rows: Map<string, SalesRow>, invoices: number): SalesAnalysis {
  const list = [...rows.values()].sort((a, b) => b.net - a.net || a.name.localeCompare(b.name));
  return {
    rows: list,
    total: {
      count: list.reduce((s, r) => s + r.count, 0),
      net: list.reduce((s, r) => s + r.net, 0),
      tax: list.reduce((s, r) => s + r.tax, 0),
      gross: list.reduce((s, r) => s + r.gross, 0),
    },
    invoices,
  };
}

/** The same customer typed two ways is one customer. */
const key = (name: string): string => name.trim().toLowerCase().replace(/\s+/g, " ");

/** Sales by customer, largest first. */
export function salesByCustomer(invoices: readonly Invoice[], range: DateRange, entityId?: string): SalesAnalysis {
  const chosen = inPeriod(invoices, range, entityId);
  const rows = new Map<string, SalesRow>();
  for (const invoice of chosen) {
    const k = key(invoice.contact);
    const row = rows.get(k) ?? { name: invoice.contact.trim() || "(no customer)", count: 0, net: 0, tax: 0, gross: 0 };
    row.count += 1;
    // The invoice's own total and tax, as the books hold them.
    row.gross += invoice.total;
    row.tax += invoice.tax;
    row.net += invoice.total - invoice.tax;
    rows.set(k, row);
  }
  return finish(rows, chosen.length);
}

/** Sales by item: a line's item code where it has one, else its description. */
export function salesByItem(invoices: readonly Invoice[], range: DateRange, entityId?: string): SalesAnalysis {
  const chosen = inPeriod(invoices, range, entityId);
  const rows = new Map<string, SalesRow>();
  for (const invoice of chosen) {
    for (const line of invoice.lines) {
      const name = (line.itemCode ?? "").trim() || line.description.trim() || "(no description)";
      const k = key(name);
      const row = rows.get(k) ?? { name, count: 0, net: 0, tax: 0, gross: 0 };
      row.count += 1;
      if (line.quantity !== undefined) row.quantity = (row.quantity ?? 0) + line.quantity * (invoice.total < 0 ? -1 : 1);
      row.net += line.net;
      row.tax += line.tax;
      row.gross += line.gross;
      rows.set(k, row);
    }
  }
  return finish(rows, chosen.length);
}
