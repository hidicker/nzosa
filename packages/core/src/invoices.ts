import type { Cents } from "./money.js";
import { formatAmount, parseAmount } from "./money.js";
import type { IsoDate } from "./dates.js";
import { parseDate } from "./dates.js";
import { findHeaderRow, normaliseHeader, parseCsvRecords } from "./csv.js";
import type { ReadonlyCsvRecord } from "./csv.js";
import { ColumnReader } from "./importers/shared.js";

/**
 * Invoices, and the lines they are made of.
 *
 * A bank statement shows what arrived; an invoice says what it was for. On a
 * payments basis the return is still driven by the money, but the invoice is
 * what turns a receipt into a coded, GST-treated line without guessing.
 *
 * Two shapes recur and neither is an error:
 *
 *  * one invoice, several lines -- goods plus shipping, arriving as a single
 *    payment;
 *  * one invoice, several payments -- a deposit and two instalments, arriving
 *    as separate receipts, each of which is income when it lands.
 *
 * So invoices are held separately from transactions and linked to them, rather
 * than being converted into them. Nothing here changes what the bank reported.
 */

export interface InvoiceLine {
  description: string;
  /** Account code the line is posted to, e.g. `200`. */
  accountCode: string;
  /** Tax treatment as the source names it, e.g. `15% GST on Income`. */
  taxType: string;
  /** Amount excluding GST. */
  net: Cents;
  /** GST on this line. */
  tax: Cents;
  /** `net` plus `tax`: what the customer actually pays for this line. */
  gross: Cents;
  quantity?: number;
  itemCode?: string;
  /**
   * The liability account this line's tax is owed in, where it is not the
   * GST account: United States sales tax, owed to the authority of the rate
   * the invoice was charged at.
   */
  taxAccount?: string;
}

export type InvoiceKind = "sales" | "purchase";

export interface Invoice {
  /** Invoice number, e.g. `INV-0121`. Unique within a kind. */
  number: string;
  kind: InvoiceKind;
  contact: string;
  reference: string;
  issued: IsoDate;
  /** Null when the source gives no due date. */
  due: IsoDate | null;
  /** GST-inclusive total, as stated by the source. */
  total: Cents;
  /** Total GST, as stated by the source. */
  tax: Cents;
  /** How much has been paid, as stated by the source. */
  paid: Cents;
  /** How much is still outstanding, as stated by the source. */
  outstanding: Cents;
  currency: string;
  status: string;
  lines: InvoiceLine[];
  /** The United States sales tax rate the invoice was charged at, by its id. */
  salesTaxRateId?: string;
  /**
   * The entity whose document this is, when the books keep several.
   *
   * Said on the document rather than worked out from its lines, because a
   * bill decides whose payables it sits in: a plumber's bill for the shop is
   * the shop's debt, whichever account its lines happen to be coded to.
   */
  entityId?: string;
  /**
   * Payments made other than through a bank line in these books.
   *
   * A bill paid by a card whose statements are not loaded, or by a
   * shareholder from their own pocket. Each clears the balance against the
   * account the money really came from, so nothing is left owing that was
   * paid -- and nothing is paid twice, since a bank line matched to the
   * same bill would clear it again.
   */
  paidOutside?: OutsidePayment[];
  /**
   * Owing on the day before the books start, for one dated earlier and still
   * open then: what the other system's aged receivables or payables said.
   * Its balance runs from this, not from its total -- whatever was paid
   * before the books began is not in them.
   */
  broughtForward?: Cents;
  /**
   * An expense claim: owed to a person who paid it themselves, held in
   * Unpaid Expense Claims rather than Accounts Payable.
   */
  claim?: boolean;
  /**
   * Where to send it: the customer's email address, kept on the invoice so
   * the "email" button can address the message. Never needed by the books --
   * nothing is posted or matched from it.
   */
  email?: string;
  /**
   * A link to the document this one came from -- the bill as a PDF in the
   * owner's Google Drive or Dropbox, say. Only the link is kept: the books
   * hold no files, and the file stays in the owner's own storage.
   */
  documentLink?: string;
  /**
   * A sales invoice's message, printed at its foot: how to pay, a thank-you.
   * The words themselves, not which saved message they came from, so changing
   * a saved message later never changes an invoice already sent.
   */
  note?: string;
}

