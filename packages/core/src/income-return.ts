import { IR10_LAYOUT } from "./ir10.js";
import type { IsoDate } from "./dates.js";
import type { Cents } from "./money.js";

/**
 * A filed income tax return, read in from what Inland Revenue holds.
 *
 * Some of what a return says the books cannot work out for themselves: the
 * tax loss carried forward from earlier years, the imputation credit balance,
 * last year's residual income tax that this year's provisional tax is set
 * from, the shareholding that decides whether a loss survives, a rental's
 * ring-fenced loss. Those come from the return that was filed, and nowhere
 * else.
 *
 * Read by a model rather than by this code. A myIR return is a PDF laid out
 * differently for each form and each year; matching its words would read one
 * return and misread the next. So the person hands the PDF to a model with
 * the prompt below -- or has it sent with their own key -- and what comes back
 * is a fixed shape that is checked here. The arithmetic has to hold, because a
 * figure misread is the one mistake that would otherwise go straight into
 * next year's tax.
 */
export type IncomeReturnForm = "IR4" | "IR3";

/** A company's return. */
export interface FiledIr4 {
  form: "IR4";
  /** The balance date the return is for, e.g. 2026-03-31. */
  balanceDate: IsoDate;
  /** Net income before any losses were claimed; negative for a loss. */
  netIncome: Cents;
  netLossBroughtForward: Cents;
  netLossClaimed: Cents;
  lossCarriedForward: Cents;
  residualIncomeTax: Cents;
  /** Tax to pay, or negative for a refund, where the return shows it. */
  taxToPay?: Cents;
  provisionalTaxMethod?: string;
  imputationOpening?: Cents;
  imputationClosing?: Cents;
  /** Lowest economic interest of the shareholders, as a percentage. */
  lowestEconomicInterest?: number;
  /** The IR10 as filed, whole dollars held in cents, by box number. */
  ir10: Record<number, Cents>;
}

/** One property's rental schedule (IR3R) as filed. */
export interface FiledRental {
  /** As the schedule names it: usually the address. */
  property: string;
  /**
   * Income and expenses, where the return shows them. myIR's IR3 gives the
   * residential portfolio both, but rental income outside it -- a commercial
   * property -- only as "Other net rental income", one figure.
   */
  grossIncome?: Cents;
  expenses?: Cents;
  /** Income less expenses; negative for a loss. */
  netIncome: Cents;
  /** Residential rental losses are ring-fenced: kept for the property, not set against other income. */
  ringFencedLossBroughtForward?: Cents;
  ringFencedLossUsed?: Cents;
  ringFencedLossCarriedForward?: Cents;
}

/** An individual's return. */
export interface FiledIr3 {
  form: "IR3";
  balanceDate: IsoDate;
  salaryWages?: Cents;
  payeDeducted?: Cents;
  interestGross?: Cents;
  rwtOnInterest?: Cents;
  dividendsGross?: Cents;
  imputationCredits?: Cents;
  rwtOnDividends?: Cents;
  shareholderSalary?: Cents;
  /** The rental schedules' net total that reaches the return. */
  rentalIncome?: Cents;
  selfEmployedIncome?: Cents;
  /** Every other kind of income, together. */
  otherIncome?: Cents;
  totalIncome: Cents;
  expensesClaimed?: Cents;
  netLossBroughtForward?: Cents;
  netLossClaimed?: Cents;
  lossCarriedForward?: Cents;
  taxableIncome: Cents;
  taxOnIncome: Cents;
  /**
   * Independent earner tax credit. Taken off the tax on income before the
   * other credits -- "Tax on taxable income less IETC" on the return -- and
   * not counted among them, so residual income tax could not be checked
   * without it.
   */
  ietc?: Cents;
  totalTaxCredits: Cents;
  residualIncomeTax: Cents;
  taxToPay?: Cents;
  provisionalTaxMethod?: string;
  rentals: FiledRental[];
}

