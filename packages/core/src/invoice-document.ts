import type { Cents } from "./money.js";
import { formatAmount } from "./money.js";
import type { Invoice, InvoiceLine } from "./invoices.js";
import { cleanEmailAddress } from "./invoices.js";

/**
 * An invoice as a document you could actually send somebody.
 *
 * The app has been able to record an invoice and match it to the money since
 * invoices existed, and never able to produce the piece of paper the customer
 * needs. That is the half a person actually has to do, so it was the half done
 * somewhere else -- which meant the invoice in these books and the invoice the
 * customer received were two documents agreeing only by hand.
 *
 * HTML, deliberately. A `.docx` is a zip of XML and this package has no
 * dependencies and no zip writer; a PDF written by hand would be worse. An
 * HTML file opens in a browser, prints from there to PDF, opens in Word and in
 * Google Docs, and pastes into anything -- which is what "send it to the
 * customer" actually needs. One self-contained file, styles inside it and no
 * images, so nothing it needs can go missing in an email.
 */

export interface InvoiceSupplier {
  /** Trading or legal name, whichever the customer would recognise. */
  name: string;
  /** Free text, one line per line. */
  address?: string;
  /** Printed only when there is one: an unregistered supplier charges no GST. */
  gstNumber?: string;
  /** Bank account or other payment instruction, printed at the foot. */
  payTo?: string;
  /** An image data URI for the top left; see `cleanLogo`. */
  logo?: string;
}

/** The largest logo taken, in bytes of image. */
export const LOGO_MAX_BYTES = 1_000_000;

/**
 * A logo that is safe to put in a document, or null.
 *
 * Only raster image types, and only as base64 in a data URI of a size that
 * was chosen: the value is written into HTML, so anything else -- an SVG,
 * a script, a remote address -- is refused rather than escaped.
 */
export function cleanLogo(raw: string | undefined): string | null {
  const value = (raw ?? "").trim();
  const match = /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (match === null) return null;
  const encoded = match[2] ?? "";
  const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
  const bytes = Math.floor((encoded.length * 3) / 4) - padding;
  return bytes > 0 && bytes <= LOGO_MAX_BYTES ? value : null;
}

