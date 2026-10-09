import type { Cents } from "./money.js";
import type { Account } from "./chart.js";
import type { AccountAmount } from "./ir9.js";
import { COMPANY_TAX_RATE } from "./company-tax.js";
import { provisionalStandardOption } from "./rental-schedules.js";
import type { ProvisionalStandard } from "./rental-schedules.js";

/**
 * The IR4: a company's income tax return, and its imputation credit account.
 *
 * Built from Inland Revenue's IR4 return for the year to 31 March 2026 and its
 * 2026 Company tax return guide (IR4GU), read in October 2026. Box numbers are
 * that form's; Inland Revenue changes them from year to year, so the worksheet
 * says what each figure is first. Check each year's form before filing.
 *
 * What the guide says, and what is done here:
 *
 * - Income is totalled by source in the form's order (questions 12 to 22),
 *   donations to donee organisations come off up to the income, net losses
 *   brought forward come off next if shareholder continuity (49%) or the
 *   business continuity test is met, and group loss offsets and subvention
 *   payments are applied as the form has them, signed.
 * - Tax is 28% of taxable income, less overseas tax paid (up to the tax),
 *   foreign investor tax credit and imputation credits. Imputation credits
 *   beyond the tax are not refunded: they become a tax loss to carry forward,
 *   found by dividing the excess by 0.28.
 * - Other tax credits (RWT, schedular tax, Māori authority and partnership
 *   credits, RLWT) come off to give the residual income tax, then provisional
 *   tax paid, to give the tax to pay or the refund.
 * - The imputation credit account (the annual imputation return, questions 41
 *   to 45) is worked out for the tax year 1 April to 31 March, whatever the
 *   balance date. A debit balance at the end is further income tax payable by
 *   20 June, with a penalty of 10% of the debit balance.
 * - Imputation credits attached to a dividend can be at most 28/72 of the
 *   dividend paid (the maximum imputation ratio), and no more than the credit
 *   balance in the account allows.
 *
 * Not worked out here: group loss offsets and part-year grouping (entered as
 * figures), the foreign investor tax credit (entered), controlled foreign
 * company and foreign investment fund income (entered as a figure), AIM, the
 * business continuity test, and the change-of-shareholding adjustment to the
 * imputation account (entered as an "other debit").
 */

export type Ir4IncomeClass =
  | "notIncome"
  | "schedular"
  | "interest"
  | "dividends"
  | "overseas"
  | "residential"
  | "business"
  | "property"
  | "other";

export const IR4_INCOME_CLASSES: readonly (readonly [Ir4IncomeClass, string])[] = [
  ["notIncome", "Not income (share capital, loans, GST)"],
  ["schedular", "Schedular payments (box 12B)"],
  ["interest", "Interest (box 13B)"],
  ["dividends", "Dividends (box 14B)"],
  ["overseas", "Income from overseas (box 18B)"],
  ["residential", "Residential rent (box 19A)"],
  ["business", "Business or other rental income (box 20B)"],
  ["property", "Taxable property sales (box 21B)"],
  ["other", "Other income (box 22B)"],
];

export function defaultIr4IncomeClass(account: Pick<Account, "name">): Ir4IncomeClass {
  const name = account.name.toLowerCase();
  if (/share capital|capital contributed|loan|shareholder|gst|drawing/.test(name)) return "notIncome";
  if (/schedular/.test(name)) return "schedular";
  if (/interest/.test(name)) return "interest";
  if (/dividend/.test(name)) return "dividends";
  if (/overseas|foreign/.test(name)) return "overseas";
  if (/residential|house|flat|home/.test(name)) return "residential";
  if (/sale of (land|property)|bright/.test(name)) return "property";
  if (/other income|sundry|refund/.test(name)) return "other";
  return "business";
}

export type Ir4ExpensePlacement = "business" | "residential" | "none";

export const IR4_EXPENSE_PLACEMENTS: readonly (readonly [Ir4ExpensePlacement, string])[] = [
  ["business", "Against business income (box 20B)"],
  ["residential", "Residential rental deductions (box 19E)"],
  ["none", "Not deductible"],
];

