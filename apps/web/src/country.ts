import { NO_SALES_TAX, jurisdictionOf, minorUnits, salesTaxFraction, setSalesTaxFraction } from "@nzosa/core";
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
  const country = applyCountryRules();
  // The country's own reports, and its date order for bank files (12/03 is
  // 12 March in New Zealand and 3 December in the United States).
  addCountryReports(country.id);
  if (country.id !== "nz") dropNewZealandReports();
  const dayFirst = document.getElementById("day-first");
  if (dayFirst instanceof HTMLInputElement) dayFirst.checked = country.dayFirst;
}

/** What the country decides with no page to draw on: the rate of GST. */
export function applyCountryRules(): Jurisdiction {
  const country = booksCountry();
  const tax = country.salesTax;
  setSalesTaxFraction(tax === null ? NO_SALES_TAX : tax.fraction);
  return country;
}

/** Whether these books are kept where there is no national sales tax, so no GST to show or choose. */
export function noSalesTax(): boolean {
  return salesTaxFraction().num === 0;
}

/** The standard rate of GST as a percentage: 15 in New Zealand, 10 in Australia, 0 where there is none. */
export function gstPercent(): number {
  const tax = booksCountry().salesTax;
  return tax === null ? 0 : Math.round(tax.rate * 100);
}

/**
 * A GST treatment's name as these books' country would say it. The names are
 * Xero New Zealand's ("15% GST on Income") and stay the stored key; only the
 * words on screen change, so Australian books read 10%.
 */
export function taxTypeLabel(name: string): string {
  return booksCountry().id === "nz" ? name : name.replace(/\b15%/, `${gstPercent()}%`);
}

/**
 * What an invoice or bill document needs to know of the country: no tax
 * column where there is no sales tax, and dates written the way its readers
 * write them. Nothing for New Zealand, whose document is the default.
 */
export function documentOptions(): { noTax?: boolean; dateStyle?: "dmy" | "mdy" | "ymd"; lang?: string } {
  const country = booksCountry();
  if (country.id === "nz") return {};
  return {
    ...(noSalesTax() ? { noTax: true } : {}),
    dateStyle: country.id === "us" ? "mdy" : country.id === "kr" ? "ymd" : "dmy",
    lang: country.locale,
  };
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
 * An amount in hundredths as the books show money: "1,234.50", "-12.00".
 *
 * Never "-0.00". A negated zero (an owed figure of nothing, turned round) and
 * a small negative that rounds to nothing at the places shown both printed
 * with a minus sign, which reads as a figure that is there.
 */
export function booksMoney(cents: number): string {
  const places = moneyPlaces();
  const value = cents / 100;
  const shown = Math.round(Math.abs(value) * 10 ** places) === 0 ? 0 : value;
  return shown.toLocaleString(booksLocale(), { minimumFractionDigits: places, maximumFractionDigits: places });
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
