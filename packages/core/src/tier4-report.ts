import type { Cents } from "./money.js";
import type { IsoDate } from "./dates.js";
import type { Account } from "./chart.js";
import type { OpeningBalances } from "./balance-sheet.js";
import { isGstControlCode } from "./posting.js";
import type { PostedJournal } from "./posting.js";

/**
 * The Tier 4 performance report, for a registered charity or society that
 * reports on a cash basis.
 *
 * Built from the XRB's Tier 4 (NFP) Standard, issued 18 May 2023 and required
 * for years starting on or after 1 April 2024 -- read in full from the
 * standard itself in October 2026. Four parts: Entity Information, a
 * Statement of Service Performance, a Statement of Cash Received and Cash
 * Paid in the exact layout of its Table 1, and Notes. Each page names the
 * entity and the year; amounts are whole dollars; the previous year is shown
 * beside the current for every figure; the report is signed and dated by the
 * governing body.
 *
 * The cash statement is worked out from the books' own journals: every
 * posting to a bank account (or cash on hand) is cash received or paid, and
 * what it was for is the other side of the posting. GST is reported inclusive
 * -- the amount that actually moved through the bank, as the standard says is
 * usual -- with the payments to and refunds from Inland Revenue shown
 * separately on their own line. Movements between the entity's own bank
 * accounts and term deposits are left out, because they change no cash held.
 *
 * Nothing is netted: a receipt that comes out negative (a refunded donation)
 * is shown as cash paid, and a payment that comes out positive (a refund of
 * an expense) as cash received, because the standard says cash received and
 * cash paid must not be set off against each other.
 *
 * Where the standard's guidance says to put a transaction in "other cash" when
 * it is hard to place, so do the defaults here; every account's line can be
 * changed. The standard's Entity Information, signing and notes are filled in
 * by the people who run the organisation: nothing in the books says what the
 * organisation did, or who is related to whom.
 */

export type Tier4Line =
  | "donations"
  | "generalGrants"
  | "serviceGrants"
  | "membership"
  | "sales"
  | "interest"
  | "otherReceived"
  | "fundraisingCosts"
  | "employee"
  | "volunteer"
  | "costOfSales"
  | "objectives"
  | "grantsPaid"
  | "otherPaid"
  | "gst"
  | "saleInvestments"
  | "saleAssets"
  | "loansReceived"
  | "purchaseInvestments"
  | "purchaseAssets"
  | "loansRepaid"
  | "incomeTax";

/** Table 1's line items, in its order and its words. */
export const TIER4_RECEIVED: readonly (readonly [Tier4Line, string])[] = [
  ["donations", "Donations, koha, bequests, and other fundraising"],
  ["generalGrants", "General grants received"],
  ["serviceGrants", "Service delivery grants/contracts"],
  ["membership", "Membership fees or subscriptions"],
  ["sales", "Sale of goods and services (commercial activities)"],
  ["interest", "Interest or dividends received"],
  ["otherReceived", "Other cash received"],
];

export const TIER4_PAID: readonly (readonly [Tier4Line, string])[] = [
  ["fundraisingCosts", "Fundraising costs"],
  ["employee", "Employee remuneration and other employee related costs"],
  ["volunteer", "Volunteer related costs"],
  ["costOfSales", "Costs related to sale of goods or services (commercial activities)"],
  ["objectives", "Other costs related to delivery of entity objectives"],
  ["grantsPaid", "Grants and donations paid"],
  ["otherPaid", "Other cash paid"],
];

export const TIER4_OTHER_RECEIVED: readonly (readonly [Tier4Line, string])[] = [
  ["saleInvestments", "Sale of investments"],
  ["saleAssets", "Sale of other assets"],
  ["loansReceived", "Cash received from loans and borrowings"],
];

export const TIER4_OTHER_PAID: readonly (readonly [Tier4Line, string])[] = [
  ["purchaseInvestments", "Purchase of investments"],
  ["purchaseAssets", "Purchase of other assets"],
  ["loansRepaid", "Repayment of loans and borrowings"],
];

/** Every line an account can be put under, for choosing one. */
export const TIER4_CHOICES: readonly (readonly [Tier4Line, string])[] = [
  ...TIER4_RECEIVED,
  ...TIER4_PAID,
  ["gst", "GST paid to or refunded by Inland Revenue"],
  ["purchaseAssets", "Other assets (bought or sold)"],
  ["purchaseInvestments", "Investments (bought or sold)"],
  ["loansReceived", "Loans and borrowings (received or repaid)"],
  ["incomeTax", "Income tax paid or refunded"],
];