export function defaultIr4ExpensePlacement(account: Pick<Account, "name">): Ir4ExpensePlacement {
  const name = account.name.toLowerCase();
  if (/depreciation recovered|private|personal|capital|income tax|penalt|fine/.test(name)) return "none";
  if (/residential/.test(name)) return "residential";
  return "business";
}

export interface Ir4Inputs {
  classes: Record<string, Ir4IncomeClass>;
  placements: Record<string, Ir4ExpensePlacement>;
  /** The books show interest and dividends before tax: the credits are in them already. */
  grossBooks?: boolean | undefined;
  schedularTax?: Cents | undefined; // 12A
  rwtInterest?: Cents | undefined; // 13A
  imputationReceived?: Cents | undefined; // 14
  rwtDividends?: Cents | undefined; // 14A
  maori?: Cents | undefined; // 15B
  maoriCredits?: Cents | undefined; // 15A
  partnership?: Cents | undefined; // 16B
  partnershipCredits?: Cents | undefined; // 16A
  overseasTax?: Cents | undefined; // 18A
  brightLine?: Cents | undefined; // 19B
  otherResidential?: Cents | undefined; // 19C
  residentialBroughtForward?: Cents | undefined; // 19F
  propertySales?: Cents | undefined; // 21B
  rlwt?: Cents | undefined; // 21A
  /** Added to (or, if negative, taken from) the business profit to give its taxable profit. */
  taxAdjustment?: Cents | undefined;
  donations?: Cents | undefined;
  lossBroughtForward?: Cents | undefined; // 26A
  /** Shareholder continuity (49%) held, or the business continuity test met. Assumed unless unticked. */
  continuityBroken?: boolean | undefined;
  /** Group loss offsets and subvention payments, signed as the form has them (28, 28A). */
  lossOffsets?: Cents | undefined;
  subvention?: Cents | undefined;
  foreignInvestorCredit?: Cents | undefined; // 30E
  provisionalPaid?: Cents | undefined; // 30K
  /** Last year's residual income tax, for this year's provisional tax if it is not known. */
  lastYearRit?: Cents | undefined;
  /** Imputation credit account: credit positive, debit negative. */
  icaOpening?: Cents | undefined;
  icaIncomeTaxPaid?: Cents | undefined; // 42A
  icaOtherCredits?: Cents | undefined; // 42D, besides RWT on dividends and RLWT
  icaRefunds?: Cents | undefined; // 43A
  icaDividendCredits?: Cents | undefined; // 43B
  icaOtherDebits?: Cents | undefined; // 43C
  icaAdjustment?: Cents | undefined; // 44A
  /** Question 40, by shareholder name: what the company paid or lent them. */
  shareholders?: Record<string, { remuneration?: Cents; aimCredits?: Cents; loans?: Cents }> | undefined;
}

export function emptyIr4Inputs(): Ir4Inputs {
  return { classes: {}, placements: {} };
}

export function ir4Inputs(stored: Partial<Ir4Inputs> | undefined): Ir4Inputs {
  return { ...emptyIr4Inputs(), ...(stored ?? {}) };
}

