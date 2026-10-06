import { spreadsheetCell } from "@nzosa/core";
import { anyModuleOn, moduleOn } from "../modules.js";
import {
  dayBefore,
  formatAmount,
  checkDailyBalances,
  matchBalanceAccount,
} from "@nzosa/core";
import type {
  Cents,
  IsoDate,
  Transaction,
  BalanceCheck,
  ReferenceLine,
} from "@nzosa/core";
import { state } from "../state.js";
import { redraw } from "../app.js";
import { banks, bankLabel } from "../books.js";
import { amountCell, dollars, nameCell, note, download } from "../ui.js";
import { booksStart } from "./balance-diagnostics.js";
import { feedStatus, lastFeedStatus } from "../feed-route.js";
import type { FeedStatus } from "../feed-route.js";
import { taxYearEnd, taxYearStart } from "../tax-year.js";

/**
 * Bank transactions reconciliation report.
 *
 * For each bank account, compares by day across:
 * 1. All ledger transactions on that day (payee, particulars, reference, amount).
 * 2. Ledger running balance starting from the opening balance.
 * 3. Imported daily closing balances (e.g. from BNZ CSV export).
 * 4. Bank vs ledger offset difference and day-on-day breaks.
 * 5. Akahu calculated live feed balance (worked back/forward through transactions).
 * 6. Xero balances and transaction entries (if reference records are loaded).
 * 7. Opening balances entered by hand or from trial balances.
 */

let activeAccount: string | null = null;
let filterMode: "all" | "activity" | "breaks" = "all";
let cachedFeedStatus: FeedStatus | null = null;
let feedStatusPending = false;
// Asked once per page load. Books with no feed answer null, and asking again
// on every redraw redrew the report for ever.
let feedStatusAsked = false;

/** Set the active bank account to display in the reconciliation report. */
export function setActiveReconcileAccount(id: string): void {
  activeAccount = id;
}

/** Fetch feed status in background and redraw when available. */
function ensureFeedStatus(): void {
  if (feedStatusAsked || feedStatusPending) return;
  feedStatusPending = true;
  void feedStatus()
    .then((status) => {
      cachedFeedStatus = status;
      feedStatusAsked = true;
      feedStatusPending = false;
      // Only a feed changes what the report shows.
      if (status !== null) redraw("reports");
    })
    .catch(() => {
      feedStatusPending = false;
    });
}

export interface BankAccountOption {
  id: string;
  label: string;
  txCount: number;
  hasBalances: boolean;
}

/** Determine whether an account ID represents an actual bank account. */
export function isBankAccount(accountId: string): boolean {
  const trimmed = accountId.trim();
  if (trimmed === "") return false;

  // 1. If it has transactions in state.ledger.transactions, it is a bank account
  if (banks().accounts.has(trimmed)) return true;

  // 2. If it is in dailyBalances, it is an imported bank statement account
  for (const s of state.ledger.dailyBalances ?? []) {
    if (s.account === trimmed) return true;
  }

  // 3. If it is in live feed accounts (Akahu)
  const feed = lastFeedStatus();
  if (feed?.configured && feed.accounts) {
    for (const [id, mapped] of Object.entries(feed.accounts)) {
      if (id === trimmed || mapped === trimmed) return true;
    }
  }

  // 4. Check Chart of Accounts explicitly if available
  if (state.chart && state.chart.length > 0) {
    const match = state.chart.find(
      (a) => a.code.trim() === trimmed || a.name.trim() === trimmed || a.ledgerAccount?.trim() === trimmed,
    );
    if (match) {
      return match.type.trim().toLowerCase() === "bank";
    }
  }

  // 5. Pattern matching for standard NZ bank account numbers, credit cards, or Wise accounts
  if (/^\d{2}-\d{4}-\d{7}-\d{2,3}$/.test(trimmed)) return true;
  if (/\b(?:card|visa|mastercard|amex|credit|wise)\b/i.test(trimmed) || /-\d{4}$/.test(trimmed)) return true;

  return false;
}

/** All bank accounts present in transactions, balances, or opening entries. */
export function getReconcileAccounts(): BankAccountOption[] {
  const { accounts, labels } = banks();
  const allIds = new Set<string>();

  for (const acc of accounts) {
    if (isBankAccount(acc)) allIds.add(acc);
  }

  for (const section of state.ledger.dailyBalances ?? []) {
    const matched = matchBalanceAccount(section, [...accounts]);
    const id = matched !== null ? matched : section.account;
    if (isBankAccount(id)) allIds.add(id);
  }

  for (const accountId of Object.keys(state.ledger.openingBalances?.accounts ?? {})) {
    if (isBankAccount(accountId)) {
      allIds.add(accountId);
    }
  }

  const byId = new Map<string, Transaction[]>();
  for (const t of state.ledger.transactions) {
    const list = byId.get(t.account);
    if (list) list.push(t);
    else byId.set(t.account, [t]);
  }

  const result: BankAccountOption[] = [];
  for (const id of allIds) {
    const txCount = byId.get(id)?.length ?? 0;
    const hasBalances = (state.ledger.dailyBalances ?? []).some(
      (s) => s.account === id || matchBalanceAccount(s, [id]) === id,
    );
    const label = labels.get(id) ?? bankLabel(id);
    result.push({ id, label: label === id ? id : `${label} (${id})`, txCount, hasBalances });
  }

  // Sort accounts with transactions or balances first
  return result.sort((a, b) => {
    if (a.txCount > 0 && b.txCount === 0) return -1;
    if (b.txCount > 0 && a.txCount === 0) return 1;
    return a.label.localeCompare(b.label);
  });
}

