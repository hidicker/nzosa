import type { Cents } from "./money.js";
import { daysBetween } from "./dates.js";
import type { IsoDate } from "./dates.js";
import { gstContent } from "./gst.js";
import type { OtherPurchase } from "./gst.js";
import { isCreditNote, isPosted } from "./invoices.js";
import type { Invoice, InvoiceBalance, InvoiceKind } from "./invoices.js";
import { taxTypeFromRate } from "./posting.js";
import type { PostedJournal, PostedLine } from "./posting.js";

/**
 * Bills: what is owed to suppliers, and when it falls due.
 *
 * A bill is an invoice somebody else raised, held the way Xero holds one. It
 * is a draft until it is approved, and approving it is what puts it in the
 * books: the cost and the GST on the bill date, the whole amount owing in
 * Accounts Payable. Paying it moves that balance to the bank and touches the
 * cost not at all.
 *
 * The document model is the invoice's own -- the posting, the matching and
 * the credit notes are shared -- and what lives here is what is particular to
 * owing rather than being owed: where each one stands, how old the debts are,
 * and a payment that no bank line in these books shows.
 */

/** Where a bill (or an invoice) stands, in the words Xero uses for it. */
export type DocumentStatus =
  | "Draft"
  | "Voided"
  | "Awaiting payment"
  | "Part paid"
  | "Overdue"
  | "Paid"
  | "Credit note";

/**
 * A document's status on a day.
 *
 * Draft and voided come from the document, because they are decisions; the
 * rest come from the money, because they are facts. Overdue is a fact of the
 * day asked about, so it is worked out rather than stored.
 */
export function documentStatus(balance: InvoiceBalance, today: IsoDate): DocumentStatus {
  const said = balance.invoice.status.trim().toLowerCase();
  if (said === "voided" || said === "deleted") return "Voided";
  if (!isPosted(balance.invoice)) return "Draft";
  if (isCreditNote(balance.invoice)) return "Credit note";
  if (balance.remaining <= 0) return "Paid";
  const due = balance.invoice.due;
  if (due !== null && due < today) return "Overdue";
  return balance.remaining < balance.invoice.total ? "Part paid" : "Awaiting payment";
}

/** One payment against a document, dated, for balances on a past day. */
export interface DatedPayment {
  invoiceNumber: string;
  date: IsoDate;
  /** Signed as the bank had it; only the size is used. */
  amount: Cents;
}

export type AgeBucket = "current" | "1-30" | "31-60" | "61-90" | "older";

export const AGE_BUCKETS: readonly { bucket: AgeBucket; label: string }[] = [
  { bucket: "current", label: "Current" },
  { bucket: "1-30", label: "1 to 30 days" },
  { bucket: "31-60", label: "31 to 60 days" },
  { bucket: "61-90", label: "61 to 90 days" },
  { bucket: "older", label: "Older" },
];

export interface AgedItem {
  invoice: Invoice;
  /** Owing on the day asked about. Negative for an unapplied credit note. */
  owing: Cents;
  /** Days past the due date (the bill date when there is none); 0 or less is not due. */
  daysOverdue: number;
  bucket: AgeBucket;
}

export interface AgedContact {
  contact: string;
  buckets: Record<AgeBucket, Cents>;
  total: Cents;
  items: AgedItem[];
}

export interface AgedReport {
  asAt: IsoDate;
  kind: InvoiceKind;
  contacts: AgedContact[];
  totals: Record<AgeBucket, Cents>;
  total: Cents;
}

function bucketFor(days: number): AgeBucket {
  if (days <= 0) return "current";
  if (days <= 30) return "1-30";
  if (days <= 60) return "31-60";
  if (days <= 90) return "61-90";
  return "older";
}

function emptyBuckets(): Record<AgeBucket, Cents> {
  return { current: 0, "1-30": 0, "31-60": 0, "61-90": 0, older: 0 };
}

/**
 * Aged payables, or aged receivables: what was owing on a day, by how late.
 *
 * Worked from the documents and the dated payments rather than from today's
 * balances, so the report for 31 March says what was owed on 31 March -- a
 * bill paid on 3 April was still owing then, and has to be, or the report
 * cannot agree with the balance sheet for the same day.
 *
 * Aged by due date, as Xero does by default: a bill with 20th-of-the-month
 * terms is not late on the 5th. A document with no due date is aged from its
 * own date. Only documents in the books count -- a draft owes nothing -- and
 * a credit note nobody has applied is shown as the credit it is, reducing
 * what the supplier is owed.
 */
