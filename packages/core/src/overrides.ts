import type { GstClassification, GstSide, GstTreatment } from "./gst.js";
import type { Transaction } from "./types.js";

/**
 * Manual corrections that beat every rule.
 *
 * Rules suggest; the user decides. No rule set survives contact with real bank
 * text -- a payout that arrives net of fees, a supplier who deregisters, a
 * one-off that looks like something it is not -- so there has to be a way to
 * say "this one is different" and have it stick.
 *
 * Overrides are keyed by transaction id, which is derived from the transaction
 * itself rather than from its position in a file. That is what makes a
 * correction durable: re-import the same statement, or a later overlapping
 * one, and the override still lands on the same row.
 *
 * Every override carries a `note`. An anonymous correction is indistinguishable
 * from a mistake six months later, and this is exactly the kind of decision
 * that gets questioned at year end.
 */

export interface TransactionOverride {
  /**
   * A human has looked at this transaction and accepted its coding.
   *
   * Rules only ever *suggest*. Without this flag a guess and a decision are
   * indistinguishable, so nothing can tell you how much of a return still
   * rests on unreviewed guesses -- which is the one thing worth knowing before
   * filing it.
   *
   * Confirming without changing anything is a real and common act: it records
   * that the suggestion was correct.
   */
  confirmed?: boolean;
  /** Account code, replacing whatever the rules would have assigned. */
  code?: string;
  /** Who this was to or from, replacing whatever the rule would have named. */
  contact?: string;
  /** GST treatment, replacing whatever the GST rules would have assigned. */
  treatment?: GstTreatment;
  /** Which side of the return. Defaults to the direction of the amount. */
  side?: GstSide;
  /**
   * Claim this transaction's GST in the return ending on this date.
   *
   * For an expense found after its own return was filed. The money still moved
   * when it moved; only the claim shifts, and it lands in Box 9 or Box 13 as an
   * adjustment rather than in Box 5 or Box 11.
   */
  claimIn?: string;
  /** Why this was overridden. Required. */
  note: string;
  /** ISO date the override was set, for auditing. */
  at?: string;
}

/** Overrides keyed by transaction id. */
export type Overrides = Readonly<Record<string, TransactionOverride>>;

export function overrideFor(
  transaction: Transaction,
  overrides: Overrides | undefined,
): TransactionOverride | undefined {
  return overrides?.[transaction.id];
}

/**
 * Apply a GST override, if one exists for this transaction.
 *
 * Returns undefined when there is no override, or when the override only sets
 * a code and says nothing about GST -- correcting a coding should not silently
 * change a GST treatment the user did not touch.
 */
export function gstOverride(
  transaction: Transaction,
  overrides: Overrides | undefined,
): GstClassification | undefined {
  const override = overrideFor(transaction, overrides);
  if (!override || override.treatment === undefined) return undefined;

  return {
    treatment: override.treatment,
    side: override.side ?? (transaction.amount < 0 ? "purchases" : "sales"),
    reason: `Manual override: ${override.note}`,
  };
}
