/**
 * Customers and vendors: who the books deal with.
 *
 * An invoice has always carried its contact as a line of text, which is all a
 * bank line or a report needs. A person keeping books for a business wants
 * more of them: an address to send to, a phone number, the terms, and -- in
 * the United States -- whether a vendor's W-9 is on file and whether they are
 * to be sent a 1099. These are those records. Nothing is posted from them:
 * they are looked up by name, so a document that names no record is as good
 * as it ever was.
 */

export type ContactKind = "customer" | "vendor" | "both";

export interface Contact {
  /** Stable, so an edit or a delete finds the same one. */
  id: string;
  /** As documents name them, `Freeman Sporting Goods:55 Twin Lane` included. */
  name: string;
  kind: ContactKind;
  company?: string;
  email?: string;
  phone?: string;
  /** As one block of text, line breaks kept. */
  address?: string;
  /** Payment terms in words: "Net 30". */
  terms?: string;
  /** The tax identifier they gave: an EIN or SSN on a W-9, an IRD or GST number. */
  taxId?: string;
  /** A signed W-9 is on file (United States). */
  w9?: boolean;
  /** To be sent a 1099-NEC when paid over the threshold. */
  is1099?: boolean;
  /** A customer charged no sales tax: a reseller or an exempt organisation (United States). */
  taxExempt?: boolean;
  /** For a customer: the most they should owe at once, in cents. A warning, not a refusal. */
  creditLimit?: number;
  /** For a vendor: the chart code their bills are usually coded to. */
  defaultAccount?: string;
  notes?: string;
  /** Left off lists and pickers when false; never deleted, so history keeps its name. */
  active?: boolean;
  /** Where it was read from, when it was read from another system. */
  source?: string;
}

/** A name compared without case, spacing or stray punctuation. */
export function contactKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[\s]+/g, " ")
    .replace(/[“”"']/g, "")
    .trim();
}

/** `Freeman Sporting Goods:55 Twin Lane` is a job of `Freeman Sporting Goods`. */
export function parentName(name: string): string | null {
  const at = name.indexOf(":");
  return at > 0 ? name.slice(0, at).trim() : null;
}

function idFor(name: string, taken: ReadonlySet<string>): string {
  const base =
    contactKey(name)
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "contact";
  let id = base;
  for (let n = 2; taken.has(id); n += 1) id = `${base}-${n}`;
  return id;
}

/** The kind two sightings of the same name come to. */
function joined(a: ContactKind, b: ContactKind): ContactKind {
  return a === b ? a : "both";
}

/**
 * Bring contacts in, by name. One already held keeps what it has and takes
 * what the incoming one adds, so an address typed here is not lost to a later
 * import that has none.
 */
export function mergeContacts(held: readonly Contact[], incoming: readonly Omit<Contact, "id">[]): Contact[] {
  const out = held.map((c) => ({ ...c }));
  const byKey = new Map(out.map((c) => [contactKey(c.name), c]));
  const ids = new Set(out.map((c) => c.id));
  for (const one of incoming) {
    const key = contactKey(one.name);
    if (key === "") continue;
    const there = byKey.get(key);
    if (there !== undefined) {
      there.kind = joined(there.kind, one.kind);
      for (const field of ["company", "email", "phone", "address", "terms", "taxId", "notes", "source"] as const) {
        const value = one[field];
        if ((there[field] ?? "") === "" && value !== undefined && value !== "") there[field] = value;
      }
      if (there.w9 === undefined && one.w9 !== undefined) there.w9 = one.w9;
      if (there.is1099 === undefined && one.is1099 !== undefined) there.is1099 = one.is1099;
      continue;
    }
    const made: Contact = { ...one, id: idFor(one.name, ids) };
    ids.add(made.id);
    out.push(made);
    byKey.set(key, made);
  }
  return out;
}

/** The record for a name on a document, or the one for its parent customer. */
export function findContact(contacts: readonly Contact[], name: string): Contact | undefined {
  const key = contactKey(name);
  const exact = contacts.find((c) => contactKey(c.name) === key);
  if (exact !== undefined) return exact;
  const parent = parentName(name);
  return parent === null ? undefined : contacts.find((c) => contactKey(c.name) === contactKey(parent));
}
