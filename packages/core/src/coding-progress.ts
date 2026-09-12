import { categorise } from "./rules.js";
import type { RuleSet } from "./rules.js";
import type { Transaction } from "./types.js";

/**
 * How much of a ledger the rules can code, and to what.
 *
 * One pass, answering both questions. They were asked separately -- how many
 * are coded, and how many to each code -- which ran the same categorisation
 * over every transaction twice for two views of one answer.
 *
 * Counted against the rules as they stand, including overrides, because that
 * is what the reconcile page is reporting progress on: not what has been
 * decided by hand, but what would be decided if every suggestion were taken.
 */
export interface CodingCounts {
  /** How many transactions the rules give a code to. */
  coded: number;
  total: number;
  /** How many land on each code. */
  byCode: Map<string, number>;
}

export function codingCounts(
  transactions: readonly Transaction[],
  rules: RuleSet,
): CodingCounts {
  const byCode = new Map<string, number>();
  let coded = 0;
  for (const transaction of transactions) {
    const { code } = categorise(transaction, rules);
    if (!code) continue;
    coded += 1;
    byCode.set(code, (byCode.get(code) ?? 0) + 1);
  }
  return { coded, total: transactions.length, byCode };
}

/**
 * Accounts whose export stopped at a round number, and is probably short.
 *
 * Banks cap a download at a fixed count -- a thousand rows is common -- and
 * give no indication that they have done so. An account holding exactly the
 * cap is therefore suspicious in a way that one holding 999 is not: the odds
 * of a real account landing exactly on it are poor, and the consequence of
 * missing the difference is a report built on part of a year.
 *
 * Suspicious, not wrong. It is reported so somebody can check, because the
 * alternative is a total that looks complete and is not.
 */
export function accountsAtExportLimit(
  transactions: readonly Transaction[],
  limit = 1000,
): string[] {
  const counts = new Map<string, number>();
  for (const t of transactions) counts.set(t.account, (counts.get(t.account) ?? 0) + 1);
  return [...counts.entries()].filter(([, n]) => n === limit).map(([account]) => account);
}
