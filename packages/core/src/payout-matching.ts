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
  /** Most payouts one bank line may combine. Defaults to 4. */
  maxPerTransfer?: number;
}

export interface PayoutMatch {
  payout: Payout;
  transaction: Transaction;
}

/** A bank line and every payout that arrived in it. */
export interface PayoutTransfer {
  transaction: Transaction;
  payouts: Payout[];
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

/**
 * Where a bank feed should resume from.
 *
 * The latest date already held on the *earliest-ending* mapped account, less a
 * week. The earliest because a feed fetch is one window for every account, and
 * starting where the furthest-ahead account ends would skip whatever the
 * others are missing.
 *
 * The week of overlap is not caution for its own sake: a card charge settles
 * after the date it carries, so resuming exactly where an account ends steps
 * over the transactions still to arrive for the last few days. Overlap is
 * cheap -- a line that arrives twice is caught as a duplicate -- and the gap
 * it prevents is not.
 *
 * Nothing at all when an account has been mapped but holds no transactions
 * yet: there is no "resume" for an account that has not started, and guessing
 * a date would quietly decide how much history it gets.
 */
export function feedResumeDate(options: {
  /** Feed account to ledger account; empty values are unmapped. */
  mapping: Readonly<Record<string, string>>;
  transactions: readonly Transaction[];
  /** Days of overlap. Defaults to 7. */
  overlapDays?: number;
}): string | undefined {
  const mapped = [...new Set(Object.values(options.mapping).filter((to) => to !== ""))];
  if (mapped.length === 0) return undefined;

  const latestFor = new Map<string, string>();
  for (const transaction of options.transactions) {
    const seen = latestFor.get(transaction.account);
    if (seen === undefined || transaction.date > seen) {
      latestFor.set(transaction.account, transaction.date);
    }
  }

  if (mapped.some((account) => !latestFor.has(account))) return undefined;

  const earliest = mapped.map((account) => latestFor.get(account) as string).sort()[0];
  if (earliest === undefined) return undefined;

  const day = new Date(`${earliest}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() - (options.overlapDays ?? 7));
  return day.toISOString().slice(0, 10);
}

/**
 * Which bank line each payout arrived in, allowing for several at once.
 *
 * A processor does not always transfer one charge at a time. On real books two
 * charges a day apart reached the bank as a single line -- 800.67 and 792.44
 * arriving together as 1,593.11 -- and matching one payout to one line could
 * never explain it, so both were left uncoded and the fees with them.
 *
 * Single payouts are matched first and exhaustively, so a transfer that is one
 * charge is never explained as a coincidental pair. Only then are combinations
 * tried, capped at a handful, and taken only when exactly one set adds up:
 * searching wider would eventually find an unrelated set totalling the same,
 * and a split put on the wrong payment is a silent error where an unmatched
 * transfer is a visible one.
 */
export function matchPayoutTransfers(options: PayoutMatchOptions): PayoutTransfer[] {
  const windowDays = options.windowDays ?? 10;
  const maxPerTransfer = options.maxPerTransfer ?? 4;
  const near = (a: string, b: string): boolean => Math.abs(daysBetween(a, b)) <= windowDays;

  const out: PayoutTransfer[] = [];
  const taken = new Set<string>();

  for (const { payout, transaction } of matchPayouts(options)) {
    taken.add(payout.reference);
    out.push({ transaction, payouts: [payout] });
  }

  const claimed = new Set(out.map((t) => t.transaction.id));
  for (const transaction of options.transactions) {
    if (claimed.has(transaction.id)) continue;
    const pool = options.payouts.filter(
      (p) => !taken.has(p.reference) && near(p.date, transaction.date),
    );
    if (pool.length < 2) continue;

    const found: Payout[][] = [];
    const walk = (from: number, chosen: Payout[], left: Cents): void => {
      if (found.length > 1) return;
      if (left === 0 && chosen.length >= 2) {
        found.push([...chosen]);
        return;
      }
      if (chosen.length >= maxPerTransfer) return;
      for (let i = from; i < pool.length; i += 1) {
        const next = pool[i] as Payout;
        chosen.push(next);
        walk(i + 1, chosen, left - next.net);
        chosen.pop();
        if (found.length > 1) return;
      }
    };
    walk(0, [], transaction.amount);

    if (found.length !== 1) continue;
    const only = found[0] as Payout[];
    for (const p of only) taken.add(p.reference);
    out.push({ transaction, payouts: only });
  }

  return out;
}
