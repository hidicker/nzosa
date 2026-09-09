import type { Cents } from "./money.js";
import { parseAmount, formatAmount } from "./money.js";
import type { IsoDate } from "./dates.js";
import type { Transaction } from "./types.js";
import { parseCsvRecords } from "./csv.js";

/**
 * Checking imported transactions against the bank's own daily balances.
 *
 * An import can be wrong in two ways a ledger cannot see by itself: a
 * transaction can be missing, or the same one can be there twice. Neither
 * shows up in any total, because the total is computed from exactly the rows
 * that are present. The bank's balance is the only outside witness.
 *
 * The check deliberately does not use the balance file's opening figure. That
 * figure is only right when the export happens to start where the account did,
 * and comparing against it turns one missing transaction into an error on
 * every day that follows. Instead this compares the *offset* -- what the bank
 * says the balance is, less what our transactions add up to -- from one day to
 * the next.
 *
 * A constant offset means every movement the bank recorded, we have. Its value
 * is simply the balance the account held before our data begins, and it is not
 * interesting. What is interesting is the offset *changing*: on that day the
 * bank saw a movement we do not have, or we have one it did not. The change is
 * the amount, to the cent.
 *
 * The file lists business days only, so a Saturday's transaction appears in
 * Monday's balance. Comparing cumulative totals on the days the file gives
 * absorbs that; comparing day-on-day movement would not.
 */
export interface DailyBalance {
  date: IsoDate;
  /** The balance the bank says the account closed the day at. */
  closing: Cents;
}

export interface BalanceSection {
  /** The account as the file names it, e.g. `02-1100-0022001-001`. */
  account: string;
  /** The name beside it, e.g. `Kea Coffee Roasters`. */
  label: string;
  days: DailyBalance[];
}

export interface BalanceImportResult {
  sections: BalanceSection[];
  problems: string[];
}

/**
 * `dd/mm/yyyy` to `yyyy-mm-dd`. Returns null for anything else.
 *
 * The day and month are checked, not just their shape. Without that a file
 * written month-first turns 04/13/2024 into "2024-13-04", which is not a date
 * but does compare and sort as though it were -- so it would land after every
 * real date and quietly corrupt the answer rather than being noticed.
 */
