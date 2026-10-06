import type { Cents } from "./money.js";
import { formatAmount } from "./money.js";
import type { Invoice, InvoiceLine } from "./invoices.js";

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
  body { font: 13px/1.5 -apple-system, "Segoe UI", system-ui, sans-serif; color: #111;
    max-width: 46em; margin: 2.5em auto; padding: 0 1.5em; }
  h1 { font-size: 1.5em; margin: 0 0 0.2em; letter-spacing: 0.02em; }
  .head { display: flex; justify-content: space-between; gap: 2em;
    border-bottom: 2px solid #111; padding-bottom: 1.2em; margin-bottom: 1.5em; }
  .who strong { display: block; font-size: 1.1em; margin-bottom: 0.3em; }
  .meta { text-align: right; white-space: nowrap; }
  /* The block is right-aligned, so the label needs its own left alignment and
     a gap: without them "Number" sat flush against "INV-1042". */
  .meta .k { display: inline-block; min-width: 5em; margin-right: 0.8em;
    text-align: left; color: #555; }
  .to { margin-bottom: 1.8em; }
  .k-block { display: block; color: #555; font-size: 0.85em;
    text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 0.25em; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 1.5em; }
  th { text-align: left; font-size: 0.8em; text-transform: uppercase;
    letter-spacing: 0.06em; color: #555; border-bottom: 1px solid #999;
    padding: 0 0.5em 0.4em 0; }
  td { padding: 0.45em 0.5em 0.45em 0; border-bottom: 1px solid #e5e5e5;
    vertical-align: top; }
  th.n, td.n { text-align: right; padding-right: 0; white-space: nowrap; }
  tfoot td { border: 0; padding-top: 0.4em; }
  tfoot .due td { font-weight: 600; font-size: 1.15em; border-top: 2px solid #111;
    padding-top: 0.6em; }
  .pay { border-top: 1px solid #e5e5e5; padding-top: 1.2em; }
  .note { margin-top: 1.5em; font-size: 0.9em; color: #444; }
  .check { margin-top: 1.5em; font-size: 0.85em; color: #a33; }
  @media print { body { margin: 0; max-width: none; } }
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
