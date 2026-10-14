import type { IsoDate } from "./dates.js";
import type { Cents } from "./money.js";
import type { Transaction } from "./types.js";

/**
 * Checking a bank account against its statement, a statement at a time.
 *
 * The bank's own figure is typed in; the lines it has cleared are ticked; and
 * the difference between the two has to come to nothing before the statement
 * is finished. That is what proves nothing is missing or twice -- and what
 * leaves a record of which lines each statement covered, so the next one
 * starts where this one ended.
 */

export interface BankReconciliation {
  id: string;
  /** The ledger account id the lines are on. */
  account: string;
  statementDate: IsoDate;
  /** As printed: for a card, what is owed. */
  statementBalance: Cents;
  /** Whether the balance is money owed, as a card's is. */
  owed: boolean;
  /** The lines this statement cleared. */
  cleared: string[];
  finishedAt: string;
  by?: string;
}

/** Every line some statement has already cleared on an account. */
export function clearedLines(done: readonly BankReconciliation[], account: string): Set<string> {
  const out = new Set<string>();
  for (const one of done) if (one.account === account) for (const id of one.cleared) out.add(id);
  return out;
}

/**
 * What the account held at the end of the last statement: its opening balance
 * and every line already cleared.
 */
export function beginningBalance(
  transactions: readonly Transaction[],
  done: readonly BankReconciliation[],
  account: string,
  opening: Cents = 0,
): Cents {
  const cleared = clearedLines(done, account);
  let total = opening;
  for (const t of transactions) if (t.account === account && cleared.has(t.id)) total += t.amount;
  return total;
}

export interface ReconciliationFigures {
  /** The statement's figure in the ledger's direction (a card's owed turned negative). */
  statement: Cents;
  beginning: Cents;
  ticked: Cents;
  /** Nothing when the statement and the books agree. */
  difference: Cents;
}

export function reconciliationFigures(
  statementBalance: Cents,
  owed: boolean,
  beginning: Cents,
  ticked: readonly Transaction[],
): ReconciliationFigures {
  const statement = owed ? -statementBalance : statementBalance;
  const sum = ticked.reduce((total, t) => total + t.amount, 0);
  return { statement, beginning, ticked: sum, difference: statement - (beginning + sum) };
}