/** The opposite line of a pair: what a payment becomes when it comes out the other way. */
const OTHER_WAY: Partial<Record<Tier4Line, Tier4Line>> = {
  purchaseAssets: "saleAssets",
  saleAssets: "purchaseAssets",
  purchaseInvestments: "saleInvestments",
  saleInvestments: "purchaseInvestments",
  loansReceived: "loansRepaid",
  loansRepaid: "loansReceived",
};

const RECEIVED_LINES = new Set<Tier4Line>(TIER4_RECEIVED.map(([k]) => k));
const PAID_LINES = new Set<Tier4Line>(TIER4_PAID.map(([k]) => k));

/**
 * The line an account usually belongs under, from its type and name.
 *
 * Read as a bookkeeper would: subscriptions are membership fees, donations
 * and fundraising are donations, anything about wages is employee costs. What
 * is not plainly any of them goes to the general lines the standard keeps for
 * the purpose -- running costs under "other costs related to delivery of
 * entity objectives", and what cannot be told under "other cash".
 */
export function defaultTier4Line(account: Pick<Account, "name" | "type">): Tier4Line {
  const name = account.name.toLowerCase();
  const type = account.type.toLowerCase();
  if (/\bgst\b/.test(type) || /\bgst\b/.test(name)) return "gst";
  if (/income tax|resident withholding|\brwt\b/.test(name)) return "incomeTax";
  if (/revenue|income|sales/.test(type) && !/expense/.test(type)) {
    if (/subscription|membership|levy|levies/.test(name)) return "membership";
    if (/service delivery|contract/.test(name)) return "serviceGrants";
    if (/grant|sponsor/.test(name)) return "generalGrants";
    if (/donation|bequest|koha|fundrais/.test(name)) return "donations";
    if (/interest|dividend/.test(name)) return "interest";
    if (/sale|trading|hire|canteen|\bbar\b|fees|programme|course/.test(name)) return "sales";
    return "otherReceived";
  }
  if (/fixed asset|non-current asset/.test(type)) return "purchaseAssets";
  if (/inventory/.test(type)) return "costOfSales";
  if (/loan|borrow|mortgage|overdraft/.test(name) || /non-current liability/.test(type)) return "loansReceived";
  if (/invest|shares|bonds|managed fund|unit trust/.test(name)) return "purchaseInvestments";
  if (/equity/.test(type)) return "otherReceived";
  if (/liability|accounts (payable|receivable)|current asset|bank/.test(type)) {
    if (/paye|kiwisaver|acc levy|wages payable|payroll/.test(name)) return "employee";
    return "otherReceived";
  }
  // Spending.
  if (/fundrais/.test(name)) return "fundraisingCosts";
  if (/salar|wage|employee|kiwisaver|\bacc\b|payroll|remuneration/.test(name)) return "employee";
  if (/volunteer/.test(name)) return "volunteer";
  if (/cost of (goods|sales)|purchases|stock for resale|cost of sale/.test(name)) return "costOfSales";
  if (/grants? (and|&) donations paid|donations? paid|grants? paid/.test(name)) return "grantsPaid";
  if (/interest|bank fee|bank charge|depreciation/.test(name)) return "otherPaid";
  return "objectives";
}

export interface CashFlows {
  lines: Record<Tier4Line, Cents>;
  /** Payments that came out of an account nobody has coded yet. */
  uncoded: { count: number; amount: Cents };
  /** Payments to or from receivables and payables: normally coded straight to what they were for. */
  clearing: number;
}

function emptyLines(): Record<Tier4Line, Cents> {
  const out = {} as Record<Tier4Line, Cents>;
  for (const [k] of [...TIER4_RECEIVED, ...TIER4_PAID, ...TIER4_OTHER_RECEIVED, ...TIER4_OTHER_PAID]) out[k] = 0;
  out.gst = 0;
  out.incomeTax = 0;
  return out;
}

export interface CashAccounts {
  /** Bank accounts (and term deposits) of this organisation, by the id the books post them under. */
  banks: readonly { id: string; label: string }[];
  /** Chart codes of cash held outside a bank: a petty cash tin. */
  cashCodes: readonly string[];
}

