import type { Cents } from "./money.js";
import type { IsoDate } from "./dates.js";
import type { Account } from "./chart.js";
import type { PostedJournal } from "./posting.js";

/**
 * The IR9: the income tax return of a club or society.
 *
 * Built from Inland Revenue's IR9 return for the year to 31 March 2026 and its
 * 2025 return guide, read in October 2026. The box numbers are the 2026 form's;
 * Inland Revenue renumbers them from year to year, so the worksheet names
 * what each figure is first and the box only as a help. Check each year's form
 * before filing.
 *
 * What the guide says, and what is done here:
 *
 * - Every club and society files, unless all its income is exempt. An amateur
 *   sports club, racing club, charitable society, district improvement
 *   society and a few others have exempt income unless any of their funds can
 *   be used for the private benefit of members (question 13).
 * - Everybody else works out net income from revenue sources only: interest,
 *   dividends, rents, sponsorship and admission fees, advertising, and trading
 *   -- less the costs of earning it. "Any membership subscriptions or levies
 *   are not income for tax purposes." Trading with its own members can be
 *   taxable, and a gift is not income.
 * - A non-profit body Inland Revenue has approved can deduct the smaller of
 *   its total income and $1,000, unless it is one of the exempt kinds.
 * - A society registered under the Incorporated Societies Act, and friendly
 *   and building societies, can deduct donations to donee organisations, up
 *   to its income after expenses.
 * - Losses brought forward come off next; what is left is taxable income.
 * - An incorporated body pays 28 cents in the dollar. An unincorporated one
 *   is assessed at individual rates, which change year to year and are not
 *   worked out here.
 *
 * Nothing here decides what a payment was -- that is a judgement about the
 * organisation, and the worksheet shows each choice and lets it be changed.
 * Residential rental property (question 10) and provisional tax are not
 * worked out here.
 */

export type Ir9Class = "notIncome" | "interest" | "dividends" | "other";

export const IR9_CLASSES: readonly (readonly [Ir9Class, string])[] = [
  ["notIncome", "Not income (subscriptions, levies, gifts)"],
  ["interest", "Interest"],
  ["dividends", "Dividends"],
  ["other", "Other taxable income"],
];

/** What an income account usually is, from its name. Every one can be changed. */
export function defaultIr9Class(account: Pick<Account, "name">): Ir9Class {
  const name = account.name.toLowerCase();
  if (/interest/.test(name)) return "interest";
  if (/dividend/.test(name)) return "dividends";
  if (/subscription|membership|levy|levies|donation|bequest|koha|gift|grant/.test(name)) return "notIncome";
  return "other";
}

export interface AccountAmount {
  code: string;
  name: string;
  /** Income, as a positive amount for money earned; expense, as a positive amount for money spent. */
  amount: Cents;
}

/** The year's income and expense accounts, from every posting in it. */
export function incomeAndExpenses(options: {
  journals: readonly PostedJournal[];
  chart: readonly Account[];
  from: IsoDate;
  to: IsoDate;
  /** Only these accounts, where the books are shared with other organisations. */
  only?: ((account: Account) => boolean) | undefined;
}): { income: AccountAmount[]; expenses: AccountAmount[] } {
  const totals = new Map<string, number>();
  for (const j of options.journals) {
    if (j.date < options.from || j.date > options.to) continue;
    for (const l of j.lines) totals.set(l.accountCode.trim(), (totals.get(l.accountCode.trim()) ?? 0) + l.amount);
  }
  const income: AccountAmount[] = [];
  const expenses: AccountAmount[] = [];
  for (const account of options.chart) {
    const code = account.code.trim();
    const sum = totals.get(code);
    if (code === "" || sum === undefined || sum === 0) continue;
    if (options.only !== undefined && !options.only(account)) continue;
    const type = account.type.toLowerCase();
    if (/revenue|other income|sales/.test(type) && !/expense/.test(type)) income.push({ code, name: account.name, amount: -sum as Cents });
    else if (/expense|overhead|direct cost|depreciation/.test(type)) expenses.push({ code, name: account.name, amount: sum as Cents });
  }
  return { income, expenses };
}

