import type { FormDefinition } from "./form-schedules.js";
import type { Cents } from "./money.js";
import type { IsoDate } from "./dates.js";

/**
 * Australia: the rental property schedule that goes with item 21 of the
 * individual tax return, the business activity statement's GST labels, and
 * resident individual income tax.
 *
 * The figures are the books' figures set out on the ATO's labels. What only
 * the owner knows -- private use of the property, days available for rent,
 * the split between joint owners' shares when it is not by title -- is asked
 * for, not guessed.
 */

/** The ATO's rental property schedule, one per property. */
export const AU_RENTAL_SCHEDULE: FormDefinition = {
  id: "au-rental-schedule",
  title: "Rental property schedule (individual tax return, item 21)",
  lines: [
    { id: "gross-rent", title: "Gross rent", side: "income" },
    { id: "other-income", title: "Other rental-related income", side: "income" },
    { id: "advertising", title: "Advertising for tenants", side: "expense" },
    { id: "body-corporate", title: "Body corporate fees and charges", side: "expense" },
    { id: "borrowing", title: "Borrowing expenses", side: "expense" },
    { id: "cleaning", title: "Cleaning", side: "expense" },
    { id: "council-rates", title: "Council rates", side: "expense" },
    { id: "capital-allowances", title: "Capital allowances (depreciation on plant)", side: "expense" },
    { id: "gardening", title: "Gardening and lawn mowing", side: "expense" },
    { id: "insurance", title: "Insurance", side: "expense" },
    { id: "interest", title: "Interest on loans", side: "expense" },
    { id: "land-tax", title: "Land tax", side: "expense" },
    { id: "legal", title: "Legal fees", side: "expense" },
    { id: "pest", title: "Pest control", side: "expense" },
    { id: "agent", title: "Property agent fees and commission", side: "expense" },
    { id: "repairs", title: "Repairs and maintenance", side: "expense" },
    { id: "capital-works", title: "Capital works deductions", side: "expense" },
    { id: "stationery", title: "Stationery, telephone and postage", side: "expense" },
    { id: "travel", title: "Travel expenses", side: "expense" },
    { id: "water", title: "Water charges", side: "expense" },
    { id: "sundry", title: "Sundry rental expenses", side: "expense" },
  ],
  rules: [
    ["gross-rent", /rent|lease|tenant/],
    ["borrowing", /borrowing|loan establishment|mortgage (registration|fee)|lenders mortgage/],
    ["interest", /interest/],
    ["insurance", /insurance/],
    ["agent", /agent|property management|management fee|letting|commission/],
    ["land-tax", /land tax/],
    ["council-rates", /council|\brates\b/],
    ["water", /water/],
    ["body-corporate", /body corporate|strata|owners corporation/],
    ["capital-works", /capital works|division 43|building (write.off|depreciation)/],
    ["capital-allowances", /depreciat|capital allowance|division 40/],
    ["repairs", /repair|maintenance/],
    ["cleaning", /clean/],
    ["gardening", /garden|lawn/],
    ["pest", /pest/],
    ["legal", /legal|lawyer|solicitor|conveyanc/],
    ["advertising", /advertis|marketing|listing/],
    ["travel", /travel|vehicle|mileage|motor/],
    ["stationery", /stationery|phone|telephone|postage|internet/],
  ],
  otherIncome: "other-income",
  otherExpense: "sundry",
  notes: [
    "Travel to inspect, maintain or collect rent for a residential rental is not deductible from 1 July 2017 for most individuals; anything on the travel line needs checking.",
    "Depreciation on second-hand plant in a residential rental bought after 9 May 2017 is not deductible for most individuals.",
    "Each owner returns their share of the net rent by their legal interest in the property.",
    "From 1 July 2027 a net loss on a residential rental reduces other income only for new builds, or a property held at 7:30 pm AEST on 12 May 2026.",
  ],
};

/**
 * GST on the business activity statement, from a GST return the books worked
 * out: the simpler BAS's three labels, G1 total sales (GST inclusive), 1A GST
 * on sales and 1B GST on purchases, and the amount owing or refunded.
 */
export interface SimplerBas {
  g1: Cents;
  a1: Cents;
  b1: Cents;
  /** 1A less 1B: positive to pay, negative a refund. */
  net: Cents;
}

export function simplerBas(boxes: { box5?: number; box8?: number; box12?: number; box13?: number }): SimplerBas {
  const g1 = boxes.box5 ?? 0;
  const a1 = boxes.box8 ?? 0;
  const b1 = (boxes.box12 ?? 0) + (boxes.box13 ?? 0);
  return { g1, a1, b1, net: a1 - b1 };
}

/**
 * When a quarterly BAS is due, lodging yourself: 28 October, 28 February,
 * 28 April and 28 July for the quarters ending September, December, March and
 * June. A tax agent lodging electronically usually has longer.
 */
