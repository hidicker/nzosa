import type { Cents } from "./money.js";
import type { IsoDate } from "./dates.js";
import type { PostedJournal } from "./posting.js";
import type { Transaction } from "./types.js";

/**
 * What a person did to the books on one day, and what it posted.
 *
 * Coding a bank line is a decision, and a decision nobody can see the effect
 * of is one nobody can check. The change log already records every decision,
 * but it records them as *changes* -- a code replaced, a transfer paired --
 * and a change is not an answer to "what did I do to the accounts today".
 * That answer is the journals: the debits and credits those decisions caused,
 * which are what the reports are built from and what an accountant would ask
 * to see.
 *
 * So this pairs the two. The decisions of a day, the bank lines they were
 * about, and every journal line arising from those lines -- which is as close
 * as this gets to a day book.
 *
 * Only the kinds that move money are counted. Renaming an account or editing a
 * rule changes what future coding will say and posts nothing itself, and
 * including those would bury the entries that did.
 */
export interface DaysWork {
  on: IsoDate;
  /** Decisions made that day, newest first. */
  events: readonly DayEvent[];
  /** The bank lines those decisions were about. */
  transactions: Transaction[];
  /** Every journal arising from those bank lines. */
  journals: PostedJournal[];
  /** Debits and credits across those journals; equal, or the posting is wrong. */
  debits: Cents;
  credits: Cents;
  /** Transactions a decision named that the ledger no longer holds. */
  missing: string[];
  /**
   * Lines whose posting sits under the other leg of their transfer.
   *
   * Not a fault, and worth saying: the entry exists, once, against the pair.
   */
  postedWithPair: Set<string>;
}

/** The little of an event this needs, so a caller need not match a whole type. */
export interface DayEvent {
  id: string;
  at: string;
  kind: string;
  summary: string;
  who: string;
  targetId?: string | undefined;
  before?: unknown;
  after?: unknown;
}

/** Event kinds that decide what a bank line is, and so cause postings. */
const POSTING_KINDS = new Set([
  "coding",
  "codingBatch",
  "split",
  "transfer",
  "transferBatch",
  "invoice",
  "manualJournal",
]);

/**
 * The transaction ids an event is about.
 *
 * A single decision names its target; a batch carries a list, and the two are
 * shaped differently because one records a replacement and the other records
 * what was accepted across a screen. Both are read, because a person who
 * accepted two hundred codings in one click did two hundred things and should
 * see them.
 */
export function transactionIdsIn(event: DayEvent): string[] {
  const out = new Set<string>();
  if (event.targetId !== undefined && event.targetId !== "") out.add(event.targetId);

  const collect = (value: unknown): void => {
    if (!Array.isArray(value)) return;
    for (const item of value) {
      if (item === null || typeof item !== "object") continue;
      const shape = item as { id?: unknown; from?: unknown; to?: unknown };
      for (const key of [shape.id, shape.from, shape.to]) {
        if (typeof key === "string" && key !== "") out.add(key);
      }
    }
  };
  collect(event.before);
  collect(event.after);
  return [...out];
}

/**
 * The bank lines a posted journal came from.
 *
 * A journal's id is not always a transaction id. A split posts under `id:1`,
 * `id:2` and so on; a transfer posts once for the pair, under
 * `transfer:<a>:<b>` with both legs named and neither of them the id itself.
 * Reading those shapes wrongly is not a small error -- it made a day of
 * pairing transfers report that fourteen decisions had posted nothing.
 */
export function sourceIdsOf(transactionId: string): string[] {
  if (transactionId.startsWith("transfer:")) {
    return transactionId.split(":").slice(1).filter((part) => part !== "");
  }
  const parts = transactionId.split(":");
  const parent = parts[0] ?? transactionId;
  return parts.length > 1 && parent !== "" ? [parent] : [transactionId];
}

export interface DaysWorkOptions {
  events: readonly DayEvent[];
  transactions: readonly Transaction[];
  journals: readonly PostedJournal[];
  /** The day to report, as an ISO date. */
  on: IsoDate;
  /**
   * Bank line to the other leg of the transfer it is half of.
   *
   * A transfer between your own accounts posts once for the pair, not once per
   * leg, so without this the leg that did not carry the posting looked as
   * though nothing had happened -- which on a day of pairing transfers was
   * most of the page.
   */
  transfers?: Readonly<Record<string, string>>;
  /** Minutes east of UTC, so "today" means the user's day. Defaults to 0. */
  offsetMinutes?: number;
}

/** The local calendar day an instant falls on, given an offset from UTC. */
export function localDay(at: string, offsetMinutes = 0): IsoDate {
  const shifted = new Date(Date.parse(at) + offsetMinutes * 60_000);
  return shifted.toISOString().slice(0, 10) as IsoDate;
}

export function daysWork(options: DaysWorkOptions): DaysWork {
  const { on, transactions, journals } = options;
  const offset = options.offsetMinutes ?? 0;

  const events = options.events
    .filter((e) => POSTING_KINDS.has(e.kind) && localDay(e.at, offset) === on)
    .slice()
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

  const wanted = new Set<string>();
  for (const event of events) for (const id of transactionIdsIn(event)) wanted.add(id);

  // A transfer posts once for the pair, so the partner's journal belongs to
  // this day's work as much as the leg that was decided.
  const pairs = options.transfers ?? {};
  const partners = new Set<string>();
  for (const id of wanted) {
    const other = pairs[id];
    if (other !== undefined && other !== "") partners.add(other);
  }

  const byId = new Map(transactions.map((t) => [t.id, t]));
  const found: Transaction[] = [];
  const missing: string[] = [];
  for (const id of wanted) {
    const transaction = byId.get(id);
    if (transaction) found.push(transaction);
    else missing.push(id);
  }
  found.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));

  const mine = (journal: PostedJournal): boolean =>
    sourceIdsOf(journal.transactionId).some((id) => wanted.has(id) || partners.has(id));
  const arising = journals.filter(mine);

  let debits = 0;
  let credits = 0;
  for (const journal of arising) {
    for (const line of journal.lines) {
      if (line.amount > 0) debits += line.amount;
      else credits += -line.amount;
    }
  }

  // Which of today's lines are explained by their pair rather than themselves.
  const posting = new Set(arising.flatMap((j) => sourceIdsOf(j.transactionId)));
  const postedWithPair = new Set<string>();
  for (const transaction of found) {
    if (posting.has(transaction.id)) continue;
    const other = pairs[transaction.id];
    if (other !== undefined && posting.has(other)) postedWithPair.add(transaction.id);
  }

  return {
    on, events, transactions: found, journals: arising, debits, credits, missing, postedWithPair,
  };
}
