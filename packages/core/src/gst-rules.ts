import { matchText } from "./rules.js";
import type { GstClassification, GstResolver, GstSide, GstTreatment } from "./gst.js";
import { isAccountNumber } from "./accounts.js";
import type { Transaction } from "./types.js";
import type { Overrides } from "./overrides.js";
import { gstOverride } from "./overrides.js";

/**
 * Deciding how each transaction is treated for GST.
 *
 * This is the replacement for the workbook's `GST_Rules` and `GST_Overrides`
 * sheets: a keyword, optionally narrowed by account and direction, resolving to
 * a treatment. Rules are tried highest priority first, and the first match
 * wins, so a specific override can sit above a general default.
 *
 * The built-in defaults below are a **starting point, not tax advice.** They
 * encode the handful of exclusions that are wrong often enough to matter --
 * transfers between your own accounts, loan principal, drawings, wages and IRD
 * payments -- because leaving those in is the commonest way to overstate a
 * return. Everything else falls through to standard-rated, which is right for
 * most domestic trading and wrong for overseas purchases. Review the output
 * before filing anything.
 */

export interface GstRule {
  /** Case-insensitive substring, matched against the transaction's text fields. */
  keyword?: string;
  /** Restrict to one account id. */
  account?: string;
  /** Restrict by direction: `CR` is money in, `DR` is money out. */
  sign?: "CR" | "DR";
  /** Only match when the counterparty is another account of the same entity. */
  ownTransfer?: boolean;
  /**
   * Only match when the counterparty is an account you own but which belongs
   * to a different entity -- personal to company, company to a rental.
   */
  relatedTransfer?: boolean;
  treatment: GstTreatment;
  /** Which side of the return this falls on. Defaults from the sign. */
  side?: GstSide;
  /** Why. Shown against the line so a classification can be argued with. */
  note: string;
  /** Higher wins. Defaults to 0. */
  priority?: number;
}

/**
 * What an account code implies for GST.
 *
 * Most codes need only a treatment, so a bare string is accepted too. The
 * object form exists for codes that carry more: entertainment is standard-rated
 * but only half deductible, and that belongs on the code rather than being
 * split by hand on every transaction that touches it.
 */
export interface CodeTreatment {
  treatment: GstTreatment;
  /** Overrides the side implied by the direction of the amount. */
  side?: GstSide;
  /** Percentage of the expenditure that is deductible. Defaults to 100. */
  deductiblePercent?: number;
}

export interface GstRulesOptions {
  /**
   * Account ids belonging to the entity this return is for.
   *
   * A transfer is out of scope only when **both ends belong to the same
   * entity**. Moving money between a company's two accounts is not a supply;
   * money arriving into the company from a shareholder's personal account is a
   * different thing entirely, and may well be the receipt that has to be coded.
   *
   * Treating every account in the ledger as "yours" silently deletes real
   * income whenever a customer pays into a personal account and the money is
   * swept across afterwards.
   */
  ownAccounts?: Iterable<string>;
  /**
   * Every account you own, across all entities.
   *
   * Money moving between entities you control is not a third-party supply, but
   * it is not nothing either, and the direction decides what it is: money
   * arriving into the business from a personal account is usually a customer
   * receipt routed through, while money leaving the business for a personal
   * account is usually drawings or a loan repayment. Both are treated as
   * suggestions to confirm, not conclusions.
   */
  relatedAccounts?: Iterable<string>;
  /** Rules to try before the built-in defaults. */
  rules?: readonly GstRule[];
  /** Replace the built-in defaults entirely rather than adding to them. */
  replaceDefaults?: boolean;
  /** Manual GST corrections keyed by transaction id. Checked before any rule. */
  overrides?: Overrides;
  /**
   * Account code to GST treatment -- the workbook's `GST_Rules` sheet.
   *
   * This is the layer that matters most in practice. GST treatment mostly
   * follows what a transaction *is*, not who it was paid to: everything coded
   * to drawings, a loan, or a transfer is out of scope whoever the payee was.
   * Keying on the code rather than the payee is why the workbook needed only
   * six keyword overrides to cover years of data.
   */
  codeTreatments?: Readonly<Record<string, GstTreatment | CodeTreatment>>;

  /**
   * The treatment an account's chart row implies, for codes with no entry above.
   *
   * A chart of accounts already records how each account is treated -- it is
   * what the package it was exported from used to work out GST. Consulting it
   * is what stops a freshly loaded chart having to be re-stated by hand, one
   * account at a time, before a return can be trusted.
   *
   * Below `codeTreatments` deliberately: that map holds decisions taken about
   * this data, and a decision outranks the file's default.
   */
  chartTreatment?: (code: string) => CodeTreatment | null;
  /**
   * How to find a transaction's code, for `codeTreatments`.
   *
   * Supplied by the caller because coding is a separate stage; GST should not
   * have its own opinion about what a transaction is.
   */
  codeOf?: (transaction: Transaction) => string | null;
}

/**
 * Exclusions that apply regardless of business.
 *
 * Money moving between accounts you own is not a supply; neither is repaying
 * a loan, drawing profit, paying wages, or settling GST itself. Interest and
 * bank fees are exempt financial services.
 */