/** What the other records are called: Xero, or the spreadsheet the books came from. */
const prior = (): string => (moduleOn("xero") ? "Xero" : "Spreadsheet");

/** Find matching Xero account name from xeroBankNumbers or reference entries. */
function findXeroAccount(ourAccount: string): string | null {
  const xeroBankNumbers = state.ledger.xeroBankNumbers ?? {};
  for (const [name, num] of Object.entries(xeroBankNumbers)) {
    const cleanNum = num.replace(/[^a-zA-Z0-9]/g, "");
    const cleanOur = ourAccount.replace(/[^a-zA-Z0-9]/g, "");
    if (cleanOur.endsWith(cleanNum) || cleanOur === cleanNum || cleanOur.includes(cleanNum)) {
      return name;
    }
  }

  // Fallback: match by card last 4 digits or wise/trading name substring
  const lastFour = /(\d{4})\s*$/.exec(ourAccount)?.[1];
  for (const line of state.ledger.reference ?? []) {
    if (line.account) {
      if (lastFour && line.account.includes(lastFour)) return line.account;
      if (ourAccount.toLowerCase().includes("wise") && line.account.toLowerCase().includes("wise")) {
        return line.account;
      }
      if (ourAccount.includes("001") && line.account.includes("01")) return line.account;
    }
  }
  return null;
}

export interface StatusDiscrepancy {
  source: "bank" | "xero" | "akahu";
  label: string;
  amount: Cents;
  /** The balance here less the other source's: negative where it holds more. */
  difference: Cents;
  amountStr: string;
}

export interface ReconcileRow {
  date: IsoDate;
  transactions: Transaction[];
  ledgerNet: Cents;
  ledgerRunning: Cents;
  bankClosing: Cents | null;
  bankOffset: Cents | null;
  bankDiff: Cents | null;
  bankBreakAmount: Cents | null;
  akahuCalculated: Cents | null;
  xeroEntries: ReferenceLine[];
  xeroNet: Cents | null;
  xeroRunning: Cents | null;
  status: "agrees" | "break" | "pending" | "timing" | "weekend" | "neutral";
  statusText: string;
  statusDiscrepancies?: StatusDiscrepancy[];
}

export interface ReconcileModel {
  accountId: string;
  accountLabel: string;
  openingBalance: Cents;
  openingDate: IsoDate;
  openingSource: string;
  totalCredits: Cents;
  totalDebits: Cents;
  netMovement: Cents;
  endingLedger: Cents;
  latestBankClosing: Cents | null;
  latestBankDate: IsoDate | null;
  latestAkahuBalance: Cents | null;
  latestAkahuDate: string | null;
  endingXero: Cents | null;
  latestXeroDate: IsoDate | null;
  endingXeroDate: IsoDate | null;
  ledgerAtXeroDate: Cents | null;
  balanceCheck: BalanceCheck | null;
  outBy: Cents;
  breaksCount: number;
  rows: ReconcileRow[];
}

