import { daysBetween } from "./dates.js";
import type { Cents } from "./money.js";
import type { Payout } from "./payouts.js";
import type { Transaction } from "./types.js";

/**
 * Which bank line each payout arrived as.
 *
 * The amount is the key and the date is only a window. A payout's net is the
 * sum of its parts, computed from the processor's own rows, so a bank line
 * that is not equal to the cent is not that payout however close the date. The
 * date, by contrast, is routinely a day or two out: the processor records the
 * payout when it releases the money and the bank records it when it lands.
 *
 * One line to one payout. Two payouts of the same amount in the same week are
 * ordinary -- a subscription business can have dozens -- so a line already
 * claimed is not offered again, and the nearest date wins.
 */
export interface PayoutMatchOptions {
  payouts: readonly Payout[];
  transactions: readonly Transaction[];
  /** How far the bank may lag the processor. Defaults to 10 days. */
  windowDays?: number;
}

export interface PayoutMatch {
  payout: Payout;
  transaction: Transaction;
}

export function matchPayouts(options: PayoutMatchOptions): PayoutMatch[] {
  const { payouts, transactions } = options;
  if (payouts.length === 0) return [];
  const windowDays = options.windowDays ?? 10;

  const byAmount = new Map<Cents, Transaction[]>();
  for (const transaction of transactions) {
    const list = byAmount.get(transaction.amount);
    if (list) list.push(transaction);
    else byAmount.set(transaction.amount, [transaction]);
  }

  const taken = new Set<string>();
  const out: PayoutMatch[] = [];
  for (const payout of payouts) {
    const candidates = (byAmount.get(payout.net) ?? []).filter((t) => !taken.has(t.id));
    let best: { gap: number; transaction: Transaction } | undefined;
    for (const transaction of candidates) {
      const gap = Math.abs(daysBetween(payout.date, transaction.date));
      if (gap > windowDays) continue;
      if (!best || gap < best.gap) best = { gap, transaction };
    }
    if (best === undefined) continue;
    taken.add(best.transaction.id);
    out.push({ payout, transaction: best.transaction });
  }
  return out;
}
