import type { Cents } from "./money.js";
import type { Entity } from "./entities.js";
import type { ProfitAndLoss, TaxExtra } from "./reports.js";

/**
 * Rental schedules, and the individual return they feed.
 *
 * A rental property's figures reach Inland Revenue twice. First as its own
 * schedule -- the rent, the expenses under the headings the form asks for, and
 * what is left -- and then as each owner's share of that on the owner's IR3. A
 * property owned half each is two people's income, and each returns half of
 * every line rather than half of the answer, because the form asks for the
 * headings and a residential loss is carried forward as deductions, not as a
 * net figure.
 *
 * Residential and other rentals are different questions on the form.
 * Residential rental deductions are ring-fenced: they reduce residential income
 * and nothing else, and what they cannot use is carried to the next year. A
 * commercial property's net rent is ordinary income in "net rents".
 */

/** The expense headings Inland Revenue's rental schedules ask for. */
export type RentalHeading = "rates" | "insurance" | "interest" | "agent" | "repairs" | "other";

export const RENTAL_HEADINGS: readonly { heading: RentalHeading; label: string }[] = [
  { heading: "rates", label: "Rates" },
  { heading: "insurance", label: "Insurance" },
  { heading: "interest", label: "Interest" },
  { heading: "agent", label: "Agent's collection fees" },
  { heading: "repairs", label: "Repairs and maintenance" },
  { heading: "other", label: "Other" },
];

/**
 * Which heading an expense account belongs under, by what it is called.
 *
 * Interest is asked first because "interest rates" is interest, and insurance
 * before agents because a letting agent's insurance excess is insurance.
 * Anything unrecognised is "other", which the form itemises -- so a heading
 * guessed wrongly is visible on the schedule rather than hidden in a total.
 */
export function rentalHeadingFor(name: string): RentalHeading {
  const n = name.toLowerCase();
  if (/interest/.test(n)) return "interest";
  if (/insurance/.test(n)) return "insurance";
  if (/agent|property management|management fees?|letting|collection fees?/.test(n)) return "agent";
  if (/\brates\b|\bwater\b/.test(n)) return "rates";
  if (/repair|maintenance/.test(n)) return "repairs";
  return "other";
}

export interface RentalLine {
  code: string;
  name: string;
  amount: Cents;
}

export interface RentalExpenseLine extends RentalLine {
  heading: RentalHeading;
}

/** One property's income and expenses for a year, before anyone's share. */
export interface RentalSchedule {
  entity: Entity;
  income: RentalLine[];
  expenses: RentalExpenseLine[];
  totalIncome: Cents;
  totalExpenses: Cents;
  net: Cents;
}

/** Whether an entity is a rental property, residential or not. */
export function isRental(entity: Entity): boolean {
  return entity.kind === "residential" || entity.kind === "commercial";
}

/**
 * A property's schedule, from its profit and loss.
 *
 * The report is whatever basis the caller chose; its lines are already net of
 * GST where the entity is registered and gross where it is not, which is what
 * each kind of schedule reports.
 */
export function rentalSchedule(
  entity: Entity,
  report: ProfitAndLoss,
  nameOf: (code: string) => string = (code) => code,
): RentalSchedule {
  const income = report.income
    .filter((line) => line.net !== 0)
    .map((line) => ({ code: line.code, name: nameOf(line.code), amount: line.net }));
  // A report holds an expense as money leaving, so negative; a schedule lists
  // it as the positive amount spent.
  const expenses = report.expenses
    .filter((line) => line.net !== 0)
    .map((line) => {
      const name = nameOf(line.code);
      return { code: line.code, name, amount: -line.net, heading: rentalHeadingFor(name) };
    });
  const byName = (a: RentalLine, b: RentalLine): number => a.name.localeCompare(b.name);
  income.sort(byName);
  expenses.sort(byName);
  const totalIncome = income.reduce((sum, line) => sum + line.amount, 0);
  const totalExpenses = expenses.reduce((sum, line) => sum + line.amount, 0);
  return { entity, income, expenses, totalIncome, totalExpenses, net: totalIncome - totalExpenses };
}

