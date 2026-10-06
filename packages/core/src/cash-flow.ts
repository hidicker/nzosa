import type { DateRange } from "./dates.js";
import type { Cents } from "./money.js";
import type { Transaction } from "./types.js";

/**
 * A statement of cash flows, by the direct method, from the bank lines.
 *
 * Every line on the entity's bank accounts is cash in or out, so the
 * statement is those lines grouped by what each was for -- the account it is
 * coded to -- under the three headings the standard uses:
 *
 *  * **Operating**: income and expenses, GST, money owed to and by others,
 *    income tax. What running the entity took in and paid out.
 *  * **Investing**: buying and selling fixed and other long-term assets, and
 *    money lent out.
 *  * **Financing**: borrowing and repaying loans, and the owners' money in and
 *    out -- funds introduced, drawings, shareholder current accounts.
 *
 * A transfer between two of the entity's own accounts is not cash moving at
 * all, so both legs are left out. A transfer to an account outside the set
 * -- another entity's -- is money leaving it, and is financing.
 *
 * Cash at the start is the accounts' opening balances carried to the first
 * day; at the end, that plus every line in the period. The statement adds up
 * by construction, because every line falls under exactly one heading: what
 * it can be wrong about is a line's heading, which is why lines not yet coded
 * are shown on their own rather than guessed.
 */

export type CashFlowActivity = "operating" | "investing" | "financing";

export interface CashFlowLine {
  label: string;
  amount: Cents;
}

export interface CashFlowSection {
  activity: CashFlowActivity;
  title: string;
  lines: CashFlowLine[];
  total: Cents;
}

export interface CashFlowStatement {
  period: DateRange;
  sections: CashFlowSection[];
  /** Lines on these accounts with no account yet, in operating, said apart. */
  uncoded: Cents;
  uncodedCount: number;
  netChange: Cents;
  openingCash: Cents;
  closingCash: Cents;
  /** Whether an opening balance was held for every account; otherwise cash at the start is from nothing. */
  openingKnown: boolean;
}

export interface CashFlowOptions {
  /** Every transaction, with splits already expanded into their parts. */
  transactions: readonly Transaction[];
  codeOf: (transaction: Transaction) => string | null;
  /** The account type the chart gives a code ("Revenue", "Fixed Asset", "Non-current Liability"...). */
  typeOf: (code: string) => string | null;
  /** The account's name, for classing an account whose type is too broad to say. */
  nameOf?: (code: string) => string;
  period: DateRange;
  /** The bank accounts the statement is for: one entity's, or every one. */
  banks: ReadonlySet<string>;
  /** Recorded transfers, each leg's id to the other's. */
  transfers?: Readonly<Record<string, string>>;
  /**
   * Loan accounts among the bank accounts: a home loan or term loan fed in
   * like any account, but borrowing rather than cash. Left out of cash, and
   * money moved to or from one is its repayment or drawdown -- financing.
   */
  loanAccounts?: ReadonlySet<string>;
  /** A bank account's name, for saying which loan. */
  accountName?: (account: string) => string;
  /** Bank balances at the start of the books, by bank account. */
  opening?: { asAt: string; accounts: Readonly<Record<string, Cents>> };
}

/** The heading a coded line goes under, from its account's type and name. */
export function cashFlowActivity(type: string | null, name = ""): CashFlowActivity {
  const t = (type ?? "").trim().toLowerCase();
  const n = name.toLowerCase();
  // The name first where it says more than the type: a "Loan" filed as a
  // current liability is borrowing, and "Owner Drawings" is the owner's money
  // whatever type it was given.
  if (/\bloans?\b|mortgage|borrow|hire purchase|finance lease/.test(n)) {
    return /\bloan to\b|advance to/.test(n) ? "investing" : "financing";
  }
  if (/drawings|funds introduced|capital|shareholder|current account|owner|dividends? paid/.test(n)) return "financing";
  if (/^(fixed asset|non-?current asset)$/.test(t)) return "investing";
  if (/^(non-?current liability|term liability|liability|equity|retained earnings)$/.test(t)) return "financing";
  return "operating";
}

