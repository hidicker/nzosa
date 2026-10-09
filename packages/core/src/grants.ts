import type { Cents } from "./money.js";
import type { IsoDate } from "./dates.js";
import type { ManualJournal } from "./manual-journals.js";
import { reversalOf } from "./manual-journals.js";
import { taxWithin } from "./sales-tax.js";
import type { Transaction } from "./types.js";

/**
 * Grants: money given to an organisation for a purpose, and what became of it.
 *
 * A funder wants to know the grant was used for what it was given for, and
 * the organisation wants to know what is left. Both come from the same place:
 * the bank lines. Each grant is linked to the lines that brought it in and the
 * lines that spent it, and everything else follows -- received, spent, what
 * is left, and the report the funder asks for.
 *
 * The register is beside the books. Nothing here posts on its own: the grant
 * money is coded where it always was (to Grants, in Reconcile), and the one
 * thing the register can add to the books is the year-end entry for a grant
 * with conditions, below.
 *
 * Conditional grants. A grant that has to be given back if it is not spent
 * for its purpose is not the organisation's income until it is spent: what is
 * unspent at balance date is a liability -- "Grants received in advance" -- and
 * comes back into income as it is used. The entry moves the unspent amount
 * there on balance date and reverses the next day, so the year after finds the
 * money where it was and the spending releases it. A grant with no such
 * condition, the usual kind, is income when it arrives and needs no entry.
 * Organisations on the cash basis (Tier 4) do not make the entry at all.
 */

export interface Grant {
  id: string;
  /** The entity (organisation) the grant is to. */
  entityId: string;
  /** Who gave it. */
  funder: string;
  /** What it is for, in the funder's words where there are some. */
  purpose: string;
  /** The amount awarded. What has actually arrived is read from the linked lines. */
  amount: Cents;
  /** The period it covers, if it has one. */
  from?: IsoDate | undefined;
  to?: IsoDate | undefined;
  /** What the funder requires, in its words: the conditions, the reporting. */
  conditions?: string | undefined;
  /** The grant has to be returned if not used for its purpose. */
  conditional: boolean;
  /** When the funder wants its report, and when it was sent. */
  reportDue?: IsoDate | undefined;
  reported?: IsoDate | undefined;
  /** The grant is finished with: fully spent, reported, put away. */
  closed?: IsoDate | undefined;
}

/** Bank line id to the grant it belongs to. A line is for at most one grant. */
export type GrantLinks = Readonly<Record<string, string>>;

export interface GrantLine {
  id: string;
  date: IsoDate;
  /** Positive: what came in. Spending is shown as a positive amount spent. */
  amount: Cents;
  who: string;
  what: string;
}

export interface GrantPosition {
  grant: Grant;
  /** Linked money in, to the date. */
  received: Cents;
  /** Linked money out, to the date. */
  spent: Cents;
  /** Received less spent: what is held for the grant. Negative if more has been spent than has arrived. */
  held: Cents;
  /** Awarded and not yet received. */
  awaiting: Cents;
  receipts: GrantLine[];
  spending: GrantLine[];
}

function lineOf(t: Transaction): GrantLine {
  return {
    id: t.id,
    date: t.date,
    amount: Math.abs(t.amount) as Cents,
    who: t.otherParty.trim(),
    what: [t.particulars, t.reference].map((x) => x.trim()).filter((x) => x !== "").join(" · "),
  };
}

/** Where a grant stands on a date. Lines after the date are not counted. */
export function grantPosition(
  grant: Grant,
  links: GrantLinks,
  transactions: readonly Transaction[],
  asAt: IsoDate,
): GrantPosition {
  const receipts: GrantLine[] = [];
  const spending: GrantLine[] = [];
  for (const t of transactions) {
    if (links[t.id] !== grant.id || t.date > asAt) continue;
    (t.amount > 0 ? receipts : spending).push(lineOf(t));
  }
  const byDate = (a: GrantLine, b: GrantLine): number => a.date.localeCompare(b.date) || a.id.localeCompare(b.id);
  receipts.sort(byDate);
  spending.sort(byDate);
  const received = receipts.reduce((sum, l) => sum + l.amount, 0) as Cents;
  const spent = spending.reduce((sum, l) => sum + l.amount, 0) as Cents;
  return {
    grant,
    received,
    spent,
    held: (received - spent) as Cents,
    awaiting: Math.max(0, grant.amount - received) as Cents,
    receipts,
    spending,
  };
}

