import type { Cents } from "./money.js";
import type { IsoDate } from "./dates.js";
import type { XeroEntry } from "./xero.js";

/**
 * A payment processor's payout, and why one bank line is three postings.
 *
 * A customer pays a 300.00 invoice through Stripe. Stripe keeps its fee, the
 * customer is charged a surcharge to cover it, and what reaches the bank is
 * one figure that equals none of those things:
 *
 *     Receivable Payment   300.00   settles the invoice
 *     Receive Money          8.70   the surcharge, which is a sale of its own
 *     Spend Money          -11.72   Stripe's fee, an expense
 *                         -------
 *                          296.98   what the bank shows
 *
 * Coded as it arrives, that 296.98 goes to sales, and three things go wrong at
 * once: sales is overstated, the invoice is never cleared so receivables carry
 * it for ever, and the processor's fee -- a real deductible expense -- is never
 * recorded at all. On one real ledger that was thirteen payouts, 11,912.73 of
 * sales that should have been receivables, and an entire Stripe Fees account
 * left empty against the 332.51 the accounting system had.
 *
 * It also explains why matching these by amount cannot work. The payout is the
 * invoice less a fee, so it never equals the invoice, and a search for an open
 * invoice of the same amount finds nothing however many payouts there are.
 *
 * The processor's charge id is what ties the three rows together. Every one of
 * them carries it, the accounting system puts it in the reference column, and
 * it is exact -- so the group is read rather than inferred.
 */

export interface PayoutPart {
  /** The account this part belongs to, as the export names it. */
  account: string;
  /** The invoice it settles, when the export names one. */
  invoice: string;
  /** Signed the same way as the payout: money in positive. */
  amount: Cents;
  /** What the accounting system called the row, e.g. `Receivable Payment`. */
  source: string;
  /**
   * The GST rate on the row, as the export gives it. Empty means none.
   *
   * Carried rather than assumed. A processor's fee is charged from offshore
   * and has no New Zealand GST on it; treating it as standard-rated strips
   * out 15% that was never there, which on one real ledger was the whole of
   * the difference -- 332.51 of fees reported as 289.14.
   */
  gstRate: string;
  /**
   * Whether the posting carried GST, from the accounts on its other side.
   *
   * The rate name sits on the ledger row and this reads bank rows, so the rate
   * itself is always blank here. What the bank row does carry is the list of
   * accounts the posting reached, and a GST control account among them is the
   * export saying the amount is tax-inclusive. Without this every payout part
   * was posted gross: a 8.70 surcharge reported as 8.70 of sales where the
   * accounting system had 7.57.
   */
  hasGst: boolean;
  description: string;
}

export interface Payout {
  /** The processor's charge id, which is what grouped these. */
  reference: string;
  /** The earliest date in the group; the bank usually shows a day or two later. */
  date: IsoDate;
  /** The bank account the payout landed in, as the export names it. */
  account: string;
  /** What reached the bank: the parts added up. */
  net: Cents;
  parts: PayoutPart[];
  /** Every invoice the group names, in the order they appear. */
  invoices: string[];
}

/** A processor's charge id: Stripe's `ch_`/`py_`, and anything similar. */
const CHARGE_ID = /^(ch|py|pi|po|txn)_[A-Za-z0-9]{6,}$/;

export interface PayoutOptions {
  /**
   * Whether a reference is a processor's charge id.
   *
   * Defaults to Stripe's shapes. Grouping on any shared reference would be
   * wrong: a customer's own reference repeats across unrelated payments, and
   * two payments joined on that would produce a payout that never happened.
   */
  isChargeId?: (reference: string) => boolean;
}

/**
 * Gather the rows of an Account Transactions export into payouts.
 *
 * Only groups of more than one row: a single row sharing nothing is an
 * ordinary payment, and calling it a payout of one part would put every
 * receipt through machinery built for a case it is not.
 */
export function payoutGroups(
  entries: readonly XeroEntry[],
  options: PayoutOptions = {},
): Payout[] {
  const isChargeId = options.isChargeId ?? ((r: string) => CHARGE_ID.test(r.trim()));

  const groups = new Map<string, XeroEntry[]>();
  for (const entry of entries) {
    const reference = entry.reference.trim();
    if (reference === "" || !isChargeId(reference)) continue;
    // Keyed by the bank account as well, because the same charge id could in
    // principle appear against two accounts and those are two payouts.
    const key = `${reference}\u0000${entry.account}`;
    const list = groups.get(key);
    if (list) list.push(entry);
    else groups.set(key, [entry]);
  }

  const payouts: Payout[] = [];
  for (const [key, rows] of groups) {
    if (rows.length < 2) continue;
    const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date) || a.line - b.line);
    const first = sorted[0];
    if (first === undefined) continue;

    const parts: PayoutPart[] = sorted.map((row) => ({
      account: row.relatedAccount,
      invoice: row.invoiceNumber.trim(),
      amount: row.amount,
      source: row.source,
      gstRate: row.gstRate,
      hasGst: row.relatedAccounts.some((a) => /\bgst\b/i.test(a)),
      description: row.description,
    }));

    const invoices: string[] = [];
    for (const part of parts) {
      if (part.invoice !== "" && !invoices.includes(part.invoice)) invoices.push(part.invoice);
    }

    payouts.push({
      reference: key.split("\u0000")[0] ?? "",
      date: first.date,
      account: first.account,
      net: parts.reduce((sum, p) => sum + p.amount, 0),
      parts,
      invoices,
    });
  }

  return payouts.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Which part of a payout settled an invoice.
 *
 * The row that clears the debtor is the one to tie to the invoice; the rest are
 * the surcharge and the fee. Recognised by the account it posts to rather than
 * by the source, because a chart names its receivables account whatever it
 * likes but always posts a payment there.
 */
export function settlingPart(payout: Payout, isReceivable: (account: string) => boolean): PayoutPart | undefined {
  return payout.parts.find((part) => isReceivable(part.account));
}
