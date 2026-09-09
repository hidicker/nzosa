import type { Cents } from "./money.js";
import type { Transaction } from "./types.js";
import type { Overrides } from "./overrides.js";
import { overrideFor } from "./overrides.js";
import { normaliseAccountNumber } from "./accounts.js";

/**
 * Assigning an account code to a transaction.
 *
 * This is a rebuild of the workbook's `Rules` and `Defaults` sheets, and it
 * keeps their structure because that structure was earned. Real bank text is
 * ambiguous in ways that need every one of these narrowings:
 *
 * - The same keyword means different things on different accounts. A hardware
 *   store on one card is one property's expense; on another it is a different
 *   property's.
 * - The same keyword means different things at different amounts. Two loan
 *   repayments share a payee and are told apart only by an amount band.
 * - Priority decides which of several plausible rules wins, so an exact
 *   reference can sit above a loose keyword fallback.
 *
 * A rule that matches nothing is not an error, and an unmatched transaction is
 * not an error either. Both are reported, because silently coding a
 * transaction to the wrong place is far worse than leaving it visibly unknown.
 */

export type Sign = "DR" | "CR";

export interface CategoryRule {
  /** Higher wins. Ties are broken by declaration order. Defaults to 0. */
  priority?: number;
  /** Case-insensitive substring, matched against the transaction's text. */
  keyword?: string;
  /**
   * Substrings that must appear in named fields, all of them.
   *
   * `keyword` searches everything the bank wrote as one run of text, which is
   * what makes it easy to write and unable to tell two things apart when the
   * distinguishing word sits in a particular field.
   *
   * Payments to Inland Revenue are the case that asks for this. They are all
   * the same payee and they are not the same payment: the tax is written in
   * the particulars -- `GST`, `IIT`, `prov tax`, and every way a person spells
   * those in a hurry. One keyword cannot separate them, because "INLAND
   * REVENUE GST" is a phrase only when the particulars say exactly `GST` and
   * not `Q2 GST`. Five rules could do it; one rule saying the payee
   * mentions Inland Revenue *and* the particulars mention GST does it
   * properly, and keeps out a supplier whose own note says "incl gst".
   *
   * Each is folded the way `keyword` is, so punctuation does not decide
   * whether a rule fires.
   */
  where?: {
    otherParty?: string;
    particulars?: string;
    /** The bank's own code field, not the account this rule assigns. */
    code?: string;
    reference?: string;
    /**
     * The account the money went to or came from.
     *
     * The one field that identifies a counterparty when the payee does not.
     * Some banks write the particulars into the payee, so every payment to one
     * supplier arrives under a different name and no keyword can gather them --
     * but they all name the same account number, every time. Written how you
     * like: both sides are normalised, so a rule quoting
     * `38-9022-0374960-00` still matches a feed that pads the suffix.
     */
    otherPartyAccount?: string;
  };
  /** Restrict to one account id. */
  account?: string;
  /** Restrict by direction: `CR` is money in, `DR` is money out. */
  sign?: Sign;
  /** Inclusive lower bound on the absolute amount, in minor units. */
  minAmount?: Cents;
  /** Inclusive upper bound on the absolute amount, in minor units. */
  maxAmount?: Cents;
  /** The code to assign. */
  code: string;
  /**
   * Who the money went to or came from, in your own words.
   *
   * The bank prints `TOWER INSURANCE - EIS` and a card feed prints
   * `SP GARMIN 8004412075`. Neither is a name anyone would choose, and the same
   * counterparty arrives spelled several ways. Setting a contact once on the
   * rule gives every line it matches the same readable name, which is what
   * makes a list of transactions scannable.
   *
   * Absent, the keyword itself is used, since that is the part of the bank text
   * the rule already identified as the distinctive bit.
   */
  contact?: string;
  /** Why this rule exists. Carried into the result so a coding can be argued with. */
  note?: string;
  /**
   * A caution to show with the suggestion, for a payee whose single code is
   * only ever part of the answer.
   *
   * A courier payment is freight plus GST charged at the border plus fees, and
   * coding the whole line to one account at 15% claims three twenty-thirds of
   * the border GST instead of all of it. The rule still offers its code --
   * refusing to suggest anything would be less useful -- but says out loud that
   * the line needs splitting first.
   */
  warn?: string;
}