export type FiledIncomeReturn = FiledIr4 | FiledIr3;

/** The IR4's figures asked for, with what each one is, for the prompt and the review. */
export const IR4_FIELDS: readonly (readonly [string, string])[] = [
  ["balanceDate", "the balance date the return is for, as YYYY-MM-DD"],
  ["netIncome", "net income (or net loss, negative) for the year before any losses are claimed"],
  ["netLossBroughtForward", "net loss brought forward from previous years"],
  ["netLossClaimed", "net loss claimed this year"],
  ["lossCarriedForward", "total loss to carry forward to next year"],
  ["residualIncomeTax", "residual income tax"],
  ["taxToPay", "total tax to pay, negative for a refund"],
  ["provisionalTaxMethod", "current provisional tax method, as written (e.g. Standard)"],
  ["imputationOpening", "imputation credit account opening balance"],
  ["imputationClosing", "imputation credit account closing balance"],
  ["lowestEconomicInterest", "lowest economic interest of shareholders, as a percentage number"],
];

/** Kept for what already names it: the IR4's fields. */
export const INCOME_RETURN_FIELDS = IR4_FIELDS;

/** The IR3's figures asked for. */
export const IR3_FIELDS: readonly (readonly [string, string])[] = [
  ["balanceDate", "the balance date the return is for, as YYYY-MM-DD"],
  ["salaryWages", "salary, wages and other income with tax deducted (PAYE), gross"],
  ["payeDeducted", "PAYE deducted from that income"],
  ["interestGross", "interest received, gross"],
  ["rwtOnInterest", "resident withholding tax deducted from interest"],
  ["dividendsGross", "dividends received, gross"],
  ["imputationCredits", "imputation credits on dividends"],
  ["rwtOnDividends", "resident withholding tax deducted from dividends"],
  ["shareholderSalary", "shareholder-employee salary with no tax deducted"],
  ["rentalIncome", "net rental income (or loss, negative) from the rental schedules, as it reaches the return"],
  ["selfEmployedIncome", "self-employed net income"],
  ["otherIncome", "all other income together (overseas, estate or trust, partnership, Maori authority, other), not PIE income taxed at the correct PIR, which is not part of total income"],
  ["totalIncome", "total income"],
  ["expensesClaimed", "expenses claimed against income (e.g. tax agent fees)"],
  ["netLossBroughtForward", "net losses brought forward from previous years"],
  ["netLossClaimed", "net losses claimed this year"],
  ["lossCarriedForward", "net losses to carry forward"],
  ["taxableIncome", "taxable income"],
  ["taxOnIncome", "tax on taxable income"],
  ["ietc", "independent earner tax credit (IETC) entitlement"],
  ["totalTaxCredits", "total tax credits (PAYE, RWT, imputation credits and any others)"],
  ["residualIncomeTax", "residual income tax"],
  ["taxToPay", "total tax to pay, negative for a refund"],
  ["provisionalTaxMethod", "current provisional tax method, as written"],
];

const IR3_RENTAL_FIELDS: readonly (readonly [keyof FiledRental, string])[] = [
  ["property", "the property as the schedule names it"],
  ["grossIncome", "total rental income"],
  ["expenses", "total expenses"],
  ["netIncome", "net rental income, negative for a loss"],
  ["ringFencedLossBroughtForward", "residential ring-fenced loss brought forward"],
  ["ringFencedLossUsed", "ring-fenced loss used this year"],
  ["ringFencedLossCarriedForward", "ring-fenced loss carried forward"],
];

/** Every field the review lists, for either form. */
export function incomeReturnFields(form: IncomeReturnForm): readonly (readonly [string, string])[] {
  return form === "IR3" ? IR3_FIELDS : IR4_FIELDS;
}