export function agedReport(options: {
  invoices: readonly Invoice[];
  kind: InvoiceKind;
  payments: readonly DatedPayment[];
  /** Credit note number to the document it credits. */
  credits?: Readonly<Record<string, string>>;
  asAt: IsoDate;
  /** Only documents this says yes to, e.g. one entity's. */
  include?: (invoice: Invoice) => boolean;
}): AgedReport {
  const { kind, asAt } = options;
  const credits = options.credits ?? {};
  const docs = options.invoices.filter(
    (i) =>
      i.kind === kind &&
      isPosted(i) &&
      i.issued <= asAt &&
      (options.include === undefined || options.include(i)),
  );
  const byNumber = new Map(docs.map((d) => [d.number, d]));

  const paid = new Map<string, Cents>();
  for (const p of options.payments) {
    if (p.date > asAt) continue;
    paid.set(p.invoiceNumber, (paid.get(p.invoiceNumber) ?? 0) + Math.abs(p.amount));
  }
  for (const doc of docs) {
    const outside = (doc.paidOutside ?? [])
      .filter((p) => p.date <= asAt)
      .reduce((sum, p) => sum + Math.abs(p.amount), 0);
    if (outside !== 0) paid.set(doc.number, (paid.get(doc.number) ?? 0) + outside);
  }

  // A credit note applies from its own date, and only to a document that was
  // in the books on the day asked about.
  const credited = new Map<string, Cents>();
  const applied = new Set<string>();
  for (const [note, target] of Object.entries(credits)) {
    const source = byNumber.get(note);
    if (source === undefined || target === "" || !byNumber.has(target)) continue;
    applied.add(note);
    credited.set(target, (credited.get(target) ?? 0) + Math.abs(source.total));
  }

  const contacts = new Map<string, AgedContact>();
  for (const doc of docs) {
    let owing: Cents;
    if (isCreditNote(doc)) {
      if (applied.has(doc.number)) continue;
      owing = (doc.broughtForward ?? doc.total) + (paid.get(doc.number) ?? 0);
    } else {
      owing = (doc.broughtForward ?? doc.total) - (paid.get(doc.number) ?? 0) - (credited.get(doc.number) ?? 0);
    }
    if (owing === 0) continue;
    const daysOverdue = daysBetween(doc.due ?? doc.issued, asAt);
    const bucket = bucketFor(daysOverdue);
    const name = doc.contact.trim() || "(no contact)";
    const key = name.toLowerCase();
    let row = contacts.get(key);
    if (row === undefined) {
      row = { contact: name, buckets: emptyBuckets(), total: 0, items: [] };
      contacts.set(key, row);
    }
    row.buckets[bucket] += owing;
    row.total += owing;
    row.items.push({ invoice: doc, owing, daysOverdue, bucket });
  }

  const rows = [...contacts.values()].sort((a, b) => a.contact.localeCompare(b.contact));
  for (const row of rows) row.items.sort((a, b) => a.invoice.issued.localeCompare(b.invoice.issued));
  const totals = emptyBuckets();
  for (const row of rows) {
    for (const { bucket } of AGE_BUCKETS) totals[bucket] += row.buckets[bucket];
  }
  return {
    asAt,
    kind,
    contacts: rows,
    totals,
    total: rows.reduce((sum, r) => sum + r.total, 0),
  };
}

/**
 * The GST in part of a document's total, in proportion.
 *
 * A bill of rates (no GST) and repairs (15%) paid in part has paid part of
 * each; the claim follows the document's own mix rather than 3/23 of the
 * whole, which would claim tax on the rates.
 */
function shareOf(part: Cents, whole: Cents, of: Cents): Cents {
  if (whole === 0) return 0;
  return Math.round((of * part) / whole);
}

/** The GST-bearing part of a document: the lines that carry tax. */
function taxableGross(invoice: Invoice): Cents {
  return invoice.lines.filter((l) => l.tax !== 0).reduce((sum, l) => sum + l.gross, 0);
}

/**
 * Purchases paid other than through a bank line, in a period, for Box 11.
 *
 * The GST return is worked from the bank lines, and a bill paid by a
 * shareholder or on an unloaded card has none: on the payments basis its GST
 * would never be claimed at all. Each such payment is claimed when it was
 * made, in proportion to the tax the bill carries.
 */
export function outsidePurchases(
  invoices: readonly Invoice[],
  period: { from: IsoDate; to: IsoDate },
  include: (invoice: Invoice) => boolean = () => true,
): OtherPurchase[] {
  const out: OtherPurchase[] = [];
  for (const bill of invoices) {
    if (bill.kind !== "purchase" || !isPosted(bill) || !include(bill)) continue;
    if (bill.tax === 0 || bill.total === 0) continue;
    for (const payment of bill.paidOutside ?? []) {
      if (payment.date < period.from || payment.date > period.to) continue;
      const amount = Math.abs(payment.amount);
      out.push({
        gross: shareOf(amount, bill.total, taxableGross(bill)),
        gst: shareOf(amount, bill.total, bill.tax),
        date: payment.date,
        label: `${bill.number} ${bill.contact}`.trim(),
      });
    }
  }
  return out;
}