/**
 * How much residential rental interest is deductible, for the year a return
 * is for (the year ending 31 March).
 *
 * From Inland Revenue's interest limitation rules: 80% for the year to 31
 * March 2025 whenever the property was bought or the loan drawn, and 100%
 * from 1 April 2025. Earlier years turn on when the property was acquired and
 * when the money was borrowed, which these books do not hold, so they give
 * null and the schedule says it has not applied a limit rather than guess.
 */
export function residentialInterestDeductible(year: number): number | null {
  if (year >= 2026) return 1;
  if (year === 2025) return 0.8;
  return null;
}

/** One owner's share of one property, as the IR3 schedules set it out. */
export interface OwnerRentalSchedule {
  property: string;
  owner: string;
  percent: number;
  residential: boolean;
  /** Rent, this owner's share. */
  rents: Cents;
  /** Other income the property produced, such as an insurance payout. */
  otherIncome: Cents;
  totalIncome: Cents;
  /** One amount per heading, in the form's order. */
  headings: { heading: RentalHeading; label: string; amount: Cents }[];
  /** What makes up "Other", which the form itemises. */
  other: RentalLine[];
  totalExpenses: Cents;
  netRents: Cents;
  /** Said about this schedule for the owner to read: a limit applied, or not. */
  notes?: string[];
}

/**
 * One owner's share of a property's schedule, or null if they own none of it.
 *
 * Each line is shared and rounded to the cent on its own, as a practitioner's
 * schedule does, so an owner's headings add to their total and two halves add
 * to the whole within a cent.
 */
export function ownerRentalSchedule(
  schedule: RentalSchedule,
  owner: string,
  /**
   * The year the return is for. Given, a residential property's interest is
   * limited as that year's rules say; left out, it is taken in full, as the
   * profit and loss shows it.
   */
  year?: number,
): OwnerRentalSchedule | null {
  const share = (schedule.entity.owners ?? []).find((o) => o.name === owner);
  // A share with no usable percentage -- an owner saved before shares were
  // percentages -- is no share at all, rather than NaN on every line of a return.
  if (share === undefined || !Number.isFinite(share.percent) || share.percent <= 0) return null;
  const part = (amount: Cents): Cents => Math.round((amount * share.percent) / 100);

  let rents = 0;
  let otherIncome = 0;
  for (const line of schedule.income) {
    if (/\b(rent|rental|lease|licen[cs]e)/i.test(line.name)) rents += part(line.amount);
    else otherIncome += part(line.amount);
  }

  const totals = new Map<RentalHeading, Cents>();
  const other: RentalLine[] = [];
  for (const line of schedule.expenses) {
    const amount = part(line.amount);
    totals.set(line.heading, (totals.get(line.heading) ?? 0) + amount);
    if (line.heading === "other") other.push({ code: line.code, name: line.name, amount });
  }
  // The interest limitation is a tax rule, not an accounting one: the profit
  // and loss keeps the whole cost, and only the schedule the return is made
  // from is limited.
  const notes: string[] = [];
  const residential = schedule.entity.kind === "residential";
  const interestPaid = totals.get("interest") ?? 0;
  if (residential && year !== undefined && interestPaid !== 0) {
    const share = schedule.entity.interestExempt === true ? 1 : residentialInterestDeductible(year);
    if (share === null) {
      notes.push(
        `${schedule.entity.name}: no interest limit applied for the year to 31 March ${year}. ` +
          "It depends on when the property was bought and the money borrowed; check the " +
          "percentage with Inland Revenue's interest limitation rules.",
      );
    } else if (share < 1) {
      const allowed = Math.round(interestPaid * share);
      totals.set("interest", allowed);
      notes.push(
        `${schedule.entity.name}: ${Math.round(share * 100)}% of the residential interest is ` +
          `deductible for the year to 31 March ${year}, so ${(allowed / 100).toFixed(2)} of ` +
          `${(interestPaid / 100).toFixed(2)} is claimed. A new build or other exempt property ` +
          "can claim it all: mark it exempt on the Entities page.",
      );
    }
  }

  const headings = RENTAL_HEADINGS.map((h) => ({ ...h, amount: totals.get(h.heading) ?? 0 }));
  const totalIncome = rents + otherIncome;
  const totalExpenses = headings.reduce((sum, h) => sum + h.amount, 0);

  return {
    property: schedule.entity.name,
    owner,
    percent: share.percent,
    residential: schedule.entity.kind === "residential",
    rents,
    otherIncome,
    totalIncome,
    headings,
    other,
    totalExpenses,
    netRents: totalIncome - totalExpenses,
    ...(notes.length > 0 ? { notes } : {}),
  };
}

