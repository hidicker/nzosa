import type { Cents } from "./money.js";
import { formatAmount } from "./money.js";
import type { GstSide, GstTreatment } from "./gst.js";
import type { Overrides, TransactionOverride } from "./overrides.js";
import type { Transaction } from "./types.js";

/**
 * Splitting one bank transaction into several coded parts.
 *
 * One payment is often several things: a supermarket shop that is partly
 * entertainment, a supplier invoice covering two expense codes, a card payout
 * that arrives net of the processor's fee.
 *
 * The rule that makes this safe is that **the parts must sum to the original,
 * exactly**. The bank saw one number; if the parts do not add back to it, the
 * ledger no longer agrees with the statement and the balance reconciliation --
 * the thing that proves the import is complete -- silently stops meaning
 * anything. A split that does not balance is refused rather than rounded.
 *
 * The original transaction is never modified. Splits are stored beside it and
 * expanded on the way into coding and GST, so `balances` continues to work on
 * exactly what the bank reported.
 */

export interface SplitPart {
  /**
   * Signed amount, in the same direction as the parent.
   *
   * A -50.00 purchase split into -35.00 and -15.00. A part may point the other
   * way when that is genuinely what happened -- a net payout of +972.43 is a
   * +1000.00 sale plus a -27.57 fee -- which is exactly the case a processor
   * like Stripe creates.
   */
  amount: Cents;
  /** Account code for this part. */
  code?: string;
  /** GST treatment for this part. */
  treatment?: GstTreatment;
  /** Which side of the GST return. Defaults to the direction of the part. */
  side?: GstSide;
  /** What this part is. Required: an unexplained split cannot be checked. */
  note: string;
}

/** Splits keyed by transaction id. */
export type Splits = Readonly<Record<string, readonly SplitPart[]>>;

export interface SplitProblem {
  id: string;
  message: string;
}

/** The id given to part `index` (0-based) of a split transaction. */
export function splitPartId(transactionId: string, index: number): string {
  return `${transactionId}:${index + 1}`;
}

/**
 * Check every split against its transaction.
 *
 * Returns a problem per split that does not balance, names a transaction that
 * is not in the ledger, or has fewer than two parts. Callers should refuse to
 * proceed rather than expand a broken split.
 */
export function validateSplits(
  transactions: readonly Transaction[],
  splits: Splits,
): SplitProblem[] {
  const byId = new Map(transactions.map((t) => [t.id, t]));
  const problems: SplitProblem[] = [];

  for (const [id, parts] of Object.entries(splits)) {
    const transaction = byId.get(id);
    if (!transaction) {
      problems.push({ id, message: "no transaction with this id is in the ledger" });
      continue;
    }
    if (parts.length < 2) {
      problems.push({ id, message: `a split needs at least two parts, found ${parts.length}` });
      continue;
    }

    const total = parts.reduce((sum, part) => sum + part.amount, 0);
    if (total !== transaction.amount) {
      problems.push({
        id,
        message:
          `parts total ${formatAmount(total, transaction.currency)} but the transaction is ` +
          `${formatAmount(transaction.amount, transaction.currency)} ` +
          `(out by ${formatAmount(total - transaction.amount, transaction.currency)})`,
      });
    }

    const unexplained = parts.findIndex((part) => part.note.trim() === "");
    if (unexplained !== -1) {
      problems.push({ id, message: `part ${unexplained + 1} has no note` });
    }
  }

  return problems;
}

export interface ExpandedSplits {
  /** Split transactions replaced by their parts; everything else unchanged. */
  transactions: Transaction[];
  /** Coding and GST for each part, in the same shape as manual overrides. */
  overrides: Overrides;
}

/**
 * Replace split transactions with their parts.
 *
 * Each part keeps the parent's date, account and description so it still reads
 * like the transaction it came from, and records the parent id in
 * `extras.splitOf` so a part can always be traced back.
 *
 * Splits that fail validation are left unsplit rather than expanded, so a
 * mistake in the split file cannot quietly change the totals. Validate first
 * and show the problems.
 */
export function expandSplits(
  transactions: readonly Transaction[],
  splits: Splits,
  existingOverrides: Overrides = {},
): ExpandedSplits {
  const problems = new Set(validateSplits(transactions, splits).map((problem) => problem.id));
  const overrides: Record<string, TransactionOverride> = { ...existingOverrides };
  const expanded: Transaction[] = [];

  for (const transaction of transactions) {
    const parts = splits[transaction.id];
    if (!parts || problems.has(transaction.id)) {
      expanded.push(transaction);
      continue;
    }

    parts.forEach((part, index) => {
      const id = splitPartId(transaction.id, index);

      expanded.push({
        ...transaction,
        id,
        amount: part.amount,
        extras: {
          ...transaction.extras,
          splitOf: transaction.id,
          splitPart: String(index + 1),
          splitParts: String(parts.length),
        },
      });

      // A part's coding is expressed as an override so that everything
      // downstream has one mechanism to respect, and so a hand correction to a
      // single part behaves exactly like any other override.
      if (part.code !== undefined || part.treatment !== undefined) {
        overrides[id] = {
          ...(part.code !== undefined ? { code: part.code } : {}),
          ...(part.treatment !== undefined ? { treatment: part.treatment } : {}),
          ...(part.side !== undefined ? { side: part.side } : {}),
          note: `Split part ${index + 1} of ${parts.length}: ${part.note}`,
        };
      }
    });
  }

  return { transactions: expanded, overrides };
}
