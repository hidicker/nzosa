import type { Cents } from "./money.js";
import { provisionalStandardOption } from "./rental-schedules.js";
import type { ProvisionalStandard } from "./rental-schedules.js";

/** The company tax rate, since the 2011 income year. */
export const COMPANY_TAX_RATE = 0.28;

export interface CompanyTax {
  /** The IR10's current year taxable profit (box 29); negative for a loss. */
  taxableProfit: Cents;
  lossBroughtForward: Cents;
  /** How much of it is set against this year's profit. */
  lossClaimed: Cents;
  /** Profit after the loss claimed; nothing for a loss year. */
  taxableIncome: Cents;
  tax: Cents;
  /** Tax less credits already paid on the income (RWT and the like). */
  residualIncomeTax: Cents;
  lossCarriedForward: Cents;
  /** This year's provisional tax, from last year's filed return, where one is held. */
  provisionalThisYear: ProvisionalStandard | null;
  /** Next year's, from this year's residual income tax. */
  provisionalNextYear: ProvisionalStandard;
  notes: string[];
}

/**
 * A company's income tax for a year, carrying last year's loss.
 *
 * The books give the profit (the IR10's box 29); last year's filed return
 * gives the loss brought forward and the residual income tax this year's
 * provisional tax is set from. A loss is set against profit before tax is
 * worked out, as far as the profit goes, and what is left carries on.
 *
 * A company keeps a loss only while its ownership continues: at least 49% of
 * the shareholding the same from when the loss arose, or the business
 * continuity test met instead. That is a fact about the shareholders, which
 * the books cannot see, so it is said rather than assumed -- and where it is
 * known to have failed, no loss is claimed.
 */
export function companyIncomeTax(options: {
  taxableProfit: Cents;
  lossBroughtForward?: Cents;
  /** False where shareholder continuity is known to have broken. */
  continuityMet?: boolean;
  /** The lowest economic interest last year's return gave, for the note. */
  lowestEconomicInterest?: number;
  /** Credits already paid on this year's income. */
  taxCredits?: Cents;
  /** Last year's residual income tax, from its filed return. */
  lastYearResidualIncomeTax?: Cents;
}): CompanyTax {
  const notes: string[] = [];
  const brought = Math.max(0, options.lossBroughtForward ?? 0);
  const profit = options.taxableProfit;
  const usable = options.continuityMet === false ? 0 : brought;
  const lossClaimed = profit > 0 ? Math.min(usable, profit) : 0;
  const taxableIncome = Math.max(0, profit - lossClaimed);
  const lossCarriedForward =
    (options.continuityMet === false ? 0 : brought - lossClaimed) + Math.max(0, -profit);
  const tax = Math.round(taxableIncome * COMPANY_TAX_RATE);
  const residualIncomeTax = Math.max(0, tax - (options.taxCredits ?? 0));

  if (brought > 0) {
    if (options.continuityMet === false) {
      notes.push(
        "Shareholder continuity has broken, so the loss brought forward is not available and " +
          "does not carry on, unless the business continuity test is met.",
      );
    } else {
      notes.push(
        "The loss brought forward counts on the basis that at least 49% of the shareholding " +
          "has continued since it arose" +
          (options.lowestEconomicInterest !== undefined
            ? ` (last year's return gave the lowest economic interest as ${options.lowestEconomicInterest}%)`
            : "") +
          ", or the business continuity test is met.",
      );
    }
  }
  if (options.taxCredits === undefined && tax > 0) {
    notes.push(
      "No tax credits are counted: there is no resident withholding tax account in the books. " +
        "RWT taken from interest reduces the residual income tax; code it to an account named " +
        "for it, such as Resident withholding tax, and it is counted here.",
    );
  }

  return {
    taxableProfit: profit,
    lossBroughtForward: brought,
    lossClaimed,
    taxableIncome,
    tax,
    residualIncomeTax,
    lossCarriedForward,
    provisionalThisYear:
      options.lastYearResidualIncomeTax === undefined
        ? null
        : provisionalStandardOption({ lastYear: options.lastYearResidualIncomeTax }),
    provisionalNextYear: provisionalStandardOption({ lastYear: residualIncomeTax }),
    notes,
  };
}