export const DEFAULT_GST_RULES: readonly GstRule[] = [
  // --- transfers between your own accounts -------------------------------
  {
    ownTransfer: true,
    treatment: "out-of-scope",
    side: "none",
    note: "Transfer between your own accounts: not a supply",
    priority: 100,
  },
  { keyword: "BNZCREDITCDS", treatment: "out-of-scope", side: "none", note: "Credit card payment", priority: 90 },
  { keyword: "PAYMENT - THANK YOU", treatment: "out-of-scope", side: "none", note: "Credit card payment", priority: 90 },
  // `INTERNET XFR` is how the payment was made, not who it was to. Unqualified
  // it wrongly excludes every customer receipt paid by online transfer, so it
  // fires only when the counterparty is also this entity's own account.
  {
    keyword: "INTERNET XFR",
    ownTransfer: true,
    treatment: "out-of-scope",
    side: "none",
    note: "Internal transfer between this entity's own accounts",
    priority: 60,
  },

  // --- money moving between entities you control ---------------------------
  // Not a third-party supply either way, but the direction decides what it is.
  // Money out of the business to an account you own is drawings or a loan
  // repayment, never a purchase; leaving it as a purchase inflates Box 11 with
  // every sweep. Money *in* is left alone, because it is commonly a customer
  // receipt banked elsewhere first, and wrongly excluding it deletes income.
  {
    relatedTransfer: true,
    sign: "DR",
    treatment: "out-of-scope",
    side: "none",
    note: "Transfer out to another account you own: drawings or a loan, not a purchase. Confirm.",
    priority: 70,
  },

  // --- tax and payroll ----------------------------------------------------
  { keyword: "INLAND REVENUE", treatment: "out-of-scope", side: "none", note: "IRD: tax is not a supply", priority: 90 },
  { keyword: "I.R.D", treatment: "out-of-scope", side: "none", note: "IRD: tax is not a supply", priority: 90 },
  { keyword: "IRD SALARY DEDUCTIONS", treatment: "out-of-scope", side: "none", note: "PAYE", priority: 95 },
  { keyword: "KIWISAVER", treatment: "out-of-scope", side: "none", note: "KiwiSaver contributions", priority: 90 },
  { keyword: "PAYE", treatment: "out-of-scope", side: "none", note: "PAYE", priority: 90 },
  { keyword: "SALARY", treatment: "out-of-scope", side: "none", note: "Wages are not a supply", priority: 80 },
  { keyword: "WAGES", treatment: "out-of-scope", side: "none", note: "Wages are not a supply", priority: 80 },

  // --- finance ------------------------------------------------------------
  { keyword: "LOAN PAYMT", treatment: "exempt", side: "none", note: "Loan repayment: exempt financial service", priority: 90 },
  { keyword: "HOUSING LOAN", treatment: "exempt", side: "none", note: "Loan repayment: exempt financial service", priority: 90 },
  { keyword: "HOME LOAN", treatment: "exempt", side: "none", note: "Loan repayment: exempt financial service", priority: 90 },
  { keyword: "TOTALMONEY", treatment: "exempt", side: "none", note: "Loan repayment: exempt financial service", priority: 90 },
  { keyword: "LOAN DRAWDOWN", treatment: "exempt", side: "none", note: "Loan principal: exempt financial service", priority: 90 },
  { keyword: "LOAN INTEREST", treatment: "exempt", side: "none", note: "Interest: exempt financial service", priority: 90 },
  { keyword: "INTEREST", treatment: "exempt", side: "none", note: "Interest: exempt financial service", priority: 50 },
  { keyword: "BANK FEE", treatment: "exempt", side: "none", note: "Bank fees: exempt financial service", priority: 50 },

  // --- GST charged at the border ------------------------------------------
  // Customs and courier GST is the GST itself, not a GST-inclusive cost, and
  // Box 11 excludes imported goods. It is claimed through Box 13 instead.
  {
    keyword: "GST ON IMPORTATION",
    treatment: "standard",
    side: "imports",
    note: "GST charged at the border: Box 13, not Box 11",
    priority: 120,
  },
  {
    keyword: "ENTRY FEE GST",
    treatment: "standard",
    side: "imports",
    note: "Customs entry fee GST: Box 13, not Box 11",
    priority: 120,
  },

  // --- owner ---------------------------------------------------------------
  { keyword: "DRAWINGS", treatment: "out-of-scope", side: "none", note: "Owner drawings", priority: 80 },
];

/**
 * Build a resolver from a rule set.
 *
 * The fall-through is deliberate and stated on every line it produces: money
 * in is treated as a standard-rated sale, money out as a standard-rated
 * purchase. That is right for ordinary domestic trading and wrong for anything
 * bought overseas or from an unregistered supplier, so unmatched lines are
 * worth reading rather than trusting.
 */
