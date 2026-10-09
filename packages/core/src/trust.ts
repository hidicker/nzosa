import type { Cents } from "./money.js";
import type { IsoDate } from "./dates.js";
import type { Account } from "./chart.js";
import type { PostedJournal } from "./posting.js";
import { incomeAndExpenses } from "./ir9.js";
import type { ManualJournal } from "./manual-journals.js";
import { provisionalStandardOption } from "./rental-schedules.js";
import type { ProvisionalStandard } from "./rental-schedules.js";
import type { AccountAmount } from "./ir9.js";

/**
 * Trusts and estates: who is in the trust, and the IR6 income tax return.
 *
 * Built from Inland Revenue's IR6 return for the year to 31 March 2026 and its
 * 2026 Estate or trust return guide (IR6G), read in October 2026. Box numbers
 * are that form's; Inland Revenue changes them from year to year, so the
 * worksheet says what each figure is first and the box only as a help. Check
 * each year's form before filing, and have an accountant look at the choices
 * that are the trustees' to make.
 *
 * What the guide says, and what is done here:
 *
 * - Income of a trust is either beneficiary income (vested in, or paid or
 *   applied for, a beneficiary by balance date or by the later of six months
 *   after it and the earlier of the return being completed or falling due) or
 *   trustee income -- everything else. Losses stay in the trust.
 * - Beneficiary income under the minor rule (a New Zealand resident under 16
 *   at balance date, unless the allocation is $1,000 or less in the year, or
 *   a disability allowance is paid) and the corporate rule (a close company
 *   with a settlor, trustee or relative as shareholder) is taxed as trustee
 *   income at 39% on the IR6 itself. If the minor allocation is over $1,000
 *   the whole of it is taxed that way, not just the excess.
 * - Other beneficiary income is taxed at the beneficiary's own marginal rates;
 *   the trustee pays it for them unless they agree otherwise. It is not final
 *   tax: the beneficiary includes the income and the tax in their own return.
 * - Trustee income is taxed at 39%, or 33% where trustee net income (trustee
 *   income less deductible expenses, ignoring income taxed under the minor and
 *   corporate beneficiary rules) is $10,000 or less, for a disabled beneficiary trust, for an estate in the
 *   year of death and the three after, or an energy consumer trust; 28% for a
 *   legacy superannuation fund trust.
 * - A distribution other than beneficiary income is not taxable from a
 *   complying trust to a New Zealand resident; from a non-complying trust it
 *   is taxed at 45% to the beneficiary.
 * - Trusts that are not exempt must also disclose: a profit and loss summary,
 *   assets and liabilities, who the settlors and appointers are, and what each
 *   beneficiary was distributed and withdrew (IR6S, IR6P and IR6B).
 *
 * Not worked out here: the foreign and non-complying trust rules beyond the
 * 45% on taxable distributions, controlled foreign company and foreign
 * investment fund income (entered as a figure), the disabled beneficiary
 * trust election, the residential property ring-fencing beyond carrying the
 * excess forward, and non-resident beneficiaries' withholding tax.
 */

export type TrustType = "complying" | "foreign" | "non-complying";

export const TRUST_TYPES: readonly (readonly [TrustType, string])[] = [
  ["complying", "Complying trust"],
  ["foreign", "Foreign trust"],
  ["non-complying", "Non-complying trust"],
];

export interface TrustPerson {
  id: string;
  name: string;
  /** Date of birth, or the date a company or trust began. */
  born?: IsoDate | undefined;
  /** Where they are tax resident: "NZ", or the country. */
  residence?: string | undefined;
  irdNumber?: string | undefined;
  /** A tax identification number from another country. */
  tin?: string | undefined;
}

export interface TrustBeneficiary extends TrustPerson {
  /** A close company with a settlor, trustee or relative as a shareholder: the corporate beneficiary rule. */
  corporateRule?: boolean | undefined;
  /** A disability allowance or child disability allowance is paid: outside the minor rule. */
  disabilityAllowance?: boolean | undefined;
  /** The account in the books that holds what the trust owes them. */
  accountCode?: string | undefined;
  /** The trustee does not deduct tax from their income, by agreement (26J). */
  trusteeDoesNotPay?: boolean | undefined;
}

export interface TrustAppointer extends TrustPerson {
  /** From when they had the power to appoint or dismiss a trustee, add or remove a beneficiary, or change the deed. */
  since?: IsoDate | undefined;
  /** Until when, if they no longer do. */
  until?: IsoDate | undefined;
}

export interface Trust {
  type: TrustType;
  /** The date of the deed (or the death, for an estate). */
  deed?: IsoDate | undefined;
  irdNumber?: string | undefined;
  /** An IR596 and a copy of the deed have been sent to Inland Revenue. */
  registered?: boolean | undefined;
  /** An estate: the tax year (ending 31 March) in which the person died. */
  estateDeathYear?: number | undefined;
  disabledBeneficiaryTrust?: boolean | undefined;
  energyConsumerTrust?: boolean | undefined;
  legacySuperannuation?: boolean | undefined;
  /**
   * Not subject to the NZ domestic trust disclosure rules: inactive, a
   * registered charity, a foreign trust, eligible to be a Māori authority,
   * and the few others in the guide's question 32.
   */
  disclosureExempt?: boolean | undefined;
  settlors: TrustPerson[];
  appointers: TrustAppointer[];
  beneficiaries: TrustBeneficiary[];
}

export function emptyTrust(type: TrustType = "complying"): Trust {
  return { type, settlors: [], appointers: [], beneficiaries: [] };
}

// ---- Rates -----------------------------------------------------------------

export const MINOR_AGE = 16;
/** A minor's allocation of this or less in a year is beneficiary income. */
export const MINOR_THRESHOLD: Cents = 100_000;
export const TRUSTEE_RATE = 0.39;
export const TRUSTEE_LOW_RATE = 0.33;
export const LEGACY_SUPER_RATE = 0.28;
/** The first tax year (ending 31 March) of the 39% trustee rate: the 2024-25 income year. */
export const TRUSTEE_RATE_FROM_YEAR = 2025;

/**
 * The rate on minor and corporate beneficiary income taxed as trustee income:
 * the trustee rate, which was 33% before the 2024-25 income year.
 */
