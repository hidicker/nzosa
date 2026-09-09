import type { Cents } from "./money.js";
import { parseAmount } from "./money.js";
import type { IsoDate } from "./dates.js";
import type { Transaction } from "./types.js";
import { accountId, isAccountNumber, normaliseAccountNumber } from "./accounts.js";

/**
 * Bank transactions arriving from a feed rather than a downloaded file.
 *
 * Everything else here reads a CSV somebody exported. A feed removes that step,
 * and with it the two things that go wrong most: an export silently cut short
 * at a thousand rows, and a date range chosen by hand that leaves a gap.
 *
 * What it does not remove is the need to check. A feed reports **settled**
 * transactions, so a charge that has not cleared is absent from it while the
 * bank's own daily balance may already include it -- which is a difference the
 * balance check is there to find, not a reason to trust one side more.
 *
 * Nothing here talks to the network. This turns what a feed returned into
 * transactions; fetching it is the caller's problem, deliberately, so the same
 * mapping can be tested against a recorded response.
 */

/** An account as Akahu describes it. Only the parts this app reads. */
export interface AkahuAccount {
  _id: string;
  name: string;
  /** A real account number when the institution has one, already formatted. */
  formatted_account?: string;
  type?: string;
  status?: string;
  connection?: { name?: string };
  balance?: { currency?: string; current?: number };
}

/** A transaction as Akahu returns it. Only the parts this app reads. */
export interface AkahuTransaction {
  _id: string;
  _account: string;
  /** ISO 8601, with a time this app does not use. */
  date: string;
  description: string;
  /** Dollars, negative for money out -- the same direction this app uses. */
  amount: number;
  type?: string;
  merchant?: { name?: string };
  /**
   * The New Zealand fields, present when the app has enriched permissions.
   *
   * These are the same four a BNZ CSV carries, which is what lets a feed
   * transaction and a downloaded one be recognised as the same thing.
   */
  meta?: {
    particulars?: string;
    code?: string;
    reference?: string;
    other_account?: string;
    card_suffix?: string;
  };
}

export interface AkahuImportOptions {
  /**
   * Our account id for one of theirs.
   *
   * Returning null skips the transaction rather than inventing an account: a
   * feed can carry accounts this ledger has never heard of, and quietly filing
   * them under an Akahu id would put somebody's personal spending into the
   * company's books.
   */
  accountFor: (akahuAccountId: string) => string | null;
}

export interface AkahuImportResult {
  transactions: Transaction[];
  /** Rows that could not be read, with the reason, in the shape imports use. */
  problems: { line: number; row: readonly string[]; message: string }[];
  /** Akahu accounts seen in the data that nothing in this ledger matches. */
  unmappedAccounts: string[];
}

/**
 * What to call an account these books have never seen.
 *
 * Named the way an imported file would name it, so that starting from a feed
 * and starting from a download arrive at the same account rather than two.
 * A real account number is used as it stands, normalised -- the feed writes a
 * two digit suffix where a file writes three. A card has no number, only a
 * masked one, so it is named from the account's name and the four digits an
 * import already ends it with.
 */
export function akahuAccountId(account: AkahuAccount): string {
  const formatted = (account.formatted_account ?? "").trim();
  const normalised = normaliseAccountNumber(formatted);
  if (isAccountNumber(normalised)) return normalised;

  const lastFour = /(\d{4})\s*$/.exec(formatted)?.[1];
  const name = account.name.trim();
  if (name === "") return lastFour === undefined ? account._id : `card-${lastFour}`;
  return accountId(lastFour === undefined ? name : `${name} ${lastFour}`);
}

/**
 * The New Zealand date an instant falls on.
 *
 * The timestamps are honest UTC, and taking the first ten characters of one
 * takes the UTC date, which is not the date anybody here was looking at. New
 * Zealand runs twelve or thirteen hours ahead, so every instant from noon UTC
 * onward already belongs to the following day.
 *
 * It was not hypothetical. One bank stamps a term loan's repayments a minute
 * after local midnight -- `2026-07-09T12:57:46Z`, which is 12:57am on Friday
 * the 10th -- while the account paying them stamps a minute before local
 * midnight, `2026-07-13T11:59:00Z`, which is 11:59pm on Monday the 13th. Read
 * as UTC, the first was filed on Thursday the 9th and the second on Monday the
 * 13th, so a transfer looked four days wide and the two legs were never
 * offered as a pair. Across a year of fortnightly repayments it put thirty-three
 * transfers a day apart that had happened on the same day, and left five
 * unmatched entirely -- and an unmatched transfer is not merely unpaired: the
 * receiving leg reads as income, and is taxed as income.
 *
 * `Pacific/Auckland` rather than a fixed offset, so daylight saving is the
 * platform's problem and not a table in here that goes stale. Assembled from
 * the formatter's own parts rather than by parsing what it prints, because
 * what it prints is a locale's business and the shape stored here is not.
 */
