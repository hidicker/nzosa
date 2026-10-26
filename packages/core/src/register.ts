import type { Cents } from "./money.js";
import type { IsoDate } from "./dates.js";
import type { Transaction } from "./types.js";

/**
 * A register you type into: cash, petty cash, or any account with no bank
 * feed and no statement to import.
 *
 * A typed entry is kept as a bank line, the same shape an import produces, so
 * everything that reads bank lines -- coding, GST, the reports, Reconcile --
 * reads it with nothing special. What marks it is where it came from: the
 * importer is "register", which is also what lets it be edited and deleted
 * where an imported line cannot.
 */

export const REGISTER_IMPORTER = "register";

/** Whether a line was typed into a register, and so can be changed there. */
export function isRegisterEntry(transaction: Transaction): boolean {
  return transaction.source.importer === REGISTER_IMPORTER;
}

export interface RegisterDraft {
  account: string;
  date: IsoDate;
  /** Who was paid, or who paid. */
  payee: string;
  /** What for. */
  description: string;
  /** Money in positive, money out negative. */
  amount: Cents;
  currency: string;
  /** A receipt or voucher number, if there is one. */
  reference?: string;
}

/** What is wrong with an entry, in words, or null. */
export function registerProblem(draft: RegisterDraft): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date)) return "A date for the entry.";
  if (!Number.isInteger(draft.amount) || draft.amount === 0) return "An amount, in or out.";
  if (draft.payee.trim() === "" && draft.description.trim() === "") return "Who it was, or what it was for.";
  if (draft.account.trim() === "") return "The account it is in.";
  return null;
}

/**
 * A typed entry as a bank line.
 *
 * `id` is given rather than worked out from the contents, so the entry keeps
 * its coding when its amount or date is corrected. `existing` is the account's
 * other lines: an entry the same as one already there on the same day -- two
 * coffees at the same price -- is numbered as the next of its kind, so neither
 * reads as a duplicate of the other.
 */
export function registerTransaction(draft: RegisterDraft, id: string, existing: readonly Transaction[]): Transaction {
  const payee = draft.payee.trim();
  const description = draft.description.trim();
  const reference = (draft.reference ?? "").trim();
  const alike = existing.filter(
    (t) =>
      t.id !== id &&
      t.account === draft.account &&
      t.date === draft.date &&
      t.amount === draft.amount &&
      t.otherParty === payee &&
      t.particulars === description &&
      t.code === "",
  ).length;
  return {
    id,
    date: draft.date,
    amount: draft.amount,
    currency: draft.currency,
    serial: "",
    trn: "",
    particulars: description,
    code: "",
    reference,
    otherParty: payee,
    origin: "",
    type: draft.amount > 0 ? "DEP" : "PAY",
    batch: "",
    otherPartyAccount: "",
    account: draft.account,
    occurrence: alike + 1,
    extras: {},
    source: { importer: REGISTER_IMPORTER, file: "Register", line: 0 },
  };
}

export interface RegisterRow {
  transaction: Transaction;
  /** The account's balance after this line, from the opening figure. */
  balance: Cents;
}

/**
 * An account's lines in date order with the balance after each, starting from
 * what the account held at the start of the books.
 */
export function registerRows(transactions: readonly Transaction[], account: string, opening: Cents = 0): RegisterRow[] {
  const lines = transactions
    .filter((t) => t.account === account)
    .map((t, index) => ({ t, index }))
    .sort((a, b) => a.t.date.localeCompare(b.t.date) || a.index - b.index);
  let balance = opening;
  return lines.map(({ t }) => {
    balance += t.amount;
    return { transaction: t, balance };
  });
}