export function minorRuleRate(year: number): number {
  return year < TRUSTEE_RATE_FROM_YEAR ? TRUSTEE_LOW_RATE : TRUSTEE_RATE;
}
/** Trustee net income of this or less is taxed at the lower rate. */
export const LOW_RATE_LIMIT: Cents = 1_000_000;
export const NON_COMPLYING_RATE = 0.45;
/** Non-cash distributions or settlements below this, for one person in a year, need not be disclosed. */
export const NON_CASH_DISCLOSURE: Cents = 10_000_000;
/** Residual income tax over this makes a trust a provisional tax payer. */
export const PROVISIONAL_LIMIT: Cents = 500_000;

type Bracket = readonly [upTo: number, rate: number];

/**
 * Individual income tax rates by the tax year that ends 31 March, as Inland
 * Revenue publishes them ("Tax rates for individuals"): the table "From 1 April
 * 2025" applies to the 2026 year and after; the 2025 year had the blended
 * rates for the 31 July 2024 change of thresholds; before that, the old bands.
 *
 * Note: the printed 2026 Estate or trust return guide (IR6G) shows the blended
 * 2025 table at question 26L. Inland Revenue's own rates page and the rest of
 * this program use the 2026 table for the 2026 year, and so does this.
 */
export function individualRates(year: number): readonly Bracket[] {
  if (year >= 2026) return [[15_600, 0.105], [53_500, 0.175], [78_100, 0.3], [180_000, 0.33], [Infinity, 0.39]];
  if (year === 2025) {
    return [[14_000, 0.105], [15_600, 0.1282], [48_000, 0.175], [53_500, 0.2164], [70_000, 0.3], [78_100, 0.3099], [180_000, 0.33], [Infinity, 0.39]];
  }
  return [[14_000, 0.105], [48_000, 0.175], [70_000, 0.3], [180_000, 0.33], [Infinity, 0.39]];
}

/** Tax on a person's whole taxable income for the year. */
export function individualTax(income: Cents, year: number): Cents {
  if (income <= 0) return 0;
  let tax = 0;
  let from = 0;
  const dollars = income / 100;
  for (const [upTo, rate] of individualRates(year)) {
    if (dollars <= from) break;
    tax += (Math.min(dollars, upTo) - from) * rate;
    from = upTo;
  }
  return Math.round(tax * 100);
}

/** Age in whole years on a date. */
export function ageOn(born: IsoDate, on: IsoDate): number {
  let age = Number(on.slice(0, 4)) - Number(born.slice(0, 4));
  if (on.slice(5) < born.slice(5)) age -= 1;
  return age;
}

/**
 * Whether "tax resident in" names New Zealand. It is typed by hand, so "NZ",
 * "New Zealand" and "Aotearoa" all say so; left empty, the trust's own country
 * is assumed, as a new person starts with it.
 */
export function nzResident(residence: string | undefined): boolean {
  const said = (residence ?? "").toLowerCase().replace(/[.\s]+/g, " ").trim();
  return ["", "nz", "nzl", "n z", "new zealand", "aotearoa", "aotearoa new zealand"].includes(said);
}

export type BeneficiaryRule = "minor" | "corporate" | null;

/**
 * The tax year (ending 31 March) a balance date falls in: an early balance date
 * (April to September) and a late one (October to March) both count toward the
 * next 31 March.
 */
function taxYearOf(balanceDate: IsoDate): number {
  const year = Number(balanceDate.slice(0, 4));
  return Number(balanceDate.slice(5, 7)) >= 4 ? year + 1 : year;
}

/** Which special rule, if any, taxes this beneficiary's allocation as trustee income. */
export function beneficiaryRule(b: TrustBeneficiary, allocation: Cents, balanceDate: IsoDate): BeneficiaryRule {
  if (b.corporateRule === true && taxYearOf(balanceDate) >= TRUSTEE_RATE_FROM_YEAR) return "corporate";
  if (
    b.born !== undefined &&
    b.born !== "" &&
    ageOn(b.born, balanceDate) < MINOR_AGE &&
    nzResident(b.residence) &&
    b.disabilityAllowance !== true &&
    allocation > MINOR_THRESHOLD
  ) {
    return "minor";
  }
  return null;
}

export interface TrusteeRate {
  rate: number;
  why: string;
}

/** The rate on trustee income (question 27B), and the reason, in words. */
export function trusteeRate(trust: Trust, year: number, trusteeNetIncome: Cents): TrusteeRate {
  if (trust.legacySuperannuation === true) return { rate: LEGACY_SUPER_RATE, why: "a legacy superannuation fund trust pays 28%" };
  if (year < TRUSTEE_RATE_FROM_YEAR) {
    return { rate: TRUSTEE_LOW_RATE, why: "before the 2024-25 income year, trustee income was taxed at 33%" };
  }
  if (trust.disabledBeneficiaryTrust === true) return { rate: TRUSTEE_LOW_RATE, why: "a disabled beneficiary trust pays 33%" };
  if (trust.energyConsumerTrust === true) return { rate: TRUSTEE_LOW_RATE, why: "an energy consumer trust pays 33%" };
  if (trust.estateDeathYear !== undefined && year >= trust.estateDeathYear && year <= trust.estateDeathYear + 3) {
    return { rate: TRUSTEE_LOW_RATE, why: "an estate pays 33% in the year of death and the three years after" };
  }
  if (trusteeNetIncome <= LOW_RATE_LIMIT) return { rate: TRUSTEE_LOW_RATE, why: "trustee net income of $10,000 or less is taxed at 33%" };
  return { rate: TRUSTEE_RATE, why: "trustee income over $10,000 is taxed at 39%" };
}

// ---- Classifying the books ---------------------------------------------------

export type TrustIncomeClass = "notIncome" | "interest" | "dividends" | "overseas" | "residential" | "business" | "other";

export const TRUST_INCOME_CLASSES: readonly (readonly [TrustIncomeClass, string])[] = [
  ["notIncome", "Not income (capital gain, gift, money settled on the trust)"],
  ["interest", "Interest (box 9B)"],
  ["dividends", "Dividends (box 10B)"],
  ["overseas", "Income from overseas (box 13B)"],
  ["residential", "Residential rent (box 15)"],
  ["business", "Business or other rent (box 16B)"],
  ["other", "Other income (box 18B)"],
];

