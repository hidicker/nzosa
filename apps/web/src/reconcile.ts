import { categorise, formatAmount, gstResolver } from "@nzosa/core";
import type {
  GstClassification,
  RuleFile,
  GstRulesOptions,
  GstSide,
  GstTreatment,
  Overrides,
  RuleSet,
  Transaction,
} from "@nzosa/core";

/**
 * The coding queue.
 *
 * A bank line arrives with no opinion about what it is. The rules offer one,
 * and a person accepts or replaces it -- which is the difference between a
 * guess and a decision, and the reason a return can be defended later.
 *
 * Accepting writes an override with `confirmed`, so the decision survives
 * re-importing the same statement: overrides are keyed by a transaction id
 * derived from the transaction itself, not from its position in a file.
 */

export interface Suggestion {
  transaction: Transaction;
  /** What the rules propose, or null when nothing matched. */
  code: string | null;
  /** Why that code, in the rule's own words. */
  reason: string;
  classification: GstClassification;
  /** True once a person has accepted or replaced the suggestion. */
  confirmed: boolean;
  /** Present when a person changed something. */
  note: string | undefined;
  /** A caution from the matched rule: this line needs more than one code. */
  warn: string | undefined;
  /**
   * Who the money went to or came from, as a person would say it.
   *
   * An override wins, then the matched rule's contact, then the keyword that
   * matched, and failing all of those the counterparty the bank printed.
   */
  contact: string;
}

/**
 * Suggest a coding for every transaction on the chosen accounts.
 *
 * The suggestion is recomputed rather than stored: a rule change should show
 * up immediately on everything not yet decided, while anything already
 * confirmed keeps the answer a person gave it.
 */
export function suggest(
  transactions: readonly Transaction[],
  rules: RuleSet | undefined,
  overrides: Overrides,
  accounts: readonly string[],
): Suggestion[] {
  const ruleFile = rules as RuleFile | undefined;
  const selected =
    accounts.length === 0 ? transactions : transactions.filter((t) => accounts.includes(t.account));

  const codingRules: RuleSet = { ...(ruleFile ?? {}), overrides };
  const resolve = gstResolver({
    ownAccounts: new Set(accounts.length > 0 ? accounts : transactions.map((t) => t.account)),
    relatedAccounts: new Set(transactions.map((t) => t.account)),
    ...(ruleFile?.gstRules ? { rules: ruleFile.gstRules } : {}),
    ...(ruleFile?.codeTreatments ? { codeTreatments: ruleFile.codeTreatments } : {}),
    codeOf: (t) => categorise(t, codingRules).code,
    overrides,
  });

  return selected
    .map((transaction) => {
      const coded = categorise(transaction, codingRules);
      const override = overrides[transaction.id];
      return {
        transaction,
        code: coded.code,
        reason: coded.reason ?? "",
        classification: resolve(transaction),
        confirmed: override?.confirmed === true,
        note: override?.note,
        // A caution is about the suggestion, so it goes once a person has
        // decided: they have seen it and answered it.
        warn: override?.confirmed === true ? undefined : coded.warn,
        contact:
          override?.contact ??
          coded.contact ??
          transaction.otherParty ??
          "",
      };
    })
    .sort((a, b) => b.transaction.date.localeCompare(a.transaction.date));
}

/** How a treatment and side read on a return, in the accounting system's words. */
export function rateLabel(classification: GstClassification): string {
  if (classification.side === "imports") return "GST on Imports";
  if (classification.treatment === "zero-rated") return "Zero Rated";
  if (classification.treatment !== "standard") return "No GST";
  const half = classification.deductiblePercent;
  const suffix = half !== undefined && half !== 100 ? ` (${half}% deductible)` : "";
  return (classification.side === "sales" ? "15% GST on Income" : "15% GST on Expenses") + suffix;
}

/**
 * The GST a line carries, as a proportion of the line.
 *
 * Three answers cover everything this business does:
 *
 *  * `0`   -- no GST at all: a transfer, a drawing, an overseas supplier, a
 *             donation, the non-deductible half of entertainment.
 *  * `15`  -- an ordinary taxable supply, GST being 3/23 of the amount.
 *  * `100` -- the line *is* GST. A customs entry paid to a courier is nothing
 *             but the tax, and it belongs in Box 13 whole rather than having
 *             3/23 taken out of it.
 *
 * Zero-rated is deliberately absent: it only differs from `0` on the sales
 * side, for Box 6, and every filed return here shows Box 6 nil.
 */
export const GST_OPTIONS: readonly { value: GstRate; label: string; hint: string }[] = [
  { value: "15", label: "15%", hint: "Ordinary taxable supply" },
  { value: "0", label: "0%", hint: "No GST on this line" },
  { value: "100", label: "100%", hint: "The whole line is GST, e.g. a customs entry" },
];

export type GstRate = "0" | "15" | "100";

/** What a chosen rate means to the return. */
export function rateToClassification(
  rate: GstRate,
  amount: number,
): { treatment: GstTreatment; side: GstSide } {
  if (rate === "0") return { treatment: "out-of-scope", side: "none" };
  if (rate === "100") return { treatment: "standard", side: "imports" };
  return { treatment: "standard", side: amount < 0 ? "purchases" : "sales" };
}

/** The rate a classification already represents, for showing the current state. */
export function classificationToRate(classification: GstClassification): GstRate {
  if (classification.side === "imports") return "100";
  if (classification.treatment !== "standard") return "0";
  return "15";
}

