import { financialYear, financialYearOf, jurisdictionOf } from "@nzosa/core";
import type { IsoDate } from "@nzosa/core";
import { state } from "./state.js";

/**
 * The tax year these books work in, in one place.
 *
 * New Zealand's runs from 1 April to 31 March and is called by the year it
 * ends in: the 2026 year is 1 April 2025 to 31 March 2026. Those two dates
 * used to be written out wherever a year was needed -- ninety-odd times -- so
 * a country with a different year (Australia's ends 30 June, the United
 * States' 31 December) would have meant finding every one. Here they come
 * from the books' country, through the core's `financialYear`; books with no
 * country set are New Zealand's.
 */
const yearEnd = (): { endMonth: number; endDay: number } => jurisdictionOf(state.ledger.jurisdiction).yearEnd;

/** The first day of the year that ends in `year`: 1 April of the year before, in New Zealand. */
export function taxYearStart(year: number): IsoDate {
  return financialYear(year, yearEnd()).from;
}

/** The last day of the year that ends in `year`: 31 March, in New Zealand. */
export function taxYearEnd(year: number): IsoDate {
  return financialYear(year, yearEnd()).to;
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** "31 March 2026", or with `short`, "31 Mar 2026": a date as the year's words say it. */
function said(date: IsoDate, short = false): string {
  const month = MONTHS[Number(date.slice(5, 7)) - 1] ?? "";
  return `${Number(date.slice(8, 10))} ${short ? month.slice(0, 3) : month} ${date.slice(0, 4)}`;
}

/** The year's last day in words: "31 March 2026" for the 2026 year, in New Zealand. */
export function taxYearEndSaid(year: number): string {
  return said(taxYearEnd(year));
}

/** The same, short: "31 Mar 2026". */
export function taxYearEndShort(year: number): string {
  return said(taxYearEnd(year), true);
}

/** The year's first day in words: "1 April 2025" for the 2026 year, in New Zealand. */
export function taxYearStartSaid(year: number): string {
  return said(taxYearStart(year));
}

/** Which tax year a date falls in, by the year it ends in. */
export function taxYearOf(date: string): number {
  return financialYearOf(date as IsoDate, yearEnd());
}
