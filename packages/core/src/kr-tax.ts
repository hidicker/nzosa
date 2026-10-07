import type { FormDefinition } from "./form-schedules.js";
import type { Cents } from "./money.js";
import type { IsoDate } from "./dates.js";

/**
 * South Korea: VAT (부가가치세), comprehensive income tax (종합소득세), a
 * business's income statement on the standard headings (표준손익계산서) and
 * a rental's income (부동산임대소득).
 *
 * Lines carry the Korean heading first, as the National Tax Service's forms
 * print them, and English after. Amounts are held as everywhere in these
 * books, in hundredths: one won is 100.
 *
 * The books set out the figures; Hometax is where they are filed. What only
 * the taxpayer knows -- tax invoices against card sales, deemed rent on
 * deposits, which houses count -- is said, not guessed.
 */

/** Standard income statement headings for a sole proprietor's business. */
export const KR_BUSINESS_STATEMENT: FormDefinition = {
  id: "kr-business-statement",
  title: "표준손익계산서 Standard income statement",
  lines: [
    { id: "sales", title: "매출액 Sales", side: "income" },
    { id: "other-income", title: "영업외수익 Non-operating income", side: "income" },
    { id: "cogs", title: "매출원가 Cost of sales", side: "expense", costOfSales: true },
    { id: "salaries", title: "급여 Salaries and wages", side: "expense" },
    { id: "retirement", title: "퇴직급여 Retirement benefits", side: "expense" },
    { id: "welfare", title: "복리후생비 Employee welfare", side: "expense" },
    { id: "travel", title: "여비교통비 Travel and transport", side: "expense" },
    { id: "entertainment", title: "기업업무추진비 Business entertainment", side: "expense" },
    { id: "communications", title: "통신비 Communications", side: "expense" },
    { id: "utilities", title: "수도광열비 Utilities", side: "expense" },
    { id: "taxes", title: "세금과공과 Taxes and dues", side: "expense" },
    { id: "depreciation", title: "감가상각비 Depreciation", side: "expense" },
    { id: "rent", title: "지급임차료 Rent", side: "expense" },
    { id: "repairs", title: "수선비 Repairs", side: "expense" },
    { id: "insurance", title: "보험료 Insurance", side: "expense" },
    { id: "vehicle", title: "차량유지비 Vehicle", side: "expense" },
    { id: "advertising", title: "광고선전비 Advertising", side: "expense" },
    { id: "supplies", title: "소모품비 Supplies", side: "expense" },
    { id: "fees", title: "지급수수료 Fees and commissions", side: "expense" },
    { id: "interest", title: "이자비용 Interest", side: "expense" },
    { id: "other", title: "기타 Other expenses", side: "expense" },
  ],
  rules: [
    ["other-income", /interest income|이자수익|other income|영업외|잡이익|refund/],
    ["sales", /sales|revenue|매출|수입|income|fees/],
    ["cogs", /cost of (goods|sales)|매출원가|purchases|상품|inventory/],
    ["retirement", /retire|퇴직|pension/],
    ["welfare", /welfare|복리후생|benefit/],
    ["salaries", /salar|wage|급여|임금|payroll/],
    ["entertainment", /entertain|접대|업무추진|meal|restaurant/],
    ["interest", /interest|이자/],
    ["insurance", /insurance|보험/],
    ["taxes", /tax|세금|공과|licen|dues/],
    ["depreciation", /depreciat|감가상각|amorti/],
    ["vehicle", /vehicle|차량|fuel|주유|parking|toll|motor/],
    ["travel", /travel|여비|교통|airfare|flight|hotel|taxi|transport/],
    ["communications", /phone|telephone|통신|internet|mobile|postage/],
    ["utilities", /utilit|electric|전기|water|수도|gas|가스|광열|heating/],
    ["rent", /rent|임차|lease/],
    ["repairs", /repair|수선|maintenance/],
    ["advertising", /advertis|광고|marketing/],
    ["supplies", /supplies|소모품|stationery|office/],
    ["fees", /fee|수수료|commission|accounting|legal|세무/],
  ],
  otherIncome: "sales",
  otherExpense: "other",
  notes: [
    "기업업무추진비(접대비)는 한도 내에서만 필요경비로 인정됩니다. Business entertainment is deductible only within its limit.",
    "복식부기의무자는 재무상태표와 함께 표준손익계산서를 제출합니다. A bookkeeping-obliged business files the balance sheet with this statement.",
  ],
};

