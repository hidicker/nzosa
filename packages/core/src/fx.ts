import type { Cents } from "./money.js";
import type { IsoDate } from "./dates.js";
import type { Transaction } from "./types.js";
import type { Invoice } from "./invoices.js";
import type { SplitPart } from "./splits.js";
import type { PostedJournal, PostedLine } from "./posting.js";

/**
 * Foreign currencies: invoices, bills and bank accounts in a currency other
 * than the books'.
 *
 * Each keeps its own amounts, in its own currency, and is turned into the
 * books' currency for the accounts at the rate on its date: a document at its
 * date, a bank line at its date. Where the money for a document arrives at
 * another rate, the difference is an exchange gain or loss, realised on the
 * payment's date. A bank account held in another currency is revalued at
 * each balance date to what its balance is worth at that day's rate; the
 * difference is an unrealised gain or loss.
 *
 * Books with nothing in another currency are not touched: the functions here
 * hand back what they were given.
 */

/** Rates for a currency: the books' currency for one unit of it, by date. */
export type FxRates = Readonly<Record<string, readonly { date: IsoDate; rate: number }[]>>;

export function isForeign(currency: string | undefined, books: string): boolean {
  const c = (currency ?? "").trim().toUpperCase();
  return c !== "" && c !== books.trim().toUpperCase();
}

/**
 * The rate for a currency on a day: the latest given on or before it, or --
 * before the first one given -- the first. Null when there are none; 1 for
 * the books' own currency.
 */
export function rateOn(rates: FxRates, currency: string, date: IsoDate, books: string): number | null {
  if (!isForeign(currency, books)) return 1;
  const list = rates[currency.trim().toUpperCase()] ?? [];
  if (list.length === 0) return null;
  let best: { date: IsoDate; rate: number } | undefined;
  let first: { date: IsoDate; rate: number } | undefined;
  for (const r of list) {
    if (!(r.rate > 0)) continue;
    if (first === undefined || r.date < first.date) first = r;
    if (r.date <= date && (best === undefined || r.date > best.date)) best = r;
  }
  return (best ?? first)?.rate ?? null;
}

/** An amount in a currency at a rate, in the books' currency, to the cent. */
export function convert(cents: Cents, rate: number): Cents {
  const value = cents * rate;
  return Math.sign(value) * Math.round(Math.abs(value));
}

/** The currencies a set of books uses besides its own, and the days each needs a rate for. */
export function foreignInUse(
  transactions: readonly Transaction[],
  invoices: readonly Invoice[],
  books: string,
): Map<string, { from: IsoDate; to: IsoDate; lines: number; documents: number }> {
  const out = new Map<string, { from: IsoDate; to: IsoDate; lines: number; documents: number }>();
  const note = (currency: string, date: IsoDate, line: boolean): void => {
    const c = currency.trim().toUpperCase();
    const held = out.get(c) ?? { from: date, to: date, lines: 0, documents: 0 };
    if (date < held.from) held.from = date;
    if (date > held.to) held.to = date;
    if (line) held.lines += 1;
    else held.documents += 1;
    out.set(c, held);
  };
  for (const t of transactions) if (isForeign(t.currency, books)) note(t.currency, t.date, true);
  for (const i of invoices) if (isForeign(i.currency, books)) note(i.currency, i.issued, false);
  return out;
}

/** The currencies that have no rate at all. */
export function missingRates(inUse: ReadonlyMap<string, unknown>, rates: FxRates): string[] {
  return [...inUse.keys()].filter((c) => !(rates[c] ?? []).some((r) => r.rate > 0)).sort();
}

/**
 * Bank lines in the books' currency, for the accounts. A line in another
 * currency is converted at its date's rate and keeps what it was in its
 * extras; a currency with no rate is left as it is (and said elsewhere).
 * With nothing foreign, the very same list comes back.
 */
export function accountingTransactions(
  transactions: readonly Transaction[],
  books: string,
  rates: FxRates,
): readonly Transaction[] {
  if (!transactions.some((t) => isForeign(t.currency, books))) return transactions;
  return transactions.map((t) => {
    if (!isForeign(t.currency, books)) return t;
    const rate = rateOn(rates, t.currency, t.date, books);
    if (rate === null) return t;
    return {
      ...t,
      amount: convert(t.amount, rate),
      currency: books,
      extras: { ...(t.extras ?? {}), fxCurrency: t.currency, fxAmount: String(t.amount), fxRate: String(rate) },
    };
  });
}

/** Split parts in the books' currency, for lines that were converted: the same rate, to the line's total. */
export function accountingSplits(
  splits: Readonly<Record<string, readonly SplitPart[]>>,
  transactions: readonly Transaction[],
  books: string,
  rates: FxRates,
): Readonly<Record<string, readonly SplitPart[]>> {
  const foreign = transactions.filter((t) => isForeign(t.currency, books) && splits[t.id] !== undefined);
  if (foreign.length === 0) return splits;
  const out: Record<string, readonly SplitPart[]> = { ...splits };
  for (const t of foreign) {
    const rate = rateOn(rates, t.currency, t.date, books);
    const parts = splits[t.id];
    if (rate === null || parts === undefined) continue;
    const total = convert(t.amount, rate);
    let given = 0;
    out[t.id] = parts.map((part, i) => {
      const amount = i === parts.length - 1 ? total - given : convert(part.amount, rate);
      given += amount;
      return { ...part, amount };
    });
  }
  return out;
}