export interface Ir4Worksheet {
  box: {
    schedular: Cents; // 12B
    schedularTax: Cents; // 12A
    interest: Cents; // 13B
    rwtInterest: Cents; // 13A
    dividends: Cents; // 14B
    imputationReceived: Cents; // 14
    rwtDividends: Cents; // 14A
    maori: Cents; // 15B
    maoriCredits: Cents; // 15A
    partnership: Cents; // 16B
    partnershipCredits: Cents; // 16A
    credits: Cents; // 17A
    overseas: Cents; // 18B
    overseasTax: Cents; // 18A
    residentialRent: Cents; // 19A
    brightLine: Cents; // 19B
    otherResidential: Cents; // 19C
    residentialIncome: Cents; // 19D
    residentialDeductions: Cents; // 19E
    residentialBroughtForward: Cents; // 19F
    residentialClaimed: Cents; // 19G
    residentialNet: Cents; // 19H
    residentialCarried: Cents; // 19I
    business: Cents; // 20B
    rlwt: Cents; // 21A
    propertySales: Cents; // 21B
    other: Cents; // 22B
    totalBeforeDonations: Cents; // 23
    donations: Cents; // 24B
    totalIncome: Cents; // 25
    lossBroughtForward: Cents; // 26A
    lossClaimed: Cents; // 26B
    afterLosses: Cents; // 27
    lossOffsets: Cents; // 28
    subvention: Cents; // 28A
    taxableIncome: Cents; // 29
    tax: Cents; // 30B
    overseasCredit: Cents; // 30C
    afterOverseas: Cents; // 30D
    foreignInvestorCredit: Cents; // 30E
    afterForeign: Cents; // 30F
    imputation: Cents; // 30G
    afterImputation: Cents; // 30H
    otherCredits: Cents; // 30I
    rlwtCredit: Cents; // 30IA
    /** Positive: tax owing after the credits (a debit); negative: a credit. */
    residual: Cents; // 30J
    provisionalPaid: Cents; // 30K
    /** Positive: tax to pay; negative: a refund. */
    toPay: Cents; // 30L
  };
  lossCarriedForward: Cents;
  provisionalNext: ProvisionalStandard;
  ica: {
    opening: Cents; // 41, credit positive
    incomeTaxPaid: Cents; // 42A
    rwtInterest: Cents; // 42B
    imputationReceived: Cents; // 42C
    otherCredits: Cents; // 42D
    totalCredits: Cents; // 42E
    refunds: Cents; // 43A
    dividendCredits: Cents; // 43B
    otherDebits: Cents; // 43C
    totalDebits: Cents; // 43D
    closing: Cents; // 44, credit positive
    adjustment: Cents; // 44A
    furtherTax: Cents; // 44B
    penalty: Cents; // 45
  };
  incomeBy: Record<Ir4IncomeClass, Cents>;
  problems: string[];
  notes: string[];
}

const floor0 = (n: number): number => Math.max(0, n);

