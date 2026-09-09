import { daysBetween } from "./dates.js";
import { formatAmount } from "./money.js";
import type { Transaction } from "./types.js";

/**
 * Deduplication.
 *
 * Bank exports overlap. Downloading "last 3 months" every month means each
 * transaction arrives two or three times, and a statement re-exported after a
 * correction arrives again with a different serial. Getting this wrong in
 * either direction is expensive: a false duplicate silently deletes a real
 * expense from a tax return, and a missed duplicate double-counts income.
 *
 * So this stage never deletes. It classifies, and everything uncertain is
 * surfaced for a human to decide.
 */

/**
 * Field separator that cannot appear in a bank field, so keys never collide.
 *
 * With a printable separator, ["a b", "c"] and ["a", "b c"] would build the
 * same key, and two unrelated transactions would be reported as duplicates.
 */
const SEP = "\u0000";

/**
 * The strict identity of a transaction.
 *
 * Every field the bank gave us that describes what happened, including the
 * account it happened on: the same amount to the same payee on two different
 * accounts is two transactions, not one.
 */
export function dedupeKey(transaction: Transaction): string {
  return [
    transaction.account,
    transaction.date,
    formatAmount(transaction.amount, transaction.currency),
    transaction.currency,
    transaction.serial,
    transaction.trn,
    transaction.particulars,
    transaction.code,
    transaction.reference,
    transaction.otherParty,
    String(transaction.occurrence),
  ].join(SEP);
}

/**
 * Identity ignoring the bank's own sequence numbers.
 *
 * Serial, transaction code and reference are assigned at export time and can
 * differ between two exports of the same transaction. Two rows matching on
 * this key but not on `dedupeKey` are near-certainly the same transaction seen
 * twice, but near-certainly is not certainly, so they are flagged not dropped.
 */
export function looseKey(transaction: Transaction): string {
  return [
    transaction.account,
    transaction.date,
    formatAmount(transaction.amount, transaction.currency),
    transaction.currency,
    transaction.particulars,
    transaction.code,
    transaction.otherParty,
    String(transaction.occurrence),
  ].join(SEP);
}

/**
 * Identity ignoring the date too, for the case where one feed reports a
 * transaction on its transaction date and another on its processed date.
 */
function adjacencyKey(transaction: Transaction): string {
  return [
    transaction.account,
    formatAmount(transaction.amount, transaction.currency),
    transaction.currency,
    transaction.particulars,
    transaction.code,
    transaction.otherParty,
  ].join(SEP);
}

/**
 * Identity ignoring who the bank says it was paid to.
 *
 * A feed and a downloaded file name the same payee differently -- "Inland
 * Revenue" against "REVENUE DEPARTMENT" -- and a feed folds the reference
 * fields into its description as well. So the payee, which tells two exports
 * of the same file apart perfectly well, tells two *sources* nothing.
 *
 * What both carry identically is what the person paying typed: the
 * particulars, the code and the reference. With the account, date and amount
 * that is enough to recognise the same transaction arriving twice by two
 * routes -- which is the case somebody moving from downloads to a feed is in.
 *
 * Flagged and never dropped. On a card purchase all three are empty, and two
 * coffees of the same price on the same day would look identical.
 */
function crossSourceKey(transaction: Transaction): string {
  return [
    transaction.account,
    formatAmount(transaction.amount, transaction.currency),
    transaction.currency,
    transaction.particulars,
    transaction.code,
    transaction.reference,
  ].join(SEP);
}

/**
 * How far apart two sources may date the same transaction.
 *
 * A feed dates a transaction when it happened; a bank's own export dates it
 * when it processed. Measured across the real overlap, the gap is one day for
 * most, and runs to five for card purchases, which settle over several
 * business days. Past that it falls to nothing until a fortnight out, where
 * the matches are different transactions that happen to share an amount.
 *
 * So five, from the shape of the data rather than from a guess: it is where
 * the settlement lag stops and coincidence starts.
 */
const CROSS_SOURCE_DAYS = 5;

/**
 * The same account, amount and payee, however the two spelled the payee.
 *
 * Used to ask whether a pair is the *only* pair of its kind nearby, which is
 * what makes it safe to treat two rows with no reference as one transaction.
 */
