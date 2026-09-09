import type { Cents } from "./money.js";
import type { OwnerSummary, TaxExtra, TaxExtraCategory } from "./reports.js";
import { totalExtras } from "./reports.js";

/**
 * The IR3, which is one person's return rather than a company's.
 *
 * Most of what belongs on it never touches a bank account this app can read.
 * Salary arrives net of PAYE; interest arrives net of RWT; a dividend arrives
 * net of RWT with imputation credits attached; PIE income is often reinvested
 * and never arrives at all. A bank feed sees the leftovers, and a return wants
 * the gross and the credits. So those are entered by hand as `TaxExtra` and
 * kept apart from anything derived, which is what that type already exists for.
 *
 * What the books *can* answer is the part a bank feed is actually good at:
 * what a business made, and what each rental property made, apportioned to the
 * people who own them.
 *
 * Two New Zealand rules shape the arithmetic, and both are easy to get wrong in
 * the direction that costs money:
 *
 *  * **Residential rental is ring-fenced.** A loss on residential property
 *    cannot be set against salary or business income. It is carried forward
 *    against future residential income instead. Netting it off would understate
 *    the tax owed.
 *  * **PIE income taxed at the right rate is not taxable income again.** Where
 *    the prescribed investor rate was correct, it does not go into the IR3's
 *    income at all. Adding it would tax it twice.
 *
 * Box numbers are deliberately absent. Inland Revenue renumbers the form, and a
 * stale number printed with confidence is worse than a named line somebody has
 * to place themselves.
 */

export interface Ir3Line {
  /** What the form calls it, in words rather than by number. */
  label: string;
  amount: Cents;
  /** Tax already paid on it: PAYE, RWT, or imputation credits. */
  credits: Cents;
  /** Why it is treated the way it is, where that is not obvious. */
  note?: string;
}

export interface Ir3Summary {
  owner: string;
  /** Financial year, labelled by the year it ends in. */
  year: number;
  /** Income the return taxes, each line as the form names it. */
  income: Ir3Line[];
  /** Shown, but outside taxable income, with the reason on each line. */
  excluded: Ir3Line[];
  totalIncome: Cents;
  /** PAYE, RWT and imputation credits already paid. */
  totalCredits: Cents;
  /**
   * A residential rental loss, which cannot reduce other income.
   *
   * Positive where there is one. It is carried forward against residential
   * income in later years rather than deducted here.
   */
  ringFencedLoss: Cents;
  /** What the books could not know, so nobody assumes they are complete. */
  missing: string[];
}

const LABELS: Record<TaxExtraCategory, string> = {
  salary: "Salary, wages and schedular payments",
  interest: "Interest",
  dividends: "Dividends",
  pie: "PIE income",
  other: "Other income",
};

/** The order the form asks for them in. */
const ORDER: TaxExtraCategory[] = ["salary", "interest", "dividends", "other"];

export function ir3Summary(options: {
  owner: string;
  year: number;
  extras: readonly TaxExtra[];
  /** This person's share of every entity, from `summariseForOwner`. */
  shares?: OwnerSummary;
}): Ir3Summary {
  const { owner, year, extras, shares } = options;
  const mine = extras.filter((e) => e.owner === owner && e.year === year);
  const totals = totalExtras(mine, owner, year);

  const income: Ir3Line[] = [];
  const excluded: Ir3Line[] = [];

  for (const category of ORDER) {
    const amount = totals.byCategory.get(category) ?? 0;
    if (amount === 0) continue;
    const credits = mine
      .filter((e) => e.category === category)
      .reduce((sum, e) => sum + e.credits, 0);
    income.push({ label: LABELS[category], amount, credits });
  }

  // PIE income sits outside, with the reason attached. Where the prescribed
  // investor rate was wrong it does belong on the return, which is a question
  // about the rate rather than about the figure -- so it is shown, not hidden.
  const pie = totals.byCategory.get("pie") ?? 0;
  if (pie !== 0) {
    excluded.push({
      label: LABELS.pie,
      amount: pie,
      credits: mine.filter((e) => e.category === "pie").reduce((sum, e) => sum + e.credits, 0),
      note:
        "Not taxable income again where the prescribed investor rate was right. " +
        "It belongs on the return only if that rate was wrong.",
    });
  }

  // Business and commercial rent: the owner's share of what the books made.
  if (shares !== undefined && shares.otherNet !== 0) {
    income.push({
      label: "Business and other income",
      amount: shares.otherNet,
      credits: 0,
      note: "This person's share of each entity, by the shares recorded against it.",
    });
  }

  // Residential rental, ring-fenced. A profit is taxed; a loss is not deducted.
  let ringFencedLoss = 0;
  if (shares !== undefined && shares.residentialNet !== 0) {
    if (shares.residentialNet > 0) {
      income.push({
        label: "Residential rental income",
        amount: shares.residentialNet,
        credits: 0,
      });
    } else {
      ringFencedLoss = -shares.residentialNet;
      excluded.push({
        label: "Residential rental loss",
        amount: shares.residentialNet,
        credits: 0,
        note:
          "Ring-fenced: a residential rental loss cannot be set against other income. " +
          "It is carried forward against residential income in later years.",
      });
    }
  }

  return {
    owner,
    year,
    income,
    excluded,
    totalIncome: income.reduce((sum, l) => sum + l.amount, 0),
    totalCredits: income.reduce((sum, l) => sum + l.credits, 0),
    ringFencedLoss,
    missing: missingFrom(mine, shares),
  };
}

/**
 * What these books cannot know, said plainly.
 *
 * A return that looks complete is the dangerous kind. Salary, interest and
 * dividends arrive net, and the gross and the credits come from a summary or a
 * certificate rather than from any bank line -- so their absence means nobody
 * has entered them yet, not that there were none.
 */
function missingFrom(extras: readonly TaxExtra[], shares: OwnerSummary | undefined): string[] {
  const seen = new Set(extras.map((e) => e.category));
  const missing: string[] = [];
  if (!seen.has("salary")) {
    missing.push("No salary or wages entered. PAYE is withheld before the money arrives, so a bank feed cannot supply it — take it from the income summary.");
  }
  if (!seen.has("interest")) {
    missing.push("No interest entered. Banks pay it net of RWT; the gross and the credit come from the certificate.");
  }
  if (!seen.has("dividends")) {
    missing.push("No dividends entered. They arrive net, with imputation credits that only the company statement shows.");
  }
  if (shares === undefined) {
    missing.push("No entity shares, so no business or rental income is included.");
  }
  return missing;
}
