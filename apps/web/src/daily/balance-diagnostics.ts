import { yearEndFigure } from "../modules.js";
import type { BalanceSection, Cents, IsoDate, Transaction } from "@nzosa/core";
import { dayBefore, matchBalanceAccount } from "@nzosa/core";
import { state } from "../state.js";
import { dollars } from "../ui.js";
import { booksStartDate } from "../migrate/onboarding-state.js";

/**
 * The day these books start: the opening balances' date, or failing that the
 * earliest transaction, or the start the guided set-up was given.
 */
export function booksStart(
  openingHeld: typeof state.ledger.openingBalances,
  transactions: readonly Transaction[],
): IsoDate {
  if (openingHeld?.asAt) return openingHeld.asAt;
  const first = transactions.reduce<string | null>((min, t) => (min === null || t.date < min ? t.date : min), null);
  return (first ?? booksStartDate()) as IsoDate;
}

/**
 * A bank account's balance at the start of the books: a year-end figure for
 * the day before where one was loaded, otherwise the opening balance.
 */
export function openingFor(
  openingHeld: typeof state.ledger.openingBalances,
  account: string,
  start: IsoDate,
): Cents {
  return openingHeld?.byDate?.[dayBefore(start)]?.[account] ?? openingHeld?.accounts?.[account] ?? 0;
}

export interface YearEndCheck {
  date: IsoDate;
  bankClosing: Cents;
  ledgerRunning: Cents;
  difference: Cents;
  agrees: boolean;
}

export interface PendingChargeMatch {
  date: IsoDate;
  amount: Cents;
  payee: string;
  matchedTxId: string;
  explanation: string;
}

export interface BalanceDiagnostic {
  accountId: string;
  accountLabel: string;
  isCreditCard: boolean;

  // 31 March Annual Balance Date milestones
  yearEnds: YearEndCheck[];
  allYearEndsAgree: boolean;

  // Latest statement date analysis
  latestStatementDate: IsoDate | null;
  latestBankClosing: Cents | null;
  latestLedgerRunning: Cents | null;
  latestDifference: Cents; // bankClosing - ledgerRunning

  // Pending charges detected at edge of statement
  pendingCharges: PendingChargeMatch[];

  // Self-resolved transient clearance lags (e.g. card authorization lag)
  transientTimingCount: number;

  // Overall evaluation
  urgency: "green" | "amber" | "red";
  actionDetail: string;
  uiBadge: string;
}

/**
 * Perform intelligent diagnosis on a bank account's daily balances and transactions.
 * Differentiates between critical annual milestones (31 March / 1 April),
 * pending charges at the latest statement edge, and transient clearance lags.
 */
