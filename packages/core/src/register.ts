import type { Cents } from "./money.js";
import type { IsoDate } from "./dates.js";
import type { Transaction } from "./types.js";
import { dedupeKey } from "./dedupe.js";
import { hash } from "./hash.js";

/**
 * A register typed into: cash, petty cash, or an account no bank file or feed
 * reaches. Each line is made a bank line like any other -- the same identity,
 * coded on Reconcile or as it is typed, split, posted and reported the same --
 * so nothing downstream has a second kind of line to know about.
 *
 * What keeps two identical cash purchases two lines is the serial, which a
 * typed line is given and a bank never would: "typed-" and a number.
 */

/** The importer name typed lines carry, so they can be told apart (and only they deleted). */
export const TYPED_IMPORTER = "typed";

export function typedLine(input: {
  account: string;
  date: IsoDate;
  /** Positive in, negative out. */
  amount: Cents;
  currency: string;
  payee: string;
  reference?: string;
  /** Unique within the account: a counter, or the moment it was typed. */
  serial: string;
  /** Its place in the register, for pointing at it. */
  line: number;
}): Transaction {
  const transaction: Transaction = {
    id: "",
    date: input.date,
    amount: input.amount,
    currency: input.currency,
    serial: `typed-${input.serial}`,
    trn: "",
    particulars: "",
    code: "",
    reference: (input.reference ?? "").trim(),
    otherParty: input.payee.trim(),
    origin: "",
    type: input.amount >= 0 ? "IN" : "OUT",
    batch: "",
    otherPartyAccount: "",
    account: input.account,
    occurrence: 1,
    extras: {},
    source: { importer: TYPED_IMPORTER, file: "Typed in", line: input.line },
  };
  return { ...transaction, id: hash(dedupeKey(transaction)) };
}

/** Whether a line was typed in rather than read from a bank. */
export function isTyped(transaction: Pick<Transaction, "source">): boolean {
  return transaction.source.importer === TYPED_IMPORTER;
}

/**
 * A register's lines in order with the balance after each: from the opening
 * balance, every line on the account -- typed or imported -- by date.
 */
export function registerLines(
  transactions: readonly Transaction[],
  account: string,
  opening: Cents = 0,
): { transaction: Transaction; balance: Cents }[] {
  let balance = opening;
  return transactions
    .filter((t) => t.account === account)
    .sort((a, b) => a.date.localeCompare(b.date) || a.source.line - b.source.line || a.id.localeCompare(b.id))
    .map((transaction) => {
      balance += transaction.amount;
      return { transaction, balance };
    });
}
