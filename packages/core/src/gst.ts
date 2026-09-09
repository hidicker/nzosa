import type { Cents } from "./money.js";
import type { IsoDate, DateRange } from "./dates.js";
import { daysInMonth, inRange } from "./dates.js";
import type { Transaction } from "./types.js";

/**
 * New Zealand GST returns (form GST101A).
 *
 * The box numbering and arithmetic here follow the printed form exactly, so a
 * result can be typed straight into myIR and compared against what was filed.
 *
 * Two things about this are easy to get subtly wrong, and both are handled
 * deliberately below:
 *
 * 1. The GST content is calculated on the **box total**, not per transaction.
 *    Box 8 is Box 7 multiplied by 3 and divided by 23. Summing a per-line GST
 *    figure instead can differ by a few cents from what the form produces.
 * 2. The **basis** decides what belongs in a period at all. On a payments
 *    basis a sale counts when the money arrives; on an invoice basis it counts
 *    when the invoice is raised. Bank transactions can only answer the first
 *    question, which is why `basis` is explicit rather than assumed.
 */

/** GST rate as a fraction of the GST-inclusive amount: 15% GST is 3/23 of the total. */
const GST_NUMERATOR = 3;
const GST_DENOMINATOR = 23;

export type GstBasis = "payments" | "invoice" | "hybrid";

/**
 * How the GST content is arrived at.
 *
 * `form` follows the printed GST101A: total the box, then take 3/23 of it.
 *
 * `per-line` follows what Xero actually does, which is the other way round --
 * round the GST on each line to the cent, add those up to get Box 8, and then
 * back-derive Box 5 as Box 8 x 23/3. That is why every filed Box 5 carries four
 * decimal places and ends in a repeating fraction.
 *
 * The two differ by a few cents. The form's method is what the form says; the
 * per-line method is what was filed. Use `per-line` to reproduce a return.
 */
export type GstRounding = "form" | "per-line";

export type GstTreatment =
  /** Standard-rated, currently 15%. The amount is GST-inclusive. */
  | "standard"
  /** Zero-rated: included in Box 5 and then removed by Box 6. Exports, going concerns. */
  | "zero-rated"
  /** Exempt: financial services, residential rent. Never appears on the return. */
  | "exempt"
  /**
   * Outside the scope of GST entirely: transfers between your own accounts,
   * loan principal, drawings, wages and PAYE, and GST payments themselves.
   * Leaving these in is the single most common way to overstate a return.
   */
  | "out-of-scope";

export type GstSide =
  | "sales"
  | "purchases"
  /**
   * GST paid at the border on imported goods.
   *
   * Box 11 explicitly excludes imported goods, so this cannot go there. The
   * amount is the GST itself rather than a GST-inclusive cost, and it is
   * claimed through Box 13. Putting a customs GST invoice in Box 11 would
   * claim 3/23 of the GST instead of the GST.
   */
  | "imports"
  | "none";

export interface GstClassification {
  treatment: GstTreatment;
  side: GstSide;
  /**
   * How much of the expenditure is deductible, as a percentage.
   *
   * Entertainment is the case that matters: New Zealand allows half of most
   * entertainment expenditure, and only half its GST may be claimed. Xero
   * models this by splitting the line in two -- half to an entertainment
   * account carrying GST, half to a non-deductible one carrying none -- and
   * the arithmetic here is the same, without requiring every such transaction
   * to be split by hand.
   *
   * Defaults to 100.
   */
  deductiblePercent?: number;
  /** Optional human-readable reason, surfaced in the detail listing. */
  reason?: string;
  /**
   * True when nothing decided this and standard rating was assumed.
   *
   * An uncoded purchase falls through every rule and every treatment and is
   * treated as standard-rated, which puts it in Box 11 and claims three
   * twenty-thirds of it in Box 12. That is a guess, and it is a guess in the
   * expensive direction: over-claiming input tax is the half of a return
   * Inland Revenue comes back about, and it happens silently on any set of
   * books that is only part-way coded.
   *
   * Nothing here changes what is computed. It marks the figures that rest on
   * an assumption so a screen can say so before somebody files them.
   */
  assumed?: boolean;
}

/** Decides how one transaction is treated. Supplied by the caller. */
export type GstResolver = (transaction: Transaction) => GstClassification;

export interface GstPeriod {
  from: IsoDate;
  to: IsoDate;
  /** e.g. `2025-05` for the two months ending 31 May 2025. */
  label: string;
  /** When the return and payment are due. */
  due: IsoDate;
}