const IR4_MONEY = [
  "netIncome", "netLossBroughtForward", "netLossClaimed", "lossCarriedForward",
  "residualIncomeTax", "taxToPay", "imputationOpening", "imputationClosing",
];
/*
 * The loss balances are not required: a company with no losses has those
 * boxes blank, and a model told to leave out what the return does not show
 * left them out -- and the return was refused. Absent reads as nil, and the
 * loss check below still catches a real loss gone missing, because a loss
 * for the year has to be carried forward somewhere.
 */
const IR4_REQUIRED = ["netIncome", "residualIncomeTax"];
const IR3_MONEY = IR3_FIELDS.map(([key]) => key).filter((k) => k !== "balanceDate" && k !== "provisionalTaxMethod");
const IR3_REQUIRED = ["totalIncome", "taxableIncome", "taxOnIncome", "totalTaxCredits", "residualIncomeTax"];

/**
 * The prompt that goes with the PDF.
 *
 * It names every figure, its key and its sign, and asks for JSON alone. The
 * IR10 is asked for by box number because the form prints the numbers, and a
 * number cannot be paraphrased into a different box the way a title can.
 */
export function incomeReturnPrompt(form: IncomeReturnForm = "IR4"): string {
  const common = [
    "Money is a number in dollars and cents, without $ or commas: 12345.67, not \"$12,345.67\".",
    "Net income, net rental income and tax to pay are negative for a loss or a refund. Every",
    "loss balance -- brought forward, claimed, used or carried forward, ring-fenced or not --",
    "is a positive amount. A loss box that is blank, or says nil, means there was no loss:",
    "give it as 0 -- every loss key is always in the answer. Any other figure the return",
    "does not show is left out, never guessed.",
    "Do not include the IRD number, any name or any address,",
    "except a rental property's own address where the schedule names it that way.",
    "",
  ];
  if (form === "IR3") {
    return [
      "The attached PDF is a New Zealand individual income tax return (IR3) from myIR, perhaps",
      "with rental schedules (IR3R). Read it and reply with one JSON object and nothing else --",
      "no explanation, no code fence.",
      "",
      ...common,
      "The object has these keys:",
      '  "form": "IR3"',
      ...IR3_FIELDS.map(([key, what]) => `  "${key}": ${what}`),
      '  "rentals": an array, one object per rental schedule (empty if there are none), with keys:',
      ...IR3_RENTAL_FIELDS.map(([key, what]) => `    "${key}": ${what}`),
      "",
      "Rental income the return gives only as a net figure -- \"Other net rental income\", for",
      "property outside the residential portfolio -- is a rental of its own with just",
      '"property" and "netIncome"; leave out the figures the return does not show.',
      "",
      "Copy each figure exactly as printed. If something is unreadable, leave its key out.",
    ].join("\n");
  }
  const boxes = IR10_LAYOUT.filter((line) => line.box > 1)
    .map((line) => `  "${line.box}": ${line.title}`)
    .join("\n");
  return [
    "The attached PDF is a New Zealand company income tax return (IR4) from myIR, with its",
    "financial statements (IR10). Read it and reply with one JSON object and nothing else --",
    "no explanation, no code fence.",
    "",
    ...common,
    "The object has these keys:",
    '  "form": "IR4"',
    ...IR4_FIELDS.map(([key, what]) => `  "${key}": ${what}`),
    '  "ir10": an object of the IR10 figures by box number, whole dollars as printed:',
    boxes,
    "",
    "Copy each figure exactly as printed. If something is unreadable, leave its key out.",
  ].join("\n");
}

export interface ReadIncomeReturn {
  /** What was read, when it could be; check `problems` before relying on it. */
  filed?: FiledIncomeReturn;
  /** Why it could not be read at all, or where its own figures disagree. */
  problems: string[];
}

function toCents(value: unknown): Cents | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value.replace(/[$,\s]/g, "")) : NaN;
  return Number.isFinite(n) ? (Math.round(n * 100) as Cents) : null;
}