/** A link worth keeping: an http(s) address with no spaces, else null. */
export function cleanDocumentLink(raw: string | undefined): string | null {
  const value = (raw ?? "").trim();
  if (value === "" || value.length > 2000 || /\s/.test(value)) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * The address last used for a contact, by name.
 *
 * Names are compared without case or spacing, because the same customer is
 * typed "Kea Cafe" on one invoice and "kea cafe " on the next. The newest
 * sales invoice that has an address wins, so a customer who changes address
 * is followed by the next invoice rather than held to the first one.
 */
export function emailForContact(invoices: readonly Invoice[], contact: string): string | null {
  const wanted = contact.trim().toLowerCase().replace(/\s+/g, " ");
  if (wanted === "") return null;
  let best: Invoice | undefined;
  for (const invoice of invoices) {
    if (invoice.kind !== "sales" || cleanEmailAddress(invoice.email) === null) continue;
    if (invoice.contact.trim().toLowerCase().replace(/\s+/g, " ") !== wanted) continue;
    if (best === undefined || invoice.issued >= best.issued) best = invoice;
  }
  return best === undefined ? null : cleanEmailAddress(best.email);
}

/** An address a mail program could be given, or null when it is not one. */
export function cleanEmailAddress(raw: string | undefined): string | null {
  const value = (raw ?? "").trim();
  return /^[^\s@,;:<>()"]+@[^\s@,;:<>()"]+\.[^\s@,;:<>()"]+$/.test(value) ? value : null;
}

/** A payment of an invoice or a bill that no bank line in these books shows. */
export interface OutsidePayment {
  date: IsoDate;
  /** Always positive; the direction is the document's. */
  amount: Cents;
  /** Where the money came from, or went to: a chart code or its label. */
  accountCode: string;
  note?: string;
  /**
   * Not paid but written off as a bad debt, to `accountCode`. Nothing was
   * received, so on the payments basis no GST falls due on it; on the invoice
   * basis the GST already returned comes back as a credit adjustment.
   */
  writeOff?: boolean;
}

/** What has been paid on a document other than through a bank line. */
export function paidOutsideTotal(invoice: Invoice): Cents {
  return (invoice.paidOutside ?? []).reduce((sum, p) => sum + Math.abs(p.amount), 0);
}

export interface InvoiceProblem {
  number: string;
  message: string;
}

export interface InvoiceImportResult {
  invoices: Invoice[];
  problems: InvoiceProblem[];
}

/** Columns a Xero sales-invoice export must have for this to be one. */
const REQUIRED = ["InvoiceNumber", "InvoiceDate", "Total", "LineAmount", "AccountCode"];

/**
 * Read Xero's sales-invoice export.
 *
 * The file carries one row per invoice *line*, repeating the invoice-level
 * fields on every row, so rows are grouped by invoice number. `LineAmount` is
 * stated excluding GST with `TaxAmount` beside it, while `Total` includes GST --
 * mixing those up silently understates every invoice by 13%, so the gross is
 * computed explicitly rather than assumed.
 */
export function parseXeroInvoices(text: string): InvoiceImportResult {
  const records = parseCsvRecords(text);
  const header = findHeaderRow(records, REQUIRED);

  if (!header) {
    return {
      invoices: [],
      problems: [{ number: "", message: "Not a Xero invoice export: required columns missing." }],
    };
  }

  const reader = new ColumnReader(header.columns);
  const byNumber = new Map<string, Invoice>();
  const problems: InvoiceProblem[] = [];

  for (let i = header.index + 1; i < records.length; i += 1) {
    const record = records[i];
    if (!record) continue;

    const cells = reader.at(record.fields);
    const number = cells.get("InvoiceNumber");
    const contact = cells.get("ContactName");
    // A row is a line of the document its number, contact, date and type
    // name together. Xero does not keep bill numbers unique -- a supplier's
    // "RPT445-1" is on every monthly bill -- and leaves some blank, so the
    // number alone merged a year of electricity into one bill and dropped
    // the ones with none.
    const group = JSON.stringify([cells.get("Type"), number, contact, cells.get("InvoiceDate")]);
    if (number === "" && contact === "") continue;

    const net = parseAmount(cells.get("LineAmount"));
    const tax = parseAmount(cells.get("TaxAmount")) ?? 0;

    if (net === null) {
      problems.push({
        number,
        message: `line ${record.line}: unreadable LineAmount ${JSON.stringify(cells.get("LineAmount"))}`,
      });
      continue;
    }

    let invoice = byNumber.get(group);
    if (!invoice) {
      const issued = parseDate(cells.get("InvoiceDate"));
      const email = cleanEmailAddress(cells.get("EmailAddress"));
      if (issued === null) {
        problems.push({ number, message: `unreadable InvoiceDate ${JSON.stringify(cells.get("InvoiceDate"))}` });
        continue;
      }

      invoice = {
        number,
        kind: cells.get("Type").toLowerCase().includes("bill") ? "purchase" : "sales",
        contact,
        reference: cells.get("Reference"),
        issued,
        due: parseDate(cells.get("DueDate")),
        total: parseAmount(cells.get("Total")) ?? 0,
        tax: parseAmount(cells.get("TaxTotal")) ?? 0,
        paid: parseAmount(cells.get("InvoiceAmountPaid")) ?? 0,
        outstanding: parseAmount(cells.get("InvoiceAmountDue")) ?? 0,
        currency: cells.get("Currency") || "NZD",
        status: cells.get("Status"),
        lines: [],
        ...(email !== null ? { email } : {}),
      };
      byNumber.set(group, invoice);
    }

    const quantity = Number(cells.get("Quantity"));
    const itemCode = cells.get("InventoryItemCode");

    invoice.lines.push({
      description: cells.get("Description"),
      accountCode: cells.get("AccountCode"),
      taxType: cells.get("TaxType"),
      net,
      tax,
      gross: net + tax,
      ...(Number.isFinite(quantity) ? { quantity } : {}),
      ...(itemCode !== "" ? { itemCode } : {}),
    });
  }

  // Unique within a kind, as everything that matches a payment to its
  // document needs: a number shared by several documents, or missing, gets
  // the date beside it -- "RPT445-1/2026-09-17".
  const invoices = [...byNumber.values()];
  const uses = new Map<string, number>();
  for (const invoice of invoices) {
    const key = `${invoice.kind}:${invoice.number}`;
    uses.set(key, (uses.get(key) ?? 0) + 1);
  }
  for (const invoice of invoices) {
    if (invoice.number === "") invoice.number = `${invoice.contact}/${invoice.issued}`;
    else if ((uses.get(`${invoice.kind}:${invoice.number}`) ?? 0) > 1) {
      invoice.number = `${invoice.number}/${invoice.issued}`;
    }
  }
  problems.push(...validateInvoices(invoices));
  return { invoices, problems };
}

/**
 * Check each invoice against itself.
 *
 * The lines must add up to the stated total and the line tax to the stated tax
 * total. An invoice that does not foot is not usable for coding a payment, and
 * reporting it is better than quietly using a wrong figure.
 */
export function validateInvoices(invoices: readonly Invoice[]): InvoiceProblem[] {
  const problems: InvoiceProblem[] = [];
  const seen = new Set<string>();

  for (const invoice of invoices) {
    if (seen.has(`${invoice.kind}:${invoice.number}`)) {
      problems.push({ number: invoice.number, message: "duplicate invoice number" });
    }
    seen.add(`${invoice.kind}:${invoice.number}`);

    if (invoice.lines.length === 0) {
      problems.push({ number: invoice.number, message: "no lines" });
      continue;
    }

    const gross = invoice.lines.reduce((sum, line) => sum + line.gross, 0);
    if (gross !== invoice.total) {
      problems.push({
        number: invoice.number,
        message:
          `lines total ${formatAmount(gross, invoice.currency)} but the invoice says ` +
          `${formatAmount(invoice.total, invoice.currency)} ` +
          `(out by ${formatAmount(gross - invoice.total, invoice.currency)})`,
      });
    }

    const tax = invoice.lines.reduce((sum, line) => sum + line.tax, 0);
    if (tax !== invoice.tax) {
      problems.push({
        number: invoice.number,
        message:
          `line GST totals ${formatAmount(tax, invoice.currency)} but the invoice says ` +
          `${formatAmount(invoice.tax, invoice.currency)}`,
      });
    }
  }

  return problems;
}

/** GST-inclusive total of an invoice's lines. */
export function invoiceGross(invoice: Invoice): Cents {
  return invoice.lines.reduce((sum, line) => sum + line.gross, 0);
}

/**
 * Split a payment across an invoice's lines, in proportion to their gross.
 *
 * A part-payment is not earmarked against particular lines, so the only
 * defensible allocation is proportional. The last line absorbs the rounding so
 * the parts still sum to the payment exactly -- the property everything else
 * depends on.
 */
export function allocateAcrossLines(
  invoice: Invoice,
  payment: Cents,
): { line: InvoiceLine; amount: Cents }[] {
  const total = invoiceGross(invoice);
  if (total === 0 || invoice.lines.length === 0) return [];

  const parts = invoice.lines.map((line) => ({
    line,
    amount: Math.round((payment * line.gross) / total),
  }));

  const drift = payment - parts.reduce((sum, part) => sum + part.amount, 0);
  const last = parts[parts.length - 1];
  if (last && drift !== 0) last.amount += drift;

  return parts;
}

/**
 * A payment applied to an invoice, as the accounting system recorded it.
 *
 * This is the authoritative link between an invoice and the money that settled
 * it. Inferring it instead -- by looking for receipts that add up to the
 * invoice total -- finds coincidences: once there are enough small receipts to
 * choose from, almost any total can be reached several ways, and a chance
 * combination is indistinguishable from a real one.
 */
export interface PaymentAllocation {
  invoiceNumber: string;
  /** The date the payment was applied. */
  date: IsoDate;
  /** Positive when money was received against a sales invoice. */
  amount: Cents;
  contact: string;
}

export interface AllocationImportResult {
  allocations: PaymentAllocation[];
  problems: InvoiceProblem[];
}

const ALLOCATION_REQUIRED = ["Date", "Source", "Reference", "Debit", "Credit"];

/**
 * Payment allocations from an ungrouped Account Transactions export.
 *
 * Each payment is two rows: the receivable it clears, and the bank line that
 * cleared it. The bank line is the one carrying the invoice number, and is the
 * debit side of a sales receipt -- which is also how it is told from the
 * receivable without having to recognise a bank account by name.
 *
 * Payments taken through Stripe name the charge rather than the invoice, and
 * the invoice number sits on a sibling row bearing the same charge id. So the
 * charges are read first and used to resolve those.
 */
function allocationsFromUngrouped(
  records: readonly ReadonlyCsvRecord[],
  headerIndex: number,
  reader: ColumnReader,
): AllocationImportResult {
  const allocations: PaymentAllocation[] = [];
  const problems: InvoiceProblem[] = [];

  const invoiceOfCharge = new Map<string, string>();
  for (let i = headerIndex + 1; i < records.length; i += 1) {
    const record = records[i];
    if (!record) continue;
    const cells = reader.at(record.fields);
    const reference = cells.get("Reference");
    const number = cells.get("Invoice Number");
    if (number !== "" && /^ch_/i.test(reference)) invoiceOfCharge.set(reference, number);
  }

  for (let i = headerIndex + 1; i < records.length; i += 1) {
    const record = records[i];
    if (!record) continue;
    const cells = reader.at(record.fields);
    if (cells.get("Source") !== "Receivable Payment") continue;

    // The bank side: a debit, and no chart code, because every ledger account
    // in this export has one and the bank accounts do not.
    if (cells.get("Account Code") !== "") continue;
    const amount = parseAmount(cells.get("Debit"));
    if (amount === null || amount === 0) continue;

    const reference = cells.get("Reference");
    const number = cells.get("Invoice Number") || invoiceOfCharge.get(reference) || reference;
    if (number === "" || /^ch_/i.test(number)) {
      problems.push({
        number: reference,
        message: `line ${record.line}: a payment whose invoice could not be identified`,
      });
      continue;
    }

    const date = parseDate(cells.get("Date"));
    if (date === null) {
      problems.push({ number, message: `line ${record.line}: unreadable date on a payment` });
      continue;
    }

    allocations.push({ invoiceNumber: number, date, amount, contact: cells.get("Contact") });
  }

  return { allocations, problems };
}

/**
 * Read payment allocations from an Account Transactions export.
 *
 * The report is grouped into sections, one per account, written as a row with
 * only the first cell filled. Payments appear twice -- once against the
 * receivable and once against the bank -- and only the receivable side carries
 * the invoice number, so that is the side read here.
 */
export function parseXeroAllocations(text: string): AllocationImportResult {
  const records = parseCsvRecords(text);
  const header = findHeaderRow(records, ALLOCATION_REQUIRED);

  if (!header) {
    return {
      allocations: [],
      problems: [{ number: "", message: "Not an Account Transactions export: required columns missing." }],
    };
  }

  const reader = new ColumnReader(header.columns);
  const allocations: PaymentAllocation[] = [];
  const problems: InvoiceProblem[] = [];
  let section = "";

  // The same report comes out in two shapes, and the ungrouped one is what
  // Xero gives by default. Grouped by account, each account is a section
  // heading and only the receivable side of a payment names the invoice.
  // Ungrouped, there are no headings -- an Account column carries it instead,
  // and it is the *bank* side that names the invoice. Told apart by the column
  // rather than by asking, because the person exporting it should not have to
  // know which they picked.
  if (header.columns.has(normaliseHeader("Account"))) {
    return allocationsFromUngrouped(records, header.index, reader);
  }

  for (let i = header.index + 1; i < records.length; i += 1) {
    const record = records[i];
    if (!record) continue;

    // A section header is a row with only its first cell filled.
    const first = record.fields[0]?.trim() ?? "";
    const filled = record.fields.filter((field) => field.trim() !== "");
    if (filled.length === 1 && first !== "") {
      section = first;
      continue;
    }

    const cells = reader.at(record.fields);
    if (!/accounts receivable/i.test(section)) continue;
    if (cells.get("Source") !== "Receivable Payment") continue;

    const reference = cells.get("Reference");
    if (reference === "") continue;

    const date = parseDate(cells.get("Date"));
    // A payment credits the receivable, so the credit column holds the amount.
    const amount = parseAmount(cells.get("Credit"));

    if (date === null || amount === null || amount === 0) {
      problems.push({
        number: reference,
        message: `line ${record.line}: unreadable date or amount on a payment allocation`,
      });
      continue;
    }

    allocations.push({ invoiceNumber: reference, date, amount, contact: cells.get("Contact") });
  }

  return { allocations, problems };
}

/**
 * What an invoice still has owing, from the receipts assigned to it.
 *
 * The imported `paid` and `outstanding` are what the system it came from
 * believed on the day it was exported. They are recorded and shown, but they
 * are not what this app counts: a figure nobody here can explain is not a
 * figure to bill a customer from. What is counted is the bank lines actually
 * assigned to the invoice, which is a claim that can be pointed at.
 *
 * The two disagreeing is information rather than a fault. An invoice the file
 * calls settled with no receipt behind it means the receipt has not been found
 * yet -- and a list of those is a day's work, not a bug.
 */
/**
 * Where an invoice stands.
 *
 * `credit note` is its own answer rather than a kind of payment. A credit note
 * is billed in the opposite direction, so measuring it the way an invoice is
 * measured made every one of them read as overpaid the moment it arrived,
 * before any money had moved at all.
 */
export type InvoiceStatus =
  | "unpaid"
  | "part paid"
  | "paid"
  | "overpaid"
  | "credit note";

export interface InvoiceBalance {
  invoice: Invoice;
  /** Total of the bank lines assigned to it, always positive. */
  assigned: Cents;
  /** `total` less `assigned`. Negative when more arrived than was billed. */
  remaining: Cents;
  /** Paid other than through a bank line in these books, always positive. */
  paidOutside: Cents;
  status: InvoiceStatus;
  /**
   * Credit notes applied against this invoice, as a positive amount.
   *
   * Part of what settles an invoice, beside the money: a sale reversed by a
   * credit note is not still owing, and an invoice showing it as outstanding
   * for ever is a debtors figure that cannot be collected.
   */
  credited: Cents;
  /**
   * What the imported file said was still owing, when it said anything.
   *
   * Kept beside our own figure rather than replacing it, so the difference can
   * be shown instead of one of them quietly winning.
   */
  fileRemaining: Cents | null;
}

/** One bank line assigned to one invoice. */
export interface InvoiceAssignment {
  invoiceNumber: string;
  /** Signed as the bank had it; the direction is taken from the invoice kind. */
  amount: Cents;
}

/** A document billed in the opposite direction to the invoices around it. */
export function isCreditNote(invoice: Invoice): boolean {
  return invoice.total < 0;
}

/**
 * Statuses under which an invoice is not in the books.
 *
 * Xero posts an invoice when it is approved, and not before: a draft, or one
 * submitted and waiting for approval, has touched no account. A voided or
 * deleted one has been taken back out. Posting any of them records a sale or a
 * bill the other system never recorded -- on real books a draft for 25.00 was
 * the whole difference in Sales between the two.
 */
const NOT_POSTED = new Set(["draft", "submitted", "awaiting approval", "voided", "deleted", "estimate", "purchase order"]);

/** Whether a document is an estimate (a quote): offered to a customer, not yet an invoice. */
export function isEstimate(invoice: Invoice): boolean {
  return invoice.status.trim().toLowerCase() === "estimate";
}

/**
 * A new document copied from an old one: the same customer or supplier,
 * lines, reference and terms, under a new number and dated today, with the
 * due date as far after it as the original's was.
 *
 * What belonged to the old one alone is left behind: what was paid on it, a
 * balance brought forward, and the link to its own file. A bill comes out a
 * draft, to be approved like any other; an estimate stays an estimate.
 */
export function duplicateInvoice(source: Invoice, number: string, today: IsoDate): Invoice {
  const { paidOutside: _paid, broughtForward: _brought, documentLink: _link, ...kept } = source;
  const gap = source.due === null ? null : Math.round((Date.parse(`${source.due}T00:00:00Z`) - Date.parse(`${source.issued}T00:00:00Z`)) / 86_400_000);
  const due = gap === null ? null : new Date(Date.parse(`${today}T00:00:00Z`) + gap * 86_400_000).toISOString().slice(0, 10);
  return {
    ...kept,
    number,
    issued: today,
    due,
    paid: 0,
    outstanding: source.total,
    status: isEstimate(source) ? source.status : source.kind === "purchase" ? "Draft" : "Awaiting Payment",
    lines: source.lines.map((line) => ({ ...line })),
  };
}

/**
 * Whether an invoice belongs in the ledger.
 *
 * A blank status counts as posted. An invoice keyed in here, or a file that
 * carries no status column, has no workflow to be part-way through, and leaving
 * it out would drop a sale that happened.
 */
export function isPosted(invoice: Invoice): boolean {
  return !NOT_POSTED.has(invoice.status.trim().toLowerCase());
}

export function invoiceBalances(
  invoices: readonly Invoice[],
  assignments: Iterable<InvoiceAssignment>,
  /** True for an invoice imported from elsewhere, whose `paid` means something. */
  imported: (invoice: Invoice) => boolean = (invoice) => invoice.paid !== 0 || invoice.outstanding !== 0,
  /**
   * Credit note number to the invoice it credits.
   *
   * Nominated by a person, because the accounting system's export does not
   * carry the link: the reference is free text, and on real books it says
   * things like "write off bad debt as per the accountant" rather than an
   * invoice number. Guessing from the contact and the amount would settle the
   * wrong invoice quietly, which is worse than leaving it unapplied.
   */
  credits: Readonly<Record<string, string>> = {},
): Map<string, InvoiceBalance> {
  const assigned = new Map<string, Cents>();
  for (const item of assignments) {
    // A receipt is positive and a bill payment negative; an invoice is owed in
    // one direction only, so the magnitude is what reduces it.
    assigned.set(item.invoiceNumber, (assigned.get(item.invoiceNumber) ?? 0) + Math.abs(item.amount));
  }

  // What each invoice has been credited, from the credit notes pointed at it.
  const byNumber = new Map(invoices.map((invoice) => [invoice.number, invoice]));
  const credited = new Map<string, Cents>();
  for (const [note, target] of Object.entries(credits)) {
    const source = byNumber.get(note);
    if (source === undefined || target === "") continue;
    credited.set(target, (credited.get(target) ?? 0) + Math.abs(source.total));
  }

  const out = new Map<string, InvoiceBalance>();
  for (const invoice of invoices) {
    const paid = assigned.get(invoice.number) ?? 0;
    const off = credited.get(invoice.number) ?? 0;
    const outside = paidOutsideTotal(invoice);
    // A credit note is measured as itself. Subtracting what it is "owed"
    // reported every one of them as overpaid before any money had moved.
    const from = invoice.broughtForward ?? invoice.total;
    const remaining = isCreditNote(invoice)
      ? from + paid + outside
      : from - paid - off - outside;
    const status: InvoiceStatus = isCreditNote(invoice)
      ? "credit note"
      : remaining < 0
        ? "overpaid"
        : remaining === 0
          ? "paid"
          : paid === 0 && off === 0 && outside === 0
            ? "unpaid"
            : "part paid";
    out.set(invoice.number, {
      invoice,
      assigned: paid,
      remaining,
      paidOutside: outside,
      credited: off,
      status,
      fileRemaining: imported(invoice) ? invoice.outstanding : null,
    });
  }
  return out;
}

/**
 * The lines of a document that carry an amount but no account. Such a line
 * is owed in receivables or payables but counts in no income or expense, so
 * the profit and loss leaves it out.
 */
export function linesWithoutAccount(invoice: Pick<Invoice, "lines">): InvoiceLine[] {
  return invoice.lines.filter((line) => line.gross !== 0 && line.accountCode.trim() === "");
}
