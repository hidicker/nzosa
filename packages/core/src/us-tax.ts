import type { FormDefinition } from "./form-schedules.js";
import type { Cents } from "./money.js";
import type { IsoDate } from "./dates.js";

/**
 * United States federal forms for the people NZOSA suits best there: landlords
 * (Schedule E, part I, one column per property) and sole proprietors
 * (Schedule C), with the contractors who need a 1099-NEC and the quarterly
 * estimated tax dates.
 *
 * What is here is the arithmetic and the layout, not advice. Federal income
 * tax itself is not worked out: it turns on filing status, other income and
 * deductions these books never see. State returns are not covered.
 */

/** Schedule E, part I: income or loss from one rental real estate property. */
export const SCHEDULE_E: FormDefinition = {
  id: "us-schedule-e",
  title: "Schedule E (Form 1040), Part I",
  lines: [
    { id: "3", title: "3 Rents received", side: "income" },
    { id: "4", title: "4 Royalties received", side: "income" },
    { id: "5", title: "5 Advertising", side: "expense" },
    { id: "6", title: "6 Auto and travel", side: "expense" },
    { id: "7", title: "7 Cleaning and maintenance", side: "expense" },
    { id: "8", title: "8 Commissions", side: "expense" },
    { id: "9", title: "9 Insurance", side: "expense" },
    { id: "10", title: "10 Legal and other professional fees", side: "expense" },
    { id: "11", title: "11 Management fees", side: "expense" },
    { id: "12", title: "12 Mortgage interest paid to banks, etc.", side: "expense" },
    { id: "13", title: "13 Other interest", side: "expense" },
    { id: "14", title: "14 Repairs", side: "expense" },
    { id: "15", title: "15 Supplies", side: "expense" },
    { id: "16", title: "16 Taxes", side: "expense" },
    { id: "17", title: "17 Utilities", side: "expense" },
    { id: "18", title: "18 Depreciation expense or depletion", side: "expense" },
    { id: "19", title: "19 Other", side: "expense" },
  ],
  rules: [
    ["4", /royalt/],
    ["3", /rent|lease|tenant/],
    ["13", /credit card|other interest|personal loan/],
    ["12", /interest|mortgage/],
    ["9", /insurance/],
    ["11", /property management|management fee|letting|managing agent/],
    ["8", /commission/],
    ["10", /legal|lawyer|attorney|account|bookkeep|tax prep|professional/],
    ["5", /advertis|marketing|listing/],
    ["14", /repair/],
    ["7", /clean|maintenance|garden|lawn|landscap|pest|snow/],
    ["18", /depreciat|amortiz|amortis|depletion/],
    ["16", /tax|rates\b|council/],
    ["17", /utilit|electric|power|water|sewer|trash|rubbish|internet|phone/],
    ["15", /supplies|stationery|tools|hardware/],
    ["6", /vehicle|motor|mileage|\bauto|travel|\bcar\b|fuel|parking|airfare|flight|hotel|lodging/],
  ],
  otherIncome: "3",
  otherExpense: "19",
  notes: [
    "Lines 20 (total expenses) and 21 (income or loss) are the totals below. A loss may be limited by the passive activity rules (Form 8582) and the at-risk rules; that is for the return, not these books.",
    "Fair rental days and personal use days (line 2) are not in the books: count them before filing.",
  ],
};