/**
 * Loss balances: amounts, whatever sign they arrive with.
 *
 * A model told that a loss is negative wrote the losses brought forward and
 * carried forward as negatives, and the return then did not add up. A loss
 * balance has no meaningful sign -- the word "loss" is the sign -- so it is
 * read as its size.
 */
const LOSS_BALANCES = new Set([
  "netLossBroughtForward",
  "netLossClaimed",
  "lossCarriedForward",
  "ringFencedLossBroughtForward",
  "ringFencedLossUsed",
  "ringFencedLossCarriedForward",
]);

function readMoney(
  raw: Record<string, unknown>,
  keys: readonly string[],
  problems: string[],
  where = "",
): Record<string, Cents> {
  const money: Record<string, Cents> = {};
  for (const key of keys) {
    if (raw[key] === undefined || raw[key] === null || raw[key] === "") continue;
    const cents = toCents(raw[key]);
    if (cents === null) problems.push(`${where}"${key}" is not an amount.`);
    else money[key] = (LOSS_BALANCES.has(key) ? Math.abs(cents) : cents) as Cents;
  }
  return money;
}

/**
 * Read a model's answer, and check the return adds up.
 *
 * The answer is data, not instructions: only the keys asked for are read,
 * and each as a number, a date or a short piece of text. Anything else is
 * ignored. `expected`, when given, is the form somebody said they were
 * reading, and an answer for the other one is refused.
 */
