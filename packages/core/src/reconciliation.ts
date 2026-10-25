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

/** A finished statement set out again: what it started from, what it cleared, and what was still to come. */
export interface ReconciliationReport {
  reconciliation: BankReconciliation;
  /** The account's balance when the statement began: its opening balance and every earlier statement's lines. */
  beginning: Cents;
  cleared: Transaction[];
  clearedTotal: Cents;
  /** The statement's figure, in the ledger's direction. */
  statement: Cents;
  /** Lines dated on or before the statement that no statement had cleared by then: in the books, not yet on a statement. */
  outstanding: Transaction[];
  outstandingTotal: Cents;
}

/**
 * The report of one finished statement. "Earlier" is the order statements
 * were finished on the account, which is the order their beginnings were
 * worked out in; a statement finished later can never have changed one
 * already finished.
 */
export function reconciliationReport(
  transactions: readonly Transaction[],
  done: readonly BankReconciliation[],
  id: string,
  opening: Cents = 0,
): ReconciliationReport | null {
  const index = done.findIndex((r) => r.id === id);
  const reconciliation = done[index];
  if (reconciliation === undefined) return null;
  const earlier = done.slice(0, index).filter((r) => r.account === reconciliation.account);
  const before = clearedLines(earlier, reconciliation.account);
  const now = new Set(reconciliation.cleared);
  const onAccount = transactions.filter((t) => t.account === reconciliation.account);
  const byDate = (a: Transaction, b: Transaction): number => a.date.localeCompare(b.date) || a.id.localeCompare(b.id);
  const cleared = onAccount.filter((t) => now.has(t.id)).sort(byDate);
  const outstanding = onAccount
    .filter((t) => !now.has(t.id) && !before.has(t.id) && t.date <= reconciliation.statementDate)
    .sort(byDate);
  const beginning = onAccount.filter((t) => before.has(t.id)).reduce((s, t) => s + t.amount, opening);
  return {
    reconciliation,
    beginning,
    cleared,
    clearedTotal: cleared.reduce((s, t) => s + t.amount, 0),
    statement: reconciliation.owed ? -reconciliation.statementBalance : reconciliation.statementBalance,
    outstanding,
    outstandingTotal: outstanding.reduce((s, t) => s + t.amount, 0),
  };
}
