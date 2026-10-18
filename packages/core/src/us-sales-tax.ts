import type { Cents } from "./money.js";
import type { Invoice, InvoiceLine } from "./invoices.js";

/**
 * Sales tax as the United States charges it: added on top of the price, at the
 * rate of the place the sale is made -- the state's, with the county's and the
 * city's or district's added -- on the lines that are taxable there, and owed
 * to each authority it was collected for.
 *
 * So a rate is a name, a percentage and the liability account it is owed in.
 * An invoice takes one rate; each of its lines is taxable or not; a customer
 * whose purchases are exempt (a reseller, a charity) is charged none. Each
 * authority's account then holds what is owed to it, and paying it is a bank
 * line coded to that account.
 */
export interface SalesTaxRate {
  id: string;
  /** As the invoice says it: "Seattle, WA". */
  name: string;
  /** The combined rate, as a percentage: 10.35. */
  percent: number;
  /** The chart code of the liability account it is owed in. */
  accountCode: string;
  /** Left out of the choices when false; kept, so old invoices still name it. */
  active?: boolean;
}

/** What a taxable line says as its treatment, and one that is not. */
export const TAXABLE = "Sales tax";
export const NOT_TAXABLE = "No sales tax";

/** The tax on an amount at a rate, to the cent, half a cent away from nothing. */
export function salesTaxAt(amount: Cents, percent: number): Cents {
  // In hundredths of a cent first: 10.35% held as a float does not multiply out exactly.
  const exact = (amount * Math.round(percent * 10000)) / 1000000;
  return Math.sign(exact) * Math.round(Math.abs(exact) + 1e-9);
}

/**
 * The lines with the rate's tax on them: worked out once on the taxable lines
 * together, as the invoice states it, then shared among them so the lines add
 * up to it to the cent. A line's amount before tax is its `net`; with no rate,
 * or on a line that is not taxable, there is none.
 */
export function applySalesTax(lines: readonly InvoiceLine[], rate: SalesTaxRate | null): InvoiceLine[] {
  const plain = lines.map((line): InvoiceLine => {
    const { taxAccount: _was, ...rest } = line;
    return { ...rest, taxType: rate !== null && line.taxType !== NOT_TAXABLE ? TAXABLE : line.taxType === TAXABLE ? TAXABLE : NOT_TAXABLE, tax: 0, gross: line.net };
  });
  if (rate === null) return plain.map((line) => ({ ...line, taxType: line.taxType === TAXABLE ? TAXABLE : NOT_TAXABLE }));
  const taxable = plain.filter((line) => line.taxType === TAXABLE && line.net !== 0);
  const base = taxable.reduce((sum, line) => sum + line.net, 0);
  const total = salesTaxAt(base, rate.percent);
  if (total === 0 || base === 0) return plain;
  // Each line's share, rounded down, and the cents left over to the lines that
  // lost the most to the rounding.
  const shares = taxable.map((line) => {
    const exact = (total * line.net) / base;
    return { line, cents: Math.trunc(exact), left: exact - Math.trunc(exact) };
  });
  let over = total - shares.reduce((sum, s) => sum + s.cents, 0);
  const step = Math.sign(over);
  for (const share of [...shares].sort((a, b) => step * (b.left - a.left))) {
    if (over === 0) break;
    share.cents += step;
    over -= step;
  }
  const taxOf = new Map(shares.map((s) => [s.line, s.cents]));
  return plain.map((line) => {
    const tax = taxOf.get(line);
    return tax === undefined ? line : { ...line, tax, gross: line.net + tax, taxAccount: rate.accountCode };
  });
}

export interface SalesTaxByRate {
  rate: SalesTaxRate | null;
  /** Every sale on the invoices charged at the rate, before tax. */
  sales: Cents;
  /** Of those, the taxable lines. */
  taxable: Cents;
  tax: Cents;
  invoices: number;
}

/**
 * Sales on invoices between two dates, by the rate each was charged at: what
 * a state's return asks for, gross sales, taxable sales and the tax, for each
 * place. Invoices with no rate, an exempt customer's included, are one row
 * with no rate.
 */
export function salesTaxByRate(
  invoices: readonly Invoice[],
  rates: readonly SalesTaxRate[],
  from: string,
  to: string,
): SalesTaxByRate[] {
  const rows = new Map<string, SalesTaxByRate>();
  for (const invoice of invoices) {
    if (invoice.kind !== "sales" || invoice.issued < from || invoice.issued > to) continue;
    if (/^(draft|estimate|voided|deleted)$/i.test(invoice.status)) continue;
    const rate = rates.find((r) => r.id === invoice.salesTaxRateId) ?? null;
    const key = rate?.id ?? "";
    const row = rows.get(key) ?? { rate, sales: 0, taxable: 0, tax: 0, invoices: 0 };
    for (const line of invoice.lines) {
      row.sales += line.net;
      if (line.taxType === TAXABLE) row.taxable += line.net;
      row.tax += line.tax;
    }
    row.invoices += 1;
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => (a.rate?.name ?? "￿").localeCompare(b.rate?.name ?? "￿"));
}