/** Schedule C: profit or loss from business (sole proprietorship). */
export const SCHEDULE_C: FormDefinition = {
  id: "us-schedule-c",
  title: "Schedule C (Form 1040)",
  lines: [
    { id: "1", title: "1 Gross receipts or sales", side: "income" },
    { id: "6", title: "6 Other income", side: "income" },
    { id: "4", title: "4 Cost of goods sold", side: "expense", costOfSales: true },
    { id: "8", title: "8 Advertising", side: "expense" },
    { id: "9", title: "9 Car and truck expenses", side: "expense" },
    { id: "10", title: "10 Commissions and fees", side: "expense" },
    { id: "11", title: "11 Contract labor", side: "expense" },
    { id: "13", title: "13 Depreciation and section 179 expense deduction", side: "expense" },
    { id: "14", title: "14 Employee benefit programs", side: "expense" },
    { id: "15", title: "15 Insurance (other than health)", side: "expense" },
    { id: "16a", title: "16a Interest: Mortgage (paid to banks, etc.)", side: "expense" },
    { id: "16b", title: "16b Interest: Other", side: "expense" },
    { id: "17", title: "17 Legal and professional services", side: "expense" },
    { id: "18", title: "18 Office expense", side: "expense" },
    { id: "19", title: "19 Pension and profit-sharing plans", side: "expense" },
    { id: "20a", title: "20a Rent or lease: Vehicles, machinery, and equipment", side: "expense" },
    { id: "20b", title: "20b Rent or lease: Other business property", side: "expense" },
    { id: "21", title: "21 Repairs and maintenance", side: "expense" },
    { id: "22", title: "22 Supplies (not included in Part III)", side: "expense" },
    { id: "23", title: "23 Taxes and licenses", side: "expense" },
    { id: "24a", title: "24a Travel", side: "expense" },
    { id: "24b", title: "24b Deductible meals", side: "expense", share: 0.5 },
    { id: "25", title: "25 Utilities", side: "expense" },
    { id: "26", title: "26 Wages (less employment credits)", side: "expense" },
    { id: "27a", title: "27a Other expenses", side: "expense" },
    // Not a line on the form: entertainment has been 0% deductible since 2018
    // (IRC 274(a)), so it is shown, and claimed nowhere.
    { id: "entertainment", title: "Entertainment (not deductible)", side: "expense", share: 0 },
  ],
  rules: [
    ["6", /interest income|interest received|other income|refund|grant|rebate/],
    ["1", /sales|revenue|receipts|fees|income|turnover/],
    ["4", /cost of goods|cost of sales|cost of labou?r|purchases|inventory|stock/],
    ["16a", /mortgage/],
    ["16b", /interest/],
    ["14", /health insurance|benefit/],
    ["15", /insurance/],
    ["23", /payroll tax|tax|licen|permit|registration/],
    ["19", /pension|401|retirement|profit.sharing/],
    ["26", /wage|salar|payroll/],
    ["11", /contract|subcontract|freelanc/],
    ["10", /commission|merchant fee|processing fee|platform fee/],
    ["17", /legal|lawyer|attorney|account|bookkeep|professional/],
    ["8", /advertis|marketing|promotion/],
    ["13", /depreciat|amortiz|amortis|section 179/],
    ["20a", /(rent|lease|hire).*(equipment|machinery|vehicle)|(equipment|machinery|vehicle).*(rent|lease|hire)/],
    ["9", /vehicle|motor|mileage|\bcar\b|\bauto|truck|fuel|parking/],
    ["20b", /rent|lease/],
    ["21", /repair|maintenance/],
    ["22", /supplies|materials|small tools/],
    // Meals first: QuickBooks' own "Meals and Entertainment" account is mostly
    // meals, and goes on line 24b with a note to take entertainment out.
    ["24b", /meal|food|restaurant/],
    ["entertainment", /entertain/],
    ["24a", /travel|airfare|flight|hotel|accommodation|lodging/],
    ["25", /utilit|electric|power|water|internet|phone|telephone/],
    ["18", /office|postage|stationery|software|subscription/],
  ],
  otherIncome: "1",
  otherExpense: "27a",
  notes: [
    "Line 24b allows half of business meals with a documented business purpose; the full amount spent is shown beside it. Entertainment is not deductible at all (IRC 274(a)): an account for meals and entertainment together is put on line 24b, and any entertainment in it needs taking out.",
    "Business use of your home (line 30, Form 8829 or the simplified method) is not in the books: work it out before filing.",
    "Self-employment tax (Schedule SE) is due on net earnings of $400 or more.",
  ],
};

/**
 * The four estimated tax payment dates for a tax year: 15 April, 15 June and
 * 15 September of the year, and 15 January of the next. A date on a weekend
 * moves to the Monday; a federal holiday also moves it, which this does not
 * know, so check the IRS calendar for the year.
 */
