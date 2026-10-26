import type { Cents } from "./money.js";
import type { IsoDate } from "./dates.js";
import type { Transaction } from "./types.js";
import type { Overrides } from "./overrides.js";
import type { Invoice } from "./invoices.js";
import { contactKey } from "./contacts.js";

/**
 * What a supplier has been paid: the money that went out to them.
 *
 * A bank line out is theirs when its payee -- as a person named it when
 * coding, or as the bank printed it -- is their name: coded straight to an
 * expense or matched to one of their bills, it is money paid to them either
 * way. A payment of their bill made some other way (recorded on the bill)
 * counts too. Money back from them is taken off.
 */
export interface PaidTo {
  /** In the period asked about. */
  period: Cents;
  /** Ever, in these books. */
  allTime: Cents;
  /** Bank lines and other payments it came from, ever. */
  payments: number;
  /** The last of them. */
  last: IsoDate | null;
}

export function paidTo(
  name: string,
  transactions: readonly Transaction[],
  overrides: Overrides,
  invoices: readonly Invoice[],
  period: { from: IsoDate; to: IsoDate },
): PaidTo {
  const key = contactKey(name);
  const out: PaidTo = { period: 0, allTime: 0, payments: 0, last: null };
  const add = (date: IsoDate, amount: Cents): void => {
    out.allTime += amount;
    out.payments += 1;
    if (date >= period.from && date <= period.to) out.period += amount;
    if (out.last === null || date > out.last) out.last = date;
  };
  if (key === "") return out;
  for (const t of transactions) {
    const payee = overrides[t.id]?.contact ?? t.otherParty;
    if (contactKey(payee) !== key) continue;
    // Out of the account is paid to them; in from them is money back.
    add(t.date, -t.amount);
  }
  for (const bill of invoices) {
    if (bill.kind !== "purchase" || contactKey(bill.contact) !== key) continue;
    for (const p of bill.paidOutside ?? []) if (p.writeOff !== true) add(p.date, Math.abs(p.amount));
  }
  return out;
}
