/**
 * The country a set of books is kept in, and what that decides.
 *
 * The engine -- double entry, coding, matching, reports -- is the same
 * everywhere. What differs by country is a short list of facts: when the tax
 * year ends, the currency, which way round dates are written, what the sales
 * tax is called and its rate, and who collects tax. Each country is one entry
 * here, so a figure that depends on any of them asks rather than assuming New
 * Zealand.
 *
 * New Zealand is the default, and the only country these books can be set to
 * until a country's returns exist: a set of books with no country is New
 * Zealand's, exactly as every set ever kept has been.
 */

export type JurisdictionId = "nz" | "au" | "us" | "generic";

export interface Jurisdiction {
  id: JurisdictionId;
  /** As a person would say it. */
  name: string;
  /** ISO 4217. */
  currency: string;
  /** BCP 47, for numbers and dates on screen. */
  locale: string;
  /** The last day of the tax year: month 1-12 and day. */
  yearEnd: { endMonth: number; endDay: number };
  /** Whether a written date is day first (12/03 is 12 March) or month first. */
  dayFirst: boolean;
  /**
   * The sales tax, or null where there is no national one (the United States).
   * `fraction` is the tax as a share of a tax-inclusive amount: 15% is 3/23.
   */
  salesTax: { name: string; rate: number; fraction: { num: number; den: number } } | null;
  /** Who collects tax, shortest and in full, and their online service. */
  taxAuthority: { short: string; name: string; portal: string };
}

export const JURISDICTIONS: Readonly<Record<JurisdictionId, Jurisdiction>> = {
  nz: {
    id: "nz",
    name: "New Zealand",
    currency: "NZD",
    locale: "en-NZ",
    yearEnd: { endMonth: 3, endDay: 31 },
    dayFirst: true,
    salesTax: { name: "GST", rate: 0.15, fraction: { num: 3, den: 23 } },
    taxAuthority: { short: "IRD", name: "Inland Revenue", portal: "myIR" },
  },
  // Drafts for the country packs to come. Nothing can choose them yet.
  au: {
    id: "au",
    name: "Australia",
    currency: "AUD",
    locale: "en-AU",
    yearEnd: { endMonth: 6, endDay: 30 },
    dayFirst: true,
    salesTax: { name: "GST", rate: 0.1, fraction: { num: 1, den: 11 } },
    taxAuthority: { short: "ATO", name: "Australian Taxation Office", portal: "ATO online services" },
  },
  us: {
    id: "us",
    name: "United States",
    currency: "USD",
    locale: "en-US",
    yearEnd: { endMonth: 12, endDay: 31 },
    dayFirst: false,
    salesTax: null,
    taxAuthority: { short: "IRS", name: "Internal Revenue Service", portal: "IRS online account" },
  },
  generic: {
    id: "generic",
    name: "Anywhere",
    currency: "USD",
    locale: "en",
    yearEnd: { endMonth: 12, endDay: 31 },
    dayFirst: true,
    salesTax: null,
    taxAuthority: { short: "tax office", name: "the tax office", portal: "the tax office online" },
  },
};

/** The country for a set of books: New Zealand where nothing is set. */
export function jurisdictionOf(id: string | undefined): Jurisdiction {
  return id !== undefined && id in JURISDICTIONS ? JURISDICTIONS[id as JurisdictionId] : JURISDICTIONS.nz;
}
