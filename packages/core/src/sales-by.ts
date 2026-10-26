import type { Cents } from "./money.js";
import type { IsoDate } from "./dates.js";
import type { Invoice } from "./invoices.js";
import { isCreditNote, isPosted } from "./invoices.js";
import { contactKey } from "./contacts.js";

/**
 * Sales, totalled: by customer, or by what was sold.
 *
 * From the sales invoices in the books -- posted, dated in the period -- with
 * credit notes taken off, so a customer's figure is what they were charged
 * less what was given back. Before tax, as income is reported; the tax beside
 * it. A line with no product named is grouped by its description.
 */

export interface SalesRow {
  name: string;
  /** Invoices and credit notes, or lines, it came from. */
  count: number;
  /** Units sold, where the lines say. */
  quantity: number;
  net: Cents;
  tax: Cents;
}

export interface SalesBy {
  rows: SalesRow[];
  net: Cents;
  tax: Cents;
}

export function salesBy(
  invoices: readonly Invoice[],
  period: { from: IsoDate; to: IsoDate },
  by: "customer" | "item",
  itemName: (code: string) => string | undefined = () => undefined,
): SalesBy {
  const groups = new Map<string, SalesRow>();
  const add = (key: string, name: string, quantity: number, net: Cents, tax: Cents): void => {
    const row = groups.get(key) ?? { name, count: 0, quantity: 0, net: 0, tax: 0 };
    row.count += 1;
    row.quantity += quantity;
    row.net += net;
    row.tax += tax;
    groups.set(key, row);
  };
  for (const invoice of invoices) {
    if (invoice.kind !== "sales" || !isPosted(invoice)) continue;
    if (invoice.issued < period.from || invoice.issued > period.to) continue;
    // A credit note gives back: whatever sign its lines were written with.
    const sign = isCreditNote(invoice) ? -1 : 1;
    if (by === "customer") {
      const net = invoice.lines.reduce((s, l) => s + Math.abs(l.net), 0) * sign;
      const tax = invoice.lines.reduce((s, l) => s + Math.abs(l.tax), 0) * sign;
      const name = invoice.contact.trim() || "(no customer)";
      add(contactKey(name), name, 0, net, tax);
      continue;
    }
    for (const line of invoice.lines) {
      if (line.net === 0 && line.tax === 0) continue;
      const named = line.itemCode !== undefined ? (itemName(line.itemCode) ?? line.itemCode) : undefined;
      const name = (named ?? line.description).trim() || "(no description)";
      add(name.toLowerCase(), name, (line.quantity ?? 0) * sign, Math.abs(line.net) * sign, Math.abs(line.tax) * sign);
    }
  }
  const rows = [...groups.values()].filter((r) => r.net !== 0 || r.tax !== 0).sort((a, b) => b.net - a.net || a.name.localeCompare(b.name));
  return { rows, net: rows.reduce((s, r) => s + r.net, 0), tax: rows.reduce((s, r) => s + r.tax, 0) };
}
