import { NO_SALES_TAX, jurisdictionOf, minorUnits, setSalesTaxFraction } from "@nzosa/core";
import type { Jurisdiction } from "@nzosa/core";
import { state } from "./state.js";
import { addCountryReports } from "./daily/country-reports.js";

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
  const country = booksCountry();
  const tax = country.salesTax;
  setSalesTaxFraction(tax === null ? NO_SALES_TAX : tax.fraction);
  // The country's own reports, and its date order for bank files (12/03 is
  // 12 March in New Zealand and 3 December in the United States).
  addCountryReports(country.id);
  if (country.id !== "nz") dropNewZealandReports();
  const dayFirst = document.getElementById("day-first");
  if (dayFirst instanceof HTMLInputElement) dayFirst.checked = country.dayFirst;
}

/** How numbers and dates are written: "en-NZ" for New Zealand. */
export function booksLocale(): string {
  return booksCountry().locale;
}

/** The currency an amount is in when nothing says otherwise: "NZD" for New Zealand. */
export function booksCurrency(): string {
  return booksCountry().currency;
}

/**
 * How many decimals money is shown with: 2 for New Zealand dollars, none for
 * won. Amounts are held in hundredths whatever the currency, so this is how
 * they are shown, never how they are stored.
 */
export function moneyPlaces(): number {
  return Math.min(2, minorUnits(booksCurrency()));
}

/**
 * New Zealand's returns out of the report list for books kept anywhere else.
 * Hiding them is not enough -- a hidden option is still in the list, and some
 * browsers have shown hidden options -- and they can never apply to these
 * books, so they are removed. New Zealand books never get here.
 */
const NEW_ZEALAND_REPORTS = ["gstreturn", "ir10", "rentals", "yearend", "ir3", "owner"];
function dropNewZealandReports(): void {
  const select = document.getElementById("report-kind");
  if (select === null) return;
  for (const value of NEW_ZEALAND_REPORTS) select.querySelector(`option[value="${value}"]`)?.remove();
  for (const group of select.querySelectorAll("optgroup")) if (group.children.length === 0) group.remove();
}