const TITLES: Record<CashFlowActivity, string> = {
  operating: "Cash flows from operating activities",
  investing: "Cash flows from investing activities",
  financing: "Cash flows from financing activities",
};

export function cashFlowStatement(options: CashFlowOptions): CashFlowStatement {
  const loans = options.loanAccounts ?? new Set<string>();
  const { period } = options;
  const banks = new Set([...options.banks].filter((b) => !loans.has(b)));
  const transfers = options.transfers ?? {};
  const byId = new Map(options.transactions.map((t) => [t.id, t]));
  const onBanks = options.transactions.filter((t) => banks.has(t.account));

  // Cash at the start: each account's opening balance, carried forward by the
  // lines between the books' start and the period's.
  const opening = options.opening;
  let openingCash = 0;
  let openingKnown = opening !== undefined;
  for (const bank of banks) {
    const held = opening?.accounts[bank];
    if (held === undefined) openingKnown = openingKnown && !onBanks.some((t) => t.account === bank);
    openingCash += held ?? 0;
  }
  const startFrom = opening?.asAt ?? "";
  for (const t of onBanks) {
    if (t.date < period.from && t.date >= startFrom) openingCash += t.amount;
  }

  const sums = new Map<string, { activity: CashFlowActivity; amount: number }>();
  let uncoded = 0;
  let uncodedCount = 0;
  let inTransit = 0;
  let netChange = 0;
  for (const t of onBanks) {
    if (t.date < period.from || t.date > period.to) continue;
    netChange += t.amount;
    // Split parts carry an id of their own; the transfer is recorded against
    // the bank line they came from.
    const root = String(t.extras?.["splitOf"] ?? t.id);
    const partner = transfers[t.id] ?? transfers[root];
    if (partner !== undefined) {
      const other = byId.get(partner);
      // Between two of these accounts: no cash moved, and the other leg
      // cancels this one. Out to another entity's: money leaving, financing.
      if (other !== undefined && loans.has(other.account)) {
        const key = `Loan repayments and drawdowns: ${options.accountName?.(other.account) ?? other.account}`;
        const held = sums.get(key) ?? { activity: "financing" as const, amount: 0 };
        held.amount += t.amount;
        sums.set(key, held);
        continue;
      }
      if (other !== undefined && banks.has(other.account)) {
        // Unless the other leg falls outside the period -- sent on 31 March,
        // arrived on 1 April -- when this one is cash on its way.
        if (other.date < period.from || other.date > period.to) inTransit += t.amount;
        continue;
      }
      const key = "Transfers to and from other entities' accounts";
      const held = sums.get(key) ?? { activity: "financing" as const, amount: 0 };
      held.amount += t.amount;
      sums.set(key, held);
      continue;
    }
    const code = options.codeOf(t);
    if (code === null || code === "" || code === "(uncoded)") {
      uncoded += t.amount;
      uncodedCount += 1;
      continue;
    }
    const activity = cashFlowActivity(options.typeOf(code), options.nameOf?.(code) ?? code);
    const held = sums.get(code) ?? { activity, amount: 0 };
    held.amount += t.amount;
    sums.set(code, held);
  }

  if (inTransit !== 0) {
    sums.set("Transfers between these accounts, in transit at the period's edge", {
      activity: "financing",
      amount: inTransit,
    });
  }

  const sections: CashFlowSection[] = (["operating", "investing", "financing"] as const).map((activity) => {
    const lines = [...sums.entries()]
      .filter(([, v]) => v.activity === activity && v.amount !== 0)
      .map(([label, v]) => ({ label, amount: v.amount as Cents }))
      // Money in before money out, the largest first within each.
      .sort((a, b) => (b.amount > 0 ? 1 : 0) - (a.amount > 0 ? 1 : 0) || Math.abs(b.amount) - Math.abs(a.amount));
    const total = lines.reduce((s, l) => s + l.amount, 0) + (activity === "operating" ? uncoded : 0);
    return { activity, title: TITLES[activity], lines, total: total as Cents };
  });

  return {
    period,
    sections,
    uncoded: uncoded as Cents,
    uncodedCount,
    netChange: netChange as Cents,
    openingCash: openingCash as Cents,
    closingCash: (openingCash + netChange) as Cents,
    openingKnown,
  };
}