export interface GstReturnBoxes {
  /** Total sales and income for the period, including GST and zero-rated supplies. */
  box5: Cents;
  /** Zero-rated supplies included in Box 5. */
  box6: Cents;
  /** Box 5 minus Box 6. */
  box7: Cents;
  /** Box 7 multiplied by 3, divided by 23. */
  box8: Cents;
  /** Adjustments from the calculation sheet. */
  box9: Cents;
  /** Box 8 plus Box 9: total GST collected on sales and income. */
  box10: Cents;
  /** Total purchases and expenses including GST, excluding imported goods. */
  box11: Cents;
  /** Box 11 multiplied by 3, divided by 23. */
  box12: Cents;
  /** Credit adjustments from the calculation sheet. */
  box13: Cents;
  /** Box 12 plus Box 13: total GST credit for purchases and expenses. */
  box14: Cents;
  /** The difference between Box 10 and Box 14, as a positive number. */
  box15: Cents;
  /** Which way Box 15 goes. Box 14 larger than Box 10 is a refund. */
  outcome: "pay" | "refund" | "nil";
}

export interface GstReturnOptions {
  /** How each transaction is treated. */
  resolve: GstResolver;
  /**
   * Recognition basis.
   *
   * `payments` uses the date money moved, which is what a bank export gives.
   * `invoice` and `hybrid` need a tax point -- the date the invoice was raised
   * -- which a bank export does not contain. Transactions carrying one in
   * `extras[taxPointField]` are placed by it; those without are reported in
   * `missingTaxPoint` rather than being quietly treated as if paid and
   * invoiced on the same day.
   */
  basis: GstBasis;
  /** Where the tax point lives on non-payments bases. Defaults to `taxPointDate`. */
  taxPointField?: string;
  /**
   * Fraction of each amount that belongs to this filer, as a percentage.
   *
   * Co-owned property is often registered per owner, each filing their own
   * share. Rimu Lane is held 50/50, so each partner files 50.
   */
  sharePercent?: number;
  /**
   * The period a transaction's GST is claimed in, when not the natural one.
   *
   * A return that has already been filed cannot be reopened for an expense
   * that turns up later, so the claim is made in a following period instead.
   * The money still moved when it moved -- what shifts is only where the GST
   * is claimed, and it is claimed as an adjustment rather than in Box 5 or 11,
   * because those boxes state the period's own trading.
   *
   * Return the period-end date to claim in, or null to leave it where it falls.
   */
  claimIn?: (transaction: Transaction) => IsoDate | null;
  /** Box 9 adjustments, if any. */
  adjustments?: Cents;
  /** Box 13 credit adjustments, if any. */
  creditAdjustments?: Cents;
  /** How to arrive at the GST content. Defaults to `form`. */
  rounding?: GstRounding;
}

export interface GstReturnLine {
  transaction: Transaction;
  classification: GstClassification;
  /** The amount after any share is applied, as it contributes to the boxes. */
  amount: Cents;
}

export interface GstReturnResult {
  period: GstPeriod;
  basis: GstBasis;
  sharePercent: number;
  boxes: GstReturnBoxes;
  /** Every transaction that contributed to Box 5 or Box 11. */
  lines: GstReturnLine[];
  /** Transactions excluded from the return, with the reason. */
  excluded: GstReturnLine[];
  /**
   * Transactions claimed in this period but belonging to an earlier one.
   *
   * They sit in Box 9 or Box 13, not in Box 5 or Box 11.
   */
  lateClaims: GstReturnLine[];
  /**
   * On an invoice or hybrid basis, transactions with no tax point recorded.
   *
   * These were placed by their payment date instead, which is the payments-basis
   * answer. A non-empty list means the return is not yet a true invoice-basis
   * return, and saying so is the whole point of tracking it.
   */
  missingTaxPoint: Transaction[];
}

/**
 * Extract the GST content of a GST-inclusive amount.
 *
 * Rounds half away from zero so a credit note is rounded the mirror image of
 * the invoice it reverses, rather than both drifting the same direction.
 */
export function gstContent(inclusive: Cents): Cents {
  const exact = (inclusive * GST_NUMERATOR) / GST_DENOMINATOR;
  return Math.sign(exact) * Math.round(Math.abs(exact));
}