export function readIncomeReturn(text: string, expected?: IncomeReturnForm): ReadIncomeReturn {
  const problems: string[] = [];
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return { problems: ["There is no JSON object in that answer."] };
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return { problems: ["That answer is not valid JSON."] };
  }
  if (typeof raw !== "object" || raw === null) return { problems: ["That answer is not a JSON object."] };

  const form = String(raw["form"] ?? expected ?? "IR4").toUpperCase();
  if (form !== "IR4" && form !== "IR3") return { problems: [`It says the return is an ${form}; only the IR4 and IR3 are read.`] };
  if (expected !== undefined && form !== expected) {
    return { problems: [`That answer is for an ${form}, and an ${expected} was being read.`] };
  }

  const balanceDate = String(raw["balanceDate"] ?? "");
  const fatal: string[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(balanceDate)) fatal.push("The balance date is missing or not YYYY-MM-DD.");
  const method = typeof raw["provisionalTaxMethod"] === "string" ? raw["provisionalTaxMethod"].trim().slice(0, 40) : "";

  if (form === "IR3") {
    const money = readMoney(raw, IR3_MONEY, problems);
    for (const key of IR3_REQUIRED) if (money[key] === undefined) fatal.push(`"${key}" is missing.`);
    const rentals: FiledRental[] = [];
    const listed = Array.isArray(raw["rentals"]) ? (raw["rentals"] as unknown[]) : [];
    listed.forEach((item, index) => {
      if (typeof item !== "object" || item === null) return;
      const one = item as Record<string, unknown>;
      const where = `Rental ${index + 1}: `;
      const m = readMoney(one, ["grossIncome", "expenses", "netIncome", "ringFencedLossBroughtForward", "ringFencedLossUsed", "ringFencedLossCarriedForward"], problems, where);
      // The net figure is what reaches the return. Income and expenses are
      // there for the residential portfolio and not for rental income outside
      // it, which myIR shows as one net figure -- and requiring all three
      // refused a whole return for a figure it does not print. Any one of the
      // three missing is worked out from the other two.
      let gross = m["grossIncome"];
      let spent = m["expenses"];
      let net = m["netIncome"];
      if (net === undefined && gross !== undefined && spent !== undefined) net = (gross - spent) as Cents;
      if (gross === undefined && spent !== undefined && net !== undefined) gross = (net + spent) as Cents;
      if (spent === undefined && gross !== undefined && net !== undefined) spent = (gross - net) as Cents;
      if (net === undefined) {
        fatal.push(`${where}its net income is needed, or its income and expenses to work it out.`);
        return;
      }
      rentals.push({
        property: String(one["property"] ?? `Rental ${index + 1}`).trim().slice(0, 80),
        ...(gross !== undefined ? { grossIncome: gross } : {}),
        ...(spent !== undefined ? { expenses: spent } : {}),
        netIncome: net,
        ...(m["ringFencedLossBroughtForward"] !== undefined ? { ringFencedLossBroughtForward: m["ringFencedLossBroughtForward"] } : {}),
        ...(m["ringFencedLossUsed"] !== undefined ? { ringFencedLossUsed: m["ringFencedLossUsed"] } : {}),
        ...(m["ringFencedLossCarriedForward"] !== undefined ? { ringFencedLossCarriedForward: m["ringFencedLossCarriedForward"] } : {}),
      });
    });
    if (fatal.length > 0) return { problems: [...fatal, ...problems] };
    // The rentals' net, where the answer gave them only in the schedules. The
    // return's total includes it, and checking that total against an income
    // list without it reported a return that adds up as one that does not.
    if (money["rentalIncome"] === undefined && rentals.length > 0) {
      money["rentalIncome"] = rentals.reduce((sum, r) => sum + r.netIncome, 0) as Cents;
    }
    const filed: FiledIr3 = {
      form: "IR3",
      balanceDate,
      ...Object.fromEntries(Object.entries(money)),
      totalIncome: money["totalIncome"] ?? 0,
      taxableIncome: money["taxableIncome"] ?? 0,
      taxOnIncome: money["taxOnIncome"] ?? 0,
      totalTaxCredits: money["totalTaxCredits"] ?? 0,
      residualIncomeTax: money["residualIncomeTax"] ?? 0,
      ...(method !== "" ? { provisionalTaxMethod: method } : {}),
      rentals,
    };
    return { filed, problems: [...problems, ...incomeReturnDisagreements(filed)] };
  }

  const money = readMoney(raw, IR4_MONEY, problems);
  for (const key of IR4_REQUIRED) if (money[key] === undefined) fatal.push(`"${key}" is missing.`);
  const ir10: Record<number, Cents> = {};
  const boxes = raw["ir10"];
  if (typeof boxes === "object" && boxes !== null) {
    for (const [key, value] of Object.entries(boxes as Record<string, unknown>)) {
      const box = Number(key);
      if (!Number.isInteger(box) || box < 2 || box > 60) continue;
      const cents = toCents(value);
      if (cents === null) problems.push(`IR10 box ${box} is not an amount.`);
      else ir10[box] = cents;
    }
  }
  if (fatal.length > 0) return { problems: [...fatal, ...problems] };

  const interest = raw["lowestEconomicInterest"];
  const lei = typeof interest === "number" ? interest : typeof interest === "string" ? Number(interest.replace("%", "")) : undefined;
  const filed: FiledIr4 = {
    form: "IR4",
    balanceDate,
    netIncome: money["netIncome"] ?? 0,
    netLossBroughtForward: money["netLossBroughtForward"] ?? 0,
    netLossClaimed: money["netLossClaimed"] ?? 0,
    lossCarriedForward: money["lossCarriedForward"] ?? 0,
    residualIncomeTax: money["residualIncomeTax"] ?? 0,
    ...(money["taxToPay"] !== undefined ? { taxToPay: money["taxToPay"] } : {}),
    ...(method !== "" ? { provisionalTaxMethod: method } : {}),
    ...(money["imputationOpening"] !== undefined ? { imputationOpening: money["imputationOpening"] } : {}),
    ...(money["imputationClosing"] !== undefined ? { imputationClosing: money["imputationClosing"] } : {}),
    ...(lei !== undefined && Number.isFinite(lei) ? { lowestEconomicInterest: lei } : {}),
    ir10,
  };
  return { filed, problems: [...problems, ...incomeReturnDisagreements(filed)] };
}