/**
 * An owner's residential properties together, with the ring-fence applied.
 *
 * The properties are a portfolio, which is the default election: a loss on one
 * is used against the others before anything is carried forward. Deductions
 * claimed are what the residential income can absorb; the rest, together with
 * any excess brought forward that could not be used, is carried to next year.
 */
export interface ResidentialPortfolio {
  properties: OwnerRentalSchedule[];
  grossRents: Cents;
  /** Bright-line profits. A sale is not in these books, so it is entered on the return. */
  brightLine: Cents;
  otherIncome: Cents;
  totalIncome: Cents;
  deductions: Cents;
  broughtForward: Cents;
  claimed: Cents;
  netIncome: Cents;
  carriedForward: Cents;
}

export function residentialPortfolio(
  schedules: readonly OwnerRentalSchedule[],
  broughtForward: Cents = 0,
): ResidentialPortfolio {
  const properties = schedules.filter((s) => s.residential);
  const grossRents = properties.reduce((sum, p) => sum + p.rents, 0);
  const otherIncome = properties.reduce((sum, p) => sum + p.otherIncome, 0);
  const totalIncome = grossRents + otherIncome;
  const deductions = properties.reduce((sum, p) => sum + p.totalExpenses, 0);
  const available = deductions + broughtForward;
  const claimed = Math.min(available, Math.max(totalIncome, 0));
  return {
    properties,
    grossRents,
    brightLine: 0,
    otherIncome,
    totalIncome,
    deductions,
    broughtForward,
    claimed,
    netIncome: totalIncome - claimed,
    carriedForward: available - claimed,
  };
}

/**
 * Income tax rates for an individual, by the year the return is for.
 *
 * As Inland Revenue publishes them (ird.govt.nz, "Tax rates for individuals").
 * A year not listed has no rates here, and the return says so rather than
 * working tax out on a guess.
 */
const INCOME_TAX: Readonly<Record<number, readonly { upTo: number | null; rate: number }[]>> = {
  // The year ended 31 March 2025 straddles the threshold change of 31 July
  // 2024, and Inland Revenue's table for it keeps the new thresholds but
  // blends the *rates* between the old and new ones -- 12.82%, 21.64% and
  // 30.99% on the stretches that moved. This held blended thresholds instead,
  // which is not the same arithmetic: on $100,000 it came to about $350 more
  // tax than Inland Revenue's table. Found by checking against that table.
  2025: [
    { upTo: 14_000, rate: 0.105 },
    { upTo: 15_600, rate: 0.1282 },
    { upTo: 48_000, rate: 0.175 },
    { upTo: 53_500, rate: 0.2164 },
    { upTo: 70_000, rate: 0.3 },
    { upTo: 78_100, rate: 0.3099 },
    { upTo: 180_000, rate: 0.33 },
    { upTo: null, rate: 0.39 },
  ],
  2026: [
    { upTo: 15_600, rate: 0.105 },
    { upTo: 53_500, rate: 0.175 },
    { upTo: 78_100, rate: 0.3 },
    { upTo: 180_000, rate: 0.33 },
    { upTo: null, rate: 0.39 },
  ],
  // The year to 31 March 2027: Inland Revenue's "From 1 April 2025" table,
  // which has not changed.
  2027: [
    { upTo: 15_600, rate: 0.105 },
    { upTo: 53_500, rate: 0.175 },
    { upTo: 78_100, rate: 0.3 },
    { upTo: 180_000, rate: 0.33 },
    { upTo: null, rate: 0.39 },
  ],
};

