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
 * The thresholds in force from 31 July 2024. A year not listed has no rates
 * here, and the return says so rather than working tax out on a guess.
 */
const INCOME_TAX: Readonly<Record<number, readonly { upTo: number | null; rate: number }[]>> = {
  2026: [
    { upTo: 15_600, rate: 0.105 },
    { upTo: 53_500, rate: 0.175 },
    { upTo: 78_100, rate: 0.3 },
    { upTo: 180_000, rate: 0.33 },
    { upTo: null, rate: 0.39 },
  ],
};

/** ACC earner levy, which PAYE includes and which is not a credit against tax. */
const EARNER_LEVY: Readonly<Record<number, { rate: number; maximum: Cents }>> = {
  2026: { rate: 0.0167, maximum: 15_279_000 },
};

/** The independent earner tax credit: its full amount, where it starts to abate, and where it ends. */
const IETC: Readonly<Record<number, { from: Cents; full: Cents; to: Cents; amount: Cents; abatement: number }>> = {
  2026: { from: 2_400_000, full: 6_600_000, to: 7_000_000, amount: 52_000, abatement: 0.13 },
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
  if (taxOnIncome === null) notes.push(`No income tax rates are held for ${year}, so no tax is worked out.`);

  const eligible = options.ietcEligible !== false;
  const ietc = eligible && taxOnIncome !== null ? ietcOn(taxableIncome, year) : 0;
  if (ietc > 0 && options.ietcEligible === undefined) {
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

  // Standard option: last year's residual income tax plus 5%, in whole dollars,
  // once it is over $5,000.
  const nextYearProvisional =
    residualIncomeTax !== null && residualIncomeTax > 500_000
      ? Math.floor((residualIncomeTax * 1.05) / 100) * 100
      : null;
  const instalments: Cents[] = [];
  if (nextYearProvisional !== null) {
    const third = Math.floor(nextYearProvisional / 300) * 100;
    instalments.push(third, third, nextYearProvisional - 2 * third);
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
  residentialBroughtForward?: Cents;
}