export function defaultTrustIncomeClass(account: Pick<Account, "name">): TrustIncomeClass {
  const name = account.name.toLowerCase();
  if (/capital|gain on|gifts?\b|settle|donation|bequest|loan|contribution|proceeds/.test(name)) return "notIncome";
  if (/interest/.test(name)) return "interest";
  if (/dividend/.test(name)) return "dividends";
  if (/overseas|foreign/.test(name)) return "overseas";
  if (/residential|house|flat|home/.test(name)) return "residential";
  if (/rent|trading|sales|farm|business/.test(name)) return "business";
  return "other";
}

export type ExpensePlacement = "q21" | "business" | "residential" | "none";

export const EXPENSE_PLACEMENTS: readonly (readonly [ExpensePlacement, string])[] = [
  ["q21", "Trustee expenses (box 21)"],
  ["business", "Against business or other rent (box 16B)"],
  ["residential", "Against residential rent (box 15E)"],
  ["none", "Not deductible"],
];

export function defaultExpensePlacement(account: Pick<Account, "name">): ExpensePlacement {
  const name = account.name.toLowerCase();
  if (/depreciation|private|personal|capital/.test(name)) return "none";
  if (/trustee|account|audit|legal|bank fee|bank charge|tax|admin|general/.test(name)) return "q21";
  if (/residential|house|flat|home/.test(name)) return "residential";
  return "business";
}

// ---- The year's inputs --------------------------------------------------------

export type SettlementKind = "cash" | "shares" | "financial" | "services" | "land" | "other";

export const SETTLEMENT_KINDS: readonly (readonly [SettlementKind, string, string])[] = [
  ["cash", "Cash", "5"],
  ["shares", "Shares or ownership interests", "6"],
  ["financial", "Financial arrangements", "7"],
  ["services", "Services", "8"],
  ["land", "Land and buildings", "9"],
  ["other", "Other", "10"],
];

export interface TrustInputs {
  /** An income account's class where it is not the default. */
  classes: Record<string, TrustIncomeClass>;
  placements: Record<string, ExpensePlacement>;
  /** The books record interest and dividends before tax was taken off, so the credits are not added to them. */
  grossBooks?: boolean | undefined;
  rwtInterest?: Cents | undefined; // 9A
  imputation?: Cents | undefined; // 10
  rwtDividends?: Cents | undefined; // 10A
  overseasTax?: Cents | undefined; // 13A
  maori?: Cents | undefined; // 11B
  maoriCredits?: Cents | undefined; // 11A
  partnership?: Cents | undefined; // 12B
  partnershipCredits?: Cents | undefined; // 12A
  ltc?: Cents | undefined; // 14E
  ltcCredits?: Cents | undefined; // 14A
  propertySales?: Cents | undefined; // 17B
  otherCredits?: Cents | undefined; // 18A
  residentialBroughtForward?: Cents | undefined; // 15F
  lossBroughtForward?: Cents | undefined; // 22A
  /** Beneficiary income allocated to each beneficiary, by id. */
  allocations: Record<string, Cents>;
  /** A beneficiary's other taxable income for the year, to find the tax on theirs. */
  otherIncome: Record<string, Cents>;
  /** Taxable distributions to beneficiaries of a non-complying trust (26K). */
  taxableDistributions: Record<string, Cents>;
  /** Each beneficiary's account: opening balance where the books can't say, and the year's movements. */
  openingBalances: Record<string, Cents>;
  distributionsTaxable: Record<string, Cents>; // 26V
  distributionsNotTaxable: Record<string, Cents>; // 26W
  withdrawals: Record<string, Cents>; // 26X
  /** Settlements made by each settlor this year, by kind. */
  settlements: Record<string, Partial<Record<SettlementKind, Cents>>>;
  /** Where an asset or liability account goes, where the name isn't enough. */
  placementsOfBalances: Record<string, BalancePlace>;
  /** Provisional tax paid for the year (28D). */
  provisionalPaid?: Cents | undefined;
}

export type BalancePlace = "associated" | "land" | "shares" | "other";

export const BALANCE_PLACES: readonly (readonly [BalancePlace, string])[] = [
  ["associated", "Loan to or from an associated person"],
  ["land", "Land and buildings"],
  ["shares", "Shares or ownership interests"],
  ["other", "Other"],
];

export function emptyTrustInputs(): TrustInputs {
  return {
    classes: {},
    placements: {},
    allocations: {},
    otherIncome: {},
    taxableDistributions: {},
    openingBalances: {},
    distributionsTaxable: {},
    distributionsNotTaxable: {},
    withdrawals: {},
    settlements: {},
    placementsOfBalances: {},
  };
}

/** Bring a stored set up to date: older versions have fewer fields. */
export function trustInputs(stored: Partial<TrustInputs> | undefined): TrustInputs {
  return { ...emptyTrustInputs(), ...(stored ?? {}) };
}

// ---- The IR6 -----------------------------------------------------------------

const floor0 = (n: number): number => Math.max(0, n);
const wholeDollars = (cents: number): number => Math.floor(Math.max(0, cents) / 100) * 100;

export interface BeneficiarySheet {
  id: string;
  name: string;
  allocation: Cents;
  rule: BeneficiaryRule;
  /** 26D to 26H: the allocation by kind of income, in the proportion the trust earned it. */
  interest: Cents;
  dividends: Cents;
  overseas: Cents;
  other: Cents;
  /** 26J: the trustee pays the tax for them. */
  trusteePays: boolean;
  taxableDistribution: Cents; // 26K
  tax: Cents; // 26L
  overseasTax: Cents; // 26M
  afterOverseas: Cents; // 26N
  imputation: Cents; // 26O
  afterImputation: Cents; // 26P
  credits: Cents; // 26Q
  nonComplyingTax: Cents; // 26S
  payable: Cents; // 26T
  /** Their account: opening, movements, closing (26U to 26Y). */
  opening: Cents;
  distributionsTaxable: Cents;
  /** True when 26V was filled in from the allocation rather than typed. */
  distributionsFromAllocation: boolean;
  distributionsNotTaxable: Cents;
  withdrawals: Cents;
  closing: Cents;
}