export function diagnoseAccountDailyBalances(
  section: BalanceSection,
  transactions: readonly Transaction[],
  openingHeld?: typeof state.ledger.openingBalances,
): BalanceDiagnostic | null {
  const accounts = [...new Set(transactions.map((t) => t.account))];
  const matched = matchBalanceAccount(section, accounts) || section.account;
  const label = section.label || matched;
  const isCreditCard = /visa|card|mastercard/i.test(`${matched} ${label}`);
  const start = booksStart(openingHeld, transactions);
  // Lines before the start are outside the balance sheet, so outside this too.
  const ourTxs = transactions
    .filter((x) => x.account === matched && x.date >= start)
    .sort((a, b) => a.date.localeCompare(b.date));

  const sortedDays = [...section.days].sort((a, b) => a.date.localeCompare(b.date));
  if (sortedDays.length === 0) return null;

  const openingBal = openingFor(openingHeld, matched, start);

  // Only the days from when these books start.
  const validDays = sortedDays.filter((d) => d.date >= start);
  if (validDays.length === 0) return null;

  let running = openingBal;
  let txIdx = 0;
  const yearEnds: YearEndCheck[] = [];
  const latestDay = validDays[validDays.length - 1]!;
  let latestDiff: Cents = 0;
  let latestRunning: Cents = 0;
  let transientTimingCount = 0;
  let priorDiff: Cents | null = null;

  for (const day of validDays) {
    while (txIdx < ourTxs.length && ourTxs[txIdx]!.date <= day.date) {
      running += ourTxs[txIdx]!.amount;
      txIdx++;
    }
    const diff = day.closing - running;

    // Check if this is an annual balance date (31 March)
    if (day.date.endsWith("-03-31")) {
      yearEnds.push({
        date: day.date,
        bankClosing: day.closing,
        ledgerRunning: running,
        difference: diff,
        agrees: diff === 0,
      });
    }

    if (day.date === latestDay.date) {
      latestDiff = diff;
      latestRunning = running;
    }

    if (priorDiff !== null && diff !== priorDiff) {
      // If diff changed and later reverted or fluctuates, it's transient timing
      transientTimingCount++;
    }
    priorDiff = diff;
  }

  // A charge in the last week before the latest statement day, for exactly
  // the difference, is likely one the bank has not cleared yet.
  const pendingCharges: PendingChargeMatch[] = [];
  if (latestDiff !== 0) {
    let weekBefore = latestDay.date;
    for (let i = 0; i < 7; i++) weekBefore = dayBefore(weekBefore);
    const edgeTxs = ourTxs.filter((x) => x.date >= weekBefore && x.date <= latestDay.date);
    for (const tx of edgeTxs) {
      if (Math.abs(tx.amount) === Math.abs(latestDiff)) {
        const payee = tx.otherParty || tx.particulars || "Transaction";
        pendingCharges.push({
          date: tx.date,
          amount: Math.abs(tx.amount),
          payee,
          matchedTxId: tx.id,
          explanation: `Payment of ${dollars(Math.abs(tx.amount))} to ${payee} on ${tx.date}, not yet cleared by the bank.`,
        });
        break;
      }
    }
  }

  // Only true where there is a year end to agree: none checked is not "agrees".
  const allYearEndsAgree = yearEnds.length > 0 && yearEnds.every((y) => y.agrees);
  const yearEndOff = yearEnds.some((y) => !y.agrees);
  let urgency: "green" | "amber" | "red" = "green";
  let actionDetail = "";
  let uiBadge = "";

  if (yearEndOff) {
    urgency = "red";
    const failed = yearEnds.filter((y) => !y.agrees).map((y) => y.date).join(", ");
    actionDetail = `${label} does not agree with the bank at the year end (${failed}).`;
    uiBadge = `Out at ${failed}`;
  } else if (latestDiff !== 0) {
    if (pendingCharges.length > 0) {
      urgency = "amber";
      const p = pendingCharges[0]!;
      actionDetail =
        `${label} is ${dollars(latestDiff)} different on ${latestDay.date}, the amount of a payment ` +
        `to ${p.payee} on ${p.date} the bank may not have cleared yet.` +
        (allYearEndsAgree ? " The year-end balance agrees." : "");
      uiBadge = `Not yet cleared: ${dollars(p.amount)}`;
    } else {
      urgency = "red";
      actionDetail = `${label} is ${dollars(latestDiff)} out on ${latestDay.date}.`;
      uiBadge = `Out by ${dollars(latestDiff)}`;
    }
  } else {
    urgency = "green";
    actionDetail = `${label} agrees with the bank statement.`;
    uiBadge = "Agrees";
  }

  return {
    accountId: matched,
    accountLabel: label,
    isCreditCard,
    yearEnds,
    allYearEndsAgree,
    latestStatementDate: latestDay.date,
    latestBankClosing: latestDay.closing,
    latestLedgerRunning: latestRunning,
    latestDifference: latestDiff,
    pendingCharges,
    transientTimingCount,
    urgency,
    actionDetail,
    uiBadge,
  };
}

/** Run diagnosis across all accounts with daily balances in the current ledger. */
export function diagnoseAllBankBalances(): BalanceDiagnostic[] {
  const kept = state.ledger.dailyBalances ?? [];
  const txs = state.ledger.transactions;
  const ob = state.ledger.openingBalances;
  const results: BalanceDiagnostic[] = [];

  for (const section of kept) {
    const diag = diagnoseAccountDailyBalances(section, txs, ob);
    if (diag !== null) results.push(diag);
  }

  return results;
}

import { showPage } from "../app.js";
import { getReconcileAccounts, setActiveReconcileAccount } from "./bank-reconcile-report.js";
import { lastFeedStatus } from "../feed-route.js";

/** Navigate directly to the Bank Transactions Reconciliation report for an account. */
export function openBankReconcileReport(accountId?: string): void {
  if (accountId) {
    setActiveReconcileAccount(accountId);
  }
  const sel = document.getElementById("report-kind") as HTMLSelectElement | null;
  if (sel) {
    sel.value = "bankreconcile";
    sel.dispatchEvent(new Event("change"));
  }
  showPage("reports");
}

