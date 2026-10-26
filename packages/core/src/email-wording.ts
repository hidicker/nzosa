/**
 * What the emails say: for an invoice, a statement and a reminder, each with
 * blanks filled in from the document -- {customer}, {owing}, {due} -- so one
 * wording serves every customer.
 *
 * Nothing is sent from the app. The wording opens a new message in the
 * person's own mail program, with the document saved beside it to attach.
 */

export type WordingKind = "invoice" | "statement" | "reminder";

export interface Wording {
  subject: string;
  body: string;
}

/** The blanks each kind can use, and what each stands for. */
export const WORDING_BLANKS: Readonly<Record<WordingKind, readonly { name: string; means: string }[]>> = {
  invoice: [
    { name: "customer", means: "who it is to" },
    { name: "business", means: "who it is from" },
    { name: "title", means: "Tax invoice, Invoice or Estimate" },
    { name: "number", means: "its number" },
    { name: "amount", means: "what is owing on it" },
    { name: "due", means: "when it is due" },
    { name: "reference", means: "its reference" },
    { name: "payment", means: "where to pay" },
    { name: "message", means: "the invoice's own message" },
  ],
  statement: [
    { name: "customer", means: "who it is to" },
    { name: "business", means: "who it is from" },
    { name: "date", means: "the statement's date" },
    { name: "owing", means: "everything owing" },
    { name: "pastdue", means: "what is past due" },
    { name: "payment", means: "where to pay" },
  ],
  reminder: [
    { name: "customer", means: "who it is to" },
    { name: "business", means: "who it is from" },
    { name: "date", means: "today" },
    { name: "owing", means: "everything owing" },
    { name: "pastdue", means: "what is past due" },
    { name: "payment", means: "where to pay" },
  ],
};

export const STANDARD_WORDING: Readonly<Record<WordingKind, Wording>> = {
  invoice: {
    subject: "{title} {number} from {business}",
    body: "Hello,\n\nPlease find {title} {number} attached.\n\nAmount due: {amount}\nDue: {due}\nReference: {reference}\n\nPayment details: {payment}\n\n{message}\n\nThank you,\n{business}",
  },
  statement: {
    subject: "Statement from {business}",
    body: "Hello,\n\nPlease find your statement as at {date} attached. The balance owing is {owing}.\n\nPayment details: {payment}\n\nThank you,\n{business}",
  },
  reminder: {
    subject: "Payment reminder from {business}",
    body: "Hello,\n\n{pastdue} on your account is now past due. Your statement is attached; it shows each invoice and what is owing on it.\n\nPayment details: {payment}\n\nIf you have paid already, thank you, and please ignore this.\n\n{business}",
  },
};

/**
 * A wording with its blanks filled. A line whose only content was a blank
 * left empty goes, with the blank line after it -- "Reference: " with no
 * reference is not said at all -- and runs of empty lines close up.
 */
export function fillWording(wording: Wording, values: Readonly<Record<string, string>>): Wording {
  const fill = (text: string): string => text.replace(/\{([a-z]+)\}/gi, (whole, name: string) => values[name.toLowerCase()] ?? whole);
  const body = wording.body
    .split(/\r?\n/)
    .filter((line) => {
      const blanks = [...line.matchAll(/\{([a-z]+)\}/gi)].map((m) => (m[1] ?? "").toLowerCase());
      return !(blanks.length > 0 && blanks.every((name) => (values[name] ?? "").trim() === ""));
    })
    .map(fill)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { subject: fill(wording.subject).replace(/\s+/g, " ").trim(), body };
}

/** The wording to use: the books' own where they have one, the standard otherwise. */
export function wordingFor(kind: WordingKind, own: Partial<Record<WordingKind, Wording>> | undefined): Wording {
  const mine = own?.[kind];
  return mine !== undefined && (mine.subject.trim() !== "" || mine.body.trim() !== "") ? mine : STANDARD_WORDING[kind];
}

/** Blanks a wording uses that its kind does not have, so a misspelt {cutsomer} is caught before it is sent. */
export function unknownBlanks(kind: WordingKind, wording: Wording): string[] {
  const known = new Set(WORDING_BLANKS[kind].map((b) => b.name));
  const used = [...`${wording.subject}\n${wording.body}`.matchAll(/\{([a-z]+)\}/gi)].map((m) => (m[1] ?? "").toLowerCase());
  return [...new Set(used.filter((name) => !known.has(name)))];
}
