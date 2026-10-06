import type { Cents } from "./money.js";
import type { IsoDate } from "./dates.js";
import { nzDate } from "./akahu.js";
import type { Transaction } from "./types.js";

/**
 * Wise, read through its own API rather than a bank feed.
 *
 * Akahu reaches the New Zealand banks and not Wise, so a Wise balance had no
 * way in except a statement downloaded by hand. Wise's API gives the same
 * statement as JSON: one entry per line, with fees on lines of their own when
 * asked for the FLAT type -- which is how an accountant wants them, a fee
 * being an expense and not part of what was bought.
 *
 * Each balance (NZD, AUD, ...) is its own bank account in these books, named
 * `wise-<currency>-<balance id>`, so a Wise number in another system's bank
 * account list can be matched to it by its digits.
 */

export interface WiseMoney {
  value?: number;
  currency?: string;
}

/** One entry of a Wise balance statement, as much of it as is read. */
export interface WiseStatementLine {
  type?: string;
  date?: string;
  amount?: WiseMoney;
  totalFees?: WiseMoney;
  details?: {
    type?: string;
    description?: string;
    senderName?: string;
    senderAccount?: string;
    paymentReference?: string;
    merchant?: { name?: string; city?: string };
    recipient?: { name?: string; bankAccount?: string };
  };
  referenceNumber?: string;
  runningBalance?: WiseMoney;
}

export interface WiseBalance {
  profileId: number | string;
  profileType: string;
  balanceId: number | string;
  currency: string;
}

/** The bank account in these books a Wise balance is. */
export function wiseAccountId(balance: Pick<WiseBalance, "balanceId" | "currency">): string {
  return `wise-${balance.currency.toUpperCase()}-${balance.balanceId}`;
}

export interface WiseImportResult {
  transactions: Transaction[];
  problems: { line: number; row: string[]; message: string }[];
}

/**
 * Turn a Wise statement into transactions.
 *
 * Signed as a bank line is: money out negative. Dated in New Zealand, as the
 * bank feed's lines are, since the statement's times are UTC. The reference
 * number is kept on the line, so the same entry fetched twice is known.
 */
export function fromWise(
  lines: readonly WiseStatementLine[],
  options: { account: string; label?: string },
): WiseImportResult {
  const transactions: Transaction[] = [];
  const problems: WiseImportResult["problems"] = [];
  lines.forEach((item, index) => {
    const line = index + 1;
    const d = item.details ?? {};
    const row = [item.date ?? "", d.description ?? "", String(item.amount?.value ?? "")];
    const date = nzDate(item.date ?? "") as IsoDate | null;
    if (date === null) {
      problems.push({ line, row, message: `unreadable date ${JSON.stringify(item.date)}` });
      return;
    }
    const value = item.amount?.value;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      problems.push({ line, row, message: `unreadable amount ${JSON.stringify(item.amount)}` });
      return;
    }
    let amount = Math.round(value * 100) as Cents;
    // A debit is money out, whichever sign the value was given.
    if ((item.type ?? "").toUpperCase() === "DEBIT" && amount > 0) amount = -amount as Cents;
    if ((item.type ?? "").toUpperCase() === "CREDIT" && amount < 0) amount = -amount as Cents;

    const who =
      d.merchant?.name ?? d.recipient?.name ?? d.senderName ?? d.description ?? "";
    transactions.push({
      id: "",
      date,
      amount,
      currency: (item.amount?.currency ?? "NZD").toUpperCase(),
      account: options.account,
      serial: "",
      trn: "",
      particulars: d.description ?? "",
      code: d.type ?? "",
      reference: d.paymentReference ?? "",
      otherParty: who,
      origin: "",
      type: d.type ?? item.type ?? "",
      batch: "",
      otherPartyAccount: d.senderAccount ?? d.recipient?.bankAccount ?? "",
      occurrence: 1,
      extras: {
        ...(item.referenceNumber ? { wiseRef: item.referenceNumber } : {}),
        ...(options.label ? { accountLabel: options.label } : {}),
      },
      source: { importer: "wise-api", file: "Wise", line },
    } as Transaction);
  });
  return { transactions, problems };
}

/**
 * The windows to ask a statement for: Wise allows at most 469 days in one.
 *
 * Whole windows of a year from `from` to `to`, both ISO timestamps, so a
 * long history is a few requests rather than a refusal.
 */
export function wiseStatementWindows(from: string, to: string, maxDays = 365): { start: string; end: string }[] {
  const out: { start: string; end: string }[] = [];
  let at = Date.parse(from);
  const stop = Date.parse(to);
  if (Number.isNaN(at) || Number.isNaN(stop) || at >= stop) return out;
  while (at < stop) {
    const next = Math.min(stop, at + maxDays * 86_400_000);
    out.push({ start: new Date(at).toISOString(), end: new Date(next - 1).toISOString() });
    at = next;
  }
  return out;
}