export function estimatedTaxDates(year: number): IsoDate[] {
  const roll = (date: string): IsoDate => {
    const at = new Date(`${date}T00:00:00Z`);
    const day = at.getUTCDay();
    if (day === 6) at.setUTCDate(at.getUTCDate() + 2);
    if (day === 0) at.setUTCDate(at.getUTCDate() + 1);
    return at.toISOString().slice(0, 10);
  };
  return [`${year}-04-15`, `${year}-06-15`, `${year}-09-15`, `${year + 1}-01-15`].map(roll);
}

/**
 * The payments to one person in a year over which a Form 1099-NEC is due.
 *
 * $600 through payments made in 2025. The One Big Beautiful Bill Act (2025)
 * raised it to $2,000 for payments made after 31 December 2025, indexed for
 * inflation from 2027 -- confirm the figure for the year before relying on it.
 */
export function nec1099Threshold(year: number): Cents {
  return year <= 2025 ? 60_000 : 200_000;
}

export interface ContractorPayment {
  payee: string;
  date: IsoDate;
  /** Positive, the amount paid. */
  amount: Cents;
}

export interface ContractorTotal {
  payee: string;
  total: Cents;
  payments: number;
  /** Over the threshold, so a 1099-NEC is due (unless the payee is a corporation). */
  due: boolean;
}

/**
 * Each contractor's total for a calendar year, largest first, with whether a
 * 1099-NEC is due. Payments by card or through a payment network are reported
 * by the network on a 1099-K instead, which the books cannot tell apart; they
 * are counted here, and the note says so.
 */
export function contractorTotals(payments: readonly ContractorPayment[], year: number): ContractorTotal[] {
  const threshold = nec1099Threshold(year);
  const totals = new Map<string, ContractorTotal>();
  for (const payment of payments) {
    if (!payment.date.startsWith(String(year))) continue;
    const key = payment.payee.trim();
    if (key === "") continue;
    const held = totals.get(key) ?? { payee: key, total: 0, payments: 0, due: false };
    held.total += payment.amount;
    held.payments += 1;
    totals.set(key, held);
  }
  for (const one of totals.values()) one.due = one.total >= threshold;
  return [...totals.values()].sort((a, b) => b.total - a.total);
}

/**
 * Social Security's wage base by year: the most of a person's earnings that
 * the 12.4% applies to. 2026 as announced by the SSA in October 2025.
 */
const SS_WAGE_BASE: Readonly<Record<number, Cents>> = {
  2025: 17_610_000,
  2026: 18_450_000,
};

export interface SelfEmploymentTax {
  /** Net earnings from self-employment, as given. */
  earnings: Cents;
  /** 92.35% of it: what the tax is worked on. */
  taxable: Cents;
  socialSecurity: Cents;
  medicare: Cents;
  /** The 0.9% above $200,000, for a single filer. */
  additionalMedicare: Cents;
  /** What goes on Schedule SE line 12, plus the additional Medicare. */
  total: Cents;
  /** Half of the 15.3% (not the additional Medicare): deducted from income. */
  deduction: Cents;
}

/**
 * Self-employment tax on net earnings from self-employment (Schedule SE).
 *
 * Nothing under $400 net. Otherwise 92.35% of the earnings, with 12.4% on up
 * to the wage base and 2.9% on all of it. Null for a year whose wage base is
 * not held, rather than a figure from last year's.
 */
export function selfEmploymentTax(earnings: Cents, year: number): SelfEmploymentTax | null {
  const base = SS_WAGE_BASE[year];
  if (base === undefined) return null;
  if (earnings < 40_000) {
    return { earnings, taxable: 0, socialSecurity: 0, medicare: 0, additionalMedicare: 0, total: 0, deduction: 0 };
  }
  const taxable = Math.round(earnings * 0.9235);
  const socialSecurity = Math.round(Math.min(taxable, base) * 0.124);
  const medicare = Math.round(taxable * 0.029);
  const additionalMedicare = Math.round(Math.max(0, taxable - 20_000_000) * 0.009);
  return {
    earnings,
    taxable,
    socialSecurity,
    medicare,
    additionalMedicare,
    total: socialSecurity + medicare + additionalMedicare,
    deduction: Math.round((socialSecurity + medicare) / 2),
  };
}