/** Build one GST101A return for a period. */
export function gstReturn(
  transactions: readonly Transaction[],
  period: GstPeriod,
  options: GstReturnOptions,
): GstReturnResult {
  const sharePercent = options.sharePercent ?? 100;
  const taxPointField = options.taxPointField ?? "taxPointDate";
  const usesTaxPoint = options.basis !== "payments";

  const lines: GstReturnLine[] = [];
  const excluded: GstReturnLine[] = [];
  const lateClaims: GstReturnLine[] = [];
  const missingTaxPoint: Transaction[] = [];
  let lateDebit = 0;
  let lateCredit = 0;

  let box5 = 0;
  let box6 = 0;
  let box11 = 0;
  let importGst = 0;
  let perLineGst = 0;
  let perLinePurchaseGst = 0;

  for (const transaction of transactions) {
    // Which date decides the period depends entirely on the basis.
    let effective = transaction.date;
    if (usesTaxPoint) {
      const taxPoint = transaction.extras[taxPointField];
      if (taxPoint === undefined || taxPoint === "") {
        if (inRange(transaction.date, period)) missingTaxPoint.push(transaction);
      } else {
        effective = taxPoint;
      }
    }

    // A deferred transaction belongs to exactly one period: the one it is
    // claimed in. It is not in its natural period at all, so the two returns
    // together still account for it once.
    const deferredTo = options.claimIn?.(transaction) ?? null;
    if (deferredTo !== null) {
      if (deferredTo !== period.to) continue;
    } else if (!inRange(effective, period)) {
      continue;
    }

    const classification = options.resolve(transaction);
    const amount = applyShare(transaction.amount, sharePercent);
    const entry: GstReturnLine = { transaction, classification, amount };

    if (
      classification.side === "none" ||
      classification.treatment === "out-of-scope" ||
      classification.treatment === "exempt"
    ) {
      excluded.push(entry);
      continue;
    }

    // A zero-rated purchase is excluded too, and for a reason worth stating.
    //
    // Box 12 is not summed from the lines; the form works it out as 3/23 of
    // Box 11. So anything placed in Box 11 claims GST at 15% whether or not
    // any was charged -- and a zero-rated purchase had none. Putting one there
    // claims a credit for tax nobody paid, which is a wrong return in the
    // direction that gets noticed.
    //
    // Zero-rated *sales* are different and stay: Box 5 takes them and Box 6
    // takes them straight back out, which is what the form asks for.
    if (classification.side === "purchases" && classification.treatment === "zero-rated") {
      excluded.push({
        ...entry,
        classification: {
          ...classification,
          reason: "Zero-rated purchase: no GST was charged, so none can be claimed",
        },
      });
      continue;
    }

    if (deferredTo !== null) {
      // Claimed here as an adjustment, so the GST is taken now and the gross
      // never reaches Box 5 or Box 11.
      if (classification.side === "imports") lateCredit += -amount;
      else if (classification.side === "sales") lateDebit += gstContent(amount);
      else lateCredit += gstContent(-amount);
      lateClaims.push(entry);
      continue;
    }

    if (classification.side === "imports") {
      // Already the GST figure, so it goes to Box 13 whole rather than having
      // 3/23 taken out of it. Sign flipped once, as with purchases.
      importGst += -amount;
      lines.push(entry);
      continue;
    }

    if (classification.side === "sales") {
      // Box 5 is stated as money in, so a sale is a positive amount. A credit
      // note or refund arrives negative and correctly reduces the box.
      box5 += amount;
      if (classification.treatment === "zero-rated") box6 += amount;
      else perLineGst += gstContent(amount);
    } else {
      // Box 11 is stated as a positive cost, but purchases are negative in the
      // ledger, so the sign is flipped once, here. A supplier refund is
      // positive in the ledger and correctly reduces Box 11.
      //
      // Only the deductible portion reaches the return at all: the rest is
      // not a claimable input, so it belongs in neither box.
      const claimable = applyShare(-amount, classification.deductiblePercent ?? 100);
      box11 += claimable;
      perLinePurchaseGst += gstContent(claimable);
    }

    lines.push(entry);
  }

  const rounding = options.rounding ?? "form";

  // Xero rounds each line's GST and adds those up, then works the box total
  // back from it. The form does the reverse. Which one is used changes the
  // answer by a few cents, so it is explicit rather than assumed.
  const perLine = rounding === "per-line";

  let box7 = box5 - box6;
  let box8 = perLine ? perLineGst : gstContent(box7);
  if (perLine) box7 = Math.round((box8 * GST_DENOMINATOR) / GST_NUMERATOR);

  const box9 = (options.adjustments ?? 0) + lateDebit;
  const box10 = box8 + box9;
  if (perLine) box11 = Math.round((perLinePurchaseGst * GST_DENOMINATOR) / GST_NUMERATOR);
  const box12 = perLine ? perLinePurchaseGst : gstContent(box11);
  const box13 = (options.creditAdjustments ?? 0) + importGst + lateCredit;
  const box14 = box12 + box13;

  const difference = box10 - box14;

  return {
    period,
    basis: options.basis,
    sharePercent,
    boxes: {
      box5,
      box6,
      box7,
      box8,
      box9,
      box10,
      box11,
      box12,
      box13,
      box14,
      box15: Math.abs(difference),
      outcome: difference === 0 ? "nil" : difference > 0 ? "pay" : "refund",
    },
    lines,
    excluded,
    lateClaims,
    missingTaxPoint,
  };
}

