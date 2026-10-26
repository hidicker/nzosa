import type { Cents } from "./money.js";
import type { Invoice } from "./invoices.js";
import type { ManualJournal } from "./manual-journals.js";
import type { Transaction } from "./types.js";

/**
 * Finding anything in the books from one box: a customer, an invoice by its
 * number or its amount, a bank line by its payee, a journal by its reason.
 *
 * Every word typed has to be found; a number typed is also tried as an
 * amount, either way round, so "230" finds the 230.00 invoice and the -230.00
 * bank line that paid it.
 */

export type SearchKind = "contact" | "invoice" | "bill" | "line" | "journal";

export interface SearchHit {
  kind: SearchKind;
  /** What opens it: a contact's name, a document's number, a line's or journal's id. */
  id: string;
  title: string;
  detail: string;
  date?: string;
  /** Lower is better. */
  score: number;
}

export interface SearchSources {
  contacts: readonly { name: string; email?: string; company?: string; phone?: string }[];
  invoices: readonly Invoice[];
  transactions: readonly Transaction[];
  journals: readonly ManualJournal[];
  /** How an amount is written, for the detail line. */
  money: (cents: Cents) => string;
  /** A bank account's name, for the detail line. */
  bankName?: (account: string) => string;
}

/** The amount a query names, in cents, or null when it is not a number. */
function amountOf(query: string): Cents | null {
  const cleaned = query.replace(/[$,\s]/g, "");
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.abs(Math.round(Number(cleaned) * 100));
}

/** On an equal match: who first, then the documents, then journals, then bank lines. */
const RANK: Record<SearchKind, number> = { contact: 0, invoice: 1, bill: 1, journal: 2, line: 3 };

export function searchBooks(query: string, from: SearchSources, limit = 8): SearchHit[] {
  const words = query.toLowerCase().split(/\s+/).filter((w) => w !== "");
  if (words.length === 0) return [];
  const phrase = words.join(" ");
  const amount = amountOf(query.trim());
  const hits: SearchHit[] = [];
  const consider = (
    kind: SearchKind,
    id: string,
    title: string,
    detail: string,
    haystack: string,
    amounts: readonly Cents[],
    date?: string,
    alsoNamed?: string,
  ): void => {
    const text = haystack.toLowerCase();
    const byAmount = amount !== null && amount !== 0 && amounts.some((a) => Math.abs(a) === amount);
    if (!byAmount && !words.every((w) => text.includes(w))) return;
    // A document is named by its number and by whose it is.
    const scoreOf = (said: string): number => {
      const name = said.toLowerCase();
      return name === phrase ? 0 : name.startsWith(phrase) ? 1 : byAmount ? 2 : name.includes(phrase) ? 3 : 4;
    };
    const score = Math.min(scoreOf(title), alsoNamed === undefined ? 4 : scoreOf(alsoNamed));
    hits.push({ kind, id, title, detail, ...(date !== undefined ? { date } : {}), score });
  };

  for (const c of from.contacts) {
    consider("contact", c.name, c.name, [c.company, c.email].filter((x) => x !== undefined && x !== "").join(" · ") || "Contact", `${c.name} ${c.company ?? ""} ${c.email ?? ""} ${c.phone ?? ""}`, []);
  }
  for (const i of from.invoices) {
    const kind: SearchKind = i.kind === "purchase" ? "bill" : "invoice";
    consider(
      kind,
      i.number,
      `${i.number} ${i.contact}`.trim(),
      `${kind === "bill" ? "Bill" : "Invoice"} · ${i.issued} · ${from.money(i.total)}${i.reference.trim() !== "" ? ` · ${i.reference}` : ""}`,
      `${i.number} ${i.contact} ${i.reference} ${i.lines.map((l) => l.description).join(" ")}`,
      [i.total],
      i.issued,
      i.contact,
    );
  }
  for (const t of from.transactions) {
    const who = (t.otherParty || t.particulars || t.reference || "").trim();
    consider(
      "line",
      t.id,
      who === "" ? from.money(t.amount) : who,
      `Bank line · ${t.date} · ${from.money(t.amount)} · ${from.bankName?.(t.account) ?? t.account}`,
      `${t.otherParty} ${t.particulars} ${t.code} ${t.reference}`,
      [t.amount],
      t.date,
    );
  }
  for (const j of from.journals) {
    if (j.deleted !== undefined) continue;
    const total = j.lines.reduce((sum, l) => sum + Math.max(0, l.amount), 0);
    consider(
      "journal",
      j.id,
      j.narration,
      `Journal · ${j.date} · ${from.money(total)}`,
      `${j.narration} ${j.lines.map((l) => `${l.code} ${l.description ?? ""}`).join(" ")}`,
      j.lines.map((l) => l.amount),
      j.date,
    );
  }
  return hits
    .sort((a, b) => a.score - b.score || RANK[a.kind] - RANK[b.kind] || (b.date ?? "").localeCompare(a.date ?? ""))
    .slice(0, limit);
}