export interface TrustWorksheet {
  box: {
    interest: Cents; // 9B
    dividends: Cents; // 10B
    maori: Cents; // 11B
    partnership: Cents; // 12B
    overseas: Cents; // 13B
    ltc: Cents; // 14E
    residentialRent: Cents; // 15A
    residentialDeductions: Cents; // 15E
    residentialBroughtForward: Cents; // 15F
    residentialClaimed: Cents; // 15G
    residentialNet: Cents; // 15H
    residentialCarried: Cents; // 15I
    business: Cents; // 16B
    propertySales: Cents; // 17B
    other: Cents; // 18B
    totalIncome: Cents; // 19B
    credits: Cents; // 19A
    beneficiaryIncome: Cents; // 20A
    trusteeIncome: Cents; // 20B
    minorCorporate: Cents; // 20C
    expenses: Cents; // 21
    lossBroughtForward: Cents; // 22A
    lossClaimed: Cents; // 22B
    totalDistributions: Cents; // 23
    taxableDistributions: Cents; // 24
    beneficiaryTax: Cents; // 26Z
    taxableTrusteeIncome: Cents; // 27A
    trusteeTax: Cents; // 27B
    minorCorporateTax: Cents; // 27C
    totalTrusteeTax: Cents; // 27D
    overseasTaxTrustee: Cents; // 27E
    afterOverseas: Cents; // 27F
    imputationTrustee: Cents; // 27G
    afterImputation: Cents; // 27H
    creditsTrustee: Cents; // 27I
    trusteeNet: Cents; // 27J, positive is a debit (tax to pay)
    residual: Cents; // 28C, positive is tax to pay
    provisionalPaid: Cents; // 28D
    toPay: Cents; // 28E, negative is a refund
  };
  rate: number;
  rateWhy: string;
  /** The rate on minor and corporate beneficiary income (27C). */
  minorRate: number;
  /** A loss, and the credits that couldn't be used, to carry to next year. */
  lossCarriedForward: Cents;
  beneficiaries: BeneficiarySheet[];
  /** Expense totals by where they go, for the page. */
  incomeBy: Record<TrustIncomeClass, Cents>;
  problems: string[];
  /** The standard option for next year's provisional tax, where the trust is a provisional taxpayer. */
  provisionalNext: ProvisionalStandard | null;
}

