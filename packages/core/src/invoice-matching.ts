import type { Cents } from "./money.js";
import { daysBetween } from "./dates.js";
import type { Transaction } from "./types.js";
import type { Invoice, PaymentAllocation } from "./invoices.js";

/**
 * Matching invoices to the money that settled them.
 *
 * The hard part is not finding a receipt of the right size; it is knowing when
 * a match is real. Four monthly instalments of the same amount match each
 * other's invoices equally well, and picking the nearest date pairs them in
 * whatever order the file happened to be in -- which looks tidy and is wrong.
 *
 * So evidence is used in order of how much it is worth:
 *
 *  1. **The invoice number on the bank line.** The customer telling you what
 *     they are paying. Believed outright, and claimed first so a named payment
 *     is not taken by an earlier invoice of the same amount.
 *  2. **A recorded allocation.** The accounting system saying which payments
 *     settled it: what to look for is known rather than guessed.
 *  3. **Amount and date.** Only exact, and only within the payment window.
 *
 * Anything short of that is a *proposal*, not a match, because closing the gap
 * means writing money off -- and that is a decision for a person.
 */

const WINDOW_DAYS = 120;

export interface InvoiceMatch {
  invoice: Invoice;
  /** One receipt for a single payment, several for instalments. */
  transactions: Transaction[];
  how: "single receipt" | "instalments" | "reference";
}

export interface InvoiceMatchProposal {
  /** Stable id so a proposal can be accepted or rejected by name. */
  id: string;
  transactionId: string;
  invoiceNumber: string;
  /** What the invoice says is outstanding. */
  invoiceAmount: Cents;
  /** What actually arrived. */
  bankAmount: Cents;
  /** The difference that would have to be written off. */
  adjustment: Cents;
  /** Where the suggestion came from, in plain words. */
  source: string;
}

export interface InvoiceMatchOptions {
  invoices: readonly Invoice[];
  transactions: readonly Transaction[];
  /** What the accounting system says settled each invoice, when known. */
  allocations?: readonly PaymentAllocation[];
  /** Largest difference to propose, in minor units. Defaults to $5. */
  tolerance?: Cents;
  /** How long after issue a payment may still be its own. Defaults to 120 days. */
  windowDays?: number;
}

export interface InvoiceMatchResult {
  matched: InvoiceMatch[];
  unmatched: Invoice[];
  proposals: InvoiceMatchProposal[];
}

/**
 * Find a set of receipts that together settle an invoice.
 *
 * An invoice paid by deposit and instalments has no single matching receipt,
 * so combinations are tried -- but only small ones, and only within the
 * payment window. Searching wider would eventually find a coincidental set of
 * unrelated receipts that happens to add up, which is worse than not matching.
 */
function findInstalments(
  invoice: Invoice,
  pool: readonly Transaction[],
  maxParts: number,
): Transaction[] | undefined {
  const found: Transaction[][] = [];

  const walk = (start: number, chosen: Transaction[], remaining: number): void => {
    // Stop once a second combination turns up: the point is to detect
    // ambiguity, not to collect every possibility.
    if (found.length > 1) return;
    if (remaining === 0 && chosen.length >= 2) {
      found.push([...chosen]);
      return;
    }
    if (chosen.length >= maxParts || remaining <= 0) return;

    for (let i = start; i < pool.length; i += 1) {
      const candidate = pool[i] as Transaction;
      if (candidate.amount > remaining) continue;
      chosen.push(candidate);
      walk(i + 1, chosen, remaining - candidate.amount);
      chosen.pop();
      if (found.length > 1) return;
    }
  };

  walk(0, [], invoice.total);

  // Any amount can be reached several ways once there are enough small
  // receipts to choose from, and a coincidental set is indistinguishable from a
  // real one. Only a single possible answer is trustworthy.
  return found.length === 1 ? found[0] : undefined;
}

