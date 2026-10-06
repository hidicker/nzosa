import type { Cents } from "./money.js";

/**
 * The GST account on the balance sheet, reconciled to the returns and to
 * Inland Revenue.
 *
 * A bookkeeper's GST reconciliation ties three things together at each
 * period end: the GST control account's balance in the books, what the
 * returns say should be owed (every return to date, less what has been paid),
 * and what Inland Revenue's own account says is owing. They agree when the
 * books posted GST the way the returns counted it and every payment and
 * refund went to the GST account. When they do not, the difference is the
 * thing to find: a payment coded elsewhere, a return not yet assessed, a
 * penalty, or GST posted that no return included.
 *
 * Amounts owed to Inland Revenue are positive here, refunds due negative:
 * "owing" in the words a person uses, whichever side of the ledger it sits.
 */

export interface GstReturnForPeriod {
  periodEnd: string;
  /** Box 15 as the books work it out: positive to pay, negative a refund. */
  box15: Cents;
}

export interface GstAccountRow {
  periodEnd: string;
  /** Every return's box 15 up to and including this one, from the books. */
  returnsToDate: Cents;
  /** GST paid to Inland Revenue to this date, less refunds received. */
  paidToDate: Cents;
  /** What should be owing: opening, plus the returns, less what was paid. */
  shouldOwe: Cents;
  /** What the GST account in the books says is owing at the period end. */
  booksOwe: Cents;
  /** The books' account less what should be owing: zero when they agree. */
  booksDifference: Cents;
  /** What Inland Revenue's account says is owing at the period end, where loaded. */
  irOwe: Cents | null;
  /** Inland Revenue's figure less the books' account. */
  irDifference: Cents | null;
}

export interface GstAccountOptions {
  /** The books' returns, one per period, in order. */
  returns: readonly GstReturnForPeriod[];
  /** Every amount posted to the GST control account(s), debit positive. */
  postings: readonly { date: string; amount: Cents }[];
  /** Payments to Inland Revenue for GST, positive; refunds received negative. */
  payments: readonly { date: string; amount: Cents }[];
  /** The control account's opening balance at the start of the books, debit positive. */
  opening?: Cents;
  /** The day the books start: returns before it are not counted. */
  booksStart?: string;
  /**
   * Inland Revenue's GST account transactions, signed as myIR exports them:
   * assessments positive, payments negative, refunds paid out positive.
   */
  ird?: readonly { date: string; amount: Cents }[];
}

export function gstAccountReconciliation(options: GstAccountOptions): GstAccountRow[] {
  const opening = options.opening ?? 0;
  const start = options.booksStart ?? "";
  let returnsToDate = 0;
  const rows: GstAccountRow[] = [];
  for (const one of [...options.returns].sort((a, b) => a.periodEnd.localeCompare(b.periodEnd))) {
    if (one.periodEnd < start) continue;
    const end = one.periodEnd;
    returnsToDate += one.box15;
    const paidToDate = options.payments.filter((p) => p.date <= end).reduce((s, p) => s + p.amount, 0);
    // Owed to Inland Revenue is a credit on the account, so the books' figure
    // is the balance turned round.
    const booksOwe = -(opening + options.postings.filter((p) => p.date <= end).reduce((s, p) => s + p.amount, 0));
    const shouldOwe = -opening + returnsToDate - paidToDate;
    const irOwe =
      options.ird === undefined || options.ird.length === 0
        ? null
        : options.ird.filter((r) => r.date <= end).reduce((s, r) => s + r.amount, 0);
    rows.push({
      periodEnd: end,
      returnsToDate: returnsToDate as Cents,
      paidToDate: paidToDate as Cents,
      shouldOwe: shouldOwe as Cents,
      booksOwe: booksOwe as Cents,
      booksDifference: (booksOwe - shouldOwe) as Cents,
      irOwe: irOwe as Cents | null,
      irDifference: irOwe === null ? null : ((irOwe - booksOwe) as Cents),
    });
  }
  return rows;
}
