import { NO_SALES_TAX, jurisdictionOf, setSalesTaxFraction } from "@nzosa/core";
import type { Jurisdiction } from "@nzosa/core";
import { state } from "./state.js";

/**
 * The country these books are kept in, for anything on screen that depends on
 * it. Books with no country set are New Zealand's (core's `jurisdictionOf`).
 */
export function booksCountry(): Jurisdiction {
  return jurisdictionOf(state.ledger.jurisdiction);
}

/**
 * Set what the books' country decides for the whole app, as they open: the
 * rate of GST (15% in New Zealand, 10% in Australia, none in the United
 * States). Called again whenever the country is changed.
 */
export function applyCountry(): void {
  const tax = booksCountry().salesTax;
  setSalesTaxFraction(tax === null ? NO_SALES_TAX : tax.fraction);
}

/** How numbers and dates are written: "en-NZ" for New Zealand. */
export function booksLocale(): string {
  return booksCountry().locale;
}

/** The currency an amount is in when nothing says otherwise: "NZD" for New Zealand. */
export function booksCurrency(): string {
  return booksCountry().currency;
}
