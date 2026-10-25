import type { Contact } from "./contacts.js";
import type { Invoice } from "./invoices.js";
import type { Transaction } from "./types.js";

/**
 * One search across the books: contacts, invoices, bills and bank lines, for
 * the box at the top of the menu. Every word typed has to be somewhere in a
 * record for it to be found; a typed amount ("120", "$1,234.50") also finds
 * the lines and documents of exactly that amount, in or out.
 */

export type SearchKind = "contact" | "invoice" | "bill" | "line";

export interface SearchHit {
  kind: SearchKind;
  /** What finds it again: a contact's id, a document's number, a line's id. */
  key: string;
  title: string;
  detail: string;
  date?: string;
}

const plain = (text: string): string =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/** The amount a query is, in cents, when it is one: "120", "120.5", "$1,234.50". */
function amountIn(query: string): number | null {
  const m = /^\s*-?\$?\s*(\d{1,3}(,\d{3})+|\d+)(\.\d{1,2})?\s*$/.exec(query);
  if (m === null) return null;
  return Math.round(Number(query.replace(/[$,\s-]/g, "")) * 100);
}

const money = (cents: number): string =>
  `${cents < 0 ? "-" : ""}${(Math.abs(cents) / 100).toLocaleString("en-NZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function searchBooks(
  query: string,
  books: {
    contacts?: readonly Contact[];
    invoices?: readonly Invoice[];
    transactions?: readonly Transaction[];
    /** A bank account's name, from its id. */
    accountName?: (id: string) => string;
  },
  each = 5,
): SearchHit[] {
  const words = plain(query).split(/\s+/).filter((w) => w !== "");
  if (words.length === 0 || (words.length === 1 && (words[0]?.length ?? 0) < 2)) return [];
  const cents = amountIn(query);
  const has = (haystack: string): boolean => {
    const h = plain(haystack);
    return words.every((w) => h.includes(w));
  };
  const phrase = words.join(" ");
  const starts = (text: string): number => (plain(text).startsWith(phrase) ? 0 : plain(text).includes(phrase) ? 1 : 2);

  const contacts = (books.contacts ?? [])
    .filter((c) => has([c.name, c.company ?? "", c.email ?? "", c.phone ?? ""].join(" ")))
    .sort((a, b) => starts(a.name) - starts(b.name) || a.name.localeCompare(b.name))
    .slice(0, each)
    .map((c): SearchHit => ({
      kind: "contact",
      key: c.id,
      title: c.name,
      detail: [c.kind === "vendor" ? "Supplier" : c.kind === "customer" ? "Customer" : "Contact", c.email ?? ""].filter((p) => p !== "").join(" · "),
    }));

  const documents = (books.invoices ?? [])
    .filter((i) => (cents !== null && Math.abs(i.total) === cents) || has([i.number, i.contact, i.reference].join(" ")))
    .sort((a, b) => starts(a.number) - starts(b.number) || b.issued.localeCompare(a.issued))
    .map((i): SearchHit => ({
      kind: i.kind === "purchase" ? "bill" : "invoice",
      key: i.number,
      title: `${i.kind === "purchase" ? "Bill" : /quote/i.test(i.status) ? "Quote" : "Invoice"} ${i.number}`,
      detail: `${i.contact} · ${money(i.total)} · ${i.status}`,
      date: i.issued,
    }));
  const invoices = documents.filter((d) => d.kind === "invoice").slice(0, each);
  const bills = documents.filter((d) => d.kind === "bill").slice(0, each);

  const lines = (books.transactions ?? [])
    .filter(
      (t) =>
        (cents !== null && Math.abs(t.amount) === cents) ||
        has([t.otherParty, t.particulars, t.code, t.reference].join(" ")),
    )
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, each)
    .map((t): SearchHit => ({
      kind: "line",
      key: t.id,
      title: t.otherParty || t.particulars || t.reference || "(no payee)",
      detail: `${money(t.amount)} · ${books.accountName?.(t.account) ?? t.account}`,
      date: t.date,
    }));

  return [...contacts, ...invoices, ...bills, ...lines];
}