/** Compute the daily reconciliation data model for an account. */
export function buildReconcileModel(accountId: string, year?: number): ReconcileModel {
  const { labels } = banks();
  const accountLabel = labels.get(accountId) ?? bankLabel(accountId);

  // 1. Ledger transactions
  const allTxs = state.ledger.transactions
    .filter((t) => t.account === accountId)
    .sort((a, b) => a.date.localeCompare(b.date));

  // 2. Opening balance
  const openingHeld = state.ledger.openingBalances;
  let openingBalance = openingHeld?.accounts?.[accountId] ?? 0;
  const openingDate = booksStart(openingHeld, state.ledger.transactions);
  const dayBeforeStart = dayBefore(openingDate);
  let openingSource = openingHeld?.source ?? "opening balances";

  // 3. Daily balances from imported file (BNZ)
  const bankSection = (state.ledger.dailyBalances ?? []).find(
    (s) => s.account === accountId || matchBalanceAccount(s, [accountId]) === accountId,
  );
  const bankDaysMap = new Map<IsoDate, Cents>();
  if (bankSection) {
    for (const d of bankSection.days) bankDaysMap.set(d.date, d.closing);
  }

  const balanceChecks = bankSection ? checkDailyBalances([bankSection], allTxs) : [];
  const balanceCheck = balanceChecks[0] ?? null;
  const breaksMap = new Map<IsoDate, Cents>();
  if (balanceCheck) {
    for (const b of balanceCheck.breaks) breaksMap.set(b.date, b.difference);
  }

  if (openingHeld?.accounts?.[accountId] === undefined && balanceCheck?.openingOffset) {
    openingBalance = balanceCheck.openingOffset;
    openingSource = "worked out from the statement";
  }

  // 4. Akahu live feed balance
  let latestAkahuBalance: Cents | null = null;
  let latestAkahuDate: string | null = null;
  let akahuId: string | null = null;

  if (cachedFeedStatus?.configured && cachedFeedStatus.balances.length > 0) {
    for (const [id, mapped] of Object.entries(cachedFeedStatus.accounts ?? {})) {
      if (mapped === accountId) {
        akahuId = id;
        break;
      }
    }
    if (akahuId !== null) {
      const latestSnapshot = cachedFeedStatus.balances[cachedFeedStatus.balances.length - 1];
      if (latestSnapshot && latestSnapshot.balances[akahuId] !== undefined) {
        latestAkahuBalance = latestSnapshot.balances[akahuId] ?? null;
        latestAkahuDate = latestSnapshot.at;
      }
    }
  }

  // 5. Xero entries
  // Only where these books came from Xero or a spreadsheet (modules.ts).
  const xeroName = anyModuleOn("xero sheet") ? findXeroAccount(accountId) : null;
  const xeroEntries = xeroName
    ? (state.ledger.reference ?? [])
        .filter((r) => r.account === xeroName)
        .sort((a, b) => a.date.localeCompare(b.date))
    : [];

  const priorBalanceDate = year !== undefined ? taxYearEnd(year - 1) : dayBeforeStart;
  const hasXeroOpening =
    openingHeld?.byDate?.[priorBalanceDate]?.[accountId] !== undefined ||
    openingHeld?.byDate?.[dayBeforeStart]?.[accountId] !== undefined ||
    openingHeld?.accounts?.[accountId] !== undefined;

  const xeroOfficialOpening =
    openingHeld?.byDate?.[priorBalanceDate]?.[accountId] ??
    openingHeld?.byDate?.[dayBeforeStart]?.[accountId] ??
    openingHeld?.accounts?.[accountId] ??
    openingBalance;

  // Determine date bounds for available Xero reference data
  let earliestXeroDate: IsoDate | null = null;
  let latestXeroDate: IsoDate | null = null;

  if (xeroEntries.length > 0) {
    earliestXeroDate = xeroEntries[0]!.date;
    latestXeroDate = xeroEntries[xeroEntries.length - 1]!.date;
  }

  if (hasXeroOpening) {
    if (earliestXeroDate === null || openingDate < earliestXeroDate) {
      earliestXeroDate = openingDate;
    }
  }

  if (openingHeld?.byDate) {
    for (const d of Object.keys(openingHeld.byDate)) {
      if (openingHeld.byDate[d]?.[accountId] !== undefined) {
        if (latestXeroDate === null || d > latestXeroDate) {
          latestXeroDate = d as IsoDate;
        }
        if (earliestXeroDate === null || d < earliestXeroDate) {
          earliestXeroDate = d as IsoDate;
        }
      }
    }
  }

  // 6. Gather all unique dates
  const datesSet = new Set<IsoDate>();
  for (const t of allTxs) datesSet.add(t.date);
  if (bankSection) {
    for (const d of bankSection.days) datesSet.add(d.date);
  }
  for (const r of xeroEntries) datesSet.add(r.date);
  if (openingDate) datesSet.add(openingDate);
  for (const d of Object.keys(openingHeld?.byDate ?? {})) {
    datesSet.add(d);
  }

  let sortedDates = [...datesSet].sort((a, b) => a.localeCompare(b));

  const firstDate = allTxs[0]?.date ?? openingDate;
  const startDate = openingDate < firstDate ? openingDate : firstDate;

  // Date filtering if year specified
  if (year !== undefined) {
    const from = taxYearStart(year);
    const to = taxYearEnd(year);
    sortedDates = sortedDates.filter((d) => d >= from && d <= to);
  } else {
    // Only show dates from when our ledger or opening begins
    sortedDates = sortedDates.filter((d) => d >= startDate);
  }

  // 7. Group transactions and xero entries by date
  const txByDate = new Map<IsoDate, Transaction[]>();
  for (const t of allTxs) {
    const list = txByDate.get(t.date);
    if (list) list.push(t);
    else txByDate.set(t.date, [t]);
  }

  const xeroByDate = new Map<IsoDate, ReferenceLine[]>();
  for (const r of xeroEntries) {
    const list = xeroByDate.get(r.date);
    if (list) list.push(r);
    else xeroByDate.set(r.date, [r]);
  }

  // 8. Iterate through dates and track running balances
  let runningLedger = openingBalance;
  let runningXero = xeroOfficialOpening;

  // Pre-calculate running ledger before filter range if filtered
  if (sortedDates.length > 0 && sortedDates[0]! > openingDate) {
    const priorTxs = allTxs.filter((t) => t.date >= openingDate && t.date < sortedDates[0]!);
    runningLedger += priorTxs.reduce((sum, t) => sum + t.amount, 0);

    // If we have an official checkpoint at priorBalanceDate (e.g. 2026-03-31 for FY2027),
    // runningXero is ALREADY set to that exact audited balance sheet figure.
    // We only accumulate priorXero if we did not have an official checkpoint for this year start.
    if (openingHeld?.byDate?.[priorBalanceDate]?.[accountId] === undefined) {
      const priorXero = xeroEntries.filter((r) => r.date >= openingDate && r.date < sortedDates[0]!);
      runningXero += priorXero.reduce((sum, r) => sum + r.amount, 0);
    }
  }

  // Determine period opening balance for display in summary tiles
  let periodOpeningBalance = openingBalance;
  let periodOpeningDate = openingDate;
  let periodOpeningSource = openingSource;

  if (year !== undefined) {
    const priorDate = taxYearEnd(year - 1);
    if (openingHeld?.byDate?.[priorDate]?.[accountId] !== undefined) {
      periodOpeningBalance = openingHeld.byDate[priorDate]![accountId]!;
      periodOpeningDate = priorDate;
      periodOpeningSource = `${prior()} year-end figure`;
    } else {
      periodOpeningBalance = runningLedger;
      periodOpeningDate = priorDate;
      periodOpeningSource = "worked out from the lines before it";
    }
  }

  const rows: ReconcileRow[] = [];
  let totalCredits = 0;
  let totalDebits = 0;

  let endingXeroBalance: Cents | null = null;
  let endingXeroDate: IsoDate | null = null;
  let ledgerAtXeroDate: Cents | null = null;

  for (const date of sortedDates) {
    // If this date has an audited trial balance figure in openingBalances.byDate,
    // synchronize runningXero to the audited balance.
    if (openingHeld?.byDate?.[date]?.[accountId] !== undefined) {
      runningXero = openingHeld.byDate[date]![accountId]!;
    }

    const dayTxs = txByDate.get(date) ?? [];
    const dayNet = dayTxs.reduce((sum, t) => sum + t.amount, 0);
    for (const t of dayTxs) {
      if (t.amount > 0) totalCredits += t.amount;
      else totalDebits += t.amount;
    }
    runningLedger += dayNet;

    // Xero entries for this day:
    const dayXero = xeroByDate.get(date) ?? [];
    let dayXeroNet: Cents | null = null;
    if (dayXero.length > 0) {
      dayXeroNet = dayXero.reduce((sum, r) => sum + r.amount, 0);
    }

    const isPastXeroEnd = latestXeroDate !== null && date > latestXeroDate;
    const isBeforeXeroStart = earliestXeroDate !== null && date < earliestXeroDate;
    const hasXeroForDay = latestXeroDate !== null && !isPastXeroEnd && !isBeforeXeroStart;

    if (hasXeroForDay) {
      // Inter-account transfer bridge:
      // Xero 'Account Transactions' exports contain nominal expense/revenue lines,
      // omitting inter-account bank transfers (such as credit card payoffs).
      // Include verified ledger transfers for this account on this date if omitted from dayXero.
      const transfers = state.ledger.transfers ?? {};
      for (const t of dayTxs) {
        const isTfr = transfers[t.id] !== undefined || t.type === "TRANSFER";
        if (isTfr) {
          const alreadyInXero = dayXero.some((r) => Math.abs(r.amount) === Math.abs(t.amount));
          if (!alreadyInXero) {
            if (dayXeroNet === null) dayXeroNet = 0;
            dayXeroNet += t.amount;
          }
        }
      }

      if (dayXeroNet !== null) runningXero += dayXeroNet;

      endingXeroBalance = runningXero;
      endingXeroDate = date;
      ledgerAtXeroDate = runningLedger;
    }

    // Ledger - Bank Diff calculation (Imported Bank Closing)
    const bankClosing = bankDaysMap.get(date) ?? null;
    let bankOffset: Cents | null = null;
    let bankDiff: Cents | null = null;
    const breakAmount = breaksMap.get(date) ?? null;

    if (bankClosing !== null) {
      bankOffset = runningLedger - bankClosing;
      bankDiff = runningLedger - bankClosing;
    }

    // Akahu calculated balance on date:
    // akahuBalance(date) = latestAkahu - txs after date up to snapshot
    let akahuCalc: Cents | null = null;
    if (latestAkahuBalance !== null && latestAkahuDate !== null) {
      const snapDay = latestAkahuDate.slice(0, 10);
      if (date <= snapDay) {
        const after = allTxs
          .filter((t) => t.date > date && t.date <= snapDay)
          .reduce((sum, t) => sum + t.amount, 0);
        akahuCalc = latestAkahuBalance - after;
      } else {
        const after = allTxs
          .filter((t) => t.date > snapDay && t.date <= date)
          .reduce((sum, t) => sum + t.amount, 0);
        akahuCalc = latestAkahuBalance + after;
      }
    }

    // Status evaluation across all available sources vs Ledger
    const statusDiscrepancies: StatusDiscrepancy[] = [];

    // 1. Ledger vs Imported Bank Closing
    if (bankClosing !== null && bankDiff !== 0) {
      statusDiscrepancies.push({
        source: "bank",
        label: "Ledger–bank",
        amount: Math.abs(bankDiff!),
        difference: bankDiff!,
        amountStr: formatAmount(bankDiff!),
      });
    }

    // 2. Ledger vs Xero
    if (hasXeroForDay && runningXero !== null) {
      const xeroDiff = runningLedger - runningXero;
      if (xeroDiff !== 0) {
        statusDiscrepancies.push({
          source: "xero",
          label: `Ledger–${prior()}`,
          amount: Math.abs(xeroDiff),
          difference: xeroDiff,
          amountStr: formatAmount(xeroDiff),
        });
      }
    }

    // 3. Ledger vs Akahu
    if (akahuCalc !== null) {
      const akahuDiff = runningLedger - akahuCalc;
      if (akahuDiff !== 0) {
        statusDiscrepancies.push({
          source: "akahu",
          label: "Ledger–Akahu",
          amount: Math.abs(akahuDiff),
          difference: akahuDiff,
          amountStr: formatAmount(akahuDiff),
        });
      }
    }

    let status: ReconcileRow["status"] = "neutral";
    let statusText = "—";

    if (statusDiscrepancies.length === 0) {
      if (bankClosing !== null || hasXeroForDay || akahuCalc !== null) {
        status = "agrees";
        statusText = "Agrees";
      } else {
        status = "weekend";
        statusText = "—";
      }
    } else {
      if (breakAmount !== null && breakAmount !== 0) {
        status = "break";
      } else {
        status = "timing";
      }
      statusText = statusDiscrepancies.map((d) => `${d.label} ${d.amountStr}`).join("\n");
    }

    rows.push({
      date,
      transactions: dayTxs,
      ledgerNet: dayNet,
      ledgerRunning: runningLedger,
      bankClosing,
      bankOffset,
      bankDiff,
      bankBreakAmount: breakAmount,
      akahuCalculated: akahuCalc,
      xeroEntries: dayXero,
      xeroNet: dayXeroNet,
      xeroRunning: hasXeroForDay ? runningXero : null,
      status,
      statusText,
      statusDiscrepancies,
    });
  }

  // Latest bank date and closing
  let latestBankClosing: Cents | null = null;
  let latestBankDate: IsoDate | null = null;
  if (bankSection && bankSection.days.length > 0) {
    const last = bankSection.days[bankSection.days.length - 1]!;
    latestBankClosing = last.closing;
    latestBankDate = last.date;
  }

  return {
    accountId,
    accountLabel,
    openingBalance: periodOpeningBalance,
    openingDate: periodOpeningDate,
    openingSource: periodOpeningSource,
    totalCredits,
    totalDebits,
    netMovement: totalCredits + totalDebits,
    endingLedger: runningLedger,
    latestBankClosing,
    latestBankDate,
    latestAkahuBalance,
    latestAkahuDate,
    endingXero: endingXeroBalance,
    latestXeroDate,
    endingXeroDate,
    ledgerAtXeroDate,
    balanceCheck,
    outBy: balanceCheck?.outBy ?? 0,
    breaksCount: balanceCheck?.breaks.length ?? 0,
    rows,
  };
}