export interface FinancialYearMilestone {
  year: number;
  closeDate: IsoDate;
  openDate: IsoDate;
  accountId: string;
  accountLabel: string;
  ledgerBalance: Cents;
  xeroBalance: Cents | null;
  akahuBalance: Cents | null;
  /** Whether there was anything to compare the ledger with. */
  compared: boolean;
  /** True only where something was compared and every figure agrees. */
  agrees: boolean;
  notes: string;
}

/**
 * Each bank account's 31 March balance, from the day before the books start
 * to the latest transaction, against the year-end figures loaded from Xero
 * and the bank feed's balance worked back.
 */
export function checkFinancialYearMilestones(): FinancialYearMilestone[] {
  const openingHeld = state.ledger.openingBalances;
  const txs = state.ledger.transactions;
  const accounts = getReconcileAccounts();
  const feed = lastFeedStatus();
  const milestones: FinancialYearMilestone[] = [];

  const start = booksStart(openingHeld, txs);
  const before = dayBefore(start);
  const last = txs.reduce((max, t) => (t.date > max ? t.date : max), before);

  // Every 31 March from the day before the start to the latest transaction,
  // and any year end a figure was loaded for within that span.
  const datesSet = new Set<IsoDate>();
  for (let year = Number(before.slice(0, 4)); `${year}-03-31` <= last; year++) {
    const date = `${year}-03-31` as IsoDate;
    if (date >= before) datesSet.add(date);
  }
  for (const d of Object.keys(openingHeld?.byDate ?? {})) {
    if (d.endsWith("-03-31") && d >= before && d <= last) datesSet.add(d as IsoDate);
  }

  for (const date of [...datesSet].sort()) {
    const year = parseInt(date.slice(0, 4), 10);
    const openDate = `${year}-04-01` as IsoDate;

    for (const acc of accounts) {
      if (acc.txCount === 0 && !openingHeld?.byDate?.[date]?.[acc.id] && !openingHeld?.accounts?.[acc.id]) {
        continue;
      }

      // 1. The ledger: the opening balance and every line from the start to the date.
      const ledgerBal =
        openingFor(openingHeld, acc.id, start) +
        txs
          .filter((t) => t.account === acc.id && t.date >= start && t.date <= date)
          .reduce((sum, t) => sum + t.amount, 0);

      // 2. Xero's year-end figure, where one was loaded.
      const xeroBal = openingHeld?.byDate?.[date]?.[acc.id] ?? null;

      // 3. The feed's latest balance, worked back to the date.
      let akahuBal: Cents | null = null;
      if (feed?.configured && feed.balances.length > 0) {
        let akahuId: string | null = null;
        for (const [id, mapped] of Object.entries(feed.accounts ?? {})) {
          if (mapped === acc.id) {
            akahuId = id;
            break;
          }
        }
        if (akahuId !== null) {
          const latestSnapshot = feed.balances[feed.balances.length - 1];
          if (latestSnapshot && latestSnapshot.balances[akahuId] !== undefined) {
            const snapBal = latestSnapshot.balances[akahuId]!;
            const txsAfter = txs.filter((t) => t.account === acc.id && t.date > date);
            akahuBal = snapBal - txsAfter.reduce((sum, t) => sum + t.amount, 0);
          }
        }
      }

      const compared = xeroBal !== null || akahuBal !== null;
      const matchXero = xeroBal === null || ledgerBal === xeroBal;
      const matchAkahu = akahuBal === null || ledgerBal === akahuBal;
      const agrees = compared && matchXero && matchAkahu;

      let notes = compared ? "Agrees" : "Nothing to compare";
      if (!matchXero && !matchAkahu) {
        notes = `${yearEndFigure()} ${dollars(ledgerBal - xeroBal!)} out, feed ${dollars(ledgerBal - akahuBal!)} out`;
      } else if (!matchXero) {
        notes = `${yearEndFigure()} ${dollars(ledgerBal - xeroBal!)} out`;
      } else if (!matchAkahu) {
        notes = `Feed ${dollars(ledgerBal - akahuBal!)} out`;
      }

      milestones.push({
        year,
        closeDate: date,
        openDate,
        accountId: acc.id,
        accountLabel: acc.label,
        ledgerBalance: ledgerBal,
        xeroBalance: xeroBal,
        akahuBalance: akahuBal,
        compared,
        agrees,
        notes,
      });
    }
  }

  return milestones;
}