/** The IR4 and the annual imputation return, from the books and the year's choices. */
export function ir4Worksheet(options: {
  income: readonly AccountAmount[];
  expenses: readonly AccountAmount[];
  inputs: Ir4Inputs;
}): Ir4Worksheet {
  const { inputs } = options;
  const n = (v: Cents | undefined): Cents => (v ?? 0) as Cents;
  const problems: string[] = [];
  const notes: string[] = [];

  const incomeBy: Record<Ir4IncomeClass, Cents> = {
    notIncome: 0, schedular: 0, interest: 0, dividends: 0, overseas: 0, residential: 0, business: 0, property: 0, other: 0,
  };
  for (const a of options.income) {
    const cls = inputs.classes[a.code] ?? defaultIr4IncomeClass(a);
    incomeBy[cls] = (incomeBy[cls] + a.amount) as Cents;
  }
  const spent: Record<Ir4ExpensePlacement, Cents> = { business: 0, residential: 0, none: 0 };
  for (const a of options.expenses) {
    const where = inputs.placements[a.code] ?? defaultIr4ExpensePlacement(a);
    spent[where] = (spent[where] + a.amount) as Cents;
  }

  const gross = inputs.grossBooks === true;
  const schedular = (incomeBy.schedular + (gross ? 0 : n(inputs.schedularTax))) as Cents;
  const interest = (incomeBy.interest + (gross ? 0 : n(inputs.rwtInterest))) as Cents;
  const dividends = (incomeBy.dividends + (gross ? 0 : n(inputs.imputationReceived) + n(inputs.rwtDividends))) as Cents;
  const overseas = (incomeBy.overseas + (gross ? 0 : n(inputs.overseasTax))) as Cents;
  const credits = (n(inputs.schedularTax) + n(inputs.rwtInterest) + n(inputs.rwtDividends) + n(inputs.maoriCredits) + n(inputs.partnershipCredits)) as Cents;

  // Residential deductions come off residential income only; the excess is carried forward.
  const residentialIncome = (incomeBy.residential + n(inputs.brightLine) + n(inputs.otherResidential)) as Cents;
  const resAvailable = (spent.residential + n(inputs.residentialBroughtForward)) as Cents;
  const resClaimed = Math.min(resAvailable, floor0(residentialIncome)) as Cents;
  const residentialNet = (residentialIncome - resClaimed) as Cents;
  const residentialCarried = (resAvailable - resClaimed) as Cents;

  const business = (incomeBy.business - spent.business + n(inputs.taxAdjustment)) as Cents;
  const totalBeforeDonations = (schedular +
    interest +
    dividends +
    n(inputs.maori) +
    n(inputs.partnership) +
    overseas +
    residentialNet +
    business +
    n(inputs.propertySales) +
    incomeBy.other) as Cents;
  const donations = Math.min(floor0(totalBeforeDonations), n(inputs.donations)) as Cents;
  const totalIncome = (totalBeforeDonations - donations) as Cents;

  const bf = n(inputs.lossBroughtForward);
  const usable = inputs.continuityBroken === true ? 0 : bf;
  const lossClaimed = Math.min(usable, floor0(totalIncome)) as Cents;
  const afterLosses = (totalIncome - lossClaimed) as Cents;
  const taxableIncome = (afterLosses + n(inputs.lossOffsets) + n(inputs.subvention)) as Cents;

  const tax = Math.round(floor0(taxableIncome) * COMPANY_TAX_RATE) as Cents;
  const overseasCredit = Math.min(n(inputs.overseasTax), tax) as Cents;
  const afterOverseas = (tax - overseasCredit) as Cents;
  const foreign = Math.min(n(inputs.foreignInvestorCredit), afterOverseas) as Cents;
  const afterForeign = (afterOverseas - foreign) as Cents;
  const imputation = n(inputs.imputationReceived);
  const afterImputation = floor0(afterForeign - imputation) as Cents;
  const otherCredits = credits;
  const rlwt = n(inputs.rlwt);
  const residual = (afterImputation - otherCredits - rlwt) as Cents;
  const paid = n(inputs.provisionalPaid);
  const toPay = (residual - paid) as Cents;

  // Unused imputation credits are not refunded: they become a loss to carry forward.
  const excessImputation = floor0(imputation - afterForeign);
  const lossFromImputation = Math.round(excessImputation / COMPANY_TAX_RATE);
  const lossThisYear = floor0(-taxableIncome);
  const lossCarriedForward = ((inputs.continuityBroken === true ? 0 : bf - lossClaimed) + lossThisYear + lossFromImputation) as Cents;
  if (excessImputation > 0) {
    notes.push(
      `Imputation credits of $${(excessImputation / 100).toFixed(2)} are more than the tax, and cannot be refunded: they add $${(lossFromImputation / 100).toFixed(2)} to the loss carried forward.`,
    );
  }
  if (bf > 0 && inputs.continuityBroken === true) {
    notes.push("Shareholder continuity has broken, so the loss brought forward is not claimed and is not carried on, unless the business continuity test is met.");
  }

  const provisionalNext = provisionalStandardOption({
    lastYear: residual > 0 ? (residual as Cents) : (0 as Cents),
  });

  // The imputation credit account: credit positive.
  const ica = (() => {
    const opening = n(inputs.icaOpening);
    const incomeTaxPaid = n(inputs.icaIncomeTaxPaid);
    const rwtInt = n(inputs.rwtInterest);
    const impRec = n(inputs.imputationReceived);
    const other = (n(inputs.icaOtherCredits) + n(inputs.rwtDividends) + n(inputs.rlwt)) as Cents;
    const totalCredits = (incomeTaxPaid + rwtInt + impRec + other) as Cents;
    const refunds = n(inputs.icaRefunds);
    const dividendCredits = n(inputs.icaDividendCredits);
    const otherDebits = n(inputs.icaOtherDebits);
    const totalDebits = (refunds + dividendCredits + otherDebits) as Cents;
    const closing = (opening + totalCredits - totalDebits) as Cents;
    const adjustment = n(inputs.icaAdjustment);
    const debit = floor0(-closing);
    const furtherTax = floor0(debit - adjustment) as Cents;
    const penalty = Math.round(debit * 0.1) as Cents;
    return { opening, incomeTaxPaid, rwtInterest: rwtInt, imputationReceived: impRec, otherCredits: other, totalCredits, refunds, dividendCredits, otherDebits, totalDebits, closing, adjustment, furtherTax, penalty };
  })();
  if (ica.closing < 0) {
    problems.push(
      `The imputation credit account ends in debit by $${(-ica.closing / 100).toFixed(2)}: further income tax is payable by 20 June, with a penalty of 10% of the debit balance.`,
    );
  }
  if (inputs.icaDividendCredits !== undefined && inputs.icaDividendCredits > 0 && ica.closing < 0) {
    notes.push("Imputation credits attached to dividends were more than the account could cover. Credits can only be attached up to the balance in the account.");
  }

  return {
    box: {
      schedular,
      schedularTax: n(inputs.schedularTax),
      interest,
      rwtInterest: n(inputs.rwtInterest),
      dividends,
      imputationReceived: imputation,
      rwtDividends: n(inputs.rwtDividends),
      maori: n(inputs.maori),
      maoriCredits: n(inputs.maoriCredits),
      partnership: n(inputs.partnership),
      partnershipCredits: n(inputs.partnershipCredits),
      credits,
      overseas,
      overseasTax: n(inputs.overseasTax),
      residentialRent: incomeBy.residential,
      brightLine: n(inputs.brightLine),
      otherResidential: n(inputs.otherResidential),
      residentialIncome,
      residentialDeductions: spent.residential,
      residentialBroughtForward: n(inputs.residentialBroughtForward),
      residentialClaimed: resClaimed,
      residentialNet,
      residentialCarried,
      business,
      rlwt,
      propertySales: n(inputs.propertySales),
      other: incomeBy.other,
      totalBeforeDonations,
      donations,
      totalIncome,
      lossBroughtForward: bf,
      lossClaimed,
      afterLosses,
      lossOffsets: n(inputs.lossOffsets),
      subvention: n(inputs.subvention),
      taxableIncome,
      tax,
      overseasCredit,
      afterOverseas,
      foreignInvestorCredit: foreign,
      afterForeign,
      imputation,
      afterImputation,
      otherCredits,
      rlwtCredit: rlwt,
      residual,
      provisionalPaid: paid,
      toPay,
    },
    lossCarriedForward,
    provisionalNext,
    ica,
    incomeBy,
    problems,
    notes,
  };
}