/** A document in the books' currency, at its date's rate: what the accounts book when it is raised. */
export function accountingInvoice(invoice: Invoice, books: string, rates: FxRates): Invoice {
  if (!isForeign(invoice.currency, books)) return invoice;
  const rate = rateOn(rates, invoice.currency, invoice.issued, books);
  if (rate === null) return invoice;
  const at = (cents: Cents): Cents => convert(cents, rate);
  return {
    ...invoice,
    currency: books,
    total: at(invoice.total),
    tax: at(invoice.tax),
    paid: at(invoice.paid),
    outstanding: at(invoice.outstanding),
    ...(invoice.broughtForward !== undefined ? { broughtForward: at(invoice.broughtForward) } : {}),
    lines: invoice.lines.map((l) => {
      const gross = at(l.gross);
      const tax = at(l.tax);
      return { ...l, gross, tax, net: gross - tax };
    }),
    // Paid outside the bank lines, at the rate on the day it was paid.
    ...(invoice.paidOutside !== undefined
      ? {
          paidOutside: invoice.paidOutside.map((p) => ({
            ...p,
            amount: convert(p.amount, rateOn(rates, invoice.currency, p.date, books) ?? rate),
          })),
        }
      : {}),
  };
}

/** One payment of a document, as the exchange difference reads it. */
export interface DocumentPayment {
  invoice: Invoice;
  date: IsoDate;
  /** What arrived or left, unsigned, in `currency`. */
  amount: Cents;
  currency: string;
  /** Names the journal: the bank line, or the outside payment. */
  id: string;
}

/**
 * The exchange difference on each payment of a document in another currency:
 * what the payment settled was booked at the document's rate, and arrived at
 * the payment's. The difference clears the receivable or payable, and goes to
 * the exchange account -- a debit is a loss, a credit a gain.
 */
export function realisedFxJournals(
  payments: readonly DocumentPayment[],
  books: string,
  rates: FxRates,
  options: {
    controlFor: (invoice: Invoice) => { code: string; name: string };
    account: { code: string; name: string };
  },
): PostedJournal[] {
  const out: PostedJournal[] = [];
  for (const p of payments) {
    const invoice = p.invoice;
    if (!isForeign(invoice.currency, books)) continue;
    const issueRate = rateOn(rates, invoice.currency, invoice.issued, books);
    const payRate = rateOn(rates, p.currency, p.date, books);
    const docRateThen = rateOn(rates, invoice.currency, p.date, books);
    if (issueRate === null || payRate === null || docRateThen === null || docRateThen === 0) continue;
    const paid = convert(p.amount, payRate);
    // How much of the document it settled, in the document's currency.
    const settled = isForeign(p.currency, invoice.currency) ? paid / docRateThen : p.amount;
    const booked = convert(Math.round(settled), issueRate);
    const residual = booked - paid;
    if (residual === 0) continue;
    const sales = invoice.kind === "sales";
    const control = options.controlFor(invoice);
    const lines: PostedLine[] = [
      { accountCode: control.code, accountName: control.name, amount: sales ? -residual : residual, taxType: "NONE", description: `Exchange difference, ${invoice.number}` },
      { accountCode: options.account.code, accountName: options.account.name, amount: sales ? residual : -residual, taxType: "NONE", description: `${invoice.number} ${invoice.contact}`.trim() },
    ];
    out.push({
      transactionId: `fx:${invoice.number}:${p.id}`,
      date: p.date,
      narration: `Exchange difference on ${invoice.number} ${invoice.contact}`.trim(),
      lines,
      source: "fx",
      taxBasis: "both",
    });
  }
  return out;
}

/**
 * A bank account held in another currency, revalued at each date given (the
 * balance dates): its balance in its own currency at that day's rate, less
 * what the accounts already hold for it. Cumulative, so each date's journal
 * is the change since the last.
 */
export function revaluationJournals(
  transactions: readonly Transaction[],
  books: string,
  rates: FxRates,
  dates: readonly IsoDate[],
  options: {
    nameOf: (account: string) => string;
    account: { code: string; name: string };
  },
): PostedJournal[] {
  const byAccount = new Map<string, Transaction[]>();
  for (const t of transactions) {
    if (!isForeign(t.currency, books)) continue;
    byAccount.set(t.account, [...(byAccount.get(t.account) ?? []), t]);
  }
  const out: PostedJournal[] = [];
  for (const [account, lines] of byAccount) {
    const currency = lines[0]!.currency.trim().toUpperCase();
    // An account whose lines are in more than one currency is not one balance.
    if (lines.some((t) => t.currency.trim().toUpperCase() !== currency)) continue;
    let revalued = 0;
    for (const date of [...dates].sort()) {
      const held = lines.filter((t) => t.date <= date);
      if (held.length === 0) continue;
      const closing = rateOn(rates, currency, date, books);
      if (closing === null) continue;
      const foreign = held.reduce((s, t) => s + t.amount, 0);
      let booked = revalued;
      for (const t of held) booked += convert(t.amount, rateOn(rates, currency, t.date, books) ?? closing);
      const change = convert(foreign, closing) - booked;
      if (change === 0) continue;
      revalued += change;
      out.push({
        transactionId: `fxreval:${account}:${date}`,
        date,
        narration: `${currency} balance revalued at ${closing}`,
        lines: [
          { accountCode: account, accountName: options.nameOf(account), amount: change, taxType: "NONE", description: `Revalued at ${closing}` },
          { accountCode: options.account.code, accountName: options.account.name, amount: -change, taxType: "NONE", description: `${currency} ${options.nameOf(account)}` },
        ],
        source: "fx",
        taxBasis: "both",
        adjusting: true,
      });
    }
  }
  return out;
}