export interface Ir9Inputs {
  /** An income account's class where it is not the default. */
  classes: Record<string, Ir9Class>;
  /** The share of an expense account, 0 to 100, that went on earning taxable income. */
  shares: Record<string, number>;
  /** Taxable Māori authority distributions, with their credits (box 14B). */
  maoriAuthority?: Cents | undefined;
  /** An amateur sports club, racing club, charitable society or similar (question 13). */
  exemptKind?: boolean | undefined;
  /** Whether any of its funds can go to the private benefit of members. */
  privateBenefit?: boolean | undefined;
  /** Registered under the Incorporated Societies Act, or a friendly or building society: may deduct donations. */
  donationsAllowed?: boolean | undefined;
  /** Donations made to donee organisations. */
  donations?: Cents | undefined;
  /** Inland Revenue has approved it as a not-for-profit. */
  deductionApproved?: boolean | undefined;
  /** Net losses brought forward. */
  lossBroughtForward?: Cents | undefined;
  /** Incorporated bodies pay 28%; others are assessed at individual rates. */
  incorporated?: boolean | undefined;
  /** Other income and tax details only the organisation has. */
  imputationCredits?: Cents | undefined;
  rwt?: Cents | undefined;
}

export function emptyIr9Inputs(): Ir9Inputs {
  return { classes: {}, shares: {} };
}

export interface Ir9Worksheet {
  /** True when the organisation's income is exempt and no return is needed. */
  exempt: boolean;
  /** Said in words, when exempt. */
  exemptReason: string;
  /** The year's income by class, before expenses. */
  incomeBy: Record<Ir9Class, Cents>;
  /** The costs of earning taxable income: each expense account's share. */
  deductibleExpenses: Cents;
  box: {
    interest: Cents;
    dividends: Cents;
    maoriAuthority: Cents;
    /** Other income net of the costs of earning all of it. */
    otherNet: Cents;
    totalIncome: Cents;
    nonProfitDeduction: Cents;
    afterDeduction: Cents;
    netIncomeBeforeDonations: Cents;
    donations: Cents;
    netIncome: Cents;
    lossBroughtForward: Cents;
    taxableIncome: Cents;
  };
  /** At 28%, for an incorporated body; null where individual rates apply. */
  tax: Cents | null;
  taxNote: string;
  /** Tax already paid or credited, and what that leaves, for an incorporated body. */
  credits: Cents;
  toPay: Cents | null;
}

/** The smallest of the amounts that are not negative. */
const floor0 = (n: number): number => Math.max(0, n);

export const NON_PROFIT_DEDUCTION: Cents = 100_000;
export const INCORPORATED_RATE = 0.28;

