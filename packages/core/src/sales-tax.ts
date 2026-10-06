import type { Cents } from "./money.js";

/**
 * The standard rate of GST (or VAT), as the fraction of a tax-inclusive amount
 * that is tax.
 *
 * New Zealand's 15% is 3/23 of the total; Australia's 10% is 1/11. Held as a
 * fraction of whole numbers, and applied in the same order the arithmetic was
 * always written -- amount times numerator, over denominator -- so New
 * Zealand's figures round exactly as they always have.
 *
 * One rate at a time: a set of books is kept in one country, and the app sets
 * the rate when it opens them. New Zealand's is the default, so anything that
 * never sets it -- every test, every set of books ever kept -- is unchanged.
 */
export interface TaxFraction {
  num: number;
  den: number;
}

export const NZ_GST: TaxFraction = { num: 3, den: 23 };
export const NO_SALES_TAX: TaxFraction = { num: 0, den: 1 };

let current: TaxFraction = NZ_GST;

/** Use this rate from now on. */
export function setSalesTaxFraction(fraction: TaxFraction): void {
  current = fraction;
}

export function salesTaxFraction(): TaxFraction {
  return current;
}

/** The tax inside a tax-inclusive amount, to the cent: $230 holds $30 at 15%. */
export function taxWithin(inclusive: Cents): Cents {
  return Math.round((inclusive * current.num) / current.den);
}

/** The same, not rounded: for summing before rounding once. */
export function taxWithinExact(inclusive: number): number {
  return (inclusive * current.num) / current.den;
}

/** The tax-inclusive amount a tax figure comes from: $30 is 15% of $230. */
export function grossFromTax(tax: Cents): Cents {
  // No sales tax at all (the United States): nothing to work back from.
  if (current.num === 0) return 0;
  return Math.round((tax * current.den) / current.num);
}
