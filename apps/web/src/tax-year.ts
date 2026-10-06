import { financialYear, financialYearOf } from "@nzosa/core";
import type { IsoDate } from "@nzosa/core";

/**
 * The tax year these books work in, in one place.
 *
 * New Zealand's runs from 1 April to 31 March and is called by the year it
 * ends in: the 2026 year is 1 April 2025 to 31 March 2026. Those two dates
 * used to be written out wherever a year was needed -- ninety-odd times -- so
 * a country with a different year (Australia's ends 30 June, the United
 * States' 31 December) would have meant finding every one. Here they are
 * worked out once, by the core's `financialYear`, which already takes any end.
 */
const YEAR_END = { endMonth: 3, endDay: 31 };

/** The first day of the year that ends in `year`: 1 April of the year before. */
export function taxYearStart(year: number): IsoDate {
  return financialYear(year, YEAR_END).from;
}

/** The last day of the year that ends in `year`: 31 March. */
export function taxYearEnd(year: number): IsoDate {
  return financialYear(year, YEAR_END).to;
}

/** Which tax year a date falls in, by the year it ends in. */
export function taxYearOf(date: string): number {
  return financialYearOf(date as IsoDate, YEAR_END);
}