export function matchInvoices(options: InvoiceMatchOptions): InvoiceMatchResult {
  const { invoices, transactions } = options;
  const toleranceCents = options.tolerance ?? 500;
  const windowDays = options.windowDays ?? WINDOW_DAYS;
  const receipts = transactions.filter((t) => t.amount > 0);
  const byAmount = new Map<number, Transaction[]>();
  for (const t of receipts) {
    const list = byAmount.get(t.amount);
    if (list) list.push(t);
    else byAmount.set(t.amount, [t]);
  }

  const used = new Set<string>();
  const matches: InvoiceMatch[] = [];
  const unmatched: Invoice[] = [];
  const proposals: InvoiceMatchProposal[] = [];
  const allocations = options.allocations ?? [];
  const byInvoice = new Map<string, PaymentAllocation[]>();
  for (const a of allocations) {
    const list = byInvoice.get(a.invoiceNumber);
    if (list) list.push(a);
    else byInvoice.set(a.invoiceNumber, [a]);
  }

  // First pass: bind every invoice whose number appears on a bank line.
  //
  // A run of equal instalments from one customer cannot be told apart by
  // amount or date -- four monthly payments of the same figure match each
  // other's invoices equally well, and taking the nearest date pairs them in
  // whatever order the file happens to be in. But the customer usually puts
  // the invoice number in the payment reference, which settles it outright.
  //
  // This runs before anything else so a named payment is claimed by the
  // invoice it names, rather than being taken first by an earlier invoice
  // that merely has the same amount.
  const claimed = new Map<string, Transaction>();
  for (const invoice of invoices) {
    if (invoice.paid === 0) continue;
    const named = (byAmount.get(invoice.total) ?? []).filter(
      (t) =>
        !used.has(t.id) &&
        `${t.reference} ${t.particulars ?? ""}`.toUpperCase().includes(invoice.number.toUpperCase()),
    );
    // Only when it is unambiguous. Two bank lines naming the same invoice is a
    // question for a person, not something to resolve by picking one.
    const only = named[0];
    if (named.length === 1 && only) {
      used.add(only.id);
      claimed.set(invoice.number, only);
    }
  }

  for (const invoice of [...invoices].sort((a, b) => a.issued.localeCompare(b.issued))) {
    // Nothing paid means there is nothing to look for in the bank, but the
    // invoice still exists and still has to be visible: skipping it outright
    // hid every invoice awaiting payment, and every invoice raised by hand,
    // which is the normal state of one the moment it is written.
    if (invoice.paid === 0) {
      unmatched.push(invoice);
      continue;
    }

    const named = claimed.get(invoice.number);
    if (named) {
      matches.push({ invoice, transactions: [named], how: "reference" });
      continue;
    }

    const recorded = byInvoice.get(invoice.number);
    if (recorded && recorded.length > 0) {
      // The accounting system says exactly which payments settled this
      // invoice. Each still has to be found in the bank, but what to look for
      // is known rather than guessed.
      const found: Transaction[] = [];
      for (const allocation of recorded) {
        const candidates = (byAmount.get(allocation.amount) ?? []).filter((t) => !used.has(t.id));

        // A run of equal instalments from one customer cannot be told apart by
        // amount or date -- the nearest date is as likely to be the wrong one
        // as the right one. But the bank line usually carries the invoice
        // number in its reference, and that is the customer telling us which
        // invoice they are paying. Believe it whenever it is there.
        const named = candidates.filter((t) =>
          `${t.reference} ${t.particulars ?? ""}`
            .toUpperCase()
            .includes(invoice.number.toUpperCase()),
        );
        const pool = named.length > 0 ? named : candidates;

        let best: { gap: number; transaction: Transaction } | undefined;
        for (const t of pool) {
          const gap = Math.abs(daysBetween(allocation.date, t.date));
          if (gap > 14) continue;
          if (!best || gap < best.gap) best = { gap, transaction: t };
        }
        if (best) {
          used.add(best.transaction.id);
          found.push(best.transaction);
          continue;
        }

        // The allocation is recorded but no receipt matches it exactly. A
        // receipt within tolerance is the likely one, arriving a few cents
        // different -- but closing that gap means writing money off, so it is
        // proposed rather than assumed.
        const near = receipts
          .filter((t) => {
            if (used.has(t.id)) return false;
            if (Math.abs(daysBetween(allocation.date, t.date)) > 14) return false;
            const difference = Math.abs(t.amount - allocation.amount);
            return difference > 0 && difference <= toleranceCents;
          })
          .sort((a, b) => Math.abs(a.amount - allocation.amount) - Math.abs(b.amount - allocation.amount));

        const candidate = near[0];
        if (candidate) {
          proposals.push({
            id: `${invoice.number}~${candidate.id.slice(0, 8)}`,
            transactionId: candidate.id,
            invoiceNumber: invoice.number,
            invoiceAmount: allocation.amount,
            bankAmount: candidate.amount,
            adjustment: candidate.amount - allocation.amount,
            source: "payment recorded against the invoice, banked a little different",
          });
        }
      }

      if (found.length === recorded.length) {
        matches.push({
          invoice,
          transactions: found,
          how: found.length > 1 ? "instalments" : "single receipt",
        });
      } else {
        for (const t of found) used.delete(t.id);
        unmatched.push(invoice);
      }
      continue;
    }

    // No recorded allocation: fall back to an exact single-receipt match.
    const candidates = (byAmount.get(invoice.total) ?? []).filter((t) => !used.has(t.id));
    let best: { gap: number; transaction: Transaction } | undefined;
    for (const t of candidates) {
      const gap = daysBetween(invoice.issued, t.date);
      if (gap < -3 || gap > windowDays) continue;
      if (!best || Math.abs(gap) < Math.abs(best.gap)) best = { gap, transaction: t };
    }

    if (best) {
      used.add(best.transaction.id);
      matches.push({ invoice, transactions: [best.transaction], how: "single receipt" });
      continue;
    }

    // Nothing matched exactly. A receipt within tolerance is worth putting in
    // front of a person, but the difference is money being written off, so it
    // is proposed rather than applied.
    const near = receipts
      .filter((t) => {
        if (used.has(t.id)) return false;
        const gap = daysBetween(invoice.issued, t.date);
        if (gap < -3 || gap > windowDays) return false;
        const difference = Math.abs(t.amount - invoice.total);
        return difference > 0 && difference <= toleranceCents;
      })
      .sort((a, b) => Math.abs(a.amount - invoice.total) - Math.abs(b.amount - invoice.total));

    const candidate = near[0];
    if (candidate) {
      proposals.push({
        id: `${invoice.number}~${candidate.id.slice(0, 8)}`,
        transactionId: candidate.id,
        invoiceNumber: invoice.number,
        invoiceAmount: invoice.total,
        bankAmount: candidate.amount,
        adjustment: candidate.amount - invoice.total,
        source: "amount within tolerance of the invoice",
      });
    }

    unmatched.push(invoice);
  }

  return { matched: matches, unmatched, proposals };
}