const NEW_ZEALAND = "Pacific/Auckland";

export function nzDate(timestamp: string): IsoDate | null {
  const at = Date.parse(timestamp);
  if (Number.isNaN(at)) return null;

  const parts = new Intl.DateTimeFormat("en-NZ", {
    timeZone: NEW_ZEALAND,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);

  const of = (type: string): string => parts.find((part) => part.type === type)?.value ?? "";
  const date = `${of("year")}-${of("month")}-${of("day")}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? (date as IsoDate) : null;
}

/**
 * Turn what a feed returned into transactions.
 *
 * Ids are deliberately not set here. They are assigned centrally from the
 * transaction's own content, so the same transaction gets the same id whether
 * it arrived through a feed or in a file -- which is what makes a coding
 * survive changing how the data gets in.
 */
export function fromAkahu(
  items: readonly AkahuTransaction[],
  options: AkahuImportOptions,
): AkahuImportResult {
  const transactions: Transaction[] = [];
  const problems: AkahuImportResult["problems"] = [];
  const unmapped = new Set<string>();

  items.forEach((item, index) => {
    const line = index + 1;
    const row = [item.date ?? "", item.description ?? "", String(item.amount ?? "")];

    const account = options.accountFor(item._account);
    if (account === null) {
      unmapped.add(item._account);
      return;
    }

    // The feed sends a full timestamp; a ledger works in days, and the time
    // would otherwise make the same transaction look different between a feed
    // and a file.
    const date = nzDate(item.date ?? "");
    if (date === null) {
      problems.push({ line, row, message: `unreadable date ${JSON.stringify(item.date)}` });
      return;
    }

    const amount = parseAmount(item.amount) as Cents | null;
    if (amount === null) {
      problems.push({ line, row, message: `unreadable amount ${JSON.stringify(item.amount)}` });
      return;
    }

    const meta = item.meta ?? {};
    transactions.push({
      id: "",
      date,
      amount,
      currency: "NZD",
      account,
      // A feed has no export sequence numbers. Left empty rather than filled
      // with something invented, because the loose duplicate check ignores
      // exactly these fields -- which is what lets the same transaction be
      // recognised across a feed and a file.
      serial: "",
      trn: "",
      particulars: meta.particulars ?? "",
      code: meta.code ?? "",
      reference: meta.reference ?? "",
      otherParty: item.merchant?.name ?? item.description ?? "",
      origin: "",
      type: item.type ?? "",
      batch: "",
      otherPartyAccount: meta.other_account ?? "",
      occurrence: 1,
      extras: { akahuId: item._id },
      source: { importer: "akahu", file: "feed", line },
    } as Transaction);
  });

  return { transactions, problems, unmappedAccounts: [...unmapped] };
}

/**
 * The account in these books that a feed account is, or null.
 *
 * The two systems write the same account differently, and getting this wrong
 * is expensive in a quiet way: transactions would go into a second account
 * beside the real one, and a history that had been reconciled would silently
 * split in two.
 *
 * A bank writes a suffix as two digits in one place and three in another --
 * `02-1234-0056789-01` and `02-1234-0056789-001` are the same account -- so
 * numbers are compared normalised. A card has no account number at all, only
 * a masked one ending in the four digits an import already names it by.
 *
 * Only when the answer is unambiguous. Two accounts ending in the same four
 * digits is a question for a person, and inventing an answer would put one
 * account's spending into another's.
 */
export function matchLedgerAccount(
  account: AkahuAccount,
  ledgerAccounts: readonly string[],
): string | null {
  const formatted = (account.formatted_account ?? "").trim();
  if (formatted === "") return null;

  const exact = ledgerAccounts.find((a) => a === formatted);
  if (exact !== undefined) return exact;

  const wanted = normaliseAccountNumber(formatted);
  const byNumber = ledgerAccounts.filter((a) => normaliseAccountNumber(a) === wanted);
  if (byNumber.length === 1) return byNumber[0] as string;

  // A masked card: xxxx-xxxx-xxxx-1122. The digits at the end are all there is
  // to go on, and an import already names the account by them.
  const lastFour = /(\d{4})\s*$/.exec(formatted)?.[1];
  if (lastFour === undefined) return null;
  const bySuffix = ledgerAccounts.filter((a) => a.endsWith(`-${lastFour}`) || a.endsWith(lastFour));
  return bySuffix.length === 1 ? (bySuffix[0] as string) : null;
}
