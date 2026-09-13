import type { Cents } from "./money.js";
import type { ReferenceLine } from "./coding-check.js";
import type { IsoDate } from "./dates.js";

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