/** Render the bank reconciliation report page. */
export function renderBankReconcile(body: HTMLElement, year?: number): void {
  ensureFeedStatus();

  const accounts = getReconcileAccounts();
  if (accounts.length === 0) {
    body.append(note("No bank accounts yet. Import bank transactions or connect a bank feed first."));
    return;
  }

  if (activeAccount === null || !accounts.some((a) => a.id === activeAccount)) {
    activeAccount = accounts[0]!.id;
  }

  const model = buildReconcileModel(activeAccount, year);

  // 1. Account, which days, and the download.
  const toolbar = document.createElement("div");
  toolbar.className = "reconcile-toolbar";

  const accLabel = document.createElement("label");
  accLabel.className = "reconcile-account";
  accLabel.textContent = "Bank account ";
  const accSelect = document.createElement("select");
  accSelect.className = "reconcile-select";
  for (const acc of accounts) {
    const opt = document.createElement("option");
    opt.value = acc.id;
    opt.textContent = `${acc.label} (${acc.txCount} transaction${acc.txCount === 1 ? "" : "s"})`;
    opt.selected = acc.id === activeAccount;
    accSelect.append(opt);
  }
  accSelect.addEventListener("change", () => {
    activeAccount = accSelect.value;
    redraw("reports");
  });
  accLabel.append(accSelect);
  toolbar.append(accLabel);

  const filterWrap = document.createElement("div");
  filterWrap.className = "reconcile-filter-tabs";
  const makeFilterBtn = (mode: "all" | "activity" | "breaks", label: string): HTMLButtonElement => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = filterMode === mode ? "primary" : "secondary";
    btn.textContent = label;
    btn.addEventListener("click", () => {
      filterMode = mode;
      redraw("reports");
    });
    return btn;
  };
  filterWrap.append(
    makeFilterBtn("all", "All days"),
    makeFilterBtn("activity", "With activity"),
    makeFilterBtn("breaks", `Differences only (${model.breaksCount})`),
  );
  toolbar.append(filterWrap);

  const exportBtn = document.createElement("button");
  exportBtn.type = "button";
  exportBtn.className = "secondary reconcile-export";
  exportBtn.textContent = "Download CSV";
  exportBtn.addEventListener("click", () => {
    const csv = bankReconcileCsv(year);
    download(csv.text, csv.name, "text/csv");
  });
  toolbar.append(exportBtn);
  body.append(toolbar);

  // 2. Summary tiles.
  const tilesWrap = document.createElement("div");
  tilesWrap.className = "chart-tiles";
  const addTile = (label: string, value: string, subnote: string, variant?: "good" | "warn"): void => {
    const tile = document.createElement("div");
    tile.className = `chart-tile${variant ? ` tile-${variant}` : ""}`;
    const lbl = document.createElement("span");
    lbl.className = "chart-tile-label";
    lbl.textContent = label;
    const val = document.createElement("strong");
    val.className = "chart-tile-value";
    val.textContent = value;
    const nt = document.createElement("span");
    nt.className = "chart-tile-note";
    nt.textContent = subnote;
    tile.append(lbl, val, nt);
    tilesWrap.append(tile);
  };

  addTile("Opening balance", dollars(model.openingBalance), `At ${model.openingDate}, ${model.openingSource}`);
  addTile(
    "Ledger movement",
    dollars(model.netMovement),
    `${dollars(model.totalCredits)} in, ${dollars(Math.abs(model.totalDebits))} out`,
  );
  addTile(
    "Ledger closing",
    dollars(model.endingLedger),
    `${model.rows.reduce((sum, r) => sum + r.transactions.length, 0)} transactions`,
  );

  if (model.latestBankClosing !== null && model.latestBankDate !== null) {
    addTile("Imported bank closing", dollars(model.latestBankClosing), `Statement closing on ${model.latestBankDate}`);
  }

  if (model.latestAkahuBalance !== null) {
    const akDate = model.latestAkahuDate ? model.latestAkahuDate.slice(0, 10) : "today";
    const diffAkahu = model.endingLedger - model.latestAkahuBalance;
    addTile(
      "Akahu live feed",
      dollars(model.latestAkahuBalance),
      diffAkahu === 0 ? `Agrees on ${akDate}` : `${dollars(diffAkahu)} different on ${akDate}`,
      diffAkahu === 0 ? "good" : "warn",
    );
  }

  if (model.endingXero !== null) {
    const lastRowDate = model.rows.length > 0 ? model.rows[model.rows.length - 1]!.date : null;
    const isEndedEarly =
      model.endingXeroDate !== null && lastRowDate !== null && model.endingXeroDate < lastRowDate;
    const compLedger = isEndedEarly ? (model.ledgerAtXeroDate ?? model.endingLedger) : model.endingLedger;
    const diffXero = compLedger - model.endingXero;
    const agreed = diffXero === 0 ? "Agrees" : `${dollars(diffXero)} different`;
    addTile(
      isEndedEarly ? `${prior()} at ${model.endingXeroDate}` : prior(),
      dollars(model.endingXero),
      isEndedEarly ? `${agreed} on ${model.endingXeroDate}; nothing from ${prior()} after it` : agreed,
      diffXero === 0 ? "good" : "warn",
    );
  }

  if (model.balanceCheck) {
    if (model.outBy === 0) {
      addTile("Bank reconciliation", "Agrees", "Every statement day agrees with the ledger", "good");
    } else {
      addTile(
        "Bank reconciliation",
        `${dollars(model.outBy)} out`,
        `${model.breaksCount} day${model.breaksCount === 1 ? "" : "s"} differing after ${model.balanceCheck.agreedUntil ?? "the start"}`,
        "warn",
      );
    }
  }
  body.append(tilesWrap);

  // 3. The days the statement moved differently from these books.
  if (model.balanceCheck && model.balanceCheck.breaks.length > 0) {
    const breaks = model.balanceCheck.breaks;
    const diag = document.createElement("div");
    diag.className = "reconcile-diagnostic";

    const diagTitle = document.createElement("h4");
    diagTitle.textContent =
      `${breaks.length} day${breaks.length === 1 ? "" : "s"} the statement moved differently, ` +
      `${dollars(model.outBy)} in all`;
    diag.append(
      diagTitle,
      note(
        "On these days the statement's balance moved by a different amount from the transactions here. " +
          "Usually a card charge the bank cleared on another day, or a line dated differently from the bank.",
      ),
    );

    const diagTable = document.createElement("table");
    diagTable.className = "report-table match-table";
    diagTable.innerHTML =
      '<thead><tr><th>Date</th><th class="report-amount">Difference</th>' +
      '<th class="report-amount">Running total</th><th>Likely reason</th></tr></thead>';
    const diagTbody = document.createElement("tbody");
    let cum = 0;
    breaks.forEach((b, i) => {
      cum += b.difference;
      // Said from the figures themselves: a difference undone later is timing.
      const undone = breaks.slice(i + 1).find((later) => later.difference === -b.difference);
      const hint =
        undone !== undefined
          ? `Reversed on ${undone.date}: a timing difference`
          : b.date === model.latestBankDate
            ? "On the latest statement day: possibly not yet cleared by the bank"
            : "Not reversed: check for a missing, doubled or misdated line";
      const tr = document.createElement("tr");
      tr.append(nameCell(b.date), amountCell(dollars(b.difference)), amountCell(dollars(cum)), nameCell(hint));
      diagTbody.append(tr);
    });
    diagTable.append(diagTbody);
    diag.append(diagTable);
    body.append(diag);
  }

  // 4. The daily table.
  let filteredRows = model.rows;
  if (filterMode === "activity") {
    filteredRows = model.rows.filter((r) => r.transactions.length > 0 || (r.xeroEntries && r.xeroEntries.length > 0));
  } else if (filterMode === "breaks") {
    filteredRows = model.rows.filter((r) => r.status === "break" || (r.bankDiff !== null && r.bankDiff !== 0));
  }

  body.append(note(`${filteredRows.length} of ${model.rows.length} days for ${model.accountLabel}.`));
  if (filteredRows.length === 0) {
    body.append(note("No days match."));
    return;
  }

  const hasAkahu = model.latestAkahuBalance !== null;
  const hasXero = model.endingXero !== null;
  const columns: { name: string; amount: boolean; help: string }[] = [
    { name: "Date", amount: false, help: "" },
    { name: "Transactions on this day", amount: false, help: "Every ledger line on this account that day." },
    { name: "Day net", amount: true, help: "The day's lines added together: money in less money out." },
    { name: "Ledger running", amount: true, help: "The ledger balance at the end of the day: the opening balance plus every line to date." },
    { name: "Imported bank closing", amount: true, help: "The bank statement's closing balance for the day, from an imported balances file." },
    { name: "Ledger–bank diff", amount: true, help: "Ledger running less imported bank closing." },
    ...(hasAkahu
      ? [{ name: "Akahu calc", amount: true, help: "The Akahu feed's latest balance, worked back to the day through the lines in between." }]
      : []),
    ...(hasXero
      ? [{ name: `${prior()} running`, amount: true, help: `The running balance in ${prior()}, from its year-end figures and imported transactions. Blank after its last date.` }]
      : []),
    { name: "Status", amount: false, help: "Agrees, or which source differs from the ledger and by how much." },
  ];

  const guide = document.createElement("details");
  guide.className = "reconcile-guide";
  const guideSummary = document.createElement("summary");
  guideSummary.textContent = "What the columns mean";
  const guideGrid = document.createElement("div");
  guideGrid.className = "reconcile-guide-grid";
  for (const col of columns.filter((c) => c.help !== "")) {
    const item = document.createElement("div");
    item.className = "reconcile-guide-item";
    const strong = document.createElement("strong");
    strong.textContent = col.name;
    const span = document.createElement("span");
    span.textContent = col.help;
    item.append(strong, span);
    guideGrid.append(item);
  }
  guide.append(guideSummary, guideGrid);
  body.append(guide);

  const tableWrap = document.createElement("div");
  tableWrap.className = "table-scroll";
  const table = document.createElement("table");
  table.className = "extract-table bank-reconcile-table";
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const col of columns) {
    const th = document.createElement("th");
    th.className = col.amount ? "report-amount" : "report-name";
    th.textContent = col.name;
    if (col.help !== "") th.title = col.help;
    headRow.append(th);
  }
  thead.append(headRow);
  table.append(thead);

  const muted = (): HTMLSpanElement => {
    const span = document.createElement("span");
    span.className = "muted";
    span.textContent = "—";
    return span;
  };

  const tbody = document.createElement("tbody");
  for (const row of filteredRows) {
    const tr = document.createElement("tr");
    if (row.status === "break") tr.className = "row-break";
    else if (row.status === "timing") tr.className = "row-timing";

    const tdDate = nameCell(row.date);
    tdDate.classList.add("reconcile-date");
    tr.append(tdDate);

    const tdTxs = document.createElement("td");
    tdTxs.className = "report-name";
    if (row.transactions.length === 0) {
      tdTxs.append(muted());
    } else {
      const list = document.createElement("div");
      list.className = "tx-list";
      for (const t of row.transactions) {
        const item = document.createElement("div");
        item.className = "tx-item";
        const desc = document.createElement("span");
        desc.className = "tx-desc";
        const payee = t.otherParty || t.particulars || "Transaction";
        const extra = [t.particulars, t.code, t.reference].filter((x) => x && x !== payee).join(" · ");
        desc.textContent = extra ? `${payee} (${extra})` : payee;
        const amt = document.createElement("span");
        amt.className = `tx-badge ${t.amount < 0 ? "tx-badge-neg" : "tx-badge-pos"}`;
        amt.textContent = dollars(t.amount);
        item.append(desc, amt);
        list.append(item);
      }
      tdTxs.append(list);
    }
    tr.append(tdTxs);

    const tdNet = amountCell(row.ledgerNet === 0 ? "—" : dollars(row.ledgerNet));
    if (row.ledgerNet > 0) tdNet.classList.add("amount-in");
    tr.append(tdNet);

    const tdRunning = amountCell(dollars(row.ledgerRunning));
    tdRunning.classList.add("amount-strong");
    tr.append(tdRunning);

    const tdBank = amountCell(row.bankClosing !== null ? dollars(row.bankClosing) : "—");
    if (row.bankClosing === null) tdBank.classList.add("muted");
    tr.append(tdBank);

    const tdBankDiff = document.createElement("td");
    tdBankDiff.className = "report-amount";
    if (row.bankDiff === null) {
      tdBankDiff.append(muted());
    } else {
      const pill = document.createElement("span");
      pill.className = `status-pill ${row.bankDiff === 0 ? "ok" : row.status === "break" ? "off" : "warn"}`;
      pill.textContent = dollars(row.bankDiff);
      tdBankDiff.append(pill);
    }
    tr.append(tdBankDiff);

    if (hasAkahu) {
      const tdAkahu = amountCell(row.akahuCalculated !== null ? dollars(row.akahuCalculated) : "—");
      if (row.akahuCalculated === null) {
        tdAkahu.classList.add("muted");
      } else if (row.akahuCalculated === row.ledgerRunning) {
        tdAkahu.classList.add("amount-ok");
      } else {
        tdAkahu.classList.add("amount-off");
        tdAkahu.title = `${dollars(row.ledgerRunning - row.akahuCalculated)} different from the ledger`;
      }
      tr.append(tdAkahu);
    }

    if (hasXero) {
      const tdXero = amountCell(row.xeroRunning !== null ? dollars(row.xeroRunning) : "—");
      if (row.xeroRunning === null) tdXero.classList.add("muted");
      else tdXero.classList.add(row.xeroRunning === row.ledgerRunning ? "amount-ok" : "amount-warn");
      tr.append(tdXero);
    }

    const tdStatus = document.createElement("td");
    if (row.status === "agrees") {
      const pill = document.createElement("span");
      pill.className = "status-pill ok";
      pill.textContent = "Agrees";
      tdStatus.append(pill);
    } else if (row.statusDiscrepancies && row.statusDiscrepancies.length > 0) {
      const box = document.createElement("div");
      box.className = `status-pill status-list ${row.status === "break" ? "off" : "warn"}`;
      for (const disc of row.statusDiscrepancies) {
        const line = document.createElement("div");
        line.textContent = `${disc.label} ${dollars(disc.difference)}`;
        box.append(line);
      }
      tdStatus.append(box);
    } else {
      tdStatus.append(muted());
    }
    tr.append(tdStatus);

    tbody.append(tr);
  }

  table.append(tbody);
  tableWrap.append(table);
  body.append(tableWrap);
}