/**
 * The journals for a document's payments made outside the bank lines.
 *
 * A bill paid by a shareholder:
 *
 *     Dr  800 Accounts Payable             115.00   INPUT2
 *     Cr  881 Shareholder current account  115.00   NONE
 *
 * The tag and base ride on the payables line, exactly as they do when a bank
 * line settles a bill, so a payments-basis return finds the tax where it fell
 * due. The cost is not touched: it was booked when the bill was approved.
 */
export function outsidePaymentJournals(
  invoice: Invoice,
  options: {
    /** The receivable or payable the document sits in. */
    control: { code: string; name: string };
    resolveAccount?: (code: string) => { code: string; name: string };
  },
): PostedJournal[] {
  if (!isPosted(invoice)) return [];
  const resolve = options.resolveAccount ?? ((code: string) => ({ code, name: code }));
  const purchase = invoice.kind === "purchase";
  const taxType = taxTypeFromRate(invoice.lines[0]?.taxType ?? "", invoice.kind);
  return (invoice.paidOutside ?? []).map((payment, index) => {
    const amount = Math.abs(payment.amount);
    // Signed as a bank line would be: money out of the business is negative.
    const moved = purchase ? -amount : amount;
    const from = resolve(payment.accountCode);
    const lines: PostedLine[] = [
      {
        accountCode: options.control.code,
        accountName: options.control.name,
        amount: -moved,
        taxType,
        taxBase: moved,
        description: `Settles ${invoice.number}`,
      },
      {
        accountCode: from.code,
        accountName: from.name,
        amount: moved,
        taxType: "NONE",
        description: payment.note ?? `${invoice.number} ${invoice.contact}`.trim(),
      },
    ];
    return {
      transactionId: `${invoice.number}:paid:${index + 1}`,
      date: payment.date,
      narration: `${invoice.number} ${invoice.contact} paid${payment.note ? `: ${payment.note}` : ""}`,
      lines,
      source: purchase ? "bill" : "invoice",
      taxBasis: "payments",
    };
  });
}

export interface BillWarning {
  field: "lines" | "tax" | "due" | "duplicate" | "total";
  message: string;
}

/**
 * What looks wrong with a bill before it is approved.
 *
 * Warnings, not refusals: a bill is what the supplier sent, and a supplier's
 * rounding is theirs to get wrong. But each of these is the kind of thing an
 * accountant checks first, and cheaper to see now than after the return.
 */
export function billWarnings(bill: Invoice, others: readonly Invoice[]): BillWarning[] {
  const out: BillWarning[] = [];
  if (bill.lines.length === 0 || bill.total === 0) {
    out.push({ field: "total", message: "The bill has no amount." });
  }
  const sum = bill.lines.reduce((s, l) => s + l.gross, 0);
  if (sum !== bill.total) {
    out.push({
      field: "lines",
      message: `The lines add to ${(sum / 100).toFixed(2)} but the total is ${(bill.total / 100).toFixed(2)}.`,
    });
  }
  for (const line of bill.lines) {
    if (!/15%/.test(line.taxType) || line.gross === 0) continue;
    const expected = gstContent(line.gross);
    if (Math.abs(line.tax - expected) > 1) {
      out.push({
        field: "tax",
        message:
          `"${line.description || "A line"}" has GST of ${(line.tax / 100).toFixed(2)}; ` +
          `3/23 of ${(line.gross / 100).toFixed(2)} is ${(expected / 100).toFixed(2)}.`,
      });
    }
  }
  if (bill.due !== null && bill.due < bill.issued) {
    out.push({ field: "due", message: "The due date is before the bill date." });
  }
  const reference = bill.reference.trim().toLowerCase();
  const contact = bill.contact.trim().toLowerCase();
  if (reference !== "" && contact !== "") {
    const twin = others.find(
      (o) =>
        o !== bill &&
        o.number !== bill.number &&
        o.kind === bill.kind &&
        o.status.trim().toLowerCase() !== "voided" &&
        o.contact.trim().toLowerCase() === contact &&
        o.reference.trim().toLowerCase() === reference,
    );
    if (twin !== undefined) {
      out.push({
        field: "duplicate",
        message: `${twin.number} is already ${bill.contact}'s ${bill.reference}: this may be the same bill twice.`,
      });
    }
  }
  return out;
}
