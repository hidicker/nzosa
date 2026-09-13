import type { Cents } from "./money.js";
import type { ReferenceLine } from "./coding-check.js";
import type { IsoDate } from "./dates.js";
import type { SplitPart } from "./splits.js";
import type { Transaction } from "./types.js";

/**
 * One card payment, as the three entries it really is.
 *
 * A customer pays a 1,000.00 invoice through a card processor and is
 * surcharged 29.00 to cover the fee. The processor keeps 27.57. What reaches
 * the bank is 1,001.43, and every part of that is a different thing: a
 * receivable settled, income earned, and an expense incurred. Coded as a
 * single receipt against the invoice it reads as an overpayment of 1.43, the
 * fee account gets nothing, and the GST on the surcharge is never declared.
 *
 * The processor's charge id is what ties them together. The Account
 * Transactions export states it as the reference on all three, and names the
 * invoice on them as well, which makes the grouping exact rather than a guess
 * from amounts and dates that happen to agree -- and two charges of the same
 * size on the same day stay apart, which no amount-and-date rule manages.
 *
 * Reversals are netted off first. An accounting system that re-codes an entry
 * posts the opposite of it rather than editing it, and both halves carry the
 * same charge id; taking all of them would count the fee twice, and taking the
 * wrong pair would record a reversal as though it were real.
 */
export interface StripeSettlement {
  /** The processor's charge id, e.g. `ch_3ThcGtS4yCINmf4d0KuJQRuW`. */
  charge: string;
  date: IsoDate;
  /** The invoice the payment settles, when the source says which. */
  invoiceNumber: string;
  /** Settled against the invoice, positive. */
  payment: Cents;
  /** Surcharge the customer paid to cover the fee, gross of GST, positive. */
  surcharge: Cents;
  /** What the processor kept, positive. */
  fee: Cents;
  /** What should have reached the bank: payment plus surcharge less fee. */
  net: Cents;
}

/** The charge id inside a fee or surcharge description, if there is one. */
export function chargeIdIn(text: string): string | null {
  const found = /\b(ch_[A-Za-z0-9]+)/.exec(text);
  return found?.[1] ?? null;
}

/**
 * Group an Account Transactions export into card settlements.
 *
 * Only complete ones are returned. A fee with no payment beside it is a refund
 * or a standalone charge, and forcing it into a settlement would invent a
 * split that never happened.
 */
export function stripeSettlements(lines: readonly ReferenceLine[]): StripeSettlement[] {
  const byCharge = new Map<string, ReferenceLine[]>();
  for (const line of lines) {
    const charge = (line.reference ?? "").trim();
    if (!/^ch_/i.test(charge)) continue;
    const held = byCharge.get(charge);
    if (held) held.push(line);
    else byCharge.set(charge, [line]);
  }

  const out: StripeSettlement[] = [];
  for (const [charge, group] of byCharge) {
    // What the processor kept is the only part that leaves the bank, so the
    // negatives are the fee. Of what arrives, the largest is the invoice being
    // settled and the rest is the surcharge added to cover that fee -- which
    // is a rule about sizes rather than about account codes, because a chart
    // names its fee account whatever it likes and this has to work on any.
    const fee = group
      .filter((line) => line.amount < 0)
      .reduce((sum, line) => sum + Math.abs(line.amount), 0);
    const arriving = group.filter((line) => line.amount > 0).sort((a, b) => b.amount - a.amount);
    const settled = arriving[0];
    if (fee === 0 || settled === undefined) continue;

    const surcharge = arriving.slice(1).reduce((sum, line) => sum + line.amount, 0);
    const invoiceNumber = group.find((line) => (line.invoiceNumber ?? "") !== "")?.invoiceNumber ?? "";
    const date = group.reduce((earliest, line) => (line.date < earliest ? line.date : earliest), group[0]!.date);

    out.push({
      charge,
      date,
      invoiceNumber,
      payment: settled.amount,
      surcharge,
      fee,
      net: settled.amount + surcharge - fee,
    });
  }
  return out;
}

/** A bank line, and the settlements that make it up. */
export interface StripeMatch {
  transaction: Transaction;
  settlements: StripeSettlement[];
}