/** The IR6, from the books, the trust's people and the choices made for the year. */
export function trustWorksheet(options: {
  income: readonly AccountAmount[];
  expenses: readonly AccountAmount[];
  trust: Trust;
  inputs: TrustInputs;
  /** The tax year, ending 31 March: 2026 for the year to 31 March 2026. */
  year: number;
  balanceDate: IsoDate;
  /** What each beneficiary's account held at the start and end of the year, from the books. */
  accountBalances?: Record<string, { opening: Cents; closing: Cents }> | undefined;
}): TrustWorksheet {
  const { trust, inputs, year, balanceDate } = options;
  const problems: string[] = [];

  const incomeBy: Record<TrustIncomeClass, Cents> = { notIncome: 0, interest: 0, dividends: 0, overseas: 0, residential: 0, business: 0, other: 0 };
  for (const a of options.income) {
    const cls = inputs.classes[a.code] ?? defaultTrustIncomeClass(a);
    incomeBy[cls] = (incomeBy[cls] + a.amount) as Cents;
  }
  const spent: Record<ExpensePlacement, Cents> = { q21: 0, business: 0, residential: 0, none: 0 };
  for (const a of options.expenses) {
    const where = inputs.placements[a.code] ?? defaultExpensePlacement(a);
    spent[where] = (spent[where] + a.amount) as Cents;
  }

  const n = (v: Cents | undefined): Cents => (v ?? 0) as Cents;
  const gross = inputs.grossBooks === true;
  const interest = (incomeBy.interest + (gross ? 0 : n(inputs.rwtInterest))) as Cents;
  const dividends = (incomeBy.dividends + (gross ? 0 : n(inputs.imputation) + n(inputs.rwtDividends))) as Cents;
  const overseas = (incomeBy.overseas + (gross ? 0 : n(inputs.overseasTax))) as Cents;

  // Residential rent: deductions come off up to the rent, and what is left is carried forward.
  const resAvailable = (spent.residential + n(inputs.residentialBroughtForward)) as Cents;
  const resClaimed = Math.min(resAvailable, floor0(incomeBy.residential)) as Cents;
  const resNet = (incomeBy.residential - resClaimed) as Cents;
  const resCarried = (resAvailable - resClaimed) as Cents;

  const business = (incomeBy.business - spent.business) as Cents;
  const totalIncome = (interest +
    dividends +
    n(inputs.maori) +
    n(inputs.partnership) +
    overseas +
    n(inputs.ltc) +
    resNet +
    business +
    n(inputs.propertySales) +
    incomeBy.other) as Cents;
  const credits = (n(inputs.rwtInterest) +
    n(inputs.rwtDividends) +
    n(inputs.maoriCredits) +
    n(inputs.partnershipCredits) +
    n(inputs.overseasTax) +
    n(inputs.ltcCredits) +
    n(inputs.otherCredits)) as Cents;

  // Allocation. A beneficiary's rule depends on the whole of what they were allocated.
  const available = floor0(totalIncome);
  const sheets: BeneficiarySheet[] = [];
  let ordinaryTotal = 0;
  let ruleTotal = 0;
  for (const b of trust.beneficiaries) {
    const allocation = n(inputs.allocations[b.id]);
    if (allocation <= 0 && n(inputs.distributionsTaxable[b.id]) + n(inputs.distributionsNotTaxable[b.id]) + n(inputs.withdrawals[b.id]) + n(inputs.taxableDistributions[b.id]) === 0) continue;
    // A disabled beneficiary trust is outside the minor beneficiary rule altogether.
    const found = allocation > 0 ? beneficiaryRule(b, allocation, balanceDate) : null;
    const rule = trust.disabledBeneficiaryTrust === true && found === "minor" ? null : found;
    if (allocation > 0) {
      if (rule === null) ordinaryTotal += allocation;
      else ruleTotal += allocation;
    }
    const books = options.accountBalances?.[b.id];
    const opening = (books !== undefined ? books.opening : n(inputs.openingBalances[b.id])) as Cents;
    // Box 26V is the accounting income distributed to them for the year, which
    // is what was allocated unless the trustees say otherwise.
    const typed = inputs.distributionsTaxable[b.id];
    const dt = (typed !== undefined ? n(typed) : Math.max(0, allocation)) as Cents;
    const dn = n(inputs.distributionsNotTaxable[b.id]);
    const wd = n(inputs.withdrawals[b.id]);
    sheets.push({
      id: b.id,
      name: b.name,
      allocation,
      rule,
      interest: 0,
      dividends: 0,
      overseas: 0,
      other: 0,
      trusteePays: b.trusteeDoesNotPay !== true && rule === null,
      taxableDistribution: n(inputs.taxableDistributions[b.id]),
      tax: 0,
      overseasTax: 0,
      afterOverseas: 0,
      imputation: 0,
      afterImputation: 0,
      credits: 0,
      nonComplyingTax: 0,
      payable: 0,
      opening,
      distributionsTaxable: dt,
      distributionsFromAllocation: typed === undefined && allocation > 0,
      distributionsNotTaxable: dn,
      withdrawals: wd,
      closing: (opening + dt + dn - wd) as Cents,
    });
  }
  if (ordinaryTotal + ruleTotal > available) {
    problems.push(
      "More income is allocated to beneficiaries than the trust earned. Beneficiary income can't exceed the trust's income, and a loss can't be passed to a beneficiary.",
    );
  }
  const beneficiaryIncome = ordinaryTotal as Cents;
  const minorCorporate = ruleTotal as Cents;
  const trusteeIncome = floor0(totalIncome - ordinaryTotal - ruleTotal) as Cents;

  // Beneficiaries' share of the kinds of income, credits and tax paid abroad, in proportion to what they were allocated.
  const share = (part: number, whole: number): number => (whole <= 0 ? 0 : Math.min(1, part / whole));
  const mix = {
    interest: share(interest, available),
    dividends: share(dividends, available),
    overseas: share(overseas, available),
  };
  const impCredits = n(inputs.imputation);
  const otherCredits = (credits - n(inputs.overseasTax)) as Cents;
  let beneficiaryTax = 0;
  let creditsToBeneficiaries = 0;
  let overseasToBeneficiaries = 0;
  let impToBeneficiaries = 0;
  const birthday = (b: BeneficiarySheet): TrustBeneficiary | undefined => trust.beneficiaries.find((x) => x.id === b.id);
  for (const s of sheets) {
    if (s.allocation > 0) {
      s.interest = Math.round(s.allocation * mix.interest) as Cents;
      s.dividends = Math.round(s.allocation * mix.dividends) as Cents;
      s.overseas = Math.round(s.allocation * mix.overseas) as Cents;
      s.other = (s.allocation - s.interest - s.dividends - s.overseas) as Cents;
    }
    const f = share(s.allocation, available);
    s.overseasTax = Math.round(n(inputs.overseasTax) * f) as Cents;
    s.imputation = Math.round(impCredits * f) as Cents;
    s.credits = Math.round(otherCredits * f) as Cents;
    if (s.rule !== null) {
      // Taxed on the IR6 as trustee income: the credits come off there, not here.
      s.overseasTax = 0;
      s.imputation = 0;
      s.credits = 0;
      continue;
    }
    overseasToBeneficiaries += s.overseasTax;
    impToBeneficiaries += s.imputation;
    creditsToBeneficiaries += s.credits;
    if (trust.type === "non-complying") s.nonComplyingTax = Math.round(s.taxableDistribution * NON_COMPLYING_RATE) as Cents;
    if (!s.trusteePays) {
      // The tax is theirs to pay; only the income is reported (26D to 26I, K, M, O, Q).
      continue;
    }
    const other = n(inputs.otherIncome[s.id]);
    s.tax = (individualTax((other + s.allocation) as Cents, year) - individualTax(other as Cents, year)) as Cents;
    s.afterOverseas = floor0(s.tax - s.overseasTax) as Cents;
    s.afterImputation = (s.afterOverseas - s.imputation) as Cents;
    const afterCredits = s.afterImputation - s.credits;
    s.payable = floor0(afterCredits + s.nonComplyingTax) as Cents;
    beneficiaryTax += s.payable;
    if (birthday(s) === undefined) problems.push(`${s.name} is not on the list of beneficiaries.`);
  }
  // A non-complying trust's tax on taxable distributions is the beneficiary's even if the trustee doesn't pay the rest.
  for (const s of sheets) {
    if (s.rule === null && !s.trusteePays && s.nonComplyingTax > 0) beneficiaryTax += s.nonComplyingTax;
  }

  // Trustee income.
  const expenses = spent.q21;
  const bf = n(inputs.lossBroughtForward);
  const trusteeNet = (trusteeIncome - expenses) as number;
  let lossClaimed = 0;
  let taxable = 0;
  let lossCarried = 0;
  if (totalIncome < 0) {
    lossCarried = bf + expenses - totalIncome;
  } else if (trusteeNet >= 0) {
    lossClaimed = Math.min(bf, trusteeNet);
    taxable = trusteeNet - lossClaimed;
    lossCarried = bf - lossClaimed;
  } else {
    lossCarried = bf - trusteeNet;
  }
  // The $10,000 test (a "de minimis trust", section HC 40) is on the trustee income
  // less deductible expenses. Income taxed as trustee income under the minor and
  // corporate beneficiary rules is ignored for it (Inland Revenue's special report
  // on the 39% trustee tax rate, April 2024).
  const { rate, why } = trusteeRate(trust, year, Math.max(0, trusteeIncome - expenses) as Cents);
  const trusteeTax = Math.round(taxable * rate) as Cents;
  const minorCorporateTax = Math.round(wholeDollars(minorCorporate) * minorRuleRate(year)) as Cents;
  const totalTrusteeTax = (trusteeTax + minorCorporateTax) as Cents;

  const overseasTrustee = (n(inputs.overseasTax) - overseasToBeneficiaries) as Cents;
  const afterOverseas = floor0(totalTrusteeTax - overseasTrustee) as Cents;
  const impTrustee = (impCredits - impToBeneficiaries) as Cents;
  const afterImputation = floor0(afterOverseas - impTrustee) as Cents;
  if (impTrustee > afterOverseas) {
    // Unused imputation credits can't be refunded: they become a loss to carry forward.
    lossCarried += Math.round((impTrustee - afterOverseas) / rate);
  }
  const creditsTrustee = (otherCredits - creditsToBeneficiaries) as Cents;
  const trusteeBalance = (afterImputation - creditsTrustee) as Cents; // positive: debit
  const residual = (beneficiaryTax + trusteeBalance) as Cents;
  const paid = n(inputs.provisionalPaid);
  const toPay = (residual - paid) as Cents;

  const totalDistributions = sheets.reduce((sum, s) => sum + s.distributionsTaxable + s.distributionsNotTaxable, 0) as Cents;
  const taxableDistributions = sheets.reduce((sum, s) => sum + s.taxableDistribution, 0) as Cents;

  if (trust.beneficiaries.length === 0) problems.push("No beneficiaries are set up: add them under Trust people before allocating income.");
  if (trust.type !== "complying" && taxableDistributions === 0 && sheets.some((s) => s.distributionsNotTaxable > 0)) {
    problems.push("Distributions from a foreign or non-complying trust can be taxable: say how much of each is taxable (26K).");
  }

  return {
    box: {
      interest,
      dividends,
      maori: n(inputs.maori),
      partnership: n(inputs.partnership),
      overseas,
      ltc: n(inputs.ltc),
      residentialRent: incomeBy.residential,
      residentialDeductions: spent.residential,
      residentialBroughtForward: n(inputs.residentialBroughtForward),
      residentialClaimed: resClaimed,
      residentialNet: resNet,
      residentialCarried: resCarried,
      business,
      propertySales: n(inputs.propertySales),
      other: incomeBy.other,
      totalIncome,
      credits,
      beneficiaryIncome,
      trusteeIncome,
      minorCorporate,
      expenses,
      lossBroughtForward: bf,
      lossClaimed: lossClaimed as Cents,
      totalDistributions,
      taxableDistributions,
      beneficiaryTax: beneficiaryTax as Cents,
      taxableTrusteeIncome: taxable as Cents,
      trusteeTax,
      minorCorporateTax,
      totalTrusteeTax,
      overseasTaxTrustee: overseasTrustee,
      afterOverseas,
      imputationTrustee: impTrustee,
      afterImputation,
      creditsTrustee,
      trusteeNet: trusteeBalance,
      residual,
      provisionalPaid: paid,
      toPay,
    },
    rate,
    rateWhy: why,
    minorRate: minorRuleRate(year),
    lossCarriedForward: Math.round(lossCarried) as Cents,
    beneficiaries: sheets,
    incomeBy,
    problems,
    provisionalNext: residual > PROVISIONAL_LIMIT ? provisionalStandardOption({ lastYear: residual as Cents }) : null,
  };
}

