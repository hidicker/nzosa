import type { Cents } from "./money.js";
import type { Account } from "./chart.js";
import type { AccountAmount } from "./ir9.js";

/**
 * The IR7: the income tax return of a partnership or a look-through company
 * (LTC).
 *
 * Built from Inland Revenue's IR7 return for the year to 31 March 2026 and its
 * 2026 Partnership and LTC return guide (IR7G), read in October 2026. Box
 * numbers are that form's; Inland Revenue changes them from year to year, so
 * the worksheet says what each figure is first. Check each year's form before
 * filing.
 *
 * What the guide says, and what is done here:
 *
 * - The partnership or LTC is not itself taxed. Its income, losses and tax
 *   credits are attributed to the partners or owners in proportion to their
 *   share of the partnership, or their effective look-through interest in the
 *   LTC (generally their percentage of the shares), and each puts their share
 *   in their own return.
 * - The IR7 totals the income by source (questions 10 to 21), takes off the
 *   expenses not already claimed (question 23) and gets the income after
 *   expenses (question 24). The attribution pages (IR7P or IR7L) must add up
 *   to that figure, so each figure is shared by whole cents with no cent lost.
 * - Residential property deductions are not set against residential income
 *   here: the ring-fencing rules are applied by each partner or owner, who may
 *   have other residential income and deductions. They are attributed on their
 *   own (box 26M).
 * - Losses extinguished on transition from a qualifying company or loss
 *   attributing qualifying company can be deducted, up to the share of income:
 *   the guide's worksheet is built in.
 * - The loss limitation rule for LTC owners no longer applies, except to an
 *   LTC in a partnership or joint venture with another LTC. That is not
 *   worked out here: it needs the owner's basis, which only the owner has.
 * - Also from Inland Revenue's IR879 (April 2024): an LTC keeps no imputation
 *   credit account, working owners are paid with PAYE and all owners deduct
 *   their share, and an owner's share for a part year is weighted by days.
 *
 * Not worked out here: the loss limitation rule, foreign investment fund and
 * controlled foreign company income (entered as a figure), the attribution
 * rule for personal services, and income that is attributed differently by
 * kind (a partnership agreement that shares one kind of income differently
 * from another).
 */

export type Ir7Kind = "partnership" | "ltc";

export interface Ir7Holder {
  id: string;
  name: string;
  /** Percentage share, 0 to 100. */
  percent: number;
  irdNumber?: string | undefined;
}

export type Ir7IncomeClass =
  | "notIncome"
  | "schedular"
  | "interest"
  | "dividends"
  | "overseas"
  | "business"
  | "residential"
  | "rental"
  | "property"
  | "other";

export const IR7_INCOME_CLASSES: readonly (readonly [Ir7IncomeClass, string])[] = [
  ["notIncome", "Not income (capital put in, loans, GST)"],
  ["schedular", "Schedular payments (box 10B)"],
  ["interest", "Interest (box 11B)"],
  ["dividends", "Dividends (box 12B)"],
  ["overseas", "Income from overseas (box 16B)"],
  ["business", "Business income (box 17B)"],
  ["residential", "Residential rent (box 18B)"],
  ["rental", "Other rental income (box 19B)"],
  ["property", "Taxable property sales (box 20B)"],
  ["other", "Other income (box 21B)"],
];

export function defaultIr7IncomeClass(account: Pick<Account, "name">): Ir7IncomeClass {
  const name = account.name.toLowerCase();
  if (/capital|loan|contribution|drawing|gst/.test(name)) return "notIncome";
  if (/schedular/.test(name)) return "schedular";
  if (/interest/.test(name)) return "interest";
  if (/dividend/.test(name)) return "dividends";
  if (/overseas|foreign/.test(name)) return "overseas";
  if (/residential|house|flat|home/.test(name)) return "residential";
  if (/rent/.test(name)) return "rental";
  if (/sale of (land|property)|bright/.test(name)) return "property";
  if (/other income|sundry|insurance|refund/.test(name)) return "other";
  return "business";
}

export type Ir7ExpensePlacement = "business" | "rental" | "residential" | "general" | "none";

export const IR7_EXPENSE_PLACEMENTS: readonly (readonly [Ir7ExpensePlacement, string])[] = [
  ["business", "Against business income (box 17B)"],
  ["rental", "Against other rental income (box 19B)"],
  ["residential", "Residential rental deductions (box 18F)"],
  ["general", "Not claimed elsewhere (box 23)"],
  ["none", "Not deductible"],
];