/** ACC earner levy, which PAYE includes and which is not a credit against tax. */
// Including GST, as PAYE deducts it (ird.govt.nz, "ACC earners' levy rates").
// A year missing here meant no levy was taken out of PAYE for it, which
// overstated the tax credit -- 2025 had tax bands and no levy.
const EARNER_LEVY: Readonly<Record<number, { rate: number; maximum: Cents }>> = {
  2025: { rate: 0.016, maximum: 14_228_300 },
  2026: { rate: 0.0167, maximum: 15_279_000 },
  2027: { rate: 0.0175, maximum: 15_664_100 },
};

/** The independent earner tax credit: its full amount, where it starts to abate, and where it ends. */
const IETC: Readonly<Record<number, { from: Cents; full: Cents; to: Cents; amount: Cents; abatement: number }>> = {
  2026: { from: 2_400_000, full: 6_600_000, to: 7_000_000, amount: 52_000, abatement: 0.13 },
  // Unchanged: Inland Revenue's figures "from July 2024" still apply.
  2027: { from: 2_400_000, full: 6_600_000, to: 7_000_000, amount: 52_000, abatement: 0.13 },
};

/**
 * Tax on a year's taxable income.
 *
 * Worked on whole dollars, as Inland Revenue does: the cents of taxable income
 * are not taxed.
 */
export function incomeTaxOn(taxableIncome: Cents, year: number): Cents | null {
  const bands = INCOME_TAX[year];
  if (bands === undefined) return null;
  const dollars = Math.max(0, Math.floor(taxableIncome / 100));
  let tax = 0;
  let from = 0;
  for (const band of bands) {
    const top = band.upTo ?? Number.POSITIVE_INFINITY;
    if (dollars > from) tax += (Math.min(dollars, top) - from) * band.rate;
    from = top;
  }
  return Math.round(tax * 100);
}

/** The ACC earner levy within PAYE on these earnings. */
export function earnerLevyOn(earnings: Cents, year: number): Cents {
  const levy = EARNER_LEVY[year];
  if (levy === undefined) return 0;
  // A hair added before flooring, so 3,000,000 x 0.0167 is not 50,099.999...
  return Math.floor(Math.min(earnings, levy.maximum) * levy.rate + 1e-6);
}

/** The independent earner tax credit on this income, for someone eligible. */
export function ietcOn(taxableIncome: Cents, year: number): Cents {
  const table = IETC[year];
  if (table === undefined || taxableIncome < table.from || taxableIncome > table.to) return 0;
  if (taxableIncome <= table.full) return table.amount;
  return Math.max(0, Math.round(table.amount - (taxableIncome - table.full) * table.abatement));
}

export interface Ir3Box {
  box: string;
  title: string;
  amount?: Cents;
  text?: string;
  total?: boolean;
}

export interface ProvisionalStandard {
  /** What the figure is worked out from, said plainly because the two differ. */
  basis: "105% of last year" | "110% of the year before" | "not due";
  amount: Cents;
  /** Three equal instalments, the last carrying the odd dollars. */
  instalments: Cents[];
  why: string;
}

/**
 * Next year's provisional tax under the standard option, both ways round.
 *
 * The usual way is 105% of last year's residual income tax, which needs last
 * year's return to have been filed. It often has not been by the first
 * instalment in August, and the Act does not leave a hole there: until that
 * return is in, the instalment is 110% of the year before it. Working it out
 * the usual way regardless would understate what is due and earn use-of-money
 * interest on the difference, which is the sort of quiet cost this app exists
 * to stop.
 *
 * Whole dollars, as Inland Revenue states them, and only once residual income
 * tax passes $5,000 -- below that, provisional tax is not due at all.
 */
