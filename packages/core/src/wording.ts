import type { Cents } from "./money.js";
import { formatAmount } from "./money.js";
import type { Invoice } from "./invoices.js";
import { cleanEmailAddress } from "./invoices.js";
import { written } from "./document-html.js";

/**
 * The words the books send: a message printed at the foot of an invoice, and
 * the email that goes with an invoice, a statement or a reminder.
 *
 * Each email is a template with fill-ins in braces -- {customer}, {number},
 * {amount}, {due}, {sender} -- so a person writes it once in their own voice
 * and every message after says it that way. A fill-in a template does not use
 * is simply not said; one it uses that has no value here is left out, with
 * the line it sat on if nothing else was on it, so a message never goes with
 * an empty "Due: ".
 */

/** A message kept to print on invoices: how to pay, a thank-you. */
export interface InvoiceMessage {
  id: string;
  /** What it is called in the list: "Bank transfer". */
  name: string;
  text: string;
  /** Put on every new invoice unless another is chosen. */
  isDefault?: boolean;
}

export type WordingKind = "invoice" | "statement" | "reminder";

export const DEFAULT_WORDING: Readonly<Record<WordingKind, { subject: string; body: string }>> = {
  invoice: {
    subject: "{document} {number} from {sender}",
    body: [
      "Hello,",
      "",
      "Please find {document} {number} attached.",
      "",
      "Amount due: {amount}",
      "Due: {due}",
      "Reference: {reference}",
      "",
      "Payment details: {payment}",
      "",
      "{note}",
      "",
      "Thank you,",
      "{sender}",
    ].join("\n"),
  },
  statement: {
    subject: "Statement from {sender}",
    body: [
      "Hello,",
      "",
      "Please find your statement attached. {amount} is owing as at {date}.",
      "",
      "Payment details: {payment}",
      "",
      "Thank you,",
      "{sender}",
    ].join("\n"),
  },
  reminder: {
    subject: "Payment reminder from {sender}",
    body: [
      "Hello,",
      "",
      "Our records show {amount} is past due. The details are attached. If you have already paid, thank you, and please disregard this message.",
      "",
      "Payment details: {payment}",
      "",
      "Thank you,",
      "{sender}",
    ].join("\n"),
  },
};

/** The fill-ins each kind of email can use, for saying so beside the box. */
export const WORDING_FILL_INS: Readonly<Record<WordingKind, readonly string[]>> = {
  invoice: ["customer", "document", "number", "amount", "due", "reference", "payment", "note", "sender"],
  statement: ["customer", "amount", "date", "payment", "sender"],
  reminder: ["customer", "amount", "date", "payment", "sender"],
};

/**
 * A template with its fill-ins put in. A line whose only fill-ins have no
 * value is dropped; a run of blank lines that leaves behind is closed up.
 */
export function fillWording(template: string, values: Readonly<Record<string, string>>): string {
  const lines = template.replace(/\r\n/g, "\n").split("\n");
  const kept: string[] = [];
  for (const line of lines) {
    const names = [...line.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? "");
    const known = names.filter((n) => n in values);
    if (known.length > 0 && known.every((n) => (values[n] ?? "").trim() === "")) continue;
    kept.push(line.replace(/\{(\w+)\}/g, (whole, name: string) => (name in values ? (values[name] ?? "").trim() : whole)));
  }
  const closed: string[] = [];
  for (const line of kept) {
    if (line.trim() === "" && (closed.length === 0 || closed[closed.length - 1]?.trim() === "")) continue;
    closed.push(line);
  }
  while (closed.length > 0 && closed[closed.length - 1]?.trim() === "") closed.pop();
  return closed.join("\r\n");
}

/** The message a new invoice starts with: the default one, if there is. */
export function defaultInvoiceMessage(messages: readonly InvoiceMessage[]): InvoiceMessage | undefined {
  return messages.find((m) => m.isDefault === true);
}

interface Sender {
  name: string;
  payTo?: string;
}

/** An invoice's email from the person's own wording, or the standard one. */
export function invoiceEmailFrom(
  invoice: Invoice,
  sender: Sender,
  options: { title: string; wording?: { subject: string; body: string }; dateStyle?: "dmy" | "mdy" | "ymd"; note?: string },
): { to: string; subject: string; body: string } {
  const wording = options.wording ?? DEFAULT_WORDING.invoice;
  const owing = invoice.paid !== 0 ? invoice.outstanding : invoice.total;
  const values = {
    customer: invoice.contact,
    document: options.title.toLowerCase(),
    number: invoice.number.trim(),
    amount: formatAmount(owing),
    due: invoice.due === null ? "" : written(invoice.due, options.dateStyle),
    reference: invoice.reference,
    payment: sender.payTo ?? "",
    note: options.note ?? "",
    sender: sender.name,
  };
  const subject = fillWording(wording.subject, values).replace(/\s+/g, " ").trim();
  return {
    to: cleanEmailAddress(invoice.email) ?? "",
    // The subject's first word capitalised, whatever the template did with {document}.
    subject: subject.charAt(0).toUpperCase() + subject.slice(1),
    body: fillWording(wording.body, values),
  };
}

/** A statement's or a reminder's email. */
export function accountEmailFrom(
  kind: "statement" | "reminder",
  customer: string,
  owing: Cents,
  asAt: string,
  sender: Sender,
  options: { to?: string; wording?: { subject: string; body: string }; dateStyle?: "dmy" | "mdy" | "ymd" } = {},
): { to: string; subject: string; body: string } {
  const wording = options.wording ?? DEFAULT_WORDING[kind];
  const values = {
    customer,
    amount: formatAmount(owing),
    date: written(asAt, options.dateStyle),
    payment: sender.payTo ?? "",
    sender: sender.name,
  };
  return {
    to: cleanEmailAddress(options.to) ?? "",
    subject: fillWording(wording.subject, values).replace(/\s+/g, " ").trim(),
    body: fillWording(wording.body, values),
  };
}

/** A `mailto:` address for a message: the person's own mail program sends it. */
export function mailtoLink(message: { to: string; subject: string; body: string }): string {
  return `mailto:${encodeURIComponent(message.to).replace(/%40/g, "@")}?subject=${encodeURIComponent(message.subject)}&body=${encodeURIComponent(message.body)}`;
}
