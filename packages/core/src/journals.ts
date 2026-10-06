import type { Cents } from "./money.js";
import { parseAmount } from "./money.js";
import type { IsoDate } from "./dates.js";
import { parseDate } from "./dates.js";
import { findHeaderRow, parseCsvRecords } from "./csv.js";
import { ColumnReader } from "./importers/shared.js";

/**
 * The general ledger, as an accounting system recorded it.
 *
 * NZOSA derives everything from bank lines, which is what lets it run from
 * a flat file with no backend. The cost of that is a blind spot: an accounting
 * system also holds events that never touch a bank account -- a year-end
 * adjustment, a GST expense claimed late, a write-off between two ledger
 * accounts. Those are real, they change a GST return, and no amount of bank
 * data will reveal them.
 *
 * So journals are read as a *reference*, not as a source of truth to merge in.
 * They answer "what does the accounting system have that we cannot see", which
 * is the question our reconciliation could not previously ask. Anything found
 * here that should affect our own returns has to become a recorded adjustment
 * that a person accepted -- never an automatic import.
 */

export interface JournalLine {
  /** Chart-of-accounts code, e.g. `820`. Empty on a bank-account line. */
  accountCode: string;
  /** Account name as the report gives it. */
  accountName: string;
  description: string;
  /** Debit positive, credit negative, in minor units. */
  amount: Cents;
  /**
   * The GST-inclusive figure this line's tax was worked out from.
   *
   * Present only on journals this app posted. A ledger read from a file keeps
   * its tax on separate lines with nothing tying them back to the cost, so a
   * report built from one cannot say what a line was before GST.
   */
  taxBase?: Cents;
  line: number;
}

export interface Journal {
  /** The accounting system's journal id. */
  id: string;
  date: IsoDate;
  /** The journal's own narration, repeated on every line of the report. */
  narration: string;
  postedDate: IsoDate | null;
  postedBy: string;
  lines: JournalLine[];
}

export interface JournalProblem {
  id: string;
  message: string;
}

export interface JournalImportResult {
  journals: Journal[];
  problems: JournalProblem[];
}

const REQUIRED = ["Date", "Journal ID", "Account", "Debit", "Credit"];

/**
 * Read a Xero Journal Report.
 *
 * One row per journal line, with the journal's own fields repeated on each, so
 * rows are grouped by journal id. A journal's bank-account line carries no
 * account code, which is why every field is read by column name -- collapsing
 * the row to its non-empty cells would shift every figure one place left.
 */
export function parseXeroJournalReport(text: string): JournalImportResult {
  const records = parseCsvRecords(text);
  const header = findHeaderRow(records, REQUIRED);

  if (!header) {
    return {
      journals: [],
      problems: [{ id: "", message: "Not a Journal Report: required columns missing." }],
    };
  }

  const reader = new ColumnReader(header.columns);
  const byId = new Map<string, Journal>();
  const problems: JournalProblem[] = [];

  for (let i = header.index + 1; i < records.length; i += 1) {
    const record = records[i];
    if (!record) continue;

    const cells = reader.at(record.fields);
    const id = cells.get("Journal ID");
    if (id === "") continue;

    const date = parseDate(cells.get("Date"));
    if (date === null) continue; // a per-journal total row carries no date

    const debit = parseAmount(cells.get("Debit")) ?? 0;
    const credit = parseAmount(cells.get("Credit")) ?? 0;

    let journal = byId.get(id);
    if (!journal) {
      journal = {
        id,
        date,
        narration: cells.get("Narration"),
        postedDate: parseDate(cells.get("Posted Date")),
        postedBy: cells.get("Posted By"),
        lines: [],
      };
      byId.set(id, journal);
    }

    journal.lines.push({
      accountCode: cells.get("Account Code"),
      accountName: cells.get("Account"),
      description: cells.get("Description"),
      amount: debit - credit,
      line: record.line,
    });
  }

  const journals = [...byId.values()];
  problems.push(...validateJournals(journals));
  return { journals, problems };
}

/**
 * Keep the narrations when a better-valued report replaces the one holding them.
 *
 * Two exports of the same journals answer different questions. The Journal
 * Report carries a Narration, which is the only thing that tells a year-end
 * adjustment from an ordinary posting -- "YE26 - Remove interest expense" is
 * not a fact about debits and credits, and nothing else in the file says it.
 * General Ledger Detail carries no narration at all, but it values every line
 * -- gross, tax and net -- which the Journal Report does not.
 *
 * Neither is the better file. Loading the valued one over the narrated one
 * used to lose every manual journal silently, which on real books was three of
 * them and 3,354.78 of interest that came back as an expense. So the values
 * come from the incoming report and the narration is carried across by journal
 * id, and the result is the only version of these journals that answers both
 * questions.
 *
 * Carried only where the incoming journal has none of its own. A report that
 * states a narration is describing the journal it is describing, and the one
 * already held is the older account of it.
 */