function payeeKey(transaction: Transaction): string {
  return [
    transaction.account,
    formatAmount(transaction.amount, transaction.currency),
    transaction.currency,
    transaction.otherParty.toLowerCase().replace(/\s+/g, " ").trim(),
  ].join(SEP);
}

export type DedupeStatus = "unique" | "duplicate" | "review";

export interface DedupeEntry {
  transaction: Transaction;
  status: DedupeStatus;
  /** Plain-English explanation, shown next to the row in the UI. */
  reason: string;
  /** Id of the transaction this one duplicates, when status is not `unique`. */
  duplicateOf?: string;
}

export interface DedupeResult {
  /** Transactions to carry forward: everything not classified as `duplicate`. */
  kept: Transaction[];
  /** One entry per input transaction, in input order. */
  entries: DedupeEntry[];
  stats: {
    total: number;
    unique: number;
    duplicate: number;
    review: number;
  };
}

export interface DedupeOptions {
  /**
   * Strict keys whose repeats are real: a standing order paid twice in one
   * day, two identical coffees. Rows matching these are always kept.
   *
   * This replaces the workbook's hand-maintained "Legitimate Duplicates"
   * column, and it is the one piece of dedupe state the user owns.
   */
  legitimateDuplicates?: Iterable<string>;
  /**
   * Flag transactions matching on everything but date that fall within this
   * many days of each other. Applied only to rows with no serial and no
   * reference, because those feeds -- cards and loans -- have nothing better
   * to match on. Set to 0 to disable.
   */
  adjacentDays?: number;
}

/**
 * Classify a list of transactions.
 *
 * Order matters: the first occurrence of a repeated transaction is the one
 * kept. Pass existing transactions before newly imported ones so what is
 * already in the ledger wins and ids stay stable across imports.
 */
