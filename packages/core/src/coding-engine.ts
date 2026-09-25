import { categorise } from "./rules.js";
import type { GstSide } from "./gst.js";
import type { CategoryDefault, CategoryRule, RuleSet } from "./rules.js";
import { gstResolver } from "./gst-rules.js";
import type { CodeTreatment } from "./gst-rules.js";
import type { GstClassification } from "./gst.js";
import { expandSplits } from "./splits.js";
import type { Splits } from "./splits.js";
import type { Overrides } from "./overrides.js";
import type { Transaction } from "./types.js";

/**
 * How a ledger's transactions get a code and a GST treatment.
 *
 * One place, because the two questions are answered together and have to agree.
 * A coding decides which account a line belongs to; the account decides how it
 * is taxed; and a correction to either has to reach both. Answered separately
 * they drift, and a report then disagrees with the return built from the same
 * ledger.
 *
 * Splits are expanded first, so a divided payment is several transactions from
 * here on, each with its own code and its own treatment. Their ids are what
 * `expandSplits` gives them, which is the same id the postings and the invoice
 * assignments use, so a part means the same thing everywhere.
 *
 * `chartTreatment` is supplied by the caller rather than read here: what the
 * chart says about an account is a lookup the app already caches, and asking
 * for it twice is how a report and a page come to disagree about the same code.
 */
export interface CodingEngineOptions {
  transactions: readonly Transaction[];
  splits: Splits;
  overrides: Overrides;
  rules?: {
    rules?: CategoryRule[];
    defaults?: CategoryDefault[];
    codeTreatments?: Record<string, unknown>;
    gstRules?: unknown[];
  };
  /** What the chart says about an account code, or null where it says nothing. */
  chartTreatment?: (code: string) => CodeTreatment | string | null;
  /** The side of the return an account is on by its type, when its tax code does not say. */
  sideOf?: (code: string) => GstSide | undefined;
  /** Whether a code belongs to an entity not registered for GST. */
  unregistered?: (code: string) => boolean;
}

export interface CodingEngine {
  /** Transactions with splits expanded into parts. */
  transactions: Transaction[];
  /** Overrides including those the expansion created for the parts. */
  overrides: Overrides;
  codeOf: (transaction: Transaction) => string | null;
  classify: (transaction: Transaction) => GstClassification;
}

export function codingEngine(options: CodingEngineOptions): CodingEngine | null {
  const { transactions, splits, overrides, rules } = options;
  if (transactions.length === 0) return null;

  const expanded = expandSplits(transactions, splits, overrides);
  const codingRules = { ...(rules ?? {}), overrides: expanded.overrides } as RuleSet;
  const codeOf = (t: Transaction): string | null => categorise(t, codingRules).code;

  // Every account this ledger holds is this entity's own, which is what makes
  // a movement between two of them a transfer rather than income.
  const own = new Set(transactions.map((t) => t.account));

  const classify = gstResolver({
    ownAccounts: own,
    relatedAccounts: own,
    ...(rules?.gstRules ? { rules: rules.gstRules as never } : {}),
    ...(rules?.codeTreatments ? { codeTreatments: rules.codeTreatments as never } : {}),
    ...(options.chartTreatment
      ? { chartTreatment: options.chartTreatment as never }
      : {}),
    ...(options.sideOf ? { sideOf: options.sideOf } : {}),
    codeOf,
    overrides: expanded.overrides,
    ...(options.unregistered ? { unregistered: options.unregistered } : {}),
  });

  return { transactions: expanded.transactions, overrides: expanded.overrides, codeOf, classify };
}
