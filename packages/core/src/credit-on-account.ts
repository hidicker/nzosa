import type { Cents } from "./money.js";
import type { IsoDate } from "./dates.js";
import type { CreditAllocation, InvoiceBalance, InvoiceKind } from "./invoices.js";
import { isCreditNote, isPosted } from "./invoices.js";
import { contactKey } from "./contacts.js";

/**
 * Credit held on a customer's or supplier's account, and using it.
 *
 * Credit comes from a credit note not yet used in full, or from a document
 * paid more than it asked for. It stays on the account until it is put
 * against another of their documents -- a later invoice, an older one still
 * owing -- in whole or in part, or paid back.
 */

export interface CreditSource {
  balance: InvoiceBalance;
  /** What is left to use, positive. */
  available: Cents;
}

/** One contact's credit, newest-held last, and the documents it could go against. */
export interface CreditOnAccount {
  contact: string;
  kind: InvoiceKind;
  sources: CreditSource[];
  available: Cents;
  open: InvoiceBalance[];
}

/**
 * Every contact with credit to use, of one kind (sales or purchase).
 * `linked` is credit notes already applied whole, which have none left.
 */
export function creditsOnAccount(
  balances: Iterable<InvoiceBalance>,
  kind: InvoiceKind,
  linked: Readonly<Record<string, string>> = {},
): CreditOnAccount[] {
  const byContact = new Map<string, CreditOnAccount>();
  const entry = (name: string): CreditOnAccount => {
    const key = contactKey(name);
    let one = byContact.get(key);
    if (one === undefined) {
      one = { contact: name, kind, sources: [], available: 0, open: [] };
      byContact.set(key, one);
    }
    return one;
  };
  for (const balance of balances) {
    const doc = balance.invoice;
    if (doc.kind !== kind || !isPosted(doc)) continue;
    if (isCreditNote(doc)) {
      if ((linked[doc.number] ?? "") !== "") continue;
      if (balance.remaining < 0) entry(doc.contact).sources.push({ balance, available: -balance.remaining });
    } else if (balance.remaining < 0) {
      entry(doc.contact).sources.push({ balance, available: -balance.remaining });
    } else if (balance.remaining > 0) {
      entry(doc.contact).open.push(balance);
    }
  }
  const out: CreditOnAccount[] = [];
  for (const one of byContact.values()) {
    if (one.sources.length === 0) continue;
    one.sources.sort((a, b) => a.balance.invoice.issued.localeCompare(b.balance.invoice.issued));
    one.open.sort((a, b) => (a.invoice.due ?? a.invoice.issued).localeCompare(b.invoice.due ?? b.invoice.issued));
    one.available = one.sources.reduce((s, x) => s + x.available, 0);
    out.push(one);
  }
  return out.sort((a, b) => a.contact.localeCompare(b.contact));
}

/**
 * The credit put against the open documents, oldest due first, until one or
 * the other runs out. Each target is given the amount asked for it (or, when
 * none is asked, as much as it owes), and the sources are drawn on in order.
 */
export function proposeAllocations(
  credit: CreditOnAccount,
  wanted: ReadonlyMap<string, Cents> | undefined,
  date: IsoDate,
): CreditAllocation[] {
  const left = credit.sources.map((s) => ({ number: s.balance.invoice.number, available: s.available }));
  const out: CreditAllocation[] = [];
  for (const target of credit.open) {
    let need = Math.min(wanted?.get(target.invoice.number) ?? target.remaining, target.remaining);
    for (const source of left) {
      if (need <= 0) break;
      const take = Math.min(need, source.available);
      if (take <= 0) continue;
      out.push({ from: source.number, to: target.invoice.number, amount: take, date });
      source.available -= take;
      need -= take;
    }
  }
  return out;
}

/** What is wrong with putting these allocations in, in words, or null. */
export function allocationProblem(
  allocations: readonly CreditAllocation[],
  balances: ReadonlyMap<string, InvoiceBalance>,
): string | null {
  const from = new Map<string, Cents>();
  const to = new Map<string, Cents>();
  for (const a of allocations) {
    if (!Number.isInteger(a.amount) || a.amount <= 0) return "Each amount more than nothing.";
    const source = balances.get(a.from);
    const target = balances.get(a.to);
    if (source === undefined || target === undefined) return "A document named is not in these books.";
    if (contactKey(source.invoice.contact) !== contactKey(target.invoice.contact) || source.invoice.kind !== target.invoice.kind) {
      return `${a.from} and ${a.to} are not the same ${source.invoice.kind === "sales" ? "customer's" : "supplier's"}.`;
    }
    if (a.date < source.invoice.issued || a.date < target.invoice.issued) return "A credit is used no earlier than both documents' dates.";
    from.set(a.from, (from.get(a.from) ?? 0) + a.amount);
    to.set(a.to, (to.get(a.to) ?? 0) + a.amount);
  }
  for (const [number, amount] of from) {
    if (amount > -(balances.get(number)?.remaining ?? 0)) return `More than the credit left on ${number}.`;
  }
  for (const [number, amount] of to) {
    if (amount > (balances.get(number)?.remaining ?? 0)) return `More than ${number} still owes.`;
  }
  return null;
}