export function provisionalStandardOption(options: {
  /** Last year's residual income tax, once that return is filed. */
  lastYear: Cents | null;
  /** The year before it, for while last year's return is still outstanding. */
  yearBefore?: Cents;
  /** False while last year's return has not been filed. */
  lastYearFiled?: boolean;
}): ProvisionalStandard {
  const filed = options.lastYearFiled !== false;
  const wholeDollars = (cents: number): Cents => Math.floor(cents / 100) * 100;
  const split = (amount: Cents): Cents[] => {
    const third = Math.floor(amount / 300) * 100;
    return [third, third, amount - 2 * third];
  };

  if (filed && options.lastYear !== null && options.lastYear > 500_000) {
    const amount = wholeDollars(options.lastYear * 1.05);
    return {
      basis: "105% of last year",
      amount,
      instalments: split(amount),
      why: "Last year's residual income tax plus 5%, the standard option.",
    };
  }

  if (!filed && options.yearBefore !== undefined && options.yearBefore > 500_000) {
    const amount = wholeDollars(options.yearBefore * 1.1);
    return {
      basis: "110% of the year before",
      amount,
      instalments: split(amount),
      why:
        "Last year's return is not filed yet, so the standard option is 110% of the year " +
        "before it until it is.",
    };
  }

  return {
    basis: "not due",
    amount: 0,
    instalments: [],
    why:
      filed && options.lastYear !== null && options.lastYear <= 500_000
        ? "Residual income tax of $5,000 or less: provisional tax is not due."
        : "Not enough is known yet to work out provisional tax.",
  };
}

export interface Ir3ReturnOptions {
  owner: string;
  /** The year the return is for, labelled by the year it ends in. */
  year: number;
  /** Income that never reaches these books: salary, interest, dividends, PIE. */
  extras: readonly TaxExtra[];
  /** This owner's share of every rental, from `ownerRentalSchedule`. */
  rentals: readonly OwnerRentalSchedule[];
  /** Residential deductions carried forward from last year's return. */
  residentialBroughtForward?: Cents;
  /** Provisional tax paid for the year, from the owner's Inland Revenue account. */
  provisionalTaxPaid?: Cents;
  /**
   * Whether the owner can have the independent earner tax credit.
   *
   * Receiving New Zealand Super, a main benefit or Working for Families rules
   * it out, and none of those are in the books -- so it is asked, and assumed
   * only where nobody has said.
   */
  ietcEligible?: boolean;
  /**
   * Months of the year the credit is ruled out, 0 to 12.
   *
   * Inland Revenue works the credit out on whole months: any month in which
   * the person receives Working for Families, New Zealand Super, a main
   * benefit or a veteran's pension -- even for a day -- loses that month's
   * credit, and only that month's. A single yes-or-no for the year got a
   * part-year wrong in one direction or the other.
   */
  ietcMonthsOut?: number;
}

export interface Ir3Return {
  owner: string;
  year: number;
  boxes: Ir3Box[];
  residential: ResidentialPortfolio;
  /** Commercial and other non-residential rentals, whose net is "net rents". */
  otherRentals: OwnerRentalSchedule[];
  taxableIncome: Cents;
  /** Null for a year whose tax rates are not held here. */
  taxOnIncome: Cents | null;
  residualIncomeTax: Cents | null;
  /** Negative is a refund. Null until provisional tax paid is known. */
  refundOrToPay: Cents | null;
  /** Next year's provisional tax, where residual income tax makes it due. */
  nextYearProvisional: Cents | null;
  /** The standard option's three instalments of it. */
  instalments: Cents[];
  notes: string[];
}

/**
 * An individual's income tax return, as the IR3 is filed.
 *
 * Box numbers are the 2026 form's. What the books know -- each rental share --
 * is combined with what only a summary of earnings or a certificate knows:
 * salary and PAYE, interest and RWT, dividends and their credits, PIE income.
 * Where a figure depends on something not in the books, the return says what
 * it assumed.
 */
