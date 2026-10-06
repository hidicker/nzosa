import type { Cents } from "./money.js";
import type { Overrides, TransactionOverride } from "./overrides.js";
import type { Transaction } from "./types.js";

/**
 * What a payment settling an invoice or bill is, for the GST return.
 *
 * On the payments basis a sale counts for GST when the money arrives, and a
 * purchase when it is paid. A receipt matched to an invoice is coded to
 * Accounts Receivable -- which is where the money goes -- and that account
 * carries no GST, so the return read it as out of scope and the sale never
 * reached Box 5. On one set of books every invoice receipt of two periods was
 * missing from the return. The ledger had them right all along; its settling
 * entries carry the invoice's tax.
 *
 * So the invoice decides, as it does in the ledger: the side from its kind,
 * and the treatment from its lines. A payment on an invoice that is partly
 * taxed is divided in the same proportion, so the zero-rated or exempt part
 * of it does not have 3/23 taken out of it.
 */
export interface Settlement {
  side: "sales" | "purchases";
  /** The part of the document's total that carries GST, 0 to 1. */
  taxable: number;
  /** The document's number, for saying why. */
  number: string;
}

export function settledGst(
  transactions: readonly Transaction[],
  overrides: Overrides,
  settles: (id: string) => Settlement | undefined,
): { transactions: Transaction[]; overrides: Overrides } {
  const out: Transaction[] = [];
  const next: Record<string, TransactionOverride> = { ...overrides };
  const mark = (id: string, taxed: boolean, s: Settlement): void => {
    next[id] = {
      ...(next[id] ?? {}),
      treatment: taxed ? "standard" : "exempt",
      side: taxed ? s.side : "none",
      note: `settles ${s.number}`,
    };
  };
  for (const t of transactions) {
    const s = settles(t.id);
    if (s === undefined) {
      out.push(t);
      continue;
    }
    if (s.taxable >= 0.9999) {
      mark(t.id, true, s);
      out.push(t);
    } else if (s.taxable <= 0.0001) {
      mark(t.id, false, s);
      out.push(t);
    } else {
      // Partly taxed: the taxed share and the rest as two lines of their own.
      const taxedAmount = Math.round(t.amount * s.taxable) as Cents;
      const taxed = { ...t, id: `${t.id}#taxed`, amount: taxedAmount };
      const rest = { ...t, id: `${t.id}#untaxed`, amount: (t.amount - taxedAmount) as Cents };
      mark(taxed.id, true, s);
      mark(rest.id, false, s);
      out.push(taxed, rest);
    }
  }
  return { transactions: out, overrides: next };
}