export interface InvoiceDocumentOptions {
  /**
   * What to call it.
   *
   * "Tax invoice" by default, which is what a New Zealand supplier issues and
   * what a customer's own bookkeeping looks for. A supplier who is not
   * registered charges no GST and should not call it one, so with no GST
   * number and no tax on the invoice it becomes plain "Invoice".
   */
  title?: string;
  /** Anything the sender wants at the foot: terms, a thank you, a reference. */
  note?: string;
  /**
   * Where there is no sales tax: no GST column, no subtotal and tax rows, and
   * the plain title. Left off, the document is a New Zealand tax invoice.
   */
  noTax?: boolean;
  /** How dates are written: day first (the default), month first, or year first. */
  dateStyle?: "dmy" | "mdy" | "ymd";
  /** The document's language tag, for readers and print dialogues; en-NZ by default. */
  lang?: string;
  /** What the supplier's tax number is called: "GST" by default, "ABN" in Australia. */
  taxIdLabel?: string;
  /**
   * Where there is no GST but the invoice charges sales tax on top (the
   * United States): what its total row says, "Sales tax (Seattle, WA 10.35%)".
   */
  salesTaxLabel?: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Free text as HTML, with the writer's own line breaks kept. */
function asLines(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map(escapeHtml)
    .join("<br>");
}

/** A date as the reader writes it: a New Zealander's day first unless said. */
function written(iso: string, style: "dmy" | "mdy" | "ymd" = "dmy"): string {
  const [year, month, day] = iso.split("-");
  if (!(year && month && day)) return iso;
  if (style === "mdy") return `${month}/${day}/${year}`;
  if (style === "ymd") return `${year}/${month}/${day}`;
  return `${day}/${month}/${year}`;
}

function lineRow(line: InvoiceLine, noTax = false): string {
  const quantity = line.quantity === undefined ? "" : String(line.quantity);
  return (
    "<tr>" +
    `<td>${escapeHtml(line.description)}</td>` +
    `<td class="n">${escapeHtml(quantity)}</td>` +
    `<td class="n">${formatAmount(line.net)}</td>` +
    (noTax ? "" : `<td class="n">${formatAmount(line.tax)}</td>`) +
    // Sales tax is added to the invoice, not to each line, where there is no GST.
    `<td class="n">${formatAmount(noTax ? line.net : line.gross)}</td>` +
    "</tr>"
  );
}

const STYLE = `
  :root { --accent: #1f4e79; --ink: #1b1f24; --muted: #5d6670; --line: #dde1e6; }
  * { box-sizing: border-box; }
  body { font: 13.5px/1.55 -apple-system, "Segoe UI", system-ui, sans-serif; color: var(--ink);
    max-width: 46em; margin: 2.5em auto; padding: 0 1.5em; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 2em;
    padding-bottom: 1.4em; margin-bottom: 1.6em; border-bottom: 3px solid var(--accent); }
  .logo { display: block; max-height: 4.5em; max-width: 14em; margin-bottom: 0.8em; }
  .who strong { display: block; font-size: 1.15em; margin-bottom: 0.25em; }
  .who { color: var(--muted); }
  .who strong { color: var(--ink); }
  .meta { text-align: right; white-space: nowrap; }
  h1 { font-size: 1.9em; margin: 0 0 0.5em; color: var(--accent); font-weight: 700;
    letter-spacing: 0.04em; text-transform: uppercase; line-height: 1.1; }
  /* The block is right-aligned, so the label needs its own left alignment and
     a gap: without them "Number" sat flush against "INV-1042". */
  .meta .k { display: inline-block; min-width: 5em; margin-right: 0.8em;
    text-align: left; color: var(--muted); }
  .to { margin-bottom: 1.8em; font-size: 1.05em; }
  .k-block { display: block; color: var(--accent); font-size: 0.75em; font-weight: 600;
    text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 0.3em; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 1.6em; }
  thead th { text-align: left; font-size: 0.75em; font-weight: 600; text-transform: uppercase;
    letter-spacing: 0.08em; color: var(--accent); background: #f1f5f9;
    border-bottom: 1px solid var(--accent); padding: 0.55em 0.6em; }
  td { padding: 0.6em; border-bottom: 1px solid var(--line); vertical-align: top; }
  th.n, td.n { text-align: right; white-space: nowrap; }
  tfoot td { border: 0; padding-top: 0.35em; padding-bottom: 0.35em; color: var(--muted); }
  tfoot .due td { font-weight: 700; font-size: 1.15em; color: var(--ink);
    border-top: 2px solid var(--accent); padding-top: 0.6em; }
  .pay { background: #f1f5f9; border-left: 4px solid var(--accent);
    padding: 0.9em 1.1em; margin-top: 0.5em; }
  .note { margin-top: 1.5em; font-size: 0.92em; color: var(--muted); }
  .check { margin-top: 1.5em; font-size: 0.85em; color: #a33; }
  @media print { body { margin: 0; max-width: none; }
    thead th, .pay { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
`;

/**
 * The invoice as one self-contained HTML file.
 *
 * Totals come from the invoice's own figures rather than being added up again
 * here. The lines and the stated total can disagree -- an imported invoice
 * says what the other system said -- and a document that quietly recomputed
 * would send the customer a different number from the one in the books, which
 * is the one thing it must never do. Where they differ, both are shown and the
 * sender is told to look.
 */
export function invoiceDocument(
  invoice: Invoice,
  supplier: InvoiceSupplier,
  options: InvoiceDocumentOptions = {},
): string {
  const noTax = options.noTax === true;
  const nzDate = (iso: string): string => written(iso, options.dateStyle);
  const gstNumber = noTax ? "" : (supplier.gstNumber ?? "").trim();
  const registered = gstNumber !== "";
  const title = options.title ?? (!noTax && (registered || invoice.tax !== 0) ? "Tax invoice" : "Invoice");
  // Columns before the total: description, quantity, amount, and GST where there is any.
  const span = noTax ? 3 : 4;
  const logo = cleanLogo(supplier.logo);

  const net = invoice.lines.reduce((sum: Cents, line) => sum + line.net, 0);
  const summed = invoice.lines.reduce((sum: Cents, line) => sum + line.gross, 0);
  const disagrees = invoice.lines.length > 0 && summed !== invoice.total;

  const detail = (label: string, value: string): string =>
    value === "" ? "" : `<div><span class="k">${label}</span>${value}</div>`;

  const totals = invoice.paid !== 0
    ? `<tr><td colspan="${span}" class="n">Total</td><td class="n">${formatAmount(invoice.total)}</td></tr>
      <tr><td colspan="${span}" class="n">Already paid</td><td class="n">${formatAmount(-invoice.paid)}</td></tr>
      <tr class="due"><td colspan="${span}" class="n">Amount due</td><td class="n">${formatAmount(invoice.outstanding)}</td></tr>`
    : `<tr class="due"><td colspan="${span}" class="n">Total due</td><td class="n">${formatAmount(invoice.total)}</td></tr>`;

  return `<!doctype html>
<html lang="${escapeHtml(options.lang ?? "en-NZ")}">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)} ${escapeHtml(invoice.number)}</title>
<style>${STYLE}</style>
</head>
<body>
  <div class="head">
    <div class="who">
      ${logo === null ? "" : `<img class="logo" src="${logo}" alt="">`}
      <strong>${escapeHtml(supplier.name)}</strong>
      ${supplier.address ? asLines(supplier.address) : ""}
      ${registered ? `<div>${escapeHtml(options.taxIdLabel ?? "GST")} ${escapeHtml(gstNumber)}</div>` : ""}
    </div>
    <div class="meta">
      <h1>${escapeHtml(title)}</h1>
      ${detail("Number", escapeHtml(invoice.number))}
      ${detail("Date", nzDate(invoice.issued))}
      ${invoice.due === null ? "" : detail("Due", nzDate(invoice.due))}
      ${detail("Reference", escapeHtml(invoice.reference))}
    </div>
  </div>

  <div class="to">
    <span class="k-block">Billed to</span>
    ${escapeHtml(invoice.contact)}
  </div>

  <table>
    <thead>
      <tr>
        <th>Description</th><th class="n">Qty</th>
        <th class="n">Amount</th>${noTax ? "" : '<th class="n">GST</th>'}
        <th class="n">Total ${escapeHtml(invoice.currency)}</th>
      </tr>
    </thead>
    <tbody>
      ${invoice.lines.map((line) => lineRow(line, noTax)).join("\n      ")}
    </tbody>
    <tfoot>
      ${
        noTax
          ? invoice.tax === 0
            ? ""
            : `<tr><td colspan="${span}" class="n">Subtotal</td><td class="n">${formatAmount(net)}</td></tr>
      <tr><td colspan="${span}" class="n">${escapeHtml(options.salesTaxLabel ?? "Sales tax")}</td><td class="n">${formatAmount(invoice.tax)}</td></tr>`
          : `<tr><td colspan="4" class="n">Subtotal</td><td class="n">${formatAmount(net)}</td></tr>
      <tr><td colspan="4" class="n">GST</td><td class="n">${formatAmount(invoice.tax)}</td></tr>`
      }
      ${totals}
    </tfoot>
  </table>

  ${supplier.payTo ? `<div class="pay"><span class="k-block">Payment</span>${asLines(supplier.payTo)}</div>` : ""}
  ${options.note ? `<div class="note">${asLines(options.note)}</div>` : ""}
  ${
    disagrees
      ? `<div class="check">The lines come to ${formatAmount(summed)} and the invoice total is recorded as ${formatAmount(invoice.total)}. Check this before sending.</div>`
      : ""
  }
</body>
</html>
`;
}

/**
 * The subject and message for emailing an invoice.
 *
 * Plain text, because it goes into a `mailto:` link: the person's own mail
 * program sends it, so the app makes no network request and holds no mail
 * credentials. A link cannot carry an attachment, so the message says the
 * invoice is attached and the app saves the file beside it. The amount is the
 * invoice's own outstanding figure, never one added up again here.
 */
export function invoiceEmail(
  invoice: Invoice,
  supplier: InvoiceSupplier,
  options: InvoiceDocumentOptions = {},
): { to: string; subject: string; body: string } {
  const registered = options.noTax !== true && (supplier.gstNumber ?? "").trim() !== "";
  const title = options.title ?? (registered || (options.noTax !== true && invoice.tax !== 0) ? "Tax invoice" : "Invoice");
  const number = invoice.number.trim();
  const owing = invoice.paid !== 0 ? invoice.outstanding : invoice.total;

  const lines = [
    "Hello,",
    "",
    `Please find ${title.toLowerCase()} ${number} attached.`.replace("  ", " "),
    "",
    `Amount due: ${formatAmount(owing)}`,
  ];
  if (invoice.due !== null) lines.push(`Due: ${written(invoice.due, options.dateStyle)}`);
  if (invoice.reference.trim() !== "") lines.push(`Reference: ${invoice.reference.trim()}`);
  const payTo = (supplier.payTo ?? "").trim();
  if (payTo !== "") lines.push("", `Payment details: ${payTo}`);
  if (options.note !== undefined && options.note.trim() !== "") lines.push("", options.note.trim());
  lines.push("", "Thank you,", supplier.name);

  return {
    to: cleanEmailAddress(invoice.email) ?? "",
    subject: `${title} ${number} from ${supplier.name}`.replace(/\s+/g, " "),
    body: lines.join("\r\n"),
  };
}

export interface StatementLine {
  number: string;
  issued: string;
  due: string | null;
  total: Cents;
  /** What is still owing on it. */
  owing: Cents;
  reference: string;
}

/**
 * A customer's statement: what they have not paid, as one document.
 *
 * Open invoices only, oldest first, aged by how long past due (or past the
 * invoice date, where no due date was given) as of the statement's date. The
 * figures are the books' own balances, passed in, not worked out again here.
 */
export function customerStatement(
  customer: string,
  lines: readonly StatementLine[],
  asAt: string,
  supplier: InvoiceSupplier,
  options: InvoiceDocumentOptions = {},
): string {
  const date = (iso: string): string => written(iso, options.dateStyle);
  const logo = cleanLogo(supplier.logo);
  const open = lines.filter((l) => l.owing !== 0).sort((a, b) => a.issued.localeCompare(b.issued));
  const days = (from: string, to: string): number =>
    Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
  const buckets = [0, 0, 0, 0, 0]; // current, 1-30, 31-60, 61-90, older
  const rows = open.map((l) => {
    const late = days(l.due ?? l.issued, asAt);
    const at = late <= 0 ? 0 : late <= 30 ? 1 : late <= 60 ? 2 : late <= 90 ? 3 : 4;
    buckets[at] = (buckets[at] ?? 0) + l.owing;
    return (
      "<tr>" +
      `<td>${escapeHtml(l.number)}</td>` +
      `<td>${date(l.issued)}</td>` +
      `<td>${l.due === null ? "" : date(l.due)}</td>` +
      `<td>${escapeHtml(l.reference)}</td>` +
      `<td class="n">${formatAmount(l.total)}</td>` +
      `<td class="n">${formatAmount(l.owing)}</td>` +
      "</tr>"
    );
  });
  const owing = open.reduce((sum, l) => sum + l.owing, 0);
  const aging = ["Current", "1–30 days", "31–60 days", "61–90 days", "Over 90 days"];
  return `<!doctype html>
<html lang="${escapeHtml(options.lang ?? "en-NZ")}">
<head>
<meta charset="utf-8">
<title>Statement ${escapeHtml(customer)}</title>
<style>${STYLE}</style>
</head>
<body>
  <div class="head">
    <div class="who">
      ${logo === null ? "" : `<img class="logo" src="${logo}" alt="">`}
      <strong>${escapeHtml(supplier.name)}</strong>
      ${supplier.address ? asLines(supplier.address) : ""}
    </div>
    <div class="meta">
      <h1>Statement</h1>
      <div><span class="k">As at</span>${date(asAt)}</div>
    </div>
  </div>
  <div class="to"><span class="k-block">For</span>${escapeHtml(customer)}</div>
  ${
    open.length === 0
      ? '<p class="note">Nothing is owing.</p>'
      : `<table>
    <thead><tr><th>Invoice</th><th>Date</th><th>Due</th><th>Reference</th><th class="n">Amount</th><th class="n">Owing</th></tr></thead>
    <tbody>${rows.join("\n")}</tbody>
    <tfoot><tr class="due"><td colspan="5" class="n">Total owing</td><td class="n">${formatAmount(owing)}</td></tr></tfoot>
  </table>
  <table>
    <thead><tr>${aging.map((a) => `<th class="n">${a}</th>`).join("")}</tr></thead>
    <tbody><tr>${buckets.map((b) => `<td class="n">${formatAmount(b)}</td>`).join("")}</tr></tbody>
  </table>`
  }
  ${supplier.payTo ? `<div class="pay"><span class="k-block">Payment</span>${asLines(supplier.payTo)}</div>` : ""}
  ${options.note ? `<div class="note">${asLines(options.note)}</div>` : ""}
</body>
</html>
`;
}

/** How firm a reminder is: a first reminder, a second notice, a final notice. */
export type ReminderStage = 1 | 2 | 3;

/** The stage that suits a debt this many days past due: a first reminder within 30 days, a second within 60, a final notice after. */
export function reminderStageFor(daysLate: number): ReminderStage {
  return daysLate <= 30 ? 1 : daysLate <= 60 ? 2 : 3;
}

const REMINDER: Record<ReminderStage, { title: string; words: (owing: string) => string }> = {
  1: {
    title: "Payment reminder",
    words: (owing) =>
      `Our records show the invoices below are past due, ${owing} in all. If you have already paid, thank you, ` +
      "and please disregard this letter. Otherwise we would be grateful for payment at your earliest convenience.",
  },
  2: {
    title: "Second notice",
    words: (owing) =>
      `The invoices below, ${owing} in all, remain unpaid after our earlier reminder. Please arrange payment ` +
      "within 7 days, or contact us if there is a problem with any of them so we can sort it out.",
  },
  3: {
    title: "Final notice",
    words: (owing) =>
      `Despite earlier reminders, ${owing} remains unpaid on the invoices below. Unless payment is received within ` +
      "7 days of the date of this letter, or you contact us to agree a way to pay it, we will have to consider " +
      "further steps to recover it.",
  },
};

/**
 * A letter asking a customer to pay what is past due: the overdue invoices
 * only, worded more firmly at each stage. Like the statement, a page to print
 * or save as PDF.
 */
export function collectionLetter(
  customer: string,
  lines: readonly StatementLine[],
  asAt: string,
  supplier: InvoiceSupplier,
  stage: ReminderStage,
  options: InvoiceDocumentOptions = {},
): string {
  const date = (iso: string): string => written(iso, options.dateStyle);
  const logo = cleanLogo(supplier.logo);
  const late = lines
    .filter((l) => l.owing > 0 && (l.due ?? l.issued) < asAt)
    .sort((a, b) => a.issued.localeCompare(b.issued));
  const owing = late.reduce((sum, l) => sum + l.owing, 0);
  const days = (from: string): number =>
    Math.round((Date.parse(`${asAt}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
  const said = REMINDER[stage];
  const rows = late.map(
    (l) =>
      "<tr>" +
      `<td>${escapeHtml(l.number)}</td>` +
      `<td>${date(l.issued)}</td>` +
      `<td>${l.due === null ? "" : date(l.due)}</td>` +
      `<td class="n">${days(l.due ?? l.issued)}</td>` +
      `<td class="n">${formatAmount(l.owing)}</td>` +
      "</tr>",
  );
  return `<!doctype html>
<html lang="${escapeHtml(options.lang ?? "en-NZ")}">
<head>
<meta charset="utf-8">
<title>${escapeHtml(said.title)} ${escapeHtml(customer)}</title>
<style>${STYLE}</style>
</head>
<body>
  <div class="head">
    <div class="who">
      ${logo === null ? "" : `<img class="logo" src="${logo}" alt="">`}
      <strong>${escapeHtml(supplier.name)}</strong>
      ${supplier.address ? asLines(supplier.address) : ""}
    </div>
    <div class="meta">
      <h1>${escapeHtml(said.title)}</h1>
      <div><span class="k">Date</span>${date(asAt)}</div>
    </div>
  </div>
  <div class="to"><span class="k-block">To</span>${escapeHtml(customer)}</div>
  <p>${escapeHtml(said.words(formatAmount(owing)))}</p>
  ${
    late.length === 0
      ? '<p class="note">Nothing is past due.</p>'
      : `<table>
    <thead><tr><th>Invoice</th><th>Date</th><th>Due</th><th class="n">Days late</th><th class="n">Owing</th></tr></thead>
    <tbody>${rows.join("\n")}</tbody>
    <tfoot><tr class="due"><td colspan="4" class="n">Past due</td><td class="n">${formatAmount(owing)}</td></tr></tfoot>
  </table>`
  }
  ${supplier.payTo ? `<div class="pay"><span class="k-block">Payment</span>${asLines(supplier.payTo)}</div>` : ""}
  ${options.note ? `<div class="note">${asLines(options.note)}</div>` : ""}
</body>
</html>
`;
}

/**
 * A late fee on what is past due: a percentage of it, never less than a
 * minimum, rounded to the cent. Nothing when nothing is past due.
 */
export function lateFee(pastDue: number, percent: number, minimum = 0): number {
  if (pastDue <= 0 || percent <= 0) return 0;
  return Math.max(Math.round((pastDue * percent) / 100), minimum);
}