const show = (n: number): string => (n / 100).toFixed(2);

/** The loss that should carry forward, and whether it does. */
function lossCheck(
  broughtForward: Cents,
  claimed: Cents,
  thisYear: Cents,
  carried: Cents,
  what: string,
): string | null {
  const expected = broughtForward - claimed + Math.max(0, -thisYear);
  if (Math.abs(expected - carried) <= 1) return null;
  return (
    `${what} carried forward should be ${show(expected)} (brought forward ${show(broughtForward)}, ` +
    `less ${show(claimed)} used` +
    (thisYear < 0 ? `, plus this year's loss of ${show(-thisYear)}` : "") +
    `), and it reads ${show(carried)}.`
  );
}

/**
 * Where a return's own figures do not add up.
 *
 * Every one of these is arithmetic the form itself does, so a disagreement is
 * a figure read wrongly, not a view about the tax. Dollars on the IR10 are
 * allowed a dollar each way for rounding; the return's own figures a cent.
 */
export function incomeReturnDisagreements(filed: FiledIncomeReturn): string[] {
  return filed.form === "IR3" ? ir3Disagreements(filed) : ir4Disagreements(filed);
}

function ir3Disagreements(filed: FiledIr3): string[] {
  const out: string[] = [];
  const parts = [
    filed.salaryWages, filed.interestGross, filed.dividendsGross, filed.shareholderSalary,
    filed.rentalIncome, filed.selfEmployedIncome, filed.otherIncome,
  ];
  const summed = parts.reduce<number>((s, p) => s + (p ?? 0), 0);
  // A return whose total is the sum of what it lists. A residential rental's
  // loss is ring-fenced and reaches the total as nothing; a commercial one's
  // is set against other income. Either reading of a negative rental figure
  // is the return adding up.
  const counted = summed - Math.min(0, filed.rentalIncome ?? 0);
  if (Math.abs(counted - filed.totalIncome) > 100 && Math.abs(summed - filed.totalIncome) > 100) {
    out.push(`Total income reads ${show(filed.totalIncome)}, and the income listed comes to ${show(counted)}.`);
  }
  const taxable =
    filed.totalIncome - (filed.expensesClaimed ?? 0) - (filed.netLossClaimed ?? 0);
  if (Math.abs(taxable - filed.taxableIncome) > 100) {
    out.push(
      `Taxable income should be ${show(taxable)} (total income less expenses and losses claimed), ` +
        `and it reads ${show(filed.taxableIncome)}.`,
    );
  }
  const rit = Math.max(0, filed.taxOnIncome - (filed.ietc ?? 0) - filed.totalTaxCredits);
  if (Math.abs(rit - filed.residualIncomeTax) > 100) {
    out.push(
      `Residual income tax should be ${show(rit)} (tax on income minus ` +
        `${filed.ietc === undefined ? "" : "IETC and "}tax credits), and it reads ` +
        `${show(filed.residualIncomeTax)}.`,
    );
  }
  if (filed.netLossBroughtForward !== undefined && filed.lossCarriedForward !== undefined) {
    const said = lossCheck(
      filed.netLossBroughtForward,
      filed.netLossClaimed ?? 0,
      (filed.totalIncome - (filed.expensesClaimed ?? 0)) as Cents,
      filed.lossCarriedForward,
      "Net loss",
    );
    if (said !== null) out.push(said);
  }
  for (const rental of filed.rentals) {
    if (
      rental.grossIncome !== undefined &&
      rental.expenses !== undefined &&
      Math.abs(rental.grossIncome - rental.expenses - rental.netIncome) > 100
    ) {
      out.push(
        `${rental.property}: net income reads ${show(rental.netIncome)}, and income less expenses is ` +
          `${show(rental.grossIncome - rental.expenses)}.`,
      );
    }
    if (rental.ringFencedLossBroughtForward !== undefined && rental.ringFencedLossCarriedForward !== undefined) {
      const said = lossCheck(
        rental.ringFencedLossBroughtForward,
        rental.ringFencedLossUsed ?? 0,
        rental.netIncome,
        rental.ringFencedLossCarriedForward,
        `${rental.property}: ring-fenced loss`,
      );
      if (said !== null) out.push(said);
    }
  }
  return out;
}