export interface Flow {
  /** `out` when money left this account, `in` when it arrived. */
  direction: "out" | "in";
  /** The other side, named as helpfully as the data allows. */
  counterparty: string;
  /** True when the other side is an account in this ledger. */
  internal: boolean;
  /** True when the matching opposite leg is actually present. */
  bothLegs: boolean;
}

/**
 * Which way the money went, and to or from where.
 *
 * A bank line reading `Garmin · INTERNET XFR · 25.00` says almost nothing on
 * its own: the payee field of a transfer holds the *other account's* name, so
 * the same wording appears on both legs and the direction is carried only by
 * the sign. Spelling that out is the difference between a line you can code and
 * one you have to go and look up.
 */
export function describeFlow(
  transaction: Transaction,
  all: readonly Transaction[],
): Flow {
  const direction = transaction.amount < 0 ? "out" : "in";
  const other = transaction.otherPartyAccount ?? "";

  const label = (account: string): string | undefined =>
    all.find((t) => t.account === account)?.extras?.["accountLabel"];

  const internal = other !== "" && all.some((t) => t.account === other);
  const named = internal ? label(other) : undefined;
  const counterparty =
    named !== undefined
      ? `${named} (${other})`
      : other !== ""
        ? other
        : transaction.otherParty || "not stated";

  // The other leg confirms it is a movement between two accounts held here,
  // rather than a payment that merely names one.
  const bothLegs =
    internal &&
    all.some(
      (t) =>
        t.account === other &&
        t.amount === -transaction.amount &&
        Math.abs(Date.parse(t.date) - Date.parse(transaction.date)) <= 3 * 86_400_000,
    );

  return { direction, counterparty, internal, bothLegs };
}

/**
 * The other leg of a transfer, as candidates to choose between.
 *
 * Never picked automatically. Two accounts sweeping the same round sum on the
 * same day are indistinguishable from the data, and a wrong pairing is worse
 * than none: it silently moves money between the wrong books. So this ranks
 * what is plausible and a person decides, which is the same rule the coding
 * rules follow.
 */
export interface TransferCandidate {
  transaction: Transaction;
  /** Days between the two legs. Zero is same-day. */
  daysApart: number;
  /** True when the counterparty account on one leg names the other's account. */
  accountsAgree: boolean;
}

export interface TransferSearch {
  /** Bank accounts that belong to the same entity as the line in hand. */
  sameEntity: ReadonlySet<string>;
  /** Legs already spoken for, so one leg cannot serve two transfers. */
  taken: ReadonlySet<string>;
  /**
   * How far apart the two legs may be. Defaults to four days.
   *
   * Four because of the calendar, not because it is a round number. The legs
   * of a transfer are the same day when nothing is in the way; what gets in
   * the way is a day the banks are shut, and the longest run of those the New
   * Zealand calendar produces is Good Friday, the weekend, and Easter Monday.
   * A repayment falling due on that Friday settles on the Tuesday: four days.
   * Measured on a real ledger of thirty-eight fortnightly repayments -- with
   * the dates read in New Zealand time, which they had not been -- thirty-three
   * are same-day, three are three days apart, and the two that are four are
   * both Easter.
   *
   * The asymmetry is what settles the number. A window too wide offers a
   * person one more candidate to glance at, ranked below the closer ones. A
   * window too narrow offers nothing at all, and an unmatched transfer is not
   * merely unpaired: both legs stay ordinary transactions and the receiving
   * one reads as income, at fifteen percent, on money that never left the
   * person's own accounts. Ten days would be too wide -- on the same ledger
   * that is where one repayment starts matching two different legs -- so this
   * is the top of the useful range rather than the middle of a guess.
   */
  windowDays?: number;
}

export function transferCandidates(
  transaction: Transaction,
  all: readonly Transaction[],
  search: TransferSearch,
): TransferCandidate[] {
  const windowMs = (search.windowDays ?? 4) * 86_400_000;
  const when = Date.parse(transaction.date);
  const candidates: TransferCandidate[] = [];

  for (const other of all) {
    if (other.id === transaction.id) continue;
    if (search.taken.has(other.id)) continue;
    // The opposite leg is the same money the other way: same size, other sign.
    if (other.amount !== -transaction.amount) continue;
    if (other.account === transaction.account) continue;
    // Both ends must be this entity's own accounts. A movement that leaves the
    // entity is drawings or a loan, which is a real coding decision, not a
    // transfer.
    if (!search.sameEntity.has(other.account)) continue;

    const gap = Math.abs(Date.parse(other.date) - when);
    if (gap > windowMs) continue;

    candidates.push({
      transaction: other,
      daysApart: Math.round(gap / 86_400_000),
      accountsAgree:
        (transaction.otherPartyAccount ?? "") === other.account ||
        (other.otherPartyAccount ?? "") === transaction.account,
    });
  }

  // Best evidence first: the accounts naming each other, then the closest date.
  candidates.sort((a, b) => {
    if (a.accountsAgree !== b.accountsAgree) return a.accountsAgree ? -1 : 1;
    return a.daysApart - b.daysApart;
  });
  return candidates;
}

/**
 * Every code the rules can produce, for the picker.
 *
 * Now in the core, so the command line uses the same list. Re-exported here
 * because this is where the app has always reached for it.
 */
export { knownCodes } from "@nzosa/core";

