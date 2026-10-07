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
  ],
  rules: [
    ["6", /interest income|interest received|other income|refund|grant|rebate/],
    ["1", /sales|revenue|receipts|fees|income|turnover/],
    ["4", /cost of goods|cost of sales|purchases|inventory|stock/],
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
    ["9", /vehicle|motor|mileage|\bcar\b|truck|fuel|parking/],
    ["20b", /rent|lease/],
    ["21", /repair|maintenance/],
    ["22", /supplies|materials|small tools/],
    ["24b", /meal|entertainment|food|restaurant/],
    ["24a", /travel|airfare|flight|hotel|accommodation|lodging/],
    ["25", /utilit|electric|power|water|internet|phone|telephone/],
    ["18", /office|postage|stationery|software|subscription/],
  ],
  otherIncome: "1",
  otherExpense: "27a",
  notes: [
    "Line 24b allows half of business meals; the full amount spent is shown beside it.",
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