/**
 * Apply a filer's percentage share.
 *
 * Rounded half away from zero at the transaction level, matching how a
 * spreadsheet split of each line behaves.
 */
function applyShare(amount: Cents, sharePercent: number): Cents {
  if (sharePercent === 100) return amount;
  const exact = (amount * sharePercent) / 100;
  return Math.sign(exact) * Math.round(Math.abs(exact));
}

export interface GstPeriodOptions {
  /** Months per period: 1, 2 or 6. */
  months: 1 | 2 | 6;
  /**
   * A month in which a period ends, 1-12, which fixes the cycle.
   *
   * New Zealand's two-monthly filers sit on one of two cycles: periods ending
   * Jan/Mar/May/Jul/Sep/Nov, or Feb/Apr/Jun/Aug/Oct/Dec. Passing 3 or 5 selects
   * the first; 2 or 4 the second. Choosing the wrong one moves transactions
   * between returns, so it is required rather than defaulted.
   */
  anchorMonth: number;
}

/**
 * Generate the GST periods covering a date range.
 *
 * Any period that overlaps the range at all is included, so asking for a
 * financial year returns the returns that year's transactions fall into.
 */
export function gstPeriods(range: DateRange, options: GstPeriodOptions): GstPeriod[] {
  const { months, anchorMonth } = options;

  const fromYear = Number(range.from.slice(0, 4));
  const fromMonth = Number(range.from.slice(5, 7));

  // Step back a full cycle so a period that started before the range but ends
  // inside it is still produced.
  let year = fromYear;
  let month = fromMonth;
  while (!isPeriodEnd(month, months, anchorMonth)) {
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }

  const periods: GstPeriod[] = [];
  let endYear = year;
  let endMonth = month;

  // Wind back one period so the first generated period can start before `from`.
  ({ year: endYear, month: endMonth } = addMonths(endYear, endMonth, -months));

  for (let guard = 0; guard < 200; guard += 1) {
    ({ year: endYear, month: endMonth } = addMonths(endYear, endMonth, months));

    const to = `${pad4(endYear)}-${pad2(endMonth)}-${pad2(daysInMonth(endYear, endMonth))}`;
    const start = addMonths(endYear, endMonth, -(months - 1));
    const from = `${pad4(start.year)}-${pad2(start.month)}-01`;

    if (from > range.to) break;
    if (to >= range.from) {
      periods.push({ from, to, label: `${pad4(endYear)}-${pad2(endMonth)}`, due: gstDueDate(to) });
    }
  }

  return periods;
}

function isPeriodEnd(month: number, months: number, anchorMonth: number): boolean {
  return ((month - anchorMonth) % months + months) % months === 0;
}

function addMonths(year: number, month: number, delta: number): { year: number; month: number } {
  const zero = year * 12 + (month - 1) + delta;
  return { year: Math.floor(zero / 12), month: (zero % 12) + 1 };
}

/**
 * The date a return and payment are due.
 *
 * Normally the 28th of the month after the period ends, with two statutory
 * exceptions that exist so the due date does not land in the Christmas period
 * or on the Easter/tax-year boundary.
 */
export function gstDueDate(periodEnd: IsoDate): IsoDate {
  const year = Number(periodEnd.slice(0, 4));
  const month = Number(periodEnd.slice(5, 7));

  // A period ending 30 November is due 15 January, not 28 December.
  if (month === 11) return `${pad4(year + 1)}-01-15`;
  // A period ending 31 March is due 7 May, not 28 April.
  if (month === 3) return `${pad4(year)}-05-07`;

  const next = addMonths(year, month, 1);
  return `${pad4(next.year)}-${pad2(next.month)}-28`;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function pad4(value: number): string {
  return String(value).padStart(4, "0");
}