export function defaultIr7ExpensePlacement(account: Pick<Account, "name">): Ir7ExpensePlacement {
  const name = account.name.toLowerCase();
  if (/depreciation recovered/.test(name)) return "none";
  if (/drawing|private|personal|capital|partner'?s? (salary|wage)/.test(name)) return "none";
  if (/return preparation|bank fee|bank charge|interest paid to inland|use of money/.test(name)) return "general";
  if (/residential/.test(name)) return "residential";
  return "business";
}

export interface Ir7Inputs {
  classes: Record<string, Ir7IncomeClass>;
  placements: Record<string, Ir7ExpensePlacement>;
  /** The books show interest and dividends before tax: the credits are in them already. */
  grossBooks?: boolean | undefined;
  schedularTax?: Cents | undefined; // 10A
  rwtInterest?: Cents | undefined; // 11A
  imputation?: Cents | undefined; // 12
  rwtDividends?: Cents | undefined; // 12A
  maori?: Cents | undefined; // 13B
  maoriCredits?: Cents | undefined; // 13A
  partnership?: Cents | undefined; // 14B
  partnershipCredits?: Cents | undefined; // 14A
  ltc?: Cents | undefined; // 15E, adjusted
  ltcCredits?: Cents | undefined; // 15A
  overseasTax?: Cents | undefined; // 16A
  brightLine?: Cents | undefined; // 18C
  otherResidential?: Cents | undefined; // 18D
  propertySales?: Cents | undefined; // 20B
  rlwt?: Cents | undefined; // 20A
  /** Losses extinguished on transition from a QC or LAQC, and deductions claimed for them before. */
  extinguished?: Cents | undefined;
  extinguishedClaimed?: Cents | undefined;
}

export function emptyIr7Inputs(): Ir7Inputs {
  return { classes: {}, placements: {} };
}

export function ir7Inputs(stored: Partial<Ir7Inputs> | undefined): Ir7Inputs {
  return { ...emptyIr7Inputs(), ...(stored ?? {}) };
}

/** Share an amount in cents between holders by their percentages, so the parts add up to it exactly. */
export function splitByShare(amount: number, percents: readonly number[]): number[] {
  const total = percents.reduce((s, p) => s + p, 0);
  if (percents.length === 0 || total <= 0) return percents.map(() => 0);
  const exact = percents.map((p) => (amount * p) / total);
  const parts = exact.map((x) => Math.trunc(x));
  let left = amount - parts.reduce((s, x) => s + x, 0);
  const order = exact
    .map((x, i) => ({ i, rest: Math.abs(x - Math.trunc(x)) }))
    .sort((a, b) => b.rest - a.rest || a.i - b.i);
  const step = left >= 0 ? 1 : -1;
  for (let k = 0; left !== 0 && order.length > 0; k = (k + 1) % order.length) {
    const slot = order[k];
    if (slot === undefined) break;
    parts[slot.i] = (parts[slot.i] ?? 0) + step;
    left -= step;
  }
  return parts;
}

export interface Ir7Attribution {
  id: string;
  name: string;
  percent: number;
  irdNumber: string;
  interest: Cents; // 26C
  dividends: Cents; // 26D
  maori: Cents; // 26E
  overseas: Cents; // 26F
  residential: Cents; // 26G
  rental: Cents; // 26H
  passive: Cents; // 26I
  other: Cents; // 26J
  total: Cents; // 26K
  extinguished: Cents; // 26L
  residentialDeductions: Cents; // 26M
  overseasTax: Cents; // 26N
  imputation: Cents; // 26O
  otherCredits: Cents; // 26P
}

export interface Ir7Worksheet {
  box: {
    schedular: Cents; // 10B
    schedularTax: Cents; // 10A
    interest: Cents; // 11B
    rwtInterest: Cents; // 11A
    dividends: Cents; // 12B
    imputation: Cents; // 12
    rwtDividends: Cents; // 12A
    maori: Cents; // 13B
    maoriCredits: Cents; // 13A
    partnership: Cents; // 14B
    partnershipCredits: Cents; // 14A
    ltc: Cents; // 15E
    ltcCredits: Cents; // 15A
    overseas: Cents; // 16B
    overseasTax: Cents; // 16A
    business: Cents; // 17B
    residentialRent: Cents; // 18B
    brightLine: Cents; // 18C
    otherResidential: Cents; // 18D
    residentialIncome: Cents; // 18E
    residentialDeductions: Cents; // 18F
    rental: Cents; // 19B
    rlwt: Cents; // 20A
    propertySales: Cents; // 20B
    other: Cents; // 21B
    totalIncome: Cents; // 22
    expenses: Cents; // 23
    afterExpenses: Cents; // 24
    extinguished: Cents; // 25
    extinguishedClaimed: Cents; // 25A
    extinguishedDeduction: Cents; // 25B
  };
  attributions: Ir7Attribution[];
  incomeBy: Record<Ir7IncomeClass, Cents>;
  problems: string[];
  /** True when there is nothing to declare, and a nil return will do. */
  nil: boolean;
}

/** The IR7 and its attribution page, from the books, the holders' shares and the year's choices. */
export function ir7Worksheet(options: {
  income: readonly AccountAmount[];
  expenses: readonly AccountAmount[];
  holders: readonly Ir7Holder[];
  inputs: Ir7Inputs;
  kind: Ir7Kind;
}): Ir7Worksheet {
  const { inputs, holders } = options;
  const n = (v: Cents | undefined): Cents => (v ?? 0) as Cents;
  const incomeBy: Record<Ir7IncomeClass, Cents> = {
    notIncome: 0, schedular: 0, interest: 0, dividends: 0, overseas: 0, business: 0, residential: 0, rental: 0, property: 0, other: 0,
  };
  for (const a of options.income) {
    const cls = inputs.classes[a.code] ?? defaultIr7IncomeClass(a);
    incomeBy[cls] = (incomeBy[cls] + a.amount) as Cents;
  }
  const spent: Record<Ir7ExpensePlacement, Cents> = { business: 0, rental: 0, residential: 0, general: 0, none: 0 };
  for (const a of options.expenses) {
    const where = inputs.placements[a.code] ?? defaultIr7ExpensePlacement(a);
    spent[where] = (spent[where] + a.amount) as Cents;
  }

  const gross = inputs.grossBooks === true;
  const schedular = (incomeBy.schedular + (gross ? 0 : n(inputs.schedularTax))) as Cents;
  const interest = (incomeBy.interest + (gross ? 0 : n(inputs.rwtInterest))) as Cents;
  const dividends = (incomeBy.dividends + (gross ? 0 : n(inputs.imputation) + n(inputs.rwtDividends))) as Cents;
  const overseas = (incomeBy.overseas + (gross ? 0 : n(inputs.overseasTax))) as Cents;
  const business = (incomeBy.business - spent.business) as Cents;
  const residentialIncome = (incomeBy.residential + n(inputs.brightLine) + n(inputs.otherResidential)) as Cents;
  const rental = (incomeBy.rental - spent.rental) as Cents;
  const totalIncome = (schedular +
    interest +
    dividends +
    n(inputs.maori) +
    n(inputs.partnership) +
    n(inputs.ltc) +
    overseas +
    business +
    residentialIncome +
    rental +
    n(inputs.propertySales) +
    incomeBy.other) as Cents;
  const expenses = spent.general;
  const afterExpenses = (totalIncome - expenses) as Cents;

  const credits = {
    overseasTax: n(inputs.overseasTax),
    imputation: n(inputs.imputation),
    other:
      n(inputs.schedularTax) + n(inputs.rwtInterest) + n(inputs.rwtDividends) + n(inputs.maoriCredits) + n(inputs.partnershipCredits) + n(inputs.ltcCredits) + n(inputs.rlwt),
  };

  const percents = holders.map((h) => h.percent);
  const share = (amount: number): number[] => splitByShare(amount, percents);
  const parts = {
    interest: share(interest),
    dividends: share(dividends),
    maori: share(n(inputs.maori)),
    overseas: share(overseas),
    residential: share(residentialIncome),
    rental: share(rental),
    passive: share(n(inputs.propertySales) + incomeBy.other),
    other: share(schedular + n(inputs.partnership) + n(inputs.ltc) + business - expenses),
    resDeductions: share(spent.residential),
    overseasTax: share(credits.overseasTax),
    imputation: share(credits.imputation),
    other2: share(credits.other),
  };
  const attributions: Ir7Attribution[] = holders.map((h, i) => {
    const get = (a: number[]): Cents => (a[i] ?? 0) as Cents;
    const interestP = get(parts.interest);
    const dividendsP = get(parts.dividends);
    const maoriP = get(parts.maori);
    const overseasP = get(parts.overseas);
    const residentialP = get(parts.residential);
    const rentalP = get(parts.rental);
    const passiveP = get(parts.passive);
    const otherP = get(parts.other);
    return {
      id: h.id,
      name: h.name,
      percent: h.percent,
      irdNumber: (h.irdNumber ?? "").trim(),
      interest: interestP,
      dividends: dividendsP,
      maori: maoriP,
      overseas: overseasP,
      residential: residentialP,
      rental: rentalP,
      passive: passiveP,
      other: otherP,
      total: (interestP + dividendsP + maoriP + overseasP + residentialP + rentalP + passiveP + otherP) as Cents,
      extinguished: 0,
      residentialDeductions: get(parts.resDeductions),
      overseasTax: get(parts.overseasTax),
      imputation: get(parts.imputation),
      otherCredits: get(parts.other2),
    };
  });

  // Losses extinguished on transition from a QC or LAQC: (balance - earlier deductions) x share, at most the share of income.
  const remaining = floor0(n(inputs.extinguished) - n(inputs.extinguishedClaimed));
  let deduction = 0;
  if (remaining > 0) {
    for (const a of attributions) {
      const cap = floor0(a.total);
      const byShare = Math.round((remaining * a.percent) / 100);
      a.extinguished = Math.min(cap, byShare) as Cents;
      deduction += a.extinguished;
    }
  }

  const problems: string[] = [];
  const total = holders.reduce((s, h) => s + h.percent, 0);
  const who = options.kind === "ltc" ? "owners" : "partners";
  if (holders.length === 0) problems.push(`No ${who} are set up: add them under Entities & accounts, in the entity's settings, so the income can be attributed.`);
  else if (Math.abs(total - 100) > 0.005) problems.push(`The ${who}' shares add up to ${Math.round(total * 100) / 100}%, not 100%. All income, losses and credits must be attributed.`);
  for (const h of holders) if ((h.irdNumber ?? "").trim() === "") problems.push(`${h.name} has no IRD number: the attribution page asks for it.`);
  const sum = attributions.reduce((s, a) => s + a.total, 0);
  if (holders.length > 0 && Math.abs(total - 100) <= 0.005 && sum !== afterExpenses) {
    problems.push("The attributions do not add up to the income after expenses. This is a fault: please report it.");
  }
  const nil =
    totalIncome === 0 &&
    spent.business + spent.rental + spent.residential + spent.general === 0 &&
    n(inputs.extinguished) === 0;

  return {
    box: {
      schedular,
      schedularTax: n(inputs.schedularTax),
      interest,
      rwtInterest: n(inputs.rwtInterest),
      dividends,
      imputation: n(inputs.imputation),
      rwtDividends: n(inputs.rwtDividends),
      maori: n(inputs.maori),
      maoriCredits: n(inputs.maoriCredits),
      partnership: n(inputs.partnership),
      partnershipCredits: n(inputs.partnershipCredits),
      ltc: n(inputs.ltc),
      ltcCredits: n(inputs.ltcCredits),
      overseas,
      overseasTax: n(inputs.overseasTax),
      business,
      residentialRent: incomeBy.residential,
      brightLine: n(inputs.brightLine),
      otherResidential: n(inputs.otherResidential),
      residentialIncome,
      residentialDeductions: spent.residential,
      rental,
      rlwt: n(inputs.rlwt),
      propertySales: n(inputs.propertySales),
      other: incomeBy.other,
      totalIncome,
      expenses,
      afterExpenses,
      extinguished: n(inputs.extinguished),
      extinguishedClaimed: n(inputs.extinguishedClaimed),
      extinguishedDeduction: deduction as Cents,
    },
    attributions,
    incomeBy,
    problems,
    nil,
  };
}

const floor0 = (n: number): number => Math.max(0, n);

/** The IR7 as rows: what each is, and the 2026 form's box. */
export function ir7Rows(sheet: Ir7Worksheet): { label: string; box: string; amount: Cents }[] {
  const b = sheet.box;
  return [
    { label: "Schedular payments (gross)", box: "10B", amount: b.schedular },
    { label: "Tax deducted from schedular payments", box: "10A", amount: b.schedularTax },
    { label: "Interest (gross)", box: "11B", amount: b.interest },
    { label: "RWT on interest", box: "11A", amount: b.rwtInterest },
    { label: "Dividends (gross)", box: "12B", amount: b.dividends },
    { label: "Dividend imputation credits", box: "12", amount: b.imputation },
    { label: "Dividend RWT credits", box: "12A", amount: b.rwtDividends },
    { label: "Taxable Māori authority distributions", box: "13B", amount: b.maori },
    { label: "Māori authority credits", box: "13A", amount: b.maoriCredits },
    { label: "Income from another partnership", box: "14B", amount: b.partnership },
    { label: "Partnership tax credits", box: "14A", amount: b.partnershipCredits },
    { label: "Income from another LTC (adjusted)", box: "15E", amount: b.ltc },
    { label: "LTC tax credits", box: "15A", amount: b.ltcCredits },
    { label: "Income from overseas", box: "16B", amount: b.overseas },
    { label: "Overseas tax paid", box: "16A", amount: b.overseasTax },
    { label: "Net income from business activities", box: "17B", amount: b.business },
    { label: "Gross residential rental income", box: "18B", amount: b.residentialRent },
    { label: "Net bright-line profit", box: "18C", amount: b.brightLine },
    { label: "Other residential income", box: "18D", amount: b.otherResidential },
    { label: "Total combined residential income", box: "18E", amount: b.residentialIncome },
    { label: "Residential rental deductions", box: "18F", amount: b.residentialDeductions },
    { label: "Net income from other rental activities", box: "19B", amount: b.rental },
    { label: "Residential land withholding tax credit", box: "20A", amount: b.rlwt },
    { label: "Profit or loss from taxable property sales", box: "20B", amount: b.propertySales },
    { label: "Other income", box: "21B", amount: b.other },
    { label: "Total income", box: "22", amount: b.totalIncome },
    { label: "Expenses not claimed elsewhere", box: "23", amount: b.expenses },
    { label: "Total income after expenses (attributed to the holders)", box: "24", amount: b.afterExpenses },
    { label: "Losses extinguished on transition", box: "25", amount: b.extinguished },
    { label: "Deductions for them claimed in earlier years", box: "25A", amount: b.extinguishedClaimed },
    { label: "Deductions claimed this year", box: "25B", amount: b.extinguishedDeduction },
  ];
}

/** One holder's attribution page as rows (IR7P or IR7L). */
export function ir7AttributionRows(a: Ir7Attribution): { label: string; box: string; amount: Cents }[] {
  return [
    { label: "Interest", box: "26C", amount: a.interest },
    { label: "Dividends", box: "26D", amount: a.dividends },
    { label: "Māori authority distributions", box: "26E", amount: a.maori },
    { label: "Overseas income", box: "26F", amount: a.overseas },
    { label: "Residential income", box: "26G", amount: a.residential },
    { label: "Other rental income", box: "26H", amount: a.rental },
    { label: "Other passive income", box: "26I", amount: a.passive },
    { label: "All other income and expenses", box: "26J", amount: a.other },
    { label: "Total income", box: "26K", amount: a.total },
    { label: "Deduction for extinguished losses", box: "26L", amount: a.extinguished },
    { label: "Residential rental deductions", box: "26M", amount: a.residentialDeductions },
    { label: "Overseas tax paid", box: "26N", amount: a.overseasTax },
    { label: "Imputation credits", box: "26O", amount: a.imputation },
    { label: "Other tax credits", box: "26P", amount: a.otherCredits },
  ];
}

export function ir7Notes(kind: Ir7Kind): string[] {
  const common = [
    "The return is due 7 July for a 31 March balance date, later with a tax agent. Attach the accounts or an IR10, and the IR7P or IR7L for every partner or owner.",
    "Each partner or owner puts their share of the income, and of the credits, in their own return.",
  ];
  return kind === "ltc"
    ? [
        ...common,
        "An LTC's owners share by their effective look-through interest, generally their percentage of the shares. The loss limitation rule no longer applies to most owners; it still does where the LTC is in a partnership or joint venture with another LTC, and that is not worked out here.",
        "An LTC is still a company: it files this return and keeps its accounts, but pays no income tax itself. It keeps no imputation credit account: imputation credits it receives pass through to the owners, and its dividends are not taxable.",
        "An owner who works for the LTC under an employment contract is paid wages with PAYE, and every owner deducts their share of those wages. An LTC cannot pay a shareholder-employee salary without PAYE.",
        "If ownership changed part-way through the year, each owner's share is their percentage weighted by the days they held it (IR879). Shares here are for the whole year, so work out the weighted shares first and enter those.",
      ]
    : [
        ...common,
        "A partner's drawings and any salary a partner is paid are not expenses of the partnership. Each partner's share is taxed whether or not it was taken out.",
      ];
}