export function basDueDate(quarterEnd: IsoDate): IsoDate {
  const year = Number(quarterEnd.slice(0, 4));
  const month = Number(quarterEnd.slice(5, 7));
  const due =
    month === 9 ? `${year}-10-28` : month === 12 ? `${year + 1}-02-28` : month === 3 ? `${year}-04-28` : `${year}-07-28`;
  // A due date on a weekend is the next business day: 28 February 2027 is a
  // Sunday, so 1 March. Public holidays move it too, which this does not know.
  const at = new Date(`${due}T00:00:00Z`);
  const day = at.getUTCDay();
  if (day === 6) at.setUTCDate(at.getUTCDate() + 2);
  if (day === 0) at.setUTCDate(at.getUTCDate() + 1);
  return at.toISOString().slice(0, 10);
}

/** The quarters of an Australian financial year, by the year it ends in. */
export function basQuarters(year: number): { from: IsoDate; to: IsoDate }[] {
  return [
    { from: `${year - 1}-07-01`, to: `${year - 1}-09-30` },
    { from: `${year - 1}-10-01`, to: `${year - 1}-12-31` },
    { from: `${year}-01-01`, to: `${year}-03-31` },
    { from: `${year}-04-01`, to: `${year}-06-30` },
  ];
}

interface Bracket {
  from: Cents;
  rate: number;
}

/**
 * Resident individual tax rates by financial year (the year ending 30 June).
 * 2025 and 2026 are the rates from 1 July 2024; from 1 July 2026 the 16%
 * rate falls to 15%. Confirm with the ATO before relying on a year.
 */
const RESIDENT_RATES: Readonly<Record<number, readonly Bracket[]>> = {
  2025: [
    { from: 1_820_000, rate: 0.16 },
    { from: 4_500_000, rate: 0.3 },
    { from: 13_500_000, rate: 0.37 },
    { from: 19_000_000, rate: 0.45 },
  ],
  2026: [
    { from: 1_820_000, rate: 0.16 },
    { from: 4_500_000, rate: 0.3 },
    { from: 13_500_000, rate: 0.37 },
    { from: 19_000_000, rate: 0.45 },
  ],
  2027: [
    { from: 1_820_000, rate: 0.15 },
    { from: 4_500_000, rate: 0.3 },
    { from: 13_500_000, rate: 0.37 },
    { from: 19_000_000, rate: 0.45 },
  ],
};

/**
 * Tax on a resident's taxable income for a year, before offsets and the
 * Medicare levy. Null for a year whose rates are not held here. Whole dollars
 * of income, as the ATO taxes them.
 */
export function auResidentTax(taxable: Cents, year: number): Cents | null {
  const brackets = RESIDENT_RATES[year];
  if (brackets === undefined) return null;
  const income = Math.floor(Math.max(0, taxable) / 100) * 100;
  let tax = 0;
  brackets.forEach((bracket, i) => {
    const next = brackets[i + 1]?.from ?? Number.POSITIVE_INFINITY;
    // Each bracket starts a dollar over the threshold: $18,201 is the first taxed dollar.
    if (income > bracket.from) tax += (Math.min(income, next) - bracket.from) * bracket.rate;
  });
  return Math.round(tax);
}

/**
 * The low income tax offset: $700 up to $37,500, less 5c a dollar to $45,000,
 * then 1.5c a dollar to nil at $66,667 (unchanged 2020-21 to 2026-27). It can
 * only reduce tax to nil. Null for a year it is not held for.
 */
export function auLowIncomeOffset(taxable: Cents, year: number): Cents | null {
  if (year < 2021 || year > 2027) return null;
  const income = Math.max(0, taxable);
  if (income <= 3_750_000) return 70_000;
  if (income <= 4_500_000) return Math.round(70_000 - (income - 3_750_000) * 0.05);
  return Math.max(0, Math.round(32_500 - (income - 4_500_000) * 0.015));
}

/**
 * Low-income thresholds for the Medicare levy, single, by year: no levy at or
 * below the first figure, 10c a dollar above it until that reaches 2%. Family
 * thresholds, seniors, the surcharge and exemptions turn on what these books
 * do not hold.
 */
const MEDICARE_LOW_INCOME: Readonly<Record<number, Cents>> = { 2026: 2_801_100 };

/**
 * The Medicare levy, 2% of taxable income, with the single low-income
 * reduction where the year's threshold is held.
 */
export function medicareLevy(taxable: Cents, year?: number): Cents {
  const income = Math.max(0, taxable);
  const full = Math.round(income * 0.02);
  const threshold = year === undefined ? undefined : MEDICARE_LOW_INCOME[year];
  if (threshold === undefined) return full;
  if (income <= threshold) return 0;
  return Math.min(full, Math.round((income - threshold) * 0.1));
}

/** Whether the year's Medicare low-income threshold is held, so the levy is reduced. */
export function medicareThresholdHeld(year: number): boolean {
  return MEDICARE_LOW_INCOME[year] !== undefined;
}