/** Cash received and paid between two dates, grouped by Table 1's lines. */
export function cashFlows(options: {
  journals: readonly PostedJournal[];
  chart: readonly Account[];
  accounts: CashAccounts;
  from: IsoDate;
  to: IsoDate;
  /** Account code to the line it goes under, where it is not the default. */
  mapping: Readonly<Record<string, Tier4Line>>;
}): CashFlows {
  const { journals, chart, accounts, from, to, mapping } = options;
  const cash = new Set<string>([...accounts.banks.map((b) => b.id), ...accounts.cashCodes.map((c) => c.trim())]);
  const byCode = new Map(chart.map((a) => [a.code.trim(), a]));
  const lines = emptyLines();
  let uncodedCount = 0;
  let uncoded = 0;
  let clearing = 0;

  for (const journal of journals) {
    if (journal.date < from || journal.date > to) continue;
    if (!journal.lines.some((l) => cash.has(l.accountCode.trim()))) continue;
    const others = journal.lines.filter((l) => !cash.has(l.accountCode.trim()));
    // Both sides in cash accounts: a move between the organisation's own
    // accounts, which changes no cash held.
    if (others.length === 0) continue;

    const isGst = (l: { accountCode: string }): boolean =>
      isGstControlCode(l.accountCode) || /gst/i.test(byCode.get(l.accountCode.trim())?.type ?? "");
    const gstLines = others.filter(isGst);
    const supplies = others.filter((l) => !isGst(l));
    if (supplies.length === 0) {
      // Only GST: a payment to, or refund from, Inland Revenue.
      // A debit to the GST account is money paid to Inland Revenue; a credit, a refund.
      const paid = gstLines.reduce((sum, l) => sum + l.amount, 0);
      lines.gst = (lines.gst + paid) as Cents;
      continue;
    }
    // GST inside a supply is part of what moved through the bank, so it is
    // reported with the supply it belongs to: folded into the largest.
    const folded = gstLines.reduce((sum, l) => sum + l.amount, 0);
    const biggest = supplies.reduce((best, l) => (Math.abs(l.amount) > Math.abs(best.amount) ? l : best), supplies[0]!);
    for (const line of supplies) {
      const amount = line.amount + (line === biggest ? folded : 0);
      const received = -amount; // a credit is money in
      const account = byCode.get(line.accountCode.trim());
      const home: Tier4Line =
        mapping[line.accountCode.trim()] ??
        (account !== undefined ? defaultTier4Line(account) : "otherReceived");
      if (account !== undefined && /accounts (receivable|payable)/i.test(`${account.type} ${account.name}`)) clearing += 1;
      if (account !== undefined && /suspense|uncoded|unreconciled|unallocated/i.test(account.name)) {
        uncodedCount += 1;
        uncoded = (uncoded + received) as Cents;
      }
      let target: Tier4Line;
      if (home === "gst" || home === "incomeTax") {
        // Paid is positive on these two lines.
        lines[home] = (lines[home] - received) as Cents;
        continue;
      }
      if (RECEIVED_LINES.has(home)) target = received >= 0 ? home : "otherPaid";
      else if (PAID_LINES.has(home)) target = received <= 0 ? home : "otherReceived";
      else {
        // A pair (assets, investments, loans): bought or sold, borrowed or repaid, by which way it went.
        const pairIn = home === "purchaseAssets" ? "saleAssets" : home === "purchaseInvestments" ? "saleInvestments" : home === "loansReceived" ? "loansReceived" : home;
        const pairOut = home === "purchaseAssets" ? "purchaseAssets" : home === "purchaseInvestments" ? "purchaseInvestments" : home === "loansReceived" ? "loansRepaid" : OTHER_WAY[home] ?? home;
        target = received >= 0 ? pairIn : pairOut;
      }
      const amountIn = Math.abs(received) as Cents;
      lines[target] = (lines[target] + amountIn) as Cents;
    }
  }
  return { lines, uncoded: { count: uncodedCount, amount: uncoded as Cents }, clearing };
}