/** The IR6 as rows, labelled with what each is and the 2026 form's box. */
export function trustRows(sheet: TrustWorksheet): { label: string; box: string; amount: Cents }[] {
  const b = sheet.box;
  const rows: { label: string; box: string; amount: Cents }[] = [
    { label: "Interest (gross)", box: "9B", amount: b.interest },
    { label: "Dividends (gross)", box: "10B", amount: b.dividends },
    { label: "Taxable Māori authority distributions", box: "11B", amount: b.maori },
    { label: "Income from a partnership, estate or trust", box: "12B", amount: b.partnership },
    { label: "Income from overseas", box: "13B", amount: b.overseas },
    { label: "Look-through company income", box: "14E", amount: b.ltc },
    { label: "Residential rent, net of deductions claimed", box: "15H", amount: b.residentialNet },
    { label: "Business or other rental, net profit", box: "16B", amount: b.business },
    { label: "Taxable property sales", box: "17B", amount: b.propertySales },
    { label: "Other income", box: "18B", amount: b.other },
    { label: "Total income", box: "19B", amount: b.totalIncome },
    { label: "Total tax credits", box: "19A", amount: b.credits },
    { label: "Beneficiary income (not minor or corporate)", box: "20A", amount: b.beneficiaryIncome },
    { label: "Trustee income", box: "20B", amount: b.trusteeIncome },
    { label: "Minor and corporate beneficiary income", box: "20C", amount: b.minorCorporate },
    { label: "Expenses claimed", box: "21", amount: b.expenses },
    { label: "Losses brought forward", box: "22A", amount: b.lossBroughtForward },
    { label: "Losses claimed this year", box: "22B", amount: b.lossClaimed },
    { label: "Total distributions to beneficiaries", box: "23", amount: b.totalDistributions },
    { label: "Taxable distributions", box: "24", amount: b.taxableDistributions },
    { label: "Tax payable for beneficiaries (from the IR6Bs)", box: "26Z", amount: b.beneficiaryTax },
    { label: "Taxable trustee income", box: "27A", amount: b.taxableTrusteeIncome },
    { label: `Tax on trustee income, at ${Math.round(sheet.rate * 100)}%`, box: "27B", amount: b.trusteeTax },
    { label: `Tax on minor and corporate beneficiary income, at ${Math.round(sheet.minorRate * 100)}%`, box: "27C", amount: b.minorCorporateTax },
    { label: "Total tax on trustee income", box: "27D", amount: b.totalTrusteeTax },
    { label: "Trustee's share of overseas tax paid", box: "27E", amount: b.overseasTaxTrustee },
    { label: "After overseas tax", box: "27F", amount: b.afterOverseas },
    { label: "Trustee's share of imputation credits", box: "27G", amount: b.imputationTrustee },
    { label: "After imputation credits", box: "27H", amount: b.afterImputation },
    { label: "Trustee's share of RWT and other credits", box: "27I", amount: b.creditsTrustee },
    { label: "Tax on trustee income, after credits (negative is a credit)", box: "27J", amount: b.trusteeNet },
    { label: "Residual income tax (negative is a credit)", box: "28C", amount: b.residual },
    { label: "Provisional tax paid", box: "28D", amount: b.provisionalPaid },
    { label: "Tax to pay (negative is a refund)", box: "28E", amount: b.toPay },
  ];
  return rows;
}

