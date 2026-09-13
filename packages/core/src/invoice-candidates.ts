import { daysBetween } from "./dates.js";
import { invoiceBalances } from "./invoices.js";
import type { Invoice, InvoiceAssignment, InvoiceBalance, InvoiceKind } from "./invoices.js";
import { splitPartId } from "./splits.js";
import type { Splits } from "./splits.js";
import type { Transaction } from "./types.js";

/**
 * What is still owing on each invoice, counting split parts as payments.
 *
 * One payment can settle several invoices, and each part is what actually
 * landed on its own. The parts are addressed by the id `expandSplits` gives
 * them, so a part assignment means the same thing here, in the postings, and
 * in the history.
 */
export function invoiceBalancesFor(options: {
  invoices: readonly Invoice[];
  transactions: readonly Transaction[];
  splits: Splits;
  assignments: ReadonlyMap<string, string>;
  /** Credit note number to the invoice it credits, as nominated by a person. */
  credits?: Readonly<Record<string, string>>;
}): Map<string, InvoiceBalance> {
  const { invoices, transactions, splits, assignments } = options;
  const byId = new Map(transactions.map((t) => [t.id, t]));
  for (const [id, parts] of Object.entries(splits)) {
    const parent = byId.get(id);
    if (parent === undefined) continue;
    parts.forEach((part, index) => {
      byId.set(splitPartId(id, index), {
        ...parent,
        id: splitPartId(id, index),
        amount: part.amount,
      });
    });
  }

  const paid: InvoiceAssignment[] = [];
  for (const [transactionId, invoiceNumber] of assignments) {
    const transaction = byId.get(transactionId);
    if (transaction !== undefined) paid.push({ invoiceNumber, amount: transaction.amount });
  }
  return invoiceBalances(invoices, paid, undefined, options.credits ?? {});
}

/**
 * Which invoices a bank line might be settling, best first.
 *
 * Scored rather than filtered, because no single signal is reliable on its
 * own and a person has to choose between what is left. In order of weight:
 *
 *  * **The number appears on the bank line** (8). A customer quoting the
 *    invoice number settles the question outright.
 *  * **The amount matches exactly** (4) -- against what is still *owing*, not
 *    the original total. An invoice already part paid is looking for the rest,
 *    and judged against the full amount it is neither exact nor ranked well:
 *    the second half of a half-paid invoice never appeared at all.
 *  * **The contact's first word appears** (2). Bank lines abbreviate, so
 *    "TAUTAHI,MERE" still has to recognise "Tautahi".
 *  * **Raised within the month** (1).
 *
 * A smaller receipt against a larger balance stays a candidate, because part
 * payments happen -- but only when the contact also matches, or every large
 * invoice would be offered for every small receipt.
 */
export interface CandidateOptions {
  invoices: readonly Invoice[];
  balances: ReadonlyMap<string, InvoiceBalance>;
  /** How far either side of the invoice date to look. Defaults to 180 days. */
  windowDays?: number;
  /** How many to return. Defaults to 6. */
  limit?: number;
}

export function invoiceCandidates(
  transaction: Transaction,
  options: CandidateOptions,
): Invoice[] {
  const { invoices, balances } = options;
  if (invoices.length === 0 || transaction.amount === 0) return [];

  const windowDays = options.windowDays ?? 180;
  const wanted = Math.abs(transaction.amount);
  const kind: InvoiceKind = transaction.amount > 0 ? "sales" : "purchase";
  const text =
    `${transaction.reference ?? ""} ${transaction.particulars ?? ""} ${transaction.otherParty ?? ""}`.toUpperCase();

  const scored: { invoice: Invoice; score: number }[] = [];
  for (const invoice of invoices) {
    if (invoice.kind !== kind) continue;

    const owing = balances.get(invoice.number)?.remaining ?? invoice.total;
    // Nothing left to settle. It stays visible on the invoice list, but it is
    // not what this receipt is for.
    if (owing <= 0) continue;

    const days = Math.abs(daysBetween(invoice.issued, transaction.date));
    if (days > windowDays) continue;

    const named = invoice.number !== "" && text.includes(invoice.number.toUpperCase());
    const exact = owing === wanted;
    const partial = !exact && wanted < owing;
    const firstWord = invoice.contact.toUpperCase().split(/[ ,]/)[0] ?? "";
    const sameContact = firstWord.length >= 3 && text.includes(firstWord);

    if (!named && !exact && !(partial && sameContact)) continue;

    scored.push({
      invoice,
      score: (named ? 8 : 0) + (exact ? 4 : 0) + (sameContact ? 2 : 0) + (days <= 30 ? 1 : 0),
    });
  }

  scored.sort((a, b) => b.score - a.score || a.invoice.issued.localeCompare(b.invoice.issued));
  return scored.slice(0, options.limit ?? 6).map((s) => s.invoice);
}

/** An invoice number split into its prefix and its number, when it has both. */
export interface NumberedInvoice {
  prefix: string;
  digits: string;
  value: number;
}

export function splitInvoiceNumber(number: string): NumberedInvoice | null {
  const parts = /^([A-Za-z-]*)(\d+)$/.exec(number.trim());
  if (parts === null) return null;
  return { prefix: parts[1] ?? "", digits: parts[2] ?? "", value: Number(parts[2]) };
}

/** What each kind of document is called. Money in is INV, money out is BILL. */
export function invoicePrefix(kind: InvoiceKind): string {
  return kind === "purchase" ? "BILL-" : "INV-";
}

/**
 * The next number in the series, padded to the width already in use.
 *
 * Padding matters because it is what keeps a list sorting correctly: INV-0010
 * after INV-0009, where INV-10 would sort before INV-9.
 */
export function nextInvoiceNumber(kind: InvoiceKind, existing: readonly Invoice[]): string {
  const numbered = existing
    .map((i) => splitInvoiceNumber(i.number))
    .filter((n): n is NumberedInvoice => n !== null);
  const prefix = invoicePrefix(kind);
  if (numbered.length === 0) return `${prefix}0001`;

  const highest = numbered.reduce((best, n) => (n.value > best.value ? n : best));
  const width = Math.max(...numbered.map((n) => n.digits.length));
  return prefix + String(highest.value + 1).padStart(width, "0");
}