export function mergeJournalNarrations(
  incoming: readonly Journal[],
  held: readonly Journal[],
): { journals: Journal[]; carried: number } {
  const said = new Map<string, Journal>();
  for (const journal of held) said.set(journal.id, journal);

  let carried = 0;
  const journals = incoming.map((journal) => {
    const before = said.get(journal.id);
    if (before === undefined) return journal;

    const narration = journal.narration.trim() === "" ? before.narration : journal.narration;
    const postedBy = journal.postedBy.trim() === "" ? before.postedBy : journal.postedBy;
    const postedDate = journal.postedDate ?? before.postedDate;
    if (narration === journal.narration && postedBy === journal.postedBy && postedDate === journal.postedDate) {
      return journal;
    }
    if (narration !== journal.narration && narration.trim() !== "") carried += 1;
    return { ...journal, narration, postedBy, postedDate };
  });

  return { journals, carried };
}

/**
 * Journals that would be lost by replacing what is held with what has arrived.
 *
 * Replacing is usually what is wanted -- a fresh export of the same period --
 * but an export of one year over a file holding two drops the other year
 * without saying so. Only the narrated ones are reported: those are the
 * entries a person wrote and nothing can re-derive.
 */
export function narratedJournalsLost(
  incoming: readonly Journal[],
  held: readonly Journal[],
): Journal[] {
  const arriving = new Set(incoming.map((journal) => journal.id));
  return held.filter(
    (journal) => journal.narration.trim() !== "" && !arriving.has(journal.id),
  );
}

/**
 * Check each journal against itself.
 *
 * Double entry means the lines must sum to zero. A journal that does not
 * balance has been read wrongly -- almost always a column misalignment -- and
 * saying so is far better than reporting figures derived from it.
 */
export function validateJournals(journals: readonly Journal[]): JournalProblem[] {
  const problems: JournalProblem[] = [];

  for (const journal of journals) {
    if (journal.lines.length === 0) {
      problems.push({ id: journal.id, message: "no lines" });
      continue;
    }
    const total = journal.lines.reduce((sum, line) => sum + line.amount, 0);
    if (total !== 0) {
      problems.push({
        id: journal.id,
        message: `does not balance: lines sum to ${total} minor units, not zero`,
      });
    }
  }

  return problems;
}

/** Total movement on one account across a set of journals, debit positive. */
export function accountMovement(
  journals: readonly Journal[],
  matches: (line: JournalLine) => boolean,
): Cents {
  let total = 0;
  for (const journal of journals) {
    for (const line of journal.lines) {
      if (matches(line)) total += line.amount;
    }
  }
  return total;
}

export type JournalKind = "banked" | "accrual" | "adjustment";

/**
 * What kind of event a journal records, from the accounts it touches.
 *
 * The distinction matters because only one of the three is interesting to us:
 *
 *  * `banked`     -- has a bank line, so it is the other side of a statement
 *                    line we already hold.
 *  * `accrual`    -- no bank line but a receivable or payable one: an invoice
 *                    raised or a bill entered. On a payments basis these do not
 *                    belong in a return until the money moves, so their absence
 *                    from our figures is correct, not a gap.
 *  * `adjustment` -- neither. A year-end correction, a late GST claim, a
 *                    transfer between ledger accounts. These are the events a
 *                    bank-derived ledger genuinely cannot see, and the reason a
 *                    filed Box 15 can differ from the Box 8 less Box 12 we
 *                    compute.
 */
export function classifyJournal(
  journal: Journal,
  isBankAccount: (line: JournalLine) => boolean,
  isControlAccount: (line: JournalLine) => boolean,
): JournalKind {
  if (journal.lines.some(isBankAccount)) return "banked";
  if (journal.lines.some(isControlAccount)) return "accrual";
  return "adjustment";
}

/**
 * Journals recording something our own ledger has no way to contain.
 *
 * Deliberately narrower than "has no bank line": an invoice accrual has no bank
 * line either, and reporting those as gaps buries the handful that matter under
 * every invoice ever raised.
 */
export function adjustmentJournals(
  journals: readonly Journal[],
  isBankAccount: (line: JournalLine) => boolean,
  isControlAccount: (line: JournalLine) => boolean,
): Journal[] {
  return journals.filter(
    (journal) => classifyJournal(journal, isBankAccount, isControlAccount) === "adjustment",
  );
}