/** The worksheet for the IR9, in the form's order. */
export function ir9Worksheet(options: {
  income: readonly AccountAmount[];
  expenses: readonly AccountAmount[];
  inputs: Ir9Inputs;
}): Ir9Worksheet {
  const { income, expenses, inputs } = options;
  if (inputs.exemptKind === true && inputs.privateBenefit !== true) {
    const zero = { notIncome: 0, interest: 0, dividends: 0, other: 0 } as Record<Ir9Class, Cents>;
    return {
      exempt: true,
      exemptReason:
        "An amateur sports club, racing club, charitable society or the like has exempt income, as long as none of its funds " +
        "can be used for the private benefit of its members. It does not need to file a return. If Inland Revenue has sent " +
        "one, tell them so they can update their records.",
      incomeBy: zero,
      deductibleExpenses: 0,
      box: {
        interest: 0, dividends: 0, maoriAuthority: 0, otherNet: 0, totalIncome: 0, nonProfitDeduction: 0, afterDeduction: 0,
        netIncomeBeforeDonations: 0, donations: 0, netIncome: 0, lossBroughtForward: 0, taxableIncome: 0,
      },
      tax: null,
      taxNote: "",
      credits: 0,
      toPay: null,
    };
  }

  const incomeBy: Record<Ir9Class, Cents> = { notIncome: 0, interest: 0, dividends: 0, other: 0 };
  for (const a of income) {
    const cls = inputs.classes[a.code] ?? defaultIr9Class(a);
    incomeBy[cls] = (incomeBy[cls] + a.amount) as Cents;
  }
  const deductibleExpenses = Math.round(
    expenses.reduce((sum, a) => sum + (a.amount * Math.min(100, Math.max(0, inputs.shares[a.code] ?? 0))) / 100, 0),
  ) as Cents;

  const maori = (inputs.maoriAuthority ?? 0) as Cents;
  // The costs of earning the income come off the other income, which may take
  // it below nothing: a loss on trading is a loss, and counts.
  const otherNet = (incomeBy.other - deductibleExpenses) as Cents;
  const totalIncome = (incomeBy.interest + incomeBy.dividends + maori + otherNet) as Cents;
  const eligible = inputs.deductionApproved === true && inputs.exemptKind !== true;
  const nonProfitDeduction = (eligible ? Math.min(floor0(totalIncome), NON_PROFIT_DEDUCTION) : 0) as Cents;
  const afterDeduction = (totalIncome - nonProfitDeduction) as Cents;
  const donations =
    inputs.donationsAllowed === true ? (Math.min(floor0(afterDeduction), inputs.donations ?? 0) as Cents) : (0 as Cents);
  const netIncome = (afterDeduction - donations) as Cents;
  const loss = (inputs.lossBroughtForward ?? 0) as Cents;
  const taxableIncome = (netIncome - loss) as Cents;

  const incorporated = inputs.incorporated === true;
  const tax = incorporated ? (Math.round(floor0(taxableIncome) * INCORPORATED_RATE) as Cents) : null;
  const credits = ((inputs.imputationCredits ?? 0) + (inputs.rwt ?? 0)) as Cents;
  return {
    exempt: false,
    exemptReason: "",
    incomeBy,
    deductibleExpenses,
    box: {
      interest: incomeBy.interest,
      dividends: incomeBy.dividends,
      maoriAuthority: maori,
      otherNet,
      totalIncome,
      nonProfitDeduction,
      afterDeduction,
      netIncomeBeforeDonations: afterDeduction,
      donations,
      netIncome,
      lossBroughtForward: loss,
      taxableIncome,
    },
    tax,
    taxNote: incorporated
      ? "Taxed at 28 cents in the dollar, as an incorporated body."
      : "An unincorporated body is assessed at individual tax rates, which change from year to year: work the tax out from Inland Revenue's rates for the year.",
    credits,
    toPay: tax === null ? null : ((tax - credits) as Cents),
  };
}

/** The worksheet as rows, labelled with what each is and the 2026 form's box. */
export function ir9Rows(sheet: Ir9Worksheet): { label: string; box: string; amount: Cents }[] {
  const b = sheet.box;
  return [
    { label: "Interest", box: "14", amount: b.interest },
    { label: "Dividends", box: "14A", amount: b.dividends },
    { label: "Taxable Māori authority distributions", box: "14B", amount: b.maoriAuthority },
    { label: "Other income, less the costs of earning your taxable income", box: "14C", amount: b.otherNet },
    { label: "Total income", box: "14D", amount: b.totalIncome },
    { label: "Income tax deduction for non-profit bodies", box: "14E", amount: b.nonProfitDeduction },
    { label: "Income after the non-profit deduction", box: "14F", amount: b.afterDeduction },
    { label: "Net income (before donations)", box: "15", amount: b.netIncomeBeforeDonations },
    { label: "Donations deduction", box: "16", amount: b.donations },
    { label: "Net income", box: "17", amount: b.netIncome },
    { label: "Net losses brought forward", box: "18", amount: b.lossBroughtForward },
    { label: "Taxable income", box: "19", amount: b.taxableIncome },
  ];
}