export function gstResolver(options: GstRulesOptions = {}): GstResolver {
  const ownAccounts = new Set(options.ownAccounts ?? []);
  const relatedAccounts = new Set(options.relatedAccounts ?? []);
  const rules = [...(options.rules ?? []), ...(options.replaceDefaults ? [] : DEFAULT_GST_RULES)]
    .map((rule, index) => ({ rule, index }))
    .sort((a, b) => (b.rule.priority ?? 0) - (a.rule.priority ?? 0) || a.index - b.index)
    .map((entry) => entry.rule);

  return (transaction: Transaction): GstClassification => {
    const manual = gstOverride(transaction, options.overrides);
    if (manual) return manual;

    const haystack = searchText(transaction);
    const sign = transaction.amount < 0 ? "DR" : "CR";

    for (const rule of rules) {
      if (rule.account !== undefined && rule.account !== transaction.account) continue;
      if (rule.sign !== undefined && rule.sign !== sign) continue;
      if (rule.ownTransfer === true && !isOwnTransfer(transaction, ownAccounts)) continue;
      if (rule.relatedTransfer === true) {
        // Between entities, not within one: excluded from the entity's own set
        // but still an account the user controls.
        if (isOwnTransfer(transaction, ownAccounts)) continue;
        if (!isOwnTransfer(transaction, relatedAccounts)) continue;
      }
      if (rule.keyword !== undefined && !haystack.includes(matchText(rule.keyword))) continue;

      return {
        treatment: rule.treatment,
        side: rule.side ?? defaultSide(sign),
        reason: rule.note,
      };
    }

    // Then the treatment that follows from what the transaction was coded to.
    const code = options.codeOf?.(transaction) ?? null;
    if (code !== null) {
      const entry = options.codeTreatments?.[code];
      if (entry !== undefined) {
        // Written either as a bare treatment or as an object, so a code that
        // needs nothing more than "standard" still reads as one word.
        const detail: CodeTreatment = typeof entry === "string" ? { treatment: entry } : entry;
        const taxable = detail.treatment === "standard" || detail.treatment === "zero-rated";
        const percent = detail.deductiblePercent;
        return {
          treatment: detail.treatment,
          side: detail.side ?? (taxable ? defaultSide(sign) : "none"),
          ...(percent !== undefined ? { deductiblePercent: percent } : {}),
          reason:
            percent !== undefined && percent !== 100
              ? `Code ${code} is ${detail.treatment}, ${percent}% deductible`
              : `Code ${code} is treated as ${detail.treatment}`,
        };
      }
    }

    // Then what the chart says about the account, before giving up and assuming.
    if (code !== null) {
      const implied = options.chartTreatment?.(code) ?? null;
      if (implied !== null) {
        const taxable = implied.treatment === "standard" || implied.treatment === "zero-rated";
        const percent = implied.deductiblePercent;
        return {
          treatment: implied.treatment,
          side: implied.side ?? (taxable ? defaultSide(sign) : "none"),
          ...(percent !== undefined ? { deductiblePercent: percent } : {}),
          reason: `Chart of accounts treats ${code} as ${implied.treatment}`,
        };
      }
    }

    return {
      treatment: "standard",
      side: defaultSide(sign),
      assumed: true,
      reason:
        code === null
          ? "No rule matched and no code assigned; assumed standard-rated"
          : `No rule matched and code ${code} has no treatment; assumed standard-rated`,
    };
  };
}

function defaultSide(sign: "CR" | "DR"): GstSide {
  return sign === "CR" ? "sales" : "purchases";
}

/**
 * Everything a keyword could reasonably be looked for in, in the one spelling
 * both sides of the match use.
 *
 * The same fold the coding rules use, for the same reason: a keyword written
 * from a line with punctuation in it would otherwise never match the line it
 * came from.
 */
function searchText(transaction: Transaction): string {
  return matchText(
    [
      transaction.otherParty,
      transaction.particulars,
      transaction.code,
      transaction.reference,
      transaction.type,
    ].join(" "),
  );
}

/**
 * True when both ends of the transfer belong to the same entity.
 *
 * This is the only exclusion decidable from the data rather than from a
 * keyword, which makes it the most reliable one available -- but only when it
 * is scoped correctly. Both the account the transaction is on and the
 * counterparty account must be in the set; a transfer that crosses out of the
 * set is a real movement between two different people or businesses.
 */
function isOwnTransfer(transaction: Transaction, ownAccounts: ReadonlySet<string>): boolean {
  if (ownAccounts.size === 0) return false;
  if (!ownAccounts.has(transaction.account)) return false;

  const counterparty = transaction.otherPartyAccount;
  if (counterparty === "") return false;

  if (isAccountNumber(counterparty)) return ownAccounts.has(counterparty);

  // A credit card counterparty is a masked PAN -- `xxxx-xxxx-xxxx-4001` -- not
  // an account number. Card account ids end in the same last four digits, so a
  // company paying its own card is still recognisable as an internal transfer.
  const masked = /^[xX*]{4}-[xX*]{4}-[xX*]{4}-(\d{4})$/.exec(counterparty);
  if (masked) {
    const lastFour = masked[1] as string;
    for (const account of ownAccounts) {
      if (account.endsWith(`-${lastFour}`)) return true;
    }
  }

  return false;
}