/**
 * Fallback coding by account and direction.
 *
 * The workbook recorded a hit count against each of these -- `587/631` -- which
 * is a confidence measure worth keeping: a default that has been right 93% of
 * the time is a very different thing from one that has been right 26% of the
 * time, and the second should be reviewed rather than trusted.
 */
export interface CategoryDefault {
  account: string;
  sign: Sign;
  code: string;
  /** How many past transactions this default matched. */
  seen?: number;
  /** How many of those were actually this code. */
  agreed?: number;
  note?: string;
}

export type MatchedBy = "override" | "rule" | "default" | "none";

export interface Categorisation {
  /** The assigned code, or null when nothing matched. */
  code: string | null;
  matchedBy: MatchedBy;
  /** True once a human has accepted this coding. Rules alone never set it. */
  confirmed: boolean;
  /** Plain-English explanation, always populated. */
  reason: string;
  /**
   * 0 to 1 for a default, from its historical agreement rate. Undefined for an
   * explicit rule, which is an instruction rather than an observation.
   */
  confidence?: number;
  /** A caution from the matched rule, when it carries one. */
  warn?: string;
  /** The contact the matched rule names, or its keyword as a fallback. */
  contact?: string;
}

export interface RuleSet {
  rules?: readonly CategoryRule[];
  defaults?: readonly CategoryDefault[];
  /**
   * Manual corrections keyed by transaction id.
   *
   * Checked before any rule. The rules are a suggestion engine; this is the
   * user's answer, and it always wins.
   */
  overrides?: Overrides;
}

/** Assign a code to one transaction. */
export function categorise(transaction: Transaction, ruleSet: RuleSet): Categorisation {
  const override = overrideFor(transaction, ruleSet.overrides);
  if (override?.code !== undefined) {
    return {
      code: override.code,
      matchedBy: "override",
      confirmed: override.confirmed ?? true,
      reason: `Manual override: ${override.note}`,
    };
  }
  const confirmed = override?.confirmed ?? false;

  const sign: Sign = transaction.amount < 0 ? "DR" : "CR";
  const magnitude = Math.abs(transaction.amount);
  const haystack = searchText(transaction);

  const ordered = [...(ruleSet.rules ?? [])]
    .map((rule, index) => ({ rule, index }))
    .sort((a, b) => (b.rule.priority ?? 0) - (a.rule.priority ?? 0) || a.index - b.index);

  for (const { rule } of ordered) {
    if (rule.account !== undefined && rule.account !== transaction.account) continue;
    if (rule.sign !== undefined && rule.sign !== sign) continue;
    if (rule.minAmount !== undefined && magnitude < rule.minAmount) continue;
    if (rule.maxAmount !== undefined && magnitude > rule.maxAmount) continue;
    if (rule.keyword !== undefined && !haystack.includes(matchText(rule.keyword))) continue;
    if (rule.where !== undefined && !fieldsMatch(transaction, rule.where)) continue;

    const contact = contactOf(rule);
    return {
      code: rule.code,
      matchedBy: "rule",
      confirmed,
      reason: rule.note ?? `Matched rule ${describeRule(rule)}`,
      ...(rule.warn !== undefined ? { warn: rule.warn } : {}),
      ...(contact !== undefined ? { contact } : {}),
    };
  }

  for (const fallback of ruleSet.defaults ?? []) {
    if (fallback.account !== transaction.account || fallback.sign !== sign) continue;

    const confidence =
      fallback.seen && fallback.seen > 0 && fallback.agreed !== undefined
        ? fallback.agreed / fallback.seen
        : undefined;

    return {
      code: fallback.code,
      matchedBy: "default",
      confirmed,
      reason:
        fallback.note ??
        `Default for ${fallback.account} ${fallback.sign}` +
          (confidence !== undefined
            ? ` (right ${fallback.agreed} of ${fallback.seen} times)`
            : ""),
      ...(confidence !== undefined ? { confidence } : {}),
    };
  }

  return {
    code: null,
    matchedBy: "none",
    confirmed,
    reason: "No rule or default matched",
  };
}

