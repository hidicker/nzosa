import type { Invoice, PaymentAllocation } from "./invoices.js";
import { matchInvoices } from "./invoice-matching.js";
import { splitPartId } from "./splits.js";
import type { Splits } from "./splits.js";
import type { Transaction } from "./types.js";

/**
 * Which receipt settled which invoice, from every source that has an opinion.
 *
 * Three of them, and the order is the whole of the logic:
 *
 *  1. **What a person accepted.** Recorded, and it wins. Somebody looked.
 *  2. **What a split part says.** A payment divided across several invoices
 *     has answered the question more precisely than any matcher could.
 *  3. **What the matcher found**, for everything still unanswered.
 *
 * The second beats the third for a reason that costs money. A payment whose
 * parts each settle an invoice is already assigned; if the matcher is also
 * allowed to claim the parent transaction, the same money is counted twice --
 * once as the whole payment against one invoice, and again as its parts
 * against several.
 *
 * An empty string is not an assignment. It is a refusal, recorded so the
 * matcher stops offering a line somebody has already rejected, and it does not
 * leave this function looking like an answer.
 */
export interface AssignmentOptions {
  invoices: readonly Invoice[];
  transactions: readonly Transaction[];
  allocations?: readonly PaymentAllocation[];
  /** Assignments a person has accepted, and refusals recorded as empty. */
  accepted: Readonly<Record<string, string>>;
  splits: Splits;
}

export function invoiceAssignments(options: AssignmentOptions): Map<string, string> {
  const { invoices, transactions, allocations, accepted, splits } = options;
  const settled = new Map<string, string>(Object.entries(accepted));

  if (invoices.length > 0) {
    const found = matchInvoices({
      invoices,
      transactions,
      ...(allocations ? { allocations } : {}),
    });

    const splitAcross = new Set<string>();
    for (const [id, parts] of Object.entries(splits)) {
      if (parts.some((_, index) => settled.has(splitPartId(id, index)))) splitAcross.add(id);
    }

    for (const match of found.matched) {
      for (const t of match.transactions) {
        if (splitAcross.has(t.id)) continue;
        if (!settled.has(t.id)) settled.set(t.id, match.invoice.number);
      }
    }
  }

  for (const [id, number] of [...settled]) if (number === "") settled.delete(id);
  return settled;
}