/** The IR4 as rows: what each is, and the 2026 form's box. */
export function ir4Rows(s: Ir4Worksheet): { label: string; box: string; amount: Cents }[] {
  const b = s.box;
  return [
    { label: "Schedular payments (gross)", box: "12B", amount: b.schedular },
    { label: "Tax deducted from schedular payments", box: "12A", amount: b.schedularTax },
    { label: "Interest (gross)", box: "13B", amount: b.interest },
    { label: "RWT on interest", box: "13A", amount: b.rwtInterest },
    { label: "Dividends (gross)", box: "14B", amount: b.dividends },
    { label: "Dividend imputation credits", box: "14", amount: b.imputationReceived },
    { label: "Dividend RWT credits", box: "14A", amount: b.rwtDividends },
    { label: "Taxable Māori authority distributions", box: "15B", amount: b.maori },
    { label: "Māori authority credits", box: "15A", amount: b.maoriCredits },
    { label: "Income from a partnership, estate or trust", box: "16B", amount: b.partnership },
    { label: "Partnership, estate or trust tax credits", box: "16A", amount: b.partnershipCredits },
    { label: "Total tax credits (not overseas tax)", box: "17A", amount: b.credits },
    { label: "Income from overseas", box: "18B", amount: b.overseas },
    { label: "Overseas tax paid", box: "18A", amount: b.overseasTax },
    { label: "Gross residential rental income", box: "19A", amount: b.residentialRent },
    { label: "Net bright-line profit", box: "19B", amount: b.brightLine },
    { label: "Other residential income", box: "19C", amount: b.otherResidential },
    { label: "Total combined residential income", box: "19D", amount: b.residentialIncome },
    { label: "Residential rental deductions", box: "19E", amount: b.residentialDeductions },
    { label: "Excess deductions brought forward", box: "19F", amount: b.residentialBroughtForward },
    { label: "Deductions claimed this year", box: "19G", amount: b.residentialClaimed },
    { label: "Net residential income", box: "19H", amount: b.residentialNet },
    { label: "Excess deductions carried forward", box: "19I", amount: b.residentialCarried },
    { label: "Net profit from business or other rental", box: "20B", amount: b.business },
    { label: "Residential land withholding tax credit", box: "21A", amount: b.rlwt },
    { label: "Profit or loss from taxable property sales", box: "21B", amount: b.propertySales },
    { label: "Other income", box: "22B", amount: b.other },
    { label: "Total income before donations", box: "23", amount: b.totalBeforeDonations },
    { label: "Donations made", box: "24B", amount: b.donations },
    { label: "Total income", box: "25", amount: b.totalIncome },
    { label: "Net losses brought forward", box: "26A", amount: b.lossBroughtForward },
    { label: "Net losses claimed this year", box: "26B", amount: b.lossClaimed },
    { label: "Total income after net losses", box: "27", amount: b.afterLosses },
    { label: "Group net losses", box: "28", amount: b.lossOffsets },
    { label: "Subvention payments", box: "28A", amount: b.subvention },
    { label: "Taxable income", box: "29", amount: b.taxableIncome },
    { label: "Tax at 28%", box: "30B", amount: b.tax },
    { label: "Overseas tax paid", box: "30C", amount: b.overseasCredit },
    { label: "After overseas tax", box: "30D", amount: b.afterOverseas },
    { label: "Foreign investor tax credit", box: "30E", amount: b.foreignInvestorCredit },
    { label: "After foreign investor tax credit", box: "30F", amount: b.afterForeign },
    { label: "Imputation credits", box: "30G", amount: b.imputation },
    { label: "After imputation credits", box: "30H", amount: b.afterImputation },
    { label: "Other tax credits", box: "30I", amount: b.otherCredits },
    { label: "RLWT credit", box: "30IA", amount: b.rlwtCredit },
    { label: "Residual income tax (negative is a credit)", box: "30J", amount: b.residual },
    { label: "Provisional tax paid", box: "30K", amount: b.provisionalPaid },
    { label: "Tax to pay (negative is a refund)", box: "30L", amount: b.toPay },
  ];
}