export function dedupe(
  transactions: readonly Transaction[],
  options: DedupeOptions = {},
): DedupeResult {
  const legitimate = new Set(options.legitimateDuplicates ?? []);
  const adjacentDays = options.adjacentDays ?? 1;

  const entries: DedupeEntry[] = [];
  const seenStrict = new Map<string, Transaction>();
  const seenLoose = new Map<string, Transaction>();
  const seenAdjacent = new Map<string, Transaction[]>();
  const seenCross = new Map<string, Transaction[]>();

  // Everything of the same account, amount and payee, indexed before the pass
  // begins. Deciding whether a pair is the only one of its kind needs to see
  // what comes after it as well as what came before.
  const byPayee = new Map<string, Transaction[]>();
  for (const transaction of transactions) {
    const key = payeeKey(transaction);
    const list = byPayee.get(key);
    if (list) list.push(transaction);
    else byPayee.set(key, [transaction]);
  }

  for (const transaction of transactions) {
    const strict = dedupeKey(transaction);
    const loose = looseKey(transaction);
    const allowed = legitimate.has(strict);

    const strictMatch = seenStrict.get(strict);
    if (strictMatch && !allowed) {
      entries.push({
        transaction,
        status: "duplicate",
        reason: `Identical to an earlier row from ${describeSource(strictMatch)}.`,
        duplicateOf: strictMatch.id,
      });
      continue;
    }
    if (!strictMatch) seenStrict.set(strict, transaction);

    // Same transaction, different bank-assigned sequence numbers.
    const looseMatch = seenLoose.get(loose);
    if (looseMatch && !allowed) {
      entries.push({
        transaction,
        status: "review",
        reason:
          `Matches an earlier row from ${describeSource(looseMatch)} on date, amount and payee, ` +
          "but the serial or reference differs. Likely the same transaction exported twice.",
        duplicateOf: looseMatch.id,
      });
      continue;
    }
    if (!looseMatch) seenLoose.set(loose, transaction);

    // The same transaction arriving from a feed and from a downloaded file.
    // Only across sources: within one, the payee is reliable and the checks
    // above have already done their work.
    const cross = crossSourceKey(transaction);
    const crossMatch = (seenCross.get(cross) ?? []).find(
      (candidate) =>
        candidate.source.importer !== transaction.source.importer &&
        Math.abs(daysBetween(candidate.date, transaction.date)) <= CROSS_SOURCE_DAYS,
    );
    pushAdjacent(seenCross, cross, transaction);
    if (crossMatch && !allowed) {
      // How much the match is worth depends on whether there was anything to
      // match on. With a particulars, code or reference in common as well as
      // the account, date and amount, two independent sources agreeing is not
      // a coincidence worth asking about. With all three empty -- an ordinary
      // card purchase -- it is only an amount on a day, and two coffees of the
      // same price would look exactly like this.
      const told =
        `${transaction.particulars}${transaction.code}${transaction.reference}`.trim() !== "";

      // With no reference to go on, the payee can still settle it -- but only
      // when the pair is the only one of its kind nearby.
      //
      // Two transfers to the same place for the same amount within a few days
      // are two transfers, and one of each in two sources is one transfer seen
      // twice. Counting both sides is what tells those apart: exactly one here
      // and exactly one there, and there is nothing else it could be.
      const family = byPayee.get(payeeKey(transaction)) ?? [];
      const nearby = family.filter(
        (candidate) => Math.abs(daysBetween(candidate.date, transaction.date)) <= CROSS_SOURCE_DAYS,
      );
      const onThisSide = nearby.filter(
        (candidate) => candidate.source.importer === transaction.source.importer,
      ).length;
      const onThatSide = nearby.filter(
        (candidate) => candidate.source.importer === crossMatch.source.importer,
      ).length;
      const onlyPair =
        crossMatch.otherParty.toLowerCase().replace(/\s+/g, " ").trim() ===
          transaction.otherParty.toLowerCase().replace(/\s+/g, " ").trim() &&
        onThisSide === 1 &&
        onThatSide === 1;
      const when =
        crossMatch.date === transaction.date
          ? "same day"
          : `dated ${crossMatch.date} there and ${transaction.date} here`;
      entries.push({
        transaction,
        status: told || onlyPair ? "duplicate" : "review",
        reason: told
          ? `The same transaction as an earlier row from ${describeSource(crossMatch)}: ` +
            `same account, amount and reference, ${when}. A feed dates a transaction when ` +
            "it happened and a bank's own export when it processed."
          : onlyPair
            ? `The same transaction as an earlier row from ${describeSource(crossMatch)}: ` +
              `same account, amount and payee, ${when}, and the only one of its kind in ` +
              "either source at the time."
            : `Matches an earlier row from ${describeSource(crossMatch)} on amount, ${when}, ` +
              "but there is no reference to check it against and more than one like it " +
              "nearby. Could be the same transaction from both a feed and a file.",
        duplicateOf: crossMatch.id,
      });
      continue;
    }

    // Feeds with no serial and no reference cannot distinguish a real repeat
    // from the same transaction dated differently by two exports.
    if (adjacentDays > 0 && transaction.serial === "" && transaction.reference === "") {
      const key = adjacencyKey(transaction);
      const near = (seenAdjacent.get(key) ?? []).find(
        (candidate) =>
          candidate.date !== transaction.date &&
          Math.abs(daysBetween(candidate.date, transaction.date)) <= adjacentDays,
      );

      pushAdjacent(seenAdjacent, key, transaction);

      if (near && !allowed) {
        const gap = Math.abs(daysBetween(near.date, transaction.date));
        entries.push({
          transaction,
          status: "review",
          reason:
            `Same amount and payee as a row dated ${near.date} from ${describeSource(near)}, ` +
            `${gap} day(s) apart. This feed has no serial to tell a genuine repeat from a ` +
            "re-dated export.",
          duplicateOf: near.id,
        });
        continue;
      }
    }

    entries.push({
      transaction,
      status: "unique",
      reason: allowed && strictMatch ? "Marked as a legitimate repeat." : "",
    });
  }

  const kept = entries
    .filter((entry) => entry.status !== "duplicate")
    .map((entry) => entry.transaction);

  return {
    kept,
    entries,
    stats: {
      total: entries.length,
      unique: entries.filter((entry) => entry.status === "unique").length,
      duplicate: entries.filter((entry) => entry.status === "duplicate").length,
      review: entries.filter((entry) => entry.status === "review").length,
    },
  };
}

function pushAdjacent(
  map: Map<string, Transaction[]>,
  key: string,
  transaction: Transaction,
): void {
  const list = map.get(key);
  if (list) list.push(transaction);
  else map.set(key, [transaction]);
}

function describeSource(transaction: Transaction): string {
  return `${transaction.source.file}:${transaction.source.line}`;
}