function isoFrom(text: string): IsoDate | null {
  const parts = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text.trim());
  if (parts === null) return null;
  const day = Number(parts[1]);
  const month = Number(parts[2]);
  const year = Number(parts[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  // Rejects the 31st of a thirty-day month, and the 29th of February in a
  // year that has no 29th.
  const made = new Date(Date.UTC(year, month - 1, day));
  if (made.getUTCMonth() !== month - 1 || made.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * A money column as cents, or null when the text is not a figure.
 *
 * Null rather than zero, and it matters here more than almost anywhere: this
 * file exists to prove a running balance against the bank's own, so a figure
 * that cannot be read has to stop the comparison rather than join it as zero.
 * A silent zero either invents a break or hides a real one.
 *
 * Parsing is delegated rather than repeated. The old test was a regular
 * expression that accepted digits, a sign and a point -- which rejected
 * `(530.61)`, the way accounts have written a negative for a century, and
 * turned a balance of -$530.61 into $0.00 without a word.
 */
function cents(text: string): Cents | null {
  if (text.trim() === "") return null;
  return parseAmount(text);
}

/**
 * Read a BNZ daily balance export.
 *
 * The file is several accounts one after another: a heading line naming the
 * account, a column header, then a row per business day.
 */
export function parseDailyBalances(text: string): BalanceImportResult {
  const records = parseCsvRecords(text);
  const sections: BalanceSection[] = [];
  const problems: string[] = [];
  let current: BalanceSection | undefined;

  for (const record of records) {
    const cells = record.fields.map((cell) => cell.trim());
    const first = cells[0] ?? "";
    if (first === "") continue;

    // A column header. Skipped rather than treated as a heading.
    if (/^date$/i.test(first)) continue;

    // A heading: `Kea Coffee Roasters - 02-1100-0022001-001`, or a card as
    // `BNZ Advantage Visa Platinum - XXXX-XXXX-XXXX-4003`.
    const heading = /^(.*\S)\s+-\s+(\S+)$/.exec(first);
    if (heading && cells.length <= 2) {
      current = { label: heading[1] as string, account: heading[2] as string, days: [] };
      sections.push(current);
      continue;
    }

    const date = isoFrom(first);
    if (date === null) {
      // Something shaped like a date that is not one is worth saying out loud:
      // a whole file written month-first would otherwise read as empty rather
      // than wrong.
      if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(first)) {
        problems.push(`Line ${record.line}: "${first}" is not a valid day/month/year date.`);
      }
      continue;
    }
    if (current === undefined) {
      problems.push(`A balance row for ${first} appears before any account heading.`);
      continue;
    }
    // Date, CCY, Opening, Debits, Credits, Closing.
    if (cells.length < 6) {
      problems.push(
        `${current.account} ${first} (line ${record.line}): expected six columns, found ${cells.length}.`,
      );
      continue;
    }
    const closing = cents(cells[5] as string);
    if (closing === null) {
      problems.push(
        `${current.account} ${first} (line ${record.line}): ` +
          `closing balance ${JSON.stringify(cells[5])} is not a figure.`,
      );
      continue;
    }
    current.days.push({ date, closing });
  }

  for (const section of sections) {
    section.days.sort((a, b) => a.date.localeCompare(b.date));
  }
  return { sections, problems };
}

/**
 * Which of our account ids a balance section is about.
 *
 * Bank accounts are named identically. A credit card is a masked number in the
 * balance file and a slug ending in the same four digits in ours, which is the
 * only thing the two have in common.
 */
export function matchBalanceAccount(
  section: Pick<BalanceSection, "account">,
  accounts: readonly string[],
): string | null {
  const exact = accounts.find((a) => a === section.account);
  if (exact !== undefined) return exact;

  const lastFour = /(\d{4})\s*$/.exec(section.account)?.[1];
  if (lastFour === undefined) return null;
  const bySuffix = accounts.filter((a) => a.endsWith(`-${lastFour}`));
  // Only when it is unambiguous. Two cards ending in the same four digits is
  // unlikely and guessing between them would be worse than saying nothing.
  return bySuffix.length === 1 ? (bySuffix[0] as string) : null;
}

/** One day where the bank and the ledger stopped agreeing. */
export interface BalanceBreak {
  date: IsoDate;
  /**
   * What the bank saw that we did not, in cents.
   *
   * Negative means money left the account that our transactions do not show.
   * Positive means the bank received something we are missing -- or, when our
   * side is larger, that we hold a transaction twice.
   */
  difference: Cents;
}

export interface BalanceCheck {
  section: BalanceSection;
  /** Our account id, or null when nothing in the ledger matches. */
  account: string | null;
  /** How many of our transactions were compared. */
  transactions: number;
  /** The balance held before our data begins. Not an error. */
  openingOffset: Cents;
  /** Days on which the two stopped agreeing, in order. */
  breaks: BalanceBreak[];
  /** The total of every break: what the account is out by at the end. */
  outBy: Cents;
  /** The last day both sides agreed. Null when they never did. */
  agreedUntil: IsoDate | null;
}

export function checkDailyBalances(
  sections: readonly BalanceSection[],
  transactions: readonly Transaction[],
): BalanceCheck[] {
  const accounts = [...new Set(transactions.map((t) => t.account))];
  const byAccount = new Map<string, Transaction[]>();
  for (const transaction of transactions) {
    const list = byAccount.get(transaction.account);
    if (list) list.push(transaction);
    else byAccount.set(transaction.account, [transaction]);
  }

  return sections.map((section) => {
    const account = matchBalanceAccount(section, accounts);
    if (account === null) {
      // A section of the bank's file that no imported account answers to.
      //
      // Running the comparison anyway would total nothing against a balance
      // that moves every day, so every day would look like a break and the
      // account would be reported as out by its whole balance. There is
      // nothing to compare, which is a different thing from disagreeing, and
      // both callers say so; this returns the shape that matches.
      return {
        section,
        account,
        transactions: 0,
        openingOffset: 0,
        breaks: [],
        outBy: 0,
        agreedUntil: null,
      };
    }

    const ours = [...(byAccount.get(account) ?? [])].sort((a, b) => a.date.localeCompare(b.date));

    let index = 0;
    let running = 0;
    let previous: Cents | null = null;
    let openingOffset = 0;
    let agreedUntil: IsoDate | null = null;
    const breaks: BalanceBreak[] = [];

    // Nothing to say about days before this ledger holds anything.
    //
    // The bank's file can reach back years further than the transactions do --
    // a feed fetched for the last three months against five years of balances
    // -- and comparing those years reported every account as not tying, for
    // hundreds of days, none of it an error. The comparison starts where the
    // ledger starts, and what came before becomes the opening position, which
    // is what it always was.
    const firstOurs = ours[0]?.date;

    for (const day of section.days) {
      if (firstOurs !== undefined && day.date < firstOurs) continue;
      while (index < ours.length && (ours[index] as Transaction).date <= day.date) {
        running += (ours[index] as Transaction).amount;
        index += 1;
      }
      const offset = day.closing - running;
      if (previous === null) {
        openingOffset = offset;
        agreedUntil = day.date;
      } else if (offset !== previous) {
        breaks.push({ date: day.date, difference: offset - previous });
      } else if (breaks.length === 0) {
        agreedUntil = day.date;
      }
      previous = offset;
    }

    return {
      section,
      account,
      transactions: ours.length,
      openingOffset,
      breaks,
      outBy: breaks.reduce((sum, b) => sum + b.difference, 0),
      agreedUntil,
    };
  });
}

/**
 * What the bank's own balance says about a transaction we are unsure of.
 *
 * A near-duplicate is undecidable from the file that contains it: two coffees
 * of the same amount at the same shop on consecutive days look exactly like
 * one coffee exported twice, and no amount of staring at the rows settles it.
 *
 * The daily balance settles it, because it is the outside witness. Holding a
 * transaction twice makes our running total too large by its amount, and the
 * offset against the bank's closing balance moves by exactly that much on the
 * day it happened. So: a break of the right size on the right day means the
 * row really is a second copy; no break at all means both are real.
 */
export type DuplicateVerdict = "double counted" | "both real" | "cannot tell";

export interface DuplicateJudgement {
  transactionId: string;
  verdict: DuplicateVerdict;
  /** Plain words for the row, saying what the balance showed. */
  reason: string;
}

/**
 * Judge each questionable transaction against the bank's daily balances.
 *
 * `candidates` are the rows a person is being asked about -- the ones dedupe
 * marked `review`. Everything else is left alone: this answers a question that
 * was already being asked rather than looking for new ones.
 */
export function judgeDuplicates(
  candidates: readonly Transaction[],
  checks: readonly BalanceCheck[],
): DuplicateJudgement[] {
  const byAccount = new Map<string, BalanceCheck>();
  for (const check of checks) {
    if (check.account !== null) byAccount.set(check.account, check);
  }

  // More than one questionable row on the same day in the same account cannot
  // be told apart by a single break, so those are left undecided rather than
  // guessed at.
  const crowd = new Map<string, number>();
  for (const t of candidates) {
    const key = `${t.account}:${t.date}`;
    crowd.set(key, (crowd.get(key) ?? 0) + 1);
  }

  return candidates.map((transaction) => {
    const check = byAccount.get(transaction.account);
    if (check === undefined) {
      return {
        transactionId: transaction.id,
        verdict: "cannot tell" as const,
        reason: "No daily balances loaded for this account.",
      };
    }

    if ((crowd.get(`${transaction.account}:${transaction.date}`) ?? 0) > 1) {
      return {
        transactionId: transaction.id,
        verdict: "cannot tell" as const,
        reason: "More than one row in question on this day, so the balance cannot separate them.",
      };
    }

    // The balance file may not carry every day. The first day on or after the
    // transaction is the one that would first show it.
    const day = check.section.days.find((d) => d.date >= transaction.date);
    if (day === undefined) {
      return {
        transactionId: transaction.id,
        verdict: "cannot tell" as const,
        reason: "The daily balances do not reach this date.",
      };
    }

    const wanted = -transaction.amount;
    const onDay = check.breaks.find((b) => b.date === day.date);

    if (onDay !== undefined && onDay.difference === wanted) {
      return {
        transactionId: transaction.id,
        verdict: "double counted" as const,
        reason:
          `The bank's balance on ${day.date} is out by exactly this amount, ` +
          `which is what holding it twice would do.`,
      };
    }

    if (onDay === undefined) {
      return {
        transactionId: transaction.id,
        verdict: "both real" as const,
        reason: `The bank's balance on ${day.date} agrees with keeping both.`,
      };
    }

    return {
      transactionId: transaction.id,
      verdict: "cannot tell" as const,
      reason:
        `The bank's balance on ${day.date} is out, but by ` +
        `${formatAmount(onDay.difference)} rather than this row's amount, so something ` +
        `else is wrong on that day too.`,
    };
  });
}