function dayBefore(date: IsoDate): IsoDate {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * The position the books started from, nearest before a day: balances at the
 * close of a date, and that date.
 *
 * Opening balances are dated the day the books take over, and mean the
 * position at the start of that day -- the close of the day before. A set of
 * year-end balances (`byDate`) is the close of its own date. The latest of
 * these on or before the day asked about is where counting starts; before the
 * books began nothing is known, and nothing is claimed.
 */
function startingPoint(
  opening: OpeningBalances | undefined,
  on: IsoDate,
): { date: IsoDate; balances: Readonly<Record<string, Cents>> } | null {
  if (opening === undefined) return { date: "0000-00-00", balances: {} };
  const points: { date: IsoDate; balances: Readonly<Record<string, Cents>> }[] = [
    { date: dayBefore(opening.asAt), balances: opening.accounts },
    ...Object.entries(opening.byDate ?? {}).map(([date, balances]) => ({ date, balances })),
  ];
  const usable = points.filter((p) => p.date <= on).sort((a, b) => b.date.localeCompare(a.date));
  return usable[0] ?? null;
}

/** What cash the organisation held at the close of a day: the starting position, then the postings since. */
export function cashHeld(options: {
  journals: readonly PostedJournal[];
  accounts: CashAccounts;
  opening?: OpeningBalances | undefined;
  on: IsoDate;
}): { bank: Cents; termDeposits: Cents; cash: Cents } {
  const { journals, accounts, opening, on } = options;
  const start = startingPoint(opening, on);
  if (start === null) return { bank: 0, termDeposits: 0, cash: 0 };
  const held = (key: string): Cents => {
    let sum = (start.balances[key] ?? 0) as number;
    for (const j of journals) {
      if (j.date > on || j.date <= start.date) continue;
      for (const l of j.lines) if (l.accountCode.trim() === key) sum += l.amount;
    }
    return sum as Cents;
  };
  let bank = 0;
  let termDeposits = 0;
  for (const b of accounts.banks) {
    const amount = held(b.id);
    if (/term deposit/i.test(b.label)) termDeposits += amount;
    else bank += amount;
  }
  const cash = accounts.cashCodes.reduce((sum, code) => sum + held(code.trim()), 0);
  return { bank: bank as Cents, termDeposits: termDeposits as Cents, cash: cash as Cents };
}

export interface CashStatement {
  year: number;
  from: IsoDate;
  to: IsoDate;
  /** Whole dollars, as the standard asks. */
  dollars: {
    opening: number;
    lines: Record<Tier4Line, number>;
    receivedTotal: number;
    paidTotal: number;
    operatingSurplus: number;
    otherReceivedTotal: number;
    otherPaidTotal: number;
    otherSurplus: number;
    increase: number;
    closing: number;
    bank: number;
    termDeposits: number;
    cash: number;
    held: number;
  };
  /**
   * Whether the statement agrees with the cash the books hold at the end of
   * the year, to within rounding. A year that began before the books did has
   * no postings to build a statement from, and does not.
   */
  reconciles: boolean;
  /** In cents, to check the statement against the cash the books say is held. */
  closingCents: Cents;
  movementCents: Cents;
  uncoded: { count: number; amount: Cents };
  clearing: number;
}

const dollar = (cents: number): number => Math.round(cents / 100);

/** The statement for one year, in Table 1's order, every total built from the rounded lines above it. */
export function cashStatement(options: {
  journals: readonly PostedJournal[];
  chart: readonly Account[];
  accounts: CashAccounts;
  opening?: OpeningBalances | undefined;
  year: number;
  from: IsoDate;
  to: IsoDate;
  mapping: Readonly<Record<string, Tier4Line>>;
}): CashStatement {
  const flows = cashFlows({
    journals: options.journals,
    chart: options.chart,
    accounts: options.accounts,
    from: options.from,
    to: options.to,
    mapping: options.mapping,
  });
  const before = cashHeld({ ...options, on: dayBefore(options.from) });
  const after = cashHeld({ ...options, on: options.to });
  const lines = {} as Record<Tier4Line, number>;
  for (const key of Object.keys(flows.lines) as Tier4Line[]) lines[key] = dollar(flows.lines[key]);
  const sum = (list: readonly (readonly [Tier4Line, string])[]): number => list.reduce((s, [k]) => s + lines[k], 0);
  const receivedTotal = sum(TIER4_RECEIVED);
  const paidTotal = sum(TIER4_PAID);
  const operatingSurplus = receivedTotal - paidTotal - lines.gst;
  const otherReceivedTotal = sum(TIER4_OTHER_RECEIVED);
  const otherPaidTotal = sum(TIER4_OTHER_PAID);
  const otherSurplus = otherReceivedTotal - otherPaidTotal;
  const increase = operatingSurplus + otherSurplus - lines.incomeTax;
  const opening = dollar(before.bank + before.termDeposits + before.cash);
  const bank = dollar(after.bank);
  const termDeposits = dollar(after.termDeposits);
  const cash = dollar(after.cash);
  const movement =
    Object.values(flows.lines).length === 0
      ? 0
      : (sumCents(flows.lines, [...TIER4_RECEIVED, ...TIER4_OTHER_RECEIVED].map(([k]) => k)) -
          sumCents(flows.lines, [...TIER4_PAID, ...TIER4_OTHER_PAID].map(([k]) => k)) -
          flows.lines.gst -
          flows.lines.incomeTax);
  return {
    year: options.year,
    from: options.from,
    to: options.to,
    dollars: {
      opening,
      lines,
      receivedTotal,
      paidTotal,
      operatingSurplus,
      otherReceivedTotal,
      otherPaidTotal,
      otherSurplus,
      increase,
      closing: opening + increase,
      bank,
      termDeposits,
      cash,
      held: bank + termDeposits + cash,
    },
    reconciles: Math.abs((after.bank + after.termDeposits + after.cash) - (opening + increase) * 100) <= 200,
    closingCents: (after.bank + after.termDeposits + after.cash) as Cents,
    movementCents: movement as Cents,
    uncoded: flows.uncoded,
    clearing: flows.clearing,
  };
}

function sumCents(lines: Record<Tier4Line, Cents>, keys: readonly Tier4Line[]): number {
  return keys.reduce((s, k) => s + lines[k], 0);
}

// -- The report itself ---------------------------------------------------------

/** What the people who run the organisation have to say, by year. */
export interface PerformanceInputs {
  /** Other names it trades under, for Entity Information. */
  tradingNames?: string | undefined;
  /** The main activities, and how much of each: the Statement of Service Performance. */
  activities: { what: string; howMuch: string }[];
  /** Significant assets held at year end, in cents (Table 2); and where a value estimate came from. */
  assets?: { land?: Cents; vehicles?: Cents; investments?: Cents; loansOut?: Cents; source?: string } | undefined;
  /** Significant liabilities owed at year end (Table 3). */
  liabilities?: { loans?: Cents; borrowed?: Cents; heldForOthers?: Cents } | undefined;
  relatedParties: { relationship: string; what: string; amount: Cents }[];
  /** Amounts owed to or by related parties at year end, in words. */
  relatedBalances?: string | undefined;
  /** Errors in last year's report that have been corrected. */
  errors?: string | undefined;
  /** Optional: events after year end; grants with expectations over their use. */
  eventsAfter?: string | undefined;
  grantsWithExpectations?: string | undefined;
  /**
   * Last year's figures, in whole dollars, for when these books cannot work
   * them out -- they began after last year did, as books moved from another
   * system do. Taken from last year's report: the standard wants every figure
   * shown beside the one before it.
   */
  previousFigures?: PreviousFigures | undefined;
  /** The date the report was approved and by whom. */
  approvedOn?: IsoDate | undefined;
  approvedBy: string[];
}

/** Last year's Table 1, as printed in last year's report. */
export type PreviousFigures = Partial<Record<Tier4Line, number>> & {
  opening?: number;
  bank?: number;
  termDeposits?: number;
  cash?: number;
};

/**
 * A year's statement from figures typed in, built with the same totals as one
 * worked out from the books, so the two columns add up the same way.
 */
export function statementFromFigures(year: number, from: IsoDate, to: IsoDate, figures: PreviousFigures): CashStatement {
  const lines = emptyLines() as unknown as Record<Tier4Line, number>;
  for (const key of Object.keys(lines) as Tier4Line[]) lines[key] = figures[key] ?? 0;
  const sum = (list: readonly (readonly [Tier4Line, string])[]): number => list.reduce((s, [k]) => s + lines[k], 0);
  const receivedTotal = sum(TIER4_RECEIVED);
  const paidTotal = sum(TIER4_PAID);
  const operatingSurplus = receivedTotal - paidTotal - lines.gst;
  const otherReceivedTotal = sum(TIER4_OTHER_RECEIVED);
  const otherPaidTotal = sum(TIER4_OTHER_PAID);
  const otherSurplus = otherReceivedTotal - otherPaidTotal;
  const increase = operatingSurplus + otherSurplus - lines.incomeTax;
  const opening = figures.opening ?? 0;
  const bank = figures.bank ?? 0;
  const termDeposits = figures.termDeposits ?? 0;
  const cash = figures.cash ?? 0;
  return {
    year,
    from,
    to,
    dollars: {
      opening, lines, receivedTotal, paidTotal, operatingSurplus, otherReceivedTotal, otherPaidTotal,
      otherSurplus, increase, closing: opening + increase, bank, termDeposits, cash, held: bank + termDeposits + cash,
    },
    reconciles: true,
    closingCents: 0 as Cents,
    movementCents: 0 as Cents,
    uncoded: { count: 0, amount: 0 as Cents },
    clearing: 0,
  };
}

export function emptyInputs(): PerformanceInputs {
  return { activities: [], relatedParties: [], approvedBy: [] };
}

/** What a report still lacks that the standard requires, in words to act on. */
export function reportProblems(options: {
  entity: { name: string; legalForm: string };
  inputs: PerformanceInputs;
  statement: CashStatement;
  previous: CashStatement;
}): string[] {
  const out: string[] = [];
  const { inputs, statement } = options;
  if (inputs.activities.filter((a) => a.what.trim() !== "").length === 0) {
    out.push("Describe the main activities in the Statement of Service Performance, and quantify them as far as you can.");
  }
  if (inputs.approvedOn === undefined || inputs.approvedBy.filter((n) => n.trim() !== "").length === 0) {
    out.push("Say who approved the report and on what date: the committee or trustees must sign and date it.");
  }
  if (statement.uncoded.count > 0) {
    out.push(`${statement.uncoded.count} payment${statement.uncoded.count === 1 ? " is" : "s are"} not coded yet, so are in "other cash". Code them in Reconcile first.`);
  }
  const gap = Math.abs(statement.closingCents - (statement.dollars.opening + statement.dollars.increase) * 100);
  if (gap > 200) {
    out.push(
      `The statement's closing cash is $${(statement.dollars.closing).toLocaleString("en-NZ")} but the books hold ` +
        `$${dollar(statement.closingCents).toLocaleString("en-NZ")}. Something in the bank accounts is not in the statement: check the accounts the organisation uses.`,
    );
  }
  // Last year's closing cash is this year's opening cash, and each year's
  // closing figure is the cash it says is held: figures typed in from last
  // year's report are checked the same way as the rest.
  const last = options.previous.dollars;
  const lastUsed = last.held !== 0 || last.opening !== 0 || last.receivedTotal !== 0 || last.paidTotal !== 0;
  if (lastUsed && Math.abs(last.closing - statement.dollars.opening) > 1) {
    out.push(
      `Last year's closing balance ($${last.closing.toLocaleString("en-NZ")}) should be this year's opening balance ` +
        `($${statement.dollars.opening.toLocaleString("en-NZ")}). Check last year's figures.`,
    );
  }
  if (lastUsed && last.held !== 0 && Math.abs(last.closing - last.held) > 1) {
    out.push(
      `Last year's figures do not add up: opening cash and the year's movement come to $${last.closing.toLocaleString("en-NZ")}, ` +
        `but the cash held is shown as $${last.held.toLocaleString("en-NZ")}.`,
    );
  }
  if (statement.clearing > 0) {
    out.push("Some payments settle invoices or bills. On a cash basis they belong under what they were for, so they are in \"other cash\": code them to the account they were for.");
  }
  return out;
}

function escape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const money = (n: number): string => (n < 0 ? `(${Math.abs(n).toLocaleString("en-NZ")})` : n.toLocaleString("en-NZ"));

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function dateSaid(date: IsoDate): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return `${d} ${MONTHS[m - 1] ?? ""} ${y}`;
}