/** Whether a grant is still to be worked on: not closed. */
export function grantOpen(grant: Grant): boolean {
  return grant.closed === undefined;
}

/**
 * Grants whose report is due, and not yet sent, by a date: the funder's
 * reporting date has come within `days`, or gone.
 */
export function reportsDue(grants: readonly Grant[], asAt: IsoDate, days = 14): Grant[] {
  const limit = new Date(`${asAt}T00:00:00Z`);
  limit.setUTCDate(limit.getUTCDate() + days);
  const by = limit.toISOString().slice(0, 10);
  return grants
    .filter((g) => grantOpen(g) && g.reportDue !== undefined && g.reported === undefined && g.reportDue <= by)
    .sort((a, b) => (a.reportDue ?? "").localeCompare(b.reportDue ?? ""));
}

/** Money still unspent in a grant past the end of its period: worth a look. */
export function endedWithMoneyLeft(
  grants: readonly Grant[],
  links: GrantLinks,
  transactions: readonly Transaction[],
  asAt: IsoDate,
): GrantPosition[] {
  return grants
    .filter((g) => grantOpen(g) && g.to !== undefined && g.to < asAt)
    .map((g) => grantPosition(g, links, transactions, asAt))
    .filter((p) => p.held > 0);
}

/**
 * What a conditional grant held at a balance date that is still to be spent,
 * as an amount for the books: net of GST where the organisation is registered
 * and the grant is taxable, because the account it comes out of holds the
 * grant without the GST in it.
 */
export function unspentForBooks(position: GrantPosition, gstRegistered: boolean): Cents {
  if (!position.grant.conditional || position.held <= 0) return 0;
  const gross = position.held;
  return (gstRegistered ? gross - taxWithin(gross) : gross) as Cents;
}

/**
 * The year-end entry for a conditional grant, and its reversal the next day.
 *
 * Income is taken out and the liability put in for what is unspent on balance
 * date, so the year's income is only what was used. On the first day of the
 * next year the entry reverses, putting the whole amount back into that
 * year's income; at that year's balance date a fresh entry defers whatever is
 * still unspent. The year therefore shows what was used in it, and the
 * liability always holds what is left.
 */
export function grantYearEnd(
  grant: Grant,
  amount: Cents,
  balanceDate: IsoDate,
  accounts: { income: string; inAdvance: string },
  nextDay: IsoDate,
): [ManualJournal, ManualJournal] | null {
  if (amount <= 0) return null;
  const journal: ManualJournal = {
    id: `grant-${grant.id}-${balanceDate}`,
    date: balanceDate,
    narration: `Unspent conditional grant at ${balanceDate}: ${grant.funder}, ${grant.purpose}`,
    lines: [
      { code: accounts.income, amount: amount as Cents },
      { code: accounts.inAdvance, amount: -amount as Cents },
    ],
  };
  return [journal, reversalOf(journal, nextDay, `${journal.id}-back`)];
}

/**
 * The funder's report as rows: what was given, what it was used for, and what
 * is left -- the same rows on screen and in the file, so what is sent is what
 * was read.
 */
export function grantReportRows(position: GrantPosition, entityName: string, asAt: IsoDate): string[][] {
  const money = (cents: number): string => (cents / 100).toFixed(2);
  const { grant } = position;
  const rows: string[][] = [
    ["Grant report", entityName],
    ["Funder", grant.funder],
    ["Purpose", grant.purpose],
    ...(grant.from !== undefined || grant.to !== undefined ? [["Period", `${grant.from ?? ""} to ${grant.to ?? ""}`]] : []),
    ...(grant.conditions !== undefined && grant.conditions.trim() !== "" ? [["Conditions", grant.conditions.trim()]] : []),
    ["Report as at", asAt],
    [],
    ["Awarded", money(grant.amount)],
    ["Received", money(position.received)],
    ["Spent", money(position.spent)],
    ["Held for this grant", money(position.held)],
    [],
    ["Received", "Date", "From", "Amount"],
    ...position.receipts.map((l) => ["", l.date, l.who, money(l.amount)]),
    [],
    ["Spent", "Date", "Paid to", "What for", "Amount"],
    ...position.spending.map((l) => ["", l.date, l.who, l.what, money(l.amount)]),
    ["", "", "", "Total spent", money(position.spent)],
  ];
  return rows;
}
