import { accountingInvoice, accountingSplits, accountingTransactions, convert, formatAmount, isForeign, rateOn } from "@nzosa/core";
import type { FxRates, Invoice, SplitPart, Transaction } from "@nzosa/core";
import { booksCurrency, booksMoney } from "./country.js";
import { state } from "./state.js";

/**
 * The books in their own currency, for the accounts: bank lines, splits and
 * documents in another currency turned into it at their dates' rates (see
 * core fx.ts). What is shown as the bank shows it -- Reconcile, statements,
 * balances -- keeps reading the lines as they are.
 *
 * Kept against what they were made from, so a render does not convert the
 * year's lines over again; and for books with nothing in another currency
 * the very same lists come back, untouched.
 */

const EMPTY: FxRates = {};

export function fxRates(): FxRates {
  return state.ledger.fxRates ?? EMPTY;
}

let txCache: { from: readonly Transaction[]; rates: FxRates; books: string; out: readonly Transaction[] } | null = null;
let splitCache: {
  from: Readonly<Record<string, readonly SplitPart[]>>;
  transactions: readonly Transaction[];
  rates: FxRates;
  out: Readonly<Record<string, readonly SplitPart[]>>;
} | null = null;

/** The bank lines in the books' currency. */
export function accountingLines(): readonly Transaction[] {
  const from = state.ledger.transactions;
  const rates = fxRates();
  const books = booksCurrency();
  if (txCache !== null && txCache.from === from && txCache.rates === rates && txCache.books === books) return txCache.out;
  const out = accountingTransactions(from, books, rates);
  txCache = { from, rates, books, out };
  return out;
}

/** The splits, their parts in the books' currency where the line was not. */
export function accountingSplitParts(): Readonly<Record<string, readonly SplitPart[]>> {
  const from = state.ledger.splits ?? {};
  const transactions = state.ledger.transactions;
  const rates = fxRates();
  if (splitCache !== null && splitCache.from === from && splitCache.transactions === transactions && splitCache.rates === rates) return splitCache.out;
  const out = accountingSplits(from, transactions, booksCurrency(), rates);
  splitCache = { from, transactions, rates, out };
  return out;
}

/** A document in the books' currency, as the accounts book it. */
export function accountingDocument(invoice: Invoice): Invoice {
  return accountingInvoice(invoice, booksCurrency(), fxRates());
}

/** Whether anything in the books is in another currency. */
export function anyForeign(): boolean {
  const books = booksCurrency();
  return accountingLines() !== state.ledger.transactions || (state.ledger.invoices ?? []).some((i) => isForeign(i.currency, books));
}

/**
 * A payment in a document's currency, where the two differ: what the money
 * that arrived was worth in the document's currency on the day. Undefined
 * for books with nothing in another currency, so their balances are worked
 * out exactly as before.
 */
export function paymentInDocumentCurrency(): ((amount: number, transaction: Transaction, invoice: Invoice) => number) | undefined {
  const books = booksCurrency();
  if (!(state.ledger.invoices ?? []).some((i) => isForeign(i.currency, books))) return undefined;
  const rates = fxRates();
  return (amount, transaction, invoice) => {
    const from = (transaction.currency || books).toUpperCase();
    const to = (invoice.currency || books).toUpperCase();
    if (from === to) return amount;
    const inBooks = convert(amount, rateOn(rates, from, transaction.date, books) ?? 1);
    const docRate = rateOn(rates, to, transaction.date, books);
    return docRate === null || docRate === 0 ? amount : Math.round(inBooks / docRate);
  };
}

/** The chart's exchange accounts: realised (on payments and conversions) and unrealised (revaluation). */
export function exchangeAccounts(): { realised: { code: string; name: string }; unrealised: { code: string; name: string } } | null {
  const find = (pattern: RegExp): { code: string; name: string } | undefined => {
    const a = state.chart.find((x) => pattern.test(x.name) && x.code.trim() !== "");
    return a === undefined ? undefined : { code: a.code.trim(), name: a.name };
  };
  const realised = find(/\brealised currency|realized currency|exchange (gains|loss)/i) ?? find(/currency gains/i);
  const unrealised = find(/unrealised currency|unrealized currency|bank revaluation/i) ?? realised;
  if (realised === undefined || unrealised === undefined) return null;
  return { realised, unrealised };
}

/** A document's amount as it is written: its own currency named where that is not the books'. */
export function documentMoney(invoice: Pick<Invoice, "currency">, cents: number): string {
  const books = booksCurrency();
  return isForeign(invoice.currency, books) ? `${invoice.currency.toUpperCase()} ${formatAmount(cents)}` : booksMoney(cents);
}