interface Bracket {
  /** The top of the bracket, in cents; null for the last. */
  upTo: Cents | null;
  rate: number;
}

/** Single filers' ordinary income brackets and standard deduction, by year. */
const SINGLE: Readonly<Record<number, { standardDeduction: Cents; brackets: readonly Bracket[] }>> = {
  2025: {
    standardDeduction: 1_575_000,
    brackets: [
      { upTo: 1_192_500, rate: 0.1 },
      { upTo: 4_847_500, rate: 0.12 },
      { upTo: 10_335_000, rate: 0.22 },
      { upTo: 19_730_000, rate: 0.24 },
      { upTo: 25_052_500, rate: 0.32 },
      { upTo: 62_635_000, rate: 0.35 },
      { upTo: null, rate: 0.37 },
    ],
  },
  2026: {
    standardDeduction: 1_610_000,
    brackets: [
      { upTo: 1_240_000, rate: 0.1 },
      { upTo: 5_040_000, rate: 0.12 },
      { upTo: 10_570_000, rate: 0.22 },
      { upTo: 20_177_500, rate: 0.24 },
      { upTo: 25_622_500, rate: 0.32 },
      { upTo: 64_060_000, rate: 0.35 },
      { upTo: null, rate: 0.37 },
    ],
  },
};

export interface UsIncomeTax {
  standardDeduction: Cents;
  taxableIncome: Cents;
  tax: Cents;
}

/**
 * Federal income tax on taxable income for a single filer, with the standard
 * deduction. An estimate: other income, the 20% qualified business income
 * deduction, credits and a different filing status are the return's. Null for
 * a year whose brackets are not held.
 */
export function usIncomeTaxSingle(income: Cents, year: number): UsIncomeTax | null {
  const table = SINGLE[year];
  if (table === undefined) return null;
  const taxableIncome = Math.max(0, income - table.standardDeduction);
  let tax = 0;
  let from = 0;
  for (const bracket of table.brackets) {
    const top = bracket.upTo ?? Number.POSITIVE_INFINITY;
    if (taxableIncome > from) tax += (Math.min(taxableIncome, top) - from) * bracket.rate;
    from = top;
  }
  return { standardDeduction: table.standardDeduction, taxableIncome, tax: Math.round(tax) };
}

/**
 * The qualified business income deduction's threshold for a single filer
 * (all returns but married filing jointly): Form 8995 instructions for 2025,
 * Rev. Proc. 2025-32 for 2026.
 */
const QBI_THRESHOLD: Readonly<Record<number, Cents>> = {
  2025: 19_730_000,
  2026: 20_175_000,
};

export interface QbiDeduction {
  /** Form 8995 line 15: what comes off taxable income (Form 1040 line 13a). */
  deduction: Cents;
  /** Over the threshold, Form 8995-A's limits apply and are not worked out here. */
  overThreshold: boolean;
  threshold: Cents;
}

/**
 * The 20% qualified business income deduction by Form 8995, for taxable
 * income (before the deduction) at or under the threshold: the smaller of 20%
 * of qualified business income and 20% of taxable income before it. From
 * 2026, at least $400 where qualified business income is $1,000 or more
 * (section 199A(i)). Null for a year whose threshold is not held.
 */
export function usQbiDeduction(qbi: Cents, taxableBeforeQbi: Cents, year: number): QbiDeduction | null {
  const threshold = QBI_THRESHOLD[year];
  if (threshold === undefined) return null;
  const overThreshold = taxableBeforeQbi > threshold;
  if (overThreshold || qbi <= 0 || taxableBeforeQbi <= 0) return { deduction: 0, overThreshold, threshold };
  let deduction = Math.min(Math.round(qbi * 0.2), Math.round(taxableBeforeQbi * 0.2));
  if (year >= 2026 && qbi >= 100_000) deduction = Math.min(Math.max(deduction, 40_000), taxableBeforeQbi);
  return { deduction, overThreshold, threshold };
}
