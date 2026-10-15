import { parseCsvRecords } from "./csv.js";
import type { Contact, ContactKind } from "./contacts.js";

/**
 * A list of customers or vendors out of an accounting system.
 *
 * QuickBooks Online's Customers and Vendors pages export one each, and most
 * other systems have the same list under other headings. They are read by what
 * the columns are called -- a name, and some of the details -- rather than by
 * a fixed layout, since the columns are the user's to choose and reorder.
 */

const NAME = ["customer", "customer full name", "customer name", "vendor", "vendor name", "vendor full name", "display name", "full name", "name", "contact name", "contact"];
const COMPANY = ["company", "company name", "business name"];
const EMAIL = ["email", "email address", "e-mail", "emails"];
const PHONE = ["phone", "phone number", "phone numbers", "telephone", "mobile", "work phone"];
const ADDRESS = ["address", "billing address", "bill address", "street address", "mailing address", "billing street", "street"];
const TERMS = ["terms", "payment terms"];
const TAX_ID = ["tax id", "tax id no.", "ein", "tin", "business id no.", "tax number", "ssn or ein", "tax identifier"];
const IS_1099 = ["track payments for 1099", "1099 vendor", "eligible for 1099", "is 1099", "1099 tracking", "1099"];
const NOTES = ["notes", "note", "memo"];
const STATUS = ["status", "active"];

const norm = (cell: string): string => cell.trim().toLowerCase().replace(/\s+/g, " ");

function indexOf(headers: readonly string[], names: readonly string[]): number {
  for (const wanted of names) {
    const at = headers.indexOf(wanted);
    if (at >= 0) return at;
  }
  return -1;
}

function headerRow(records: ReturnType<typeof parseCsvRecords>): { at: number; headers: string[] } | null {
  for (let i = 0; i < Math.min(records.length, 15); i += 1) {
    const headers = (records[i]?.fields ?? []).map(norm);
    const named = indexOf(headers, NAME) >= 0;
    const details =
      [COMPANY, EMAIL, PHONE, ADDRESS].filter((group) => indexOf(headers, group) >= 0).length;
    if (named && details >= 1) return { at: i, headers };
  }
  return null;
}

/** Whether a file is a list of customers or vendors, from its headings. */
export function isContactList(text: string): boolean {
  const records = parseCsvRecords(text);
  const found = headerRow(records);
  if (found === null) return false;
  // A statement or a ledger has dates and amounts: a contact list has neither.
  const money = ["amount", "debit", "credit", "date", "transaction date", "invoice date", "due date"];
  return indexOf(found.headers, money) < 0;
}

export interface ContactListRead {
  contacts: Omit<Contact, "id">[];
  /** The kind the list says it is, when its headings say; else null. */
  kind: ContactKind | null;
}

/** The contacts in a list, as customers unless the list says vendors. */
export function parseContactList(text: string, hint: ContactKind | null = null): ContactListRead {
  const records = parseCsvRecords(text);
  const found = headerRow(records);
  if (found === null) return { contacts: [], kind: null };
  const { at, headers } = found;
  const column = {
    name: indexOf(headers, NAME),
    company: indexOf(headers, COMPANY),
    email: indexOf(headers, EMAIL),
    phone: indexOf(headers, PHONE),
    address: indexOf(headers, ADDRESS),
    terms: indexOf(headers, TERMS),
    taxId: indexOf(headers, TAX_ID),
    is1099: indexOf(headers, IS_1099),
    notes: indexOf(headers, NOTES),
    status: indexOf(headers, STATUS),
    city: indexOf(headers, ["city", "town", "suburb"]),
    region: indexOf(headers, ["state", "region", "province"]),
    postcode: indexOf(headers, ["zip", "zip code", "postcode", "post code", "postal code"]),
  };
  const nameHeading = headers[column.name] ?? "";
  const kind: ContactKind | null = /vendor/.test(nameHeading) || column.is1099 >= 0 ? "vendor" : /customer/.test(nameHeading) ? "customer" : hint;

  const contacts: Omit<Contact, "id">[] = [];
  for (const record of records.slice(at + 1)) {
    const cell = (index: number): string => (index >= 0 ? (record.fields[index] ?? "").trim() : "");
    const name = cell(column.name);
    // Totals and blank lines.
    if (name === "" || /^total\b/i.test(name)) continue;
    const status = cell(column.status).toLowerCase();
    const flag = cell(column.is1099).toLowerCase();
    // The street, then the town, state and postcode where a list keeps them
    // in columns of their own (SlowBooks does): "Springfield, IL 62701".
    const place = [cell(column.city), [cell(column.region), cell(column.postcode)].filter((p) => p !== "").join(" ")]
      .filter((p) => p !== "")
      .join(", ");
    const address = [cell(column.address).replace(/\s*\n\s*/g, "\n"), place].filter((p) => p !== "").join("\n");
    const contact: Omit<Contact, "id"> = {
      name,
      kind: kind ?? "customer",
      ...(cell(column.company) !== "" && cell(column.company) !== name ? { company: cell(column.company) } : {}),
      ...(cell(column.email) !== "" ? { email: cell(column.email).split(/[;,]/)[0]?.trim() ?? "" } : {}),
      ...(cell(column.phone) !== "" ? { phone: cell(column.phone) } : {}),
      ...(address !== "" ? { address } : {}),
      ...(cell(column.terms) !== "" ? { terms: cell(column.terms) } : {}),
      ...(cell(column.taxId) !== "" ? { taxId: cell(column.taxId) } : {}),
      ...(cell(column.notes) !== "" ? { notes: cell(column.notes) } : {}),
      ...(flag === "yes" || flag === "true" || flag === "y" || flag === "1" ? { is1099: true } : {}),
      ...(status === "inactive" || status === "false" || status === "no" ? { active: false } : {}),
      source: "QuickBooks",
    };
    contacts.push(contact);
  }
  return { contacts, kind };
}