export function ir3Return(options: Ir3ReturnOptions): Ir3Return {
  const { owner, year } = options;
  const mine = options.extras.filter((e) => e.owner === owner && e.year === year);
  const sum = (list: readonly TaxExtra[], pick: (e: TaxExtra) => Cents): Cents =>
    list.reduce((total, e) => total + pick(e), 0);
  const of = (category: TaxExtra["category"]): TaxExtra[] => mine.filter((e) => e.category === category);

  const salary = of("salary");
  const earnings = sum(salary, (e) => e.gross);
  const paye = sum(salary, (e) => e.credits);
  const levy = earnings > 0 ? Math.min(paye, earnerLevyOn(earnings, year)) : 0;
  const taxDeductions = paye - levy;

  const interest = of("interest");
  const grossInterest = sum(interest, (e) => e.gross);
  const interestRwt = sum(interest, (e) => e.credits);

  const dividends = of("dividends");
  const grossDividends = sum(dividends, (e) => e.gross);
  const dividendRwt = sum(dividends, (e) => e.credits);
  const imputation = sum(dividends, (e) => e.imputation ?? 0);

  const pie = of("pie");
  const other = of("other");
  const otherIncome = sum(other, (e) => e.gross);
  const otherCredits = sum(other, (e) => e.credits);

  const mineRentals = options.rentals.filter((r) => r.owner === owner);
  const residential = residentialPortfolio(mineRentals, options.residentialBroughtForward ?? 0);
  const otherRentals = mineRentals.filter((r) => !r.residential);
  const netRents = otherRentals.reduce((total, r) => total + r.netRents, 0);

  const taxableIncome =
    earnings + grossInterest + grossDividends + residential.netIncome + netRents + otherIncome;
  const taxOnIncome = incomeTaxOn(taxableIncome, year);
  const notes: string[] = [];
  // What each rental schedule had to say -- an interest limit applied, or one it
  // could not work out -- belongs with the return it was made for.
  for (const rental of options.rentals) notes.push(...(rental.notes ?? []));
  if (taxOnIncome === null) notes.push(`No income tax rates are held for ${year}, so no tax is worked out.`);
  // A year can have income tax bands here without the other two tables. Both
  // would then come out as nothing, which on a return reads as a figure rather
  // than as a gap -- so the gap is named.
  if (taxOnIncome !== null && earnings > 0 && EARNER_LEVY[year] === undefined) {
    notes.push(
      `No ACC earner levy rate is held for ${year}, so none is separated out of the PAYE credit.`,
    );
  }
  if (taxOnIncome !== null && IETC[year] === undefined) {
    notes.push(
      `No independent earner tax credit thresholds are held for ${year}, so none is claimed.`,
    );
  }

  const eligible = options.ietcEligible !== false;
  const monthsOut = Math.min(12, Math.max(0, Math.round(options.ietcMonthsOut ?? 0)));
  const fullYear = eligible && taxOnIncome !== null ? ietcOn(taxableIncome, year) : 0;
  // The year's entitlement, for the months it is not ruled out.
  const ietc = Math.round((fullYear * (12 - monthsOut)) / 12);
  if (fullYear > 0 && monthsOut > 0) {
    notes.push(
      `The independent earner tax credit is for ${12 - monthsOut} of 12 months: it is worked ` +
        "out on whole months, and a month with Working for Families, New Zealand Super, a main " +
        "benefit or a veteran's pension loses that month's credit.",
    );
  }
  if (ietc > 0 && options.ietcEligible === undefined && options.ietcMonthsOut === undefined) {
    notes.push(
      "The independent earner tax credit is included on the assumption nothing rules it out: " +
        "not New Zealand Super, a main benefit or Working for Families.",
    );
  }

  const taxPaid = taxDeductions + interestRwt + dividendRwt + otherCredits;
  const taxPayable = taxOnIncome === null ? null : Math.max(0, taxOnIncome - imputation - ietc);
  const residualIncomeTax = taxPayable === null ? null : taxPayable - taxPaid;
  const refundOrToPay =
    residualIncomeTax === null || options.provisionalTaxPaid === undefined
      ? null
      : residualIncomeTax - options.provisionalTaxPaid;

  const standard = provisionalStandardOption({ lastYear: residualIncomeTax });
  const nextYearProvisional = standard.basis === "not due" ? null : standard.amount;
  const instalments = standard.instalments;
  if (nextYearProvisional !== null) {
    notes.push(
      "That is the standard option on this return once it is filed. If it is not filed " +
        "before the first instalment, that instalment is 110% of the year before instead, " +
        "and the later ones pick up the 105% once it is.",
    );
  }

  const box = (id: string, title: string, amount: Cents, total = false): Ir3Box =>
    ({ box: id, title, amount, ...(total ? { total } : {}) });
  const boxes: Ir3Box[] = [
    box("11A", "Total PAYE withheld", paye),
    box("11B", "Total gross earnings", earnings),
    box("11C", "Total income not liable for earner levy", 0),
    box("11E", "Total tax deductions", taxDeductions),
    box("13A", "Total RWT on interest", interestRwt),
    box("13B", "Total gross interest", grossInterest),
    box("14", "Total dividend imputation credits", imputation),
    box("14A", "Total dividend RWT", dividendRwt),
    box("14B", "Total gross dividends", grossDividends),
    box("21A", "Total tax paid", taxPaid),
    { box: "22", title: "Residential income indicator", text: residential.properties.length > 0 ? "P" : "" },
    box("22A", "Gross residential rental income", residential.grossRents),
    box("22B", "Net bright-line profit", residential.brightLine),
    box("22C", "Other residential income", residential.otherIncome),
    box("22D", "Total residential income", residential.totalIncome),
    box("22E", "Residential rental deductions", residential.deductions),
    box("22F", "Excess residential rental deductions brought forward", residential.broughtForward),
    box("22G", "Residential rental deductions claimed", residential.claimed),
    box("22H", "Net residential income", residential.netIncome),
    box("22I", "Excess residential rental deductions carried forward", residential.carriedForward),
    box("23", "Net rents", netRents),
    box("24", "Self-employed income", 0),
    box("27", "Other income", otherIncome),
    box("29", "Total other expenses", 0),
    box("31A", "Amount of loss brought forward", 0),
    box("31B", "Amount of loss claimed this year", 0),
    box("32", "Taxable income", taxableIncome, true),
    { box: "33A", title: "Are you entitled to IETC?", text: ietc > 0 ? "Yes" : "No" },
    box("33", "IETC amount claimed", ietc),
    box("35A", "Total PIE deductions", sum(pie, (e) => e.credits)),
    box("35B", "Total PIE income", sum(pie, (e) => e.gross)),
    ...(taxOnIncome === null ? [] : [box("36", "Tax on taxable income", taxOnIncome)]),
    ...(residualIncomeTax === null ? [] : [box("36A", "Residual income tax", residualIncomeTax, true)]),
    ...(refundOrToPay === null ? [] : [box("36B", "Refund or tax to pay", refundOrToPay)]),
    ...(nextYearProvisional === null ? [] : [box("39B", `${year + 1} Provisional tax payable`, nextYearProvisional)]),
  ];

  return {
    owner,
    year,
    boxes,
    residential,
    otherRentals,
    taxableIncome,
    taxOnIncome,
    residualIncomeTax,
    refundOrToPay,
    nextYearProvisional,
    instalments,
    notes,
  };
}

/**
 * What an owner's return needs that the books cannot know, per owner and year.
 *
 * Provisional tax paid is on the owner's Inland Revenue account, which can
 * hold transfers in from other years; last year's excess residential
 * deductions are on last year's return; and whether the independent earner
 * tax credit applies turns on benefits these books never see.
 */
export interface Ir3Details {
  owner: string;
  year: number;
  provisionalTaxPaid?: Cents;
  ietcEligible?: boolean;
  /** Months the independent earner credit is ruled out, 0 to 12. */
  ietcMonthsOut?: number;
  residentialBroughtForward?: Cents;
}