/** Code every transaction, keeping the result alongside each one. */
export function categoriseAll(
  transactions: readonly Transaction[],
  ruleSet: RuleSet,
): { transaction: Transaction; categorisation: Categorisation }[] {
  return transactions.map((transaction) => ({
    transaction,
    categorisation: categorise(transaction, ruleSet),
  }));
}

/** A rule's contact, falling back to the keyword that identified it. */
function contactOf(rule: CategoryRule): string | undefined {
  if (rule.contact !== undefined && rule.contact.trim() !== "") return rule.contact.trim();
  if (rule.keyword !== undefined && rule.keyword.trim() !== "") return rule.keyword.trim();
  return undefined;
}

function describeRule(rule: CategoryRule): string {
  const parts: string[] = [];
  if (rule.keyword) parts.push(`keyword "${rule.keyword}"`);
  // Named so a coding can be argued with: "matched rule particulars \"GST\"" is
  // an answer, and "matched rule" is not.
  for (const [field, wanted] of Object.entries(rule.where ?? {})) {
    if (wanted) parts.push(`${field} "${wanted}"`);
  }
  if (rule.account) parts.push(`account ${rule.account}`);
  if (rule.sign) parts.push(rule.sign);
  if (rule.minAmount !== undefined || rule.maxAmount !== undefined) {
    parts.push(`amount ${rule.minAmount ?? 0}..${rule.maxAmount ?? "∞"}`);
  }
  return parts.join(", ") || "(matches everything)";
}

/**
 * One spelling for matching, used on both sides of it.
 *
 * A keyword is derived from a bank line with the punctuation taken out --
 * `PAYPAL *GOOGLE TILE INC` becomes `PAYPAL GOOGLE TILE INC`, because the
 * asterisk is the card network's and not part of anybody's name. The line it
 * came from still has the asterisk in it, so a plain substring test says the
 * rule does not match the very transaction it was written from. It matched
 * nothing, for ever, and looked correct in the rules table while doing it.
 *
 * That is not a new mistake: the coverage count had the same one, comparing a
 * stripped keyword against unstripped text and promising to code 584 lines
 * before coding 413. It was fixed there by asking the engine. This fixes it
 * where it starts, by giving the engine one spelling and folding both the
 * keyword and the text into it.
 *
 * Only punctuation is folded, never digits: a keyword may legitimately hold a
 * number -- `MITRE 10`, `INV-4021` -- and stripping those would break rules
 * that work today to fix ones that never did.
 */
export function matchText(text: string): string {
  return text
    .toUpperCase()
    .replace(/[^A-Z0-9&' -]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Whether every named field holds what the rule asks of it.
 *
 * All of them, not any: a rule naming two fields is narrowing, and one that
 * fired on either would be wider than the single keyword it replaced.
 */
function fieldsMatch(
  transaction: Transaction,
  where: NonNullable<CategoryRule["where"]>,
): boolean {
  const has = (value: string | undefined, wanted: string | undefined): boolean =>
    wanted === undefined || matchText(value ?? "").includes(matchText(wanted));
  // An account number is matched as a number rather than as text: the suffix
  // is padded differently by different feeds, and folding punctuation would
  // make `0011` match `00110`.
  const sameAccount = (value: string, wanted: string | undefined): boolean =>
    wanted === undefined ||
    normaliseAccountNumber(value) === normaliseAccountNumber(wanted);

  return (
    has(transaction.otherParty, where.otherParty) &&
    has(transaction.particulars, where.particulars) &&
    has(transaction.code, where.code) &&
    has(transaction.reference, where.reference) &&
    sameAccount(transaction.otherPartyAccount, where.otherPartyAccount)
  );
}

/** Everything a keyword could reasonably be looked for in, upper-cased once. */
function searchText(transaction: Transaction): string {
  return matchText(
    [
      transaction.otherParty,
      transaction.particulars,
      transaction.code,
      transaction.reference,
      transaction.otherPartyAccount,
    ].join(" "),
  );
}