/** The annual imputation return as rows, in the form's order. */
export function icaRows(s: Ir4Worksheet): { label: string; box: string; amount: Cents }[] {
  const i = s.ica;
  return [
    { label: "Opening balance (negative is a debit)", box: "41", amount: i.opening },
    { label: "Income tax paid", box: "42A", amount: i.incomeTaxPaid },
    { label: "RWT on interest received", box: "42B", amount: i.rwtInterest },
    { label: "Imputation credits attached to dividends received", box: "42C", amount: i.imputationReceived },
    { label: "Other credits", box: "42D", amount: i.otherCredits },
    { label: "Total credits", box: "42E", amount: i.totalCredits },
    { label: "Income tax refunded", box: "43A", amount: i.refunds },
    { label: "Imputation credits attached to dividends paid", box: "43B", amount: i.dividendCredits },
    { label: "Other debits", box: "43C", amount: i.otherDebits },
    { label: "Total debits", box: "43D", amount: i.totalDebits },
    { label: "Closing balance (negative is a debit)", box: "44", amount: i.closing },
    { label: "Adjustments to reduce further income tax", box: "44A", amount: i.adjustment },
    { label: "Further income tax payable", box: "44B", amount: i.furtherTax },
    { label: "Imputation penalty tax", box: "45", amount: i.penalty },
  ];
}

export const MAX_IMPUTATION_RATIO = 28 / 72;

export interface DividendImputation {
  /** The dividend paid in cash. */
  net: Cents;
  /** The most credit the law allows on it: 28/72 of the dividend. */
  maximum: Cents;
  /** What the account can cover. */
  available: Cents;
  /** The credit to attach: the smaller of the two. */
  credit: Cents;
  /** The dividend with its credit: what the shareholder includes as income. */
  gross: Cents;
  /** Credit as a share of the cash dividend, as a ratio: 0.3889 is the maximum. */
  ratio: number;
  /** True when the account holds less than the maximum credit. */
  limitedByAccount: boolean;
}

/** The imputation credit to attach to a dividend, given what the account holds. */
export function dividendImputation(net: Cents, available: Cents): DividendImputation {
  const maximum = Math.round(net * MAX_IMPUTATION_RATIO) as Cents;
  const room = floor0(available) as Cents;
  const credit = Math.min(maximum, room) as Cents;
  return {
    net,
    maximum,
    available: room,
    credit,
    gross: (net + credit) as Cents,
    ratio: net > 0 ? credit / net : 0,
    limitedByAccount: room < maximum,
  };
}