export interface StripeMatchOptions {
  settlements: readonly StripeSettlement[];
  transactions: readonly Transaction[];
  /** How far the bank may lag the processor. Defaults to 10 days. */
  windowDays?: number;
  /** Most settlements one payout may combine. Defaults to 4. */
  maxPerPayout?: number;
}

/**
 * Which bank line each settlement arrived as.
 *
 * A processor does not always pay out one charge at a time: two charges on
 * consecutive days can reach the bank as a single transfer, and on real books
 * one did -- 800.67 and 792.44 arriving together as 1,593.11. So a payout is
 * matched to a *set* of settlements, not only to one.
 *
 * The amount is the key and the date is only a window. A settlement's net is
 * computed from the processor's own figures, so a bank line that is not equal
 * to the cent is not that payout however close the date; the date, by
 * contrast, is routinely two to four days out, because the processor records
 * the charge when it takes it and the bank records the money when it lands.
 *
 * Combinations are tried only after every single settlement has had its
 * chance, are capped at a handful, and are taken only when exactly one set
 * adds up. Searching wider would eventually find an unrelated set that happens
 * to total the same, which is worse than not matching: a split put on the
 * wrong payment is a silent error, and an unmatched payout is a visible one.
 */
export function matchStripeSettlements(options: StripeMatchOptions): StripeMatch[] {
  const windowDays = options.windowDays ?? 10;
  const maxPerPayout = options.maxPerPayout ?? 4;
  const within = (a: IsoDate, b: IsoDate): boolean =>
    Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) <= windowDays * 86_400_000;

  const taken = new Set<string>();
  const out: StripeMatch[] = [];

  // One settlement to one line first. A payout that is a single charge must
  // never be explained as a coincidental combination of two others.
  for (const transaction of options.transactions) {
    const found = options.settlements.filter(
      (s) => !taken.has(s.charge) && s.net === transaction.amount && within(s.date, transaction.date),
    );
    if (found.length !== 1) continue;
    const one = found[0] as StripeSettlement;
    taken.add(one.charge);
    out.push({ transaction, settlements: [one] });
  }

  const matched = new Set(out.map((m) => m.transaction.id));
  for (const transaction of options.transactions) {
    if (matched.has(transaction.id)) continue;
    const pool = options.settlements.filter(
      (s) => !taken.has(s.charge) && within(s.date, transaction.date),
    );
    if (pool.length < 2) continue;

    const sets: StripeSettlement[][] = [];
    const walk = (from: number, chosen: StripeSettlement[], left: Cents): void => {
      if (sets.length > 1) return; // ambiguous already; stop looking
      if (left === 0 && chosen.length >= 2) {
        sets.push([...chosen]);
        return;
      }
      if (chosen.length >= maxPerPayout) return;
      for (let i = from; i < pool.length; i += 1) {
        const next = pool[i] as StripeSettlement;
        chosen.push(next);
        walk(i + 1, chosen, left - next.net);
        chosen.pop();
        if (sets.length > 1) return;
      }
    };
    walk(0, [], transaction.amount);

    if (sets.length !== 1) continue; // none, or more than one way: leave it
    const only = sets[0] as StripeSettlement[];
    for (const s of only) taken.add(s.charge);
    out.push({ transaction, settlements: only });
  }

  return out;
}

/**
 * The parts a matched payout should be split into.
 *
 * Three kinds, and each is a different thing: the invoice settled, the
 * surcharge the customer paid to cover the fee, and the fee itself. The
 * surcharge is income and carries GST; the fee is an expense. Rolling them
 * together as one receipt against the invoice reads as an overpayment, leaves
 * the fee account empty, and never declares the GST on the surcharge.
 */
export function stripeSplitParts(
  match: StripeMatch,
  accounts: { sales: string; fees: string },
): SplitPart[] {
  const parts: SplitPart[] = [];
  for (const s of match.settlements) {
    const named = s.invoiceNumber === "" ? "an invoice" : s.invoiceNumber;
    parts.push({
      amount: s.payment,
      note: `Settles ${named}`,
      treatment: "out-of-scope",
    });
    if (s.surcharge !== 0) {
      parts.push({
        amount: s.surcharge,
        code: accounts.sales,
        note: `Fee surcharge reimbursed on ${named}`,
      });
    }
    parts.push({
      amount: -s.fee,
      code: accounts.fees,
      note: `Processor fee on ${named}`,
    });
  }
  return parts;
}
