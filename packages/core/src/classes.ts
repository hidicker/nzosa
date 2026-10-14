import type { PostedJournal } from "./posting.js";

/**
 * Classes: a second way of cutting the profit and loss, across accounts --
 * a department, a location, a job. A class is given to where a posting came
 * from (a bank line, an invoice, a journal), and every income and expense line
 * that source posts falls under it. Nothing is posted differently.
 */

/** Where a posting came from, to the class it is given. */
export type ClassAssignments = Record<string, string>;

/** The name the report gives to what has no class. */
export const UNCLASSIFIED = "Unclassified";

/**
 * The source a posted journal is classed by: the bank line, invoice, or manual
 * journal it came from. An invoice's payment, and the cost of the stock it
 * sold, are classed with the invoice.
 */
export function classSource(journal: Pick<PostedJournal, "transactionId">): string {
  const id = journal.transactionId;
  const paid = /^(.*):(?:paid:\d+|cost)$/.exec(id);
  return paid !== null && paid[1] !== undefined ? paid[1] : id;
}

export interface ClassColumn {
  name: string;
  /** Account code to the sum of its lines, debits positive. */
  byAccount: Map<string, number>;
}

/**
 * Income and expense, account by account, for each class and for what has
 * none. `counts(code)` says which accounts belong in a profit and loss.
 */
export function profitAndLossByClass(
  journals: readonly PostedJournal[],
  assignments: ClassAssignments,
  counts: (code: string) => boolean,
  range: { from: string; to: string },
): ClassColumn[] {
  const columns = new Map<string, ClassColumn>();
  for (const journal of journals) {
    if (journal.date < range.from || journal.date > range.to) continue;
    const name = assignments[classSource(journal)] ?? UNCLASSIFIED;
    for (const line of journal.lines) {
      const code = line.accountCode.trim();
      if (!counts(code)) continue;
      const column = columns.get(name) ?? { name, byAccount: new Map<string, number>() };
      column.byAccount.set(code, (column.byAccount.get(code) ?? 0) + line.amount);
      columns.set(name, column);
    }
  }
  // Classes by name, what has none last.
  return [...columns.values()].sort((a, b) =>
    a.name === UNCLASSIFIED ? 1 : b.name === UNCLASSIFIED ? -1 : a.name.localeCompare(b.name),
  );
}