/** The IR6B for each beneficiary as rows, in the form's box order. */
export function ir6bRows(s: BeneficiarySheet): { label: string; box: string; amount: Cents }[] {
  const rows: { label: string; box: string; amount: Cents }[] = [];
  if (s.allocation > 0) {
    rows.push(
      { label: "New Zealand interest", box: "26D", amount: s.interest },
      { label: "New Zealand dividends", box: "26E", amount: s.dividends },
      { label: "Income from overseas", box: "26G", amount: s.overseas },
      { label: "Other income", box: "26H", amount: s.other },
      { label: "Beneficiary income from the trust", box: "26I", amount: s.allocation },
    );
    if (s.rule === null) {
      if (s.taxableDistribution > 0) rows.push({ label: "Taxable distribution by a non-complying trust", box: "26K", amount: s.taxableDistribution });
      if (s.trusteePays) {
        rows.push(
          { label: "Tax on their taxable income", box: "26L", amount: s.tax },
          { label: "Overseas tax paid", box: "26M", amount: s.overseasTax },
          { label: "After overseas tax", box: "26N", amount: s.afterOverseas },
          { label: "Dividend imputation credits", box: "26O", amount: s.imputation },
          { label: "After imputation credits", box: "26P", amount: s.afterImputation },
          { label: "RWT and other credits", box: "26Q", amount: s.credits },
          { label: "Tax on taxable distributions (45%)", box: "26S", amount: s.nonComplyingTax },
          { label: "Tax payable", box: "26T", amount: s.payable },
        );
      }
    }
  }
  rows.push(
    { label: "Opening balance of their account", box: "26U", amount: s.opening },
    { label: "Distributions that are taxable", box: "26V", amount: s.distributionsTaxable },
    { label: "Distributions that are not taxable", box: "26W", amount: s.distributionsNotTaxable },
    { label: "Withdrawals and amounts enjoyed", box: "26X", amount: s.withdrawals },
    { label: "Closing balance of their account", box: "26Y", amount: s.closing },
  );
  return rows;
}

// ---- Disclosure: profit and loss, assets and liabilities ----------------------

export interface TrustStatements {
  profit: Cents; // 33A
  taxAdjustments: Cents; // 33B
  assets: {
    associated: Cents; // 34A
    land: Cents; // 34B
    shares: Cents; // 34D
    beneficiaryAccounts: Cents; // 34F
    other: Cents; // 34G
    total: Cents; // 34H
  };
  liabilities: {
    associated: Cents; // 35A
    beneficiaryAccounts: Cents; // 35B
    other: Cents; // 35C
    total: Cents; // 35D
  };
  accumulated: Cents; // 36A
  untaxedGains: Cents; // 37A
  withdrawn: Cents; // 37B
}

export function defaultBalancePlace(account: Pick<Account, "name">): BalancePlace {
  const name = account.name.toLowerCase();
  if (/associated|related|family|loan (to|from)|shareholder|beneficiar/.test(name)) return "associated";
  if (/land|building|property|house|home|flat|farm/.test(name)) return "land";
  if (/share|unit trust|investment in|partnership|ownership/.test(name)) return "shares";
  return "other";
}

/** The disclosure statements: from the books at the end of the year. */
export function trustStatements(options: {
  journals: readonly PostedJournal[];
  chart: readonly Account[];
  trust: Trust;
  inputs: TrustInputs;
  from: IsoDate;
  to: IsoDate;
  sheet: TrustWorksheet;
  only?: ((account: Account) => boolean) | undefined;
}): TrustStatements {
  const { chart, trust, inputs } = options;
  const balance = new Map<string, number>();
  for (const j of options.journals) {
    if (j.date > options.to) continue;
    for (const l of j.lines) balance.set(l.accountCode.trim(), (balance.get(l.accountCode.trim()) ?? 0) + l.amount);
  }
  const linked = new Map<string, string>();
  for (const b of trust.beneficiaries) if (b.accountCode !== undefined && b.accountCode !== "") linked.set(b.accountCode.trim(), b.id);

  const a = { associated: 0, land: 0, shares: 0, other: 0 };
  const l = { associated: 0, other: 0 };
  let beneficiaryNet = 0; // positive: the trust owes the beneficiaries
  for (const account of chart) {
    if (options.only !== undefined && !options.only(account)) continue;
    // A bank account's lines are posted under its ledger account id, not a code.
    const code = (account.ledgerAccount ?? "").trim() || account.code.trim();
    if (code === "") continue;
    const sum = balance.get(code) ?? 0;
    if (sum === 0) continue;
    if (linked.has(code)) {
      beneficiaryNet += -sum;
      continue;
    }
    const type = account.type.toLowerCase();
    const place = inputs.placementsOfBalances[code] ?? defaultBalancePlace(account);
    if (/liabilit|payable/.test(type)) {
      if (place === "associated") l.associated += -sum;
      else l.other += -sum;
    } else if (/asset|bank|receivable|inventory|prepay/.test(type)) {
      if (place === "associated") a.associated += sum;
      else if (place === "land") a.land += sum;
      else if (place === "shares") a.shares += sum;
      else a.other += sum;
    }
  }
  const benAsset = beneficiaryNet < 0 ? -beneficiaryNet : 0;
  const benLiability = beneficiaryNet > 0 ? beneficiaryNet : 0;
  const assetsTotal = a.associated + a.land + a.shares + benAsset + a.other;
  const liabilitiesTotal = l.associated + benLiability + l.other;

  const { income, expenses } = incomeAndExpenses({
    journals: options.journals,
    chart,
    from: options.from,
    to: options.to,
    only: options.only,
  });
  const profit = income.reduce((s, x) => s + x.amount, 0) - expenses.reduce((s, x) => s + x.amount, 0);
  let gains = 0;
  for (const x of income) if ((inputs.classes[x.code] ?? defaultTrustIncomeClass(x)) === "notIncome") gains += x.amount;
  const withdrawn = options.sheet.beneficiaries.reduce((s, x) => s + x.withdrawals, 0);

  return {
    profit: profit as Cents,
    taxAdjustments: (options.sheet.box.totalIncome - profit) as Cents,
    assets: {
      associated: a.associated as Cents,
      land: a.land as Cents,
      shares: a.shares as Cents,
      beneficiaryAccounts: benAsset as Cents,
      other: a.other as Cents,
      total: assetsTotal as Cents,
    },
    liabilities: {
      associated: l.associated as Cents,
      beneficiaryAccounts: benLiability as Cents,
      other: l.other as Cents,
      total: liabilitiesTotal as Cents,
    },
    accumulated: (assetsTotal - liabilitiesTotal) as Cents,
    untaxedGains: gains as Cents,
    withdrawn: withdrawn as Cents,
  };
}