/** A rental's income and expenses (부동산임대업). */
export const KR_RENTAL_STATEMENT: FormDefinition = {
  id: "kr-rental-statement",
  title: "부동산임대업 수입금액·필요경비 Rental income and expenses",
  lines: [
    { id: "rent", title: "임대료 수입 Rent received", side: "income" },
    { id: "maintenance-income", title: "관리비 수입 Maintenance fees received", side: "income" },
    { id: "interest", title: "이자비용 Interest", side: "expense" },
    { id: "taxes", title: "세금과공과 Property tax and dues", side: "expense" },
    { id: "insurance", title: "보험료 Insurance", side: "expense" },
    { id: "repairs", title: "수선비 Repairs", side: "expense" },
    { id: "management", title: "관리비 Management", side: "expense" },
    { id: "agent", title: "중개수수료 Agent fees", side: "expense" },
    { id: "depreciation", title: "감가상각비 Depreciation", side: "expense" },
    { id: "other", title: "기타 Other expenses", side: "expense" },
  ],
  rules: [
    ["maintenance-income", /관리비|maintenance fee|service charge/],
    ["rent", /rent|임대|월세|lease|tenant/],
    ["interest", /interest|이자/],
    ["taxes", /tax|세금|재산세|공과|rates/],
    ["insurance", /insurance|보험/],
    ["repairs", /repair|수선|maintenance/],
    ["agent", /agent|중개|commission|letting/],
    ["management", /management|관리/],
    ["depreciation", /depreciat|감가상각/],
  ],
  otherIncome: "rent",
  otherExpense: "other",
  notes: [
    "보증금에 대한 간주임대료는 장부에 없으므로 따로 계산해야 합니다. Deemed rent on deposits is not in the books and is worked out separately.",
    "주택임대 수입이 연 2천만원 이하이면 분리과세를 선택할 수 있습니다. Housing rent of 20 million won or less a year may be taxed separately.",
    "1주택 임대는 기준시가 12억원 초과 주택이 아니면 비과세될 수 있습니다. Renting out a single house is generally not taxed unless it is valued over 1.2 billion won.",
  ],
};

/**
 * VAT for a general taxpayer: tax base, output VAT, input VAT and what is to
 * pay, from a return the books worked out. Tax invoices, card and cash-receipt
 * sales are one figure here; the return splits them, and the books cannot.
 */
export interface KrVatReturn {
  /** 과세표준: sales, VAT excluded. */
  taxBase: Cents;
  /** 영세율: zero-rated sales. */
  zeroRated: Cents;
  /** 매출세액 */
  outputVat: Cents;
  /** 매입세액 */
  inputVat: Cents;
  /** 납부(환급)세액: positive to pay, negative a refund. */
  payable: Cents;
}

export function krVatReturn(boxes: { box5?: number; box6?: number; box8?: number; box12?: number; box13?: number }): KrVatReturn {
  const outputVat = boxes.box8 ?? 0;
  const inputVat = (boxes.box12 ?? 0) + (boxes.box13 ?? 0);
  return {
    taxBase: (boxes.box5 ?? 0) - outputVat,
    zeroRated: boxes.box6 ?? 0,
    outputVat,
    inputVat,
    payable: outputVat - inputVat,
  };
}

/**
 * The two VAT periods of a year for a general taxpayer, with the final
 * return's due date: 1기 January to June, due 25 July; 2기 July to December,
 * due 25 January. An individual pays a preliminary amount on notice in April
 * and October; a company files a preliminary return then.
 */
export function krVatPeriods(year: number): { label: string; from: IsoDate; to: IsoDate; due: IsoDate }[] {
  return [
    { label: "1기 First half", from: `${year}-01-01`, to: `${year}-06-30`, due: `${year}-07-25` },
    { label: "2기 Second half", from: `${year}-07-01`, to: `${year}-12-31`, due: `${year + 1}-01-25` },
  ];
}

/** Comprehensive income tax is due by 31 May of the next year. */
export function krIncomeTaxDue(year: number): IsoDate {
  return `${year + 1}-05-31`;
}

interface Bracket {
  over: Cents;
  rate: number;
}

/** Comprehensive income tax rates from 2023 (won x 100). */
const KR_BRACKETS: readonly Bracket[] = [
  { over: 0, rate: 0.06 },
  { over: 1_400_000_000, rate: 0.15 },
  { over: 5_000_000_000, rate: 0.24 },
  { over: 8_800_000_000, rate: 0.35 },
  { over: 15_000_000_000, rate: 0.38 },
  { over: 30_000_000_000, rate: 0.4 },
  { over: 50_000_000_000, rate: 0.42 },
  { over: 100_000_000_000, rate: 0.45 },
];

/**
 * Comprehensive income tax on a tax base (과세표준), and local income tax at
 * a tenth of it. From 2023's rates; null before. Credits and deductions are
 * the return's, not the books'. Confirm the rates for the year.
 */
export function krIncomeTax(taxBase: Cents, year: number): { incomeTax: Cents; localTax: Cents } | null {
  if (year < 2023) return null;
  const base = Math.max(0, taxBase);
  let tax = 0;
  KR_BRACKETS.forEach((bracket, i) => {
    const next = KR_BRACKETS[i + 1]?.over ?? Number.POSITIVE_INFINITY;
    if (base > bracket.over) tax += (Math.min(base, next) - bracket.over) * bracket.rate;
  });
  // Whole won, as the tax is stated.
  const incomeTax = Math.floor(tax / 100) * 100;
  return { incomeTax, localTax: Math.floor(incomeTax / 10 / 100) * 100 };
}
