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

/** A date as a New Zealander writes it. */
function nzDate(iso: string): string {
  const [year, month, day] = iso.split("-");
  return year && month && day ? `${day}/${month}/${year}` : iso;
}

function lineRow(line: InvoiceLine): string {
  const quantity = line.quantity === undefined ? "" : String(line.quantity);
  return (
    "<tr>" +
    `<td>${escapeHtml(line.description)}</td>` +
    `<td class="n">${escapeHtml(quantity)}</td>` +
    `<td class="n">${formatAmount(line.net)}</td>` +
    `<td class="n">${formatAmount(line.tax)}</td>` +
    `<td class="n">${formatAmount(line.gross)}</td>` +
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
  const gstNumber = (supplier.gstNumber ?? "").trim();
  const registered = gstNumber !== "";
  const title = options.title ?? (registered || invoice.tax !== 0 ? "Tax invoice" : "Invoice");
  const logo = cleanLogo(supplier.logo);

  const net = invoice.lines.reduce((sum: Cents, line) => sum + line.net, 0);
  const summed = invoice.lines.reduce((sum: Cents, line) => sum + line.gross, 0);
  const disagrees = invoice.lines.length > 0 && summed !== invoice.total;

  const detail = (label: string, value: string): string =>
    value === "" ? "" : `<div><span class="k">${label}</span>${value}</div>`;

  const totals = invoice.paid !== 0
    ? `<tr><td colspan="4" class="n">Total</td><td class="n">${formatAmount(invoice.total)}</td></tr>
      <tr><td colspan="4" class="n">Already paid</td><td class="n">${formatAmount(-invoice.paid)}</td></tr>
      <tr class="due"><td colspan="4" class="n">Amount due</td><td class="n">${formatAmount(invoice.outstanding)}</td></tr>`
    : `<tr class="due"><td colspan="4" class="n">Total due</td><td class="n">${formatAmount(invoice.total)}</td></tr>`;

  return `<!doctype html>
<html lang="en-NZ">
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
      ${registered ? `<div>GST ${escapeHtml(gstNumber)}</div>` : ""}
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
        <th class="n">Amount</th><th class="n">GST</th>
        <th class="n">Total ${escapeHtml(invoice.currency)}</th>
      </tr>
    </thead>
    <tbody>
      ${invoice.lines.map(lineRow).join("\n      ")}
    </tbody>
    <tfoot>
      <tr><td colspan="4" class="n">Subtotal</td><td class="n">${formatAmount(net)}</td></tr>
      <tr><td colspan="4" class="n">GST</td><td class="n">${formatAmount(invoice.tax)}</td></tr>
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
  const registered = (supplier.gstNumber ?? "").trim() !== "";
  const title = options.title ?? (registered || invoice.tax !== 0 ? "Tax invoice" : "Invoice");
  const number = invoice.number.trim();
  const owing = invoice.paid !== 0 ? invoice.outstanding : invoice.total;

  const lines = [
    "Hello,",
    "",
    `Please find ${title.toLowerCase()} ${number} attached.`.replace("  ", " "),
    "",
    `Amount due: ${formatAmount(owing)}`,
  ];
  if (invoice.due !== null) lines.push(`Due: ${nzDate(invoice.due)}`);
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