export function trustStatementRows(s: TrustStatements): { label: string; box: string; amount: Cents }[] {
  return [
    { label: "Net profit or loss before tax", box: "33A", amount: s.profit },
    { label: "Tax adjustments", box: "33B", amount: s.taxAdjustments },
    { label: "Loans to associated persons", box: "34A", amount: s.assets.associated },
    { label: "Land and buildings", box: "34B", amount: s.assets.land },
    { label: "Shares and ownership interests", box: "34D", amount: s.assets.shares },
    { label: "Beneficiary current accounts (owed to the trust)", box: "34F", amount: s.assets.beneficiaryAccounts },
    { label: "Other assets", box: "34G", amount: s.assets.other },
    { label: "Total assets", box: "34H", amount: s.assets.total },
    { label: "Loans from associated persons", box: "35A", amount: s.liabilities.associated },
    { label: "Beneficiary current accounts (owed to beneficiaries)", box: "35B", amount: s.liabilities.beneficiaryAccounts },
    { label: "Other liabilities", box: "35C", amount: s.liabilities.other },
    { label: "Total liabilities", box: "35D", amount: s.liabilities.total },
    { label: "Accumulated trust funds", box: "36A", amount: s.accumulated },
    { label: "Untaxed gains", box: "37A", amount: s.untaxedGains },
    { label: "Amounts withdrawn by beneficiaries", box: "37B", amount: s.withdrawn },
  ];
}

// ---- What the trust has to tell Inland Revenue and when ------------------------

/** What this trust files, in plain words: a line each, for its settings. */
export function trustReporting(trust: Trust): string[] {
  const out: string[] = [
    "An income tax return (IR6) every year, due 7 July for a 31 March balance date (later with a tax agent), with the beneficiaries' details on an IR6B for each. " +
      "A trust that has no income and no distributions can say so in the first questions and answer nothing more.",
  ];
  if (trust.registered !== true) {
    out.push("A new trust registers with Inland Revenue: an IR596 and a copy of the trust deed.");
  }
  if (trust.disclosureExempt !== true) {
    out.push(
      "The trust disclosure rules apply: with the return, a profit and loss summary, assets and liabilities, the settlors (IR6S), anybody who can appoint or remove trustees or beneficiaries (IR6P), " +
        "and each beneficiary's distributions and account (IR6B). Non-cash settlements or distributions under $100,000 per person in a year need not be disclosed.",
    );
  }
  if (trust.estateDeathYear !== undefined) {
    out.push("An estate pays 33% on trustee income in the year of death and the three after; if it isn't wound up by then, 39%.");
  }
  return out;
}

/** Things worth saying about the trust's details. Advice, never a refusal. */
export function trustNotes(trust: Trust): string[] {
  const notes: string[] = [];
  if (trust.type === "non-complying") {
    notes.push("A distribution to a beneficiary from a non-complying trust, other than beneficiary income and the trust's corpus, is taxed at 45 cents in the dollar.");
  }
  if (trust.type === "foreign") {
    notes.push("Distributions from a foreign trust are taxable to a New Zealand resident beneficiary except corpus and capital gains. A trust whose settlors are all non-resident has its own rules; check with Inland Revenue.");
  }
  if (trust.settlors.length === 0 && trust.disclosureExempt !== true) {
    notes.push("The disclosure rules ask for everyone who has ever settled value on the trust, even if nothing was settled this year. Add them under Trust people.");
  }
  if (trust.irdNumber === undefined || trust.irdNumber.trim() === "") notes.push("The trust's IRD number isn't entered.");
  const noId = [...trust.beneficiaries, ...trust.settlors, ...trust.appointers].filter(
    (p) => (p.irdNumber ?? "").trim() === "" && (p.tin ?? "").trim() === "",
  );
  if (noId.length > 0 && trust.disclosureExempt !== true) {
    notes.push(
      `${noId.length === 1 ? "One person has" : `${noId.length} people have`} no IRD number or tax identification number: the return asks for it, ` +
        "and a minor with no income can be marked 'not required'.",
    );
  }
  return notes;
}

/** A person's IRD number or TIN, or what to put when they have none. */
export function personId(p: TrustPerson): string {
  const ird = (p.irdNumber ?? "").trim();
  if (ird !== "") return ird;
  const tin = (p.tin ?? "").trim();
  return tin !== "" ? tin : "";
}

export function trustYearEnd(year: number): IsoDate {
  return `${year}-03-31`;
}

// ---- The trustees' allocation, as a journal ---------------------------------------

export interface AllocationJournal {
  /** One journal a year: posting again replaces it. */
  id: string;
  journal: ManualJournal | null;
  /** Why there is none, or what to look at, in words. */
  problems: string[];
}

/**
 * The entry that records the trustees' allocation in the books: the income
 * allocated comes out of the trust's own funds and into each beneficiary's
 * current account, on balance date. The accountant's year-end journal for a
 * trust; what is later paid out is a bank line against the account.
 *
 * `debit` and each beneficiary's account are written as the books write them
 * (`Name - code`). A beneficiary with no account linked is a problem, not a
 * silent omission: the journal would not match the return.
 */
export function allocationJournal(options: {
  entityId: string;
  year: number;
  date: IsoDate;
  debit: string;
  sheet: TrustWorksheet;
  trust: Trust;
  /** An account's label from its code, as the books write it. */
  label: (code: string) => string;
}): AllocationJournal {
  const id = `trust-allocation-${options.entityId}-${options.year}`;
  const problems: string[] = [];
  const credits: { code: string; amount: Cents; description: string }[] = [];
  for (const b of options.sheet.beneficiaries) {
    if (b.allocation <= 0) continue;
    const person = options.trust.beneficiaries.find((x) => x.id === b.id);
    const code = (person?.accountCode ?? "").trim();
    if (code === "") {
      problems.push(`${b.name} has no account in the books: link one on Trust people.`);
      continue;
    }
    credits.push({ code: options.label(code), amount: b.allocation, description: `Income allocated to ${b.name}` });
  }
  const total = credits.reduce((s, c) => s + c.amount, 0);
  if (options.debit.trim() === "") problems.push("Choose the account the allocation comes out of.");
  if (total === 0 && problems.length === 0) problems.push("Nothing is allocated to any beneficiary this year.");
  if (problems.length > 0) return { id, journal: null, problems };
  return {
    id,
    problems,
    journal: {
      id,
      date: options.date,
      narration: `Income allocated to beneficiaries, year ended ${options.date}`,
      lines: [{ code: options.debit, amount: total as Cents }, ...credits.map((c) => ({ code: c.code, amount: -c.amount as Cents, description: c.description }))],
    },
  };
}