/**
 * The report as a page to print or save as a PDF, in the standard's order.
 * Every page names the entity and the year (paragraph 20), and every figure
 * has the previous year beside it (paragraph 23).
 */
export function performanceReportHtml(options: {
  entity: { name: string; legalForm: string; address?: string | undefined };
  gstRegistered: boolean;
  statement: CashStatement;
  previous: CashStatement;
  inputs: PerformanceInputs;
  previousInputs?: PerformanceInputs | undefined;
}): string {
  const { entity, statement: cur, previous: prev, inputs } = options;
  const year = `Year ended ${dateSaid(cur.to)}`;
  const head = `<p class="running">${escape(entity.name)} &middot; ${escape(year)}</p>`;
  const col = (current: number, previous: number): string => `<td class="n">${money(current)}</td><td class="n">${money(previous)}</td>`;
  const row = (label: string, current: number, previous: number, cls = ""): string =>
    `<tr class="${cls}"><td>${escape(label)}</td>${col(current, previous)}</tr>`;
  const optional = (
    list: readonly (readonly [Tier4Line, string])[],
  ): string =>
    list
      .filter(([k]) => cur.dollars.lines[k] !== 0 || prev.dollars.lines[k] !== 0)
      .map(([k, label]) => row(label, cur.dollars.lines[k], prev.dollars.lines[k], "indent"))
      .join("");

  const c = cur.dollars;
  const p = prev.dollars;
  const cash = `
<table>
<thead><tr><th></th><th class="n">${cur.year}<br>$</th><th class="n">${prev.year}<br>$</th></tr></thead>
<tbody>
${row("Opening balance in bank account(s) and any cash on hand", c.opening, p.opening, "strong")}
<tr class="head"><td colspan="3">Operating activities</td></tr>
<tr class="sub"><td colspan="3">Plus: Cash received from operating activities</td></tr>
${optional(TIER4_RECEIVED)}
${row("Total cash received from operating activities", c.receivedTotal, p.receivedTotal, "strong")}
<tr class="sub"><td colspan="3">Less: Cash paid for operating activities</td></tr>
${optional(TIER4_PAID)}
${row("Total cash paid for operating activities", c.paidTotal, p.paidTotal, "strong")}
${row("Total GST paid or refunded in the financial year", c.lines.gst, p.lines.gst)}
${row("Cash surplus or (deficit) from operating activities", c.operatingSurplus, p.operatingSurplus, "strong")}
<tr class="head"><td colspan="3">Other activities</td></tr>
<tr class="sub"><td colspan="3">Plus: Cash received from other activities</td></tr>
${optional(TIER4_OTHER_RECEIVED)}
${row("Total cash received from other activities", c.otherReceivedTotal, p.otherReceivedTotal, "strong")}
<tr class="sub"><td colspan="3">Less: Cash paid for other activities</td></tr>
${optional(TIER4_OTHER_PAID)}
${row("Total cash paid for other activities", c.otherPaidTotal, p.otherPaidTotal, "strong")}
${row("Cash surplus or (deficit) from other activities", c.otherSurplus, p.otherSurplus, "strong")}
${c.lines.incomeTax !== 0 || p.lines.incomeTax !== 0 ? row("Income tax paid or refunded", c.lines.incomeTax, p.lines.incomeTax) : ""}
${row("Increase or (decrease) in cash for the financial year", c.increase, p.increase, "strong")}
${row("Closing balance in bank account(s) and any cash on hand", c.closing, p.closing, "strong")}
<tr class="sub"><td colspan="3">Represented by:</td></tr>
${row("Closing balance of bank account(s)", c.bank, p.bank, "indent")}
${c.termDeposits !== 0 || p.termDeposits !== 0 ? row("Balance invested in term deposit(s)", c.termDeposits, p.termDeposits, "indent") : ""}
${c.cash !== 0 || p.cash !== 0 ? row("Undeposited cash held by the entity", c.cash, p.cash, "indent") : ""}
${row("Total cash balances held", c.held, p.held, "strong")}
</tbody>
</table>`;

  const activities = inputs.activities.filter((a) => a.what.trim() !== "");
  const service =
    activities.length === 0
      ? "<p><em>Not yet written.</em></p>"
      : `<table><thead><tr><th>What we did</th><th>How much</th></tr></thead><tbody>${activities
          .map((a) => `<tr><td>${escape(a.what)}</td><td>${escape(a.howMuch)}</td></tr>`)
          .join("")}</tbody></table>`;

  const rowsOf = (items: readonly (readonly [string, number | undefined, number | undefined])[]): string =>
    items
      .filter(([, a, b]) => (a ?? 0) !== 0 || (b ?? 0) !== 0)
      .map(([label, a, b]) => row(label, dollar(a ?? 0), dollar(b ?? 0)))
      .join("");
  const a = inputs.assets;
  const pa = options.previousInputs?.assets;
  const assetRows = rowsOf([
    ["Land and buildings", a?.land, pa?.land],
    ["Vehicles", a?.vehicles, pa?.vehicles],
    ["Investments (shares, bonds, units in managed funds)", a?.investments, pa?.investments],
    ["Amounts loaned to other organisations or persons", a?.loansOut, pa?.loansOut],
  ]);
  const l = inputs.liabilities;
  const pl = options.previousInputs?.liabilities;
  const liabilityRows = rowsOf([
    ["Loans and other borrowings", l?.loans, pl?.loans],
    ["Amounts borrowed from other organisations or persons", l?.borrowed, pl?.borrowed],
    ["Money held on behalf of others", l?.heldForOthers, pl?.heldForOthers],
  ]);
  const table = (rows: string): string =>
    `<table><thead><tr><th></th><th class="n">${cur.year}<br>$</th><th class="n">${prev.year}<br>$</th></tr></thead><tbody>${rows}</tbody></table>`;

  const related = inputs.relatedParties.filter((r) => r.relationship.trim() !== "" || r.what.trim() !== "");
  const gstNote = options.gstRegistered
    ? "All amounts recorded in the Performance Report are inclusive of GST (if any). The entity is GST registered and any GST payable to, or refunded by, the IRD is recognised when paid or when a refund is received."
    : "The entity is not registered for GST and all amounts are recorded inclusive of GST (if any).";

  const approvers = inputs.approvedBy.filter((n) => n.trim() !== "");
  return `<!doctype html>
<html lang="en-NZ">
<head>
<meta charset="utf-8">
<title>${escape(entity.name)} performance report, ${escape(year)}</title>
<style>
  body { font-family: Georgia, "Times New Roman", serif; max-width: 46rem; margin: 2rem auto; padding: 0 1rem; color: #111; }
  section { page-break-after: always; margin-bottom: 3rem; }
  section:last-child { page-break-after: auto; }
  .running { font-family: sans-serif; font-size: 0.8rem; color: #444; border-bottom: 1px solid #999; padding-bottom: 0.3rem; margin: 0 0 1.2rem; }
  h1 { font-size: 1.5rem; margin: 0 0 0.3rem; }
  h2 { font-size: 1.2rem; margin: 0 0 0.8rem; }
  h3 { font-size: 1rem; margin: 1.4rem 0 0.4rem; }
  table { width: 100%; border-collapse: collapse; margin: 0.4rem 0 1rem; font-size: 0.92rem; }
  th { text-align: left; border-bottom: 1px solid #111; padding: 0.25rem 0.3rem; }
  td { padding: 0.2rem 0.3rem; vertical-align: top; }
  .n { text-align: right; width: 6rem; font-variant-numeric: tabular-nums; }
  th.n { text-align: right; }
  tr.strong td { font-weight: 700; border-top: 1px solid #bbb; }
  tr.head td { font-weight: 700; padding-top: 0.8rem; text-transform: uppercase; font-size: 0.8rem; letter-spacing: 0.05em; }
  tr.sub td { font-style: italic; padding-top: 0.4rem; }
  tr.indent td:first-child { padding-left: 1.4rem; }
  .sign { margin-top: 2.5rem; }
  .line { border-top: 1px solid #111; width: 16rem; margin: 2.2rem 0 0.2rem; }
  .small { font-size: 0.85rem; color: #333; }
</style>
</head>
<body>
<section>
${head}
<h1>${escape(entity.name)}</h1>
<h2>Performance Report</h2>
<p>${escape(year)}</p>
<h3>Entity Information</h3>
<table><tbody>
<tr><td>Name</td><td>${escape(entity.name)}</td></tr>
${(inputs.tradingNames ?? "").trim() !== "" ? `<tr><td>Also trading as</td><td>${escape((inputs.tradingNames ?? "").trim())}</td></tr>` : ""}
<tr><td>Type of entity</td><td>${escape(entity.legalForm)}</td></tr>
</tbody></table>
<h3>Statement of Service Performance</h3>
${service}
</section>
<section>
${head}
<h2>Statement of Cash Received and Cash Paid</h2>
${cash}
</section>
<section>
${head}
<h2>Notes to the Performance Report</h2>
<h3>Basis of preparation</h3>
<p>${escape(entity.name)} has prepared the Performance Report in accordance with the Tier 4 (NFP) Standard issued by the External Reporting Board (XRB). It is permitted by its governing legislation to apply the Tier 4 (NFP) Standard and has elected to do so. All transactions included in the Statement of Cash Received and Cash Paid and related notes have been reported on a cash basis.</p>
<h3>Goods and Services Tax (GST)</h3>
<p>${escape(gstNote)}</p>
<h3>Significant assets</h3>
${assetRows !== "" ? table(assetRows) : "<p>The organisation holds no significant assets of the kinds the standard lists.</p>"}
${(a?.source ?? "").trim() !== "" ? `<p class="small">Where a current value is estimated, the source: ${escape((a?.source ?? "").trim())}</p>` : ""}
<h3>Significant liabilities</h3>
${liabilityRows !== "" ? table(liabilityRows) : "<p>The organisation owes no significant liabilities of the kinds the standard lists.</p>"}
<h3>Related party transactions</h3>
${
  related.length === 0
    ? "<p>There were no significant related party transactions in the year.</p>"
    : `<table><thead><tr><th>Relationship</th><th>Transaction</th><th class="n">$</th></tr></thead><tbody>${related
        .map((r) => `<tr><td>${escape(r.relationship)}</td><td>${escape(r.what)}</td><td class="n">${money(dollar(r.amount))}</td></tr>`)
        .join("")}</tbody></table>`
}
${(inputs.relatedBalances ?? "").trim() !== "" ? `<p>${escape((inputs.relatedBalances ?? "").trim())}</p>` : ""}
<h3>Correction of errors</h3>
<p>${(inputs.errors ?? "").trim() !== "" ? escape((inputs.errors ?? "").trim()) : "There were no errors in the previous year's report that have been corrected in this one."}</p>
${(inputs.eventsAfter ?? "").trim() !== "" ? `<h3>Events after the financial year end</h3><p>${escape((inputs.eventsAfter ?? "").trim())}</p>` : ""}
${(inputs.grantsWithExpectations ?? "").trim() !== "" ? `<h3>Grants or donations received with expectations over use</h3><p>${escape((inputs.grantsWithExpectations ?? "").trim())}</p>` : ""}
<div class="sign">
<h3>Approval</h3>
<p>This Performance Report was approved by the ${escape(entity.name)} governing body${inputs.approvedOn !== undefined ? ` on ${escape(dateSaid(inputs.approvedOn))}` : ""}.</p>
${(approvers.length === 0 ? ["", ""] : approvers).map((n) => `<div class="line"></div><div>${escape(n)}</div>`).join("")}
</div>
</section>
</body>
</html>
`;
}