/** Generate downloadable CSV format of the bank reconciliation. */
export function bankReconcileCsv(year?: number): { name: string; text: string } {
  const accounts = getReconcileAccounts();
  const accId = activeAccount ?? accounts[0]?.id ?? "bank-account";
  const model = buildReconcileModel(accId, year);

  const lines: string[] = [];
  lines.push(`"Bank reconciliation: ${model.accountLabel}"`);
  lines.push(`"Opening balance","${formatAmount(model.openingBalance)}","as at ${model.openingDate}"`);
  lines.push(`"Money in","${formatAmount(model.totalCredits)}"`);
  lines.push(`"Money out","${formatAmount(model.totalDebits)}"`);
  lines.push(`"Ledger closing","${formatAmount(model.endingLedger)}"`);
  if (model.latestBankClosing !== null) {
    lines.push(`"Imported bank closing","${formatAmount(model.latestBankClosing)}","${model.latestBankDate}"`);
  }
  if (model.latestAkahuBalance !== null) {
    lines.push(`"Akahu feed balance","${formatAmount(model.latestAkahuBalance)}"`);
  }
  if (model.endingXero !== null) {
    const xeroDateLabel = model.endingXeroDate ? `as at ${model.endingXeroDate}` : "";
    lines.push(`"${prior()} balance","${formatAmount(model.endingXero)}","${xeroDateLabel}"`);
  }
  lines.push(`"Bank reconciliation","${model.outBy === 0 ? "Agrees" : `Out by ${formatAmount(model.outBy)}`}"`);
  lines.push("");

  const hasAkahu = model.latestAkahuBalance !== null;
  const hasXero = model.endingXero !== null;

  const header = [
    "Date",
    "Transactions",
    "Day net",
    "Ledger running",
    "Imported bank closing",
    "Ledger-bank diff",
    ...(hasAkahu ? ["Akahu calc"] : []),
    ...(hasXero ? [`${prior()} running`] : []),
    "Status",
  ];
  lines.push(header.map((h) => `"${h}"`).join(","));

  for (const row of model.rows) {
    const txDetails = row.transactions
      .map((t) => `${t.otherParty || t.particulars || "Tx"}: ${formatAmount(t.amount)}`)
      .join(" | ");

    const cols = [
      row.date,
      txDetails,
      row.ledgerNet !== 0 ? formatAmount(row.ledgerNet) : "0.00",
      formatAmount(row.ledgerRunning),
      row.bankClosing !== null ? formatAmount(row.bankClosing) : "",
      row.bankDiff !== null ? formatAmount(row.bankDiff) : "",
      ...(hasAkahu ? [row.akahuCalculated !== null ? formatAmount(row.akahuCalculated) : ""] : []),
      ...(hasXero ? [row.xeroRunning !== null ? formatAmount(row.xeroRunning) : ""] : []),
      row.statusDiscrepancies && row.statusDiscrepancies.length > 0
        ? row.statusDiscrepancies.map((d) => `${d.label} ${d.amountStr}`).join(" | ")
        : row.statusText,
    ];
    lines.push(cols.map((c) => spreadsheetCell(String(c))).join(","));
  }

  const filename = `bank-reconciliation-${accId.replace(/[^a-zA-Z0-9_-]/g, "")}${year ? `-fy${year}` : ""}.csv`;
  return { name: filename, text: lines.join("\r\n") };
}