function ir4Disagreements(filed: FiledIr4): string[] {
  const out: string[] = [];
  const loss = lossCheck(
    filed.netLossBroughtForward,
    filed.netLossClaimed,
    filed.netIncome,
    filed.lossCarriedForward,
    "Loss",
  );
  if (loss !== null) out.push(loss);
  if (filed.netLossClaimed > filed.netLossBroughtForward + 1) {
    out.push("More loss is claimed than was brought forward.");
  }
  if (filed.netIncome >= 0 && filed.netLossClaimed > filed.netIncome + 1) {
    out.push("More loss is claimed than there was income to set it against.");
  }

  const box = filed.ir10;
  const have = (...boxes: number[]) => boxes.every((b) => box[b] !== undefined);
  const sum = (boxes: number[]) => boxes.reduce((s, b) => s + (box[b] ?? 0), 0);
  const check = (total: number, parts: () => number, what: string) => {
    if (box[total] === undefined) return;
    const worked = parts();
    if (Math.abs(worked - (box[total] ?? 0)) > 100) {
      out.push(`IR10 box ${total} (${what}) reads ${show(box[total] ?? 0)} but its parts come to ${show(worked)}.`);
    }
  };
  if (Object.keys(box).length > 0) {
    check(6, () => (box[2] ?? 0) - (box[3] ?? 0) - (box[4] ?? 0) + (box[5] ?? 0), "gross profit");
    if (have(6)) check(11, () => sum([6, 7, 8, 9, 10]), "total income");
    check(25, () => sum([12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24]), "total expenses");
    if (have(11, 25)) check(27, () => (box[11] ?? 0) - (box[25] ?? 0) + (box[26] ?? 0), "net profit before tax");
    if (have(27)) check(29, () => (box[27] ?? 0) + (box[28] ?? 0), "taxable profit");
    check(43, () => sum([30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42]), "total assets");
    check(48, () => sum([44, 45, 46, 47]), "total current liabilities");
    if (have(48)) check(50, () => (box[48] ?? 0) + (box[49] ?? 0), "total liabilities");
    if (have(43, 50)) check(51, () => (box[43] ?? 0) - (box[50] ?? 0), "owners' equity");
    // The return's net income is the IR10's taxable profit, to the dollar.
    if (box[29] !== undefined && Math.abs(Math.round(filed.netIncome / 100) * 100 - (box[29] ?? 0)) > 100) {
      out.push(`Net income reads ${show(filed.netIncome)}, and IR10 box 29 (taxable profit) ${show(box[29] ?? 0)}.`);
    }
  }
  return out;
}

export interface Ir10Difference {
  box: number;
  title: string;
  filed: Cents;
  books: Cents;
}

/**
 * The boxes where the filed IR10 and the books' own differ.
 *
 * Only boxes the return shows. A difference is not a mistake in itself -- a
 * late adjustment, or a filed figure the accountant rounded differently -- it
 * is where to look.
 */
export function ir10Differences(
  filed: Readonly<Record<number, Cents>>,
  books: Readonly<Record<number, Cents>>,
): Ir10Difference[] {
  const out: Ir10Difference[] = [];
  for (const line of IR10_LAYOUT) {
    const given = filed[line.box];
    if (given === undefined) continue;
    const ours = books[line.box] ?? 0;
    if (Math.abs(given - ours) > 100) out.push({ box: line.box, title: line.title, filed: given, books: ours });
  }
  return out;
}
