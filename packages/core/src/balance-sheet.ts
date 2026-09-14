import type { Cents } from "./money.js";
import type { IsoDate } from "./dates.js";
import type { Account } from "./chart.js";
import type { Journal } from "./journals.js";
import type { PostedJournal, PostedLine } from "./posting.js";
import { isShareholderCurrentAccount } from "./ir10.js";

/**
 * The balance sheet, derived from the postings and nothing else.
 *
 * The version this replaces computed its two halves by different routes: the
 * assets and liabilities from the journals, and the equity from a profit figure
 * handed in from outside. Its `imbalance` field then compared them -- but with
 * nothing tying the two calculations together, a difference between them was
 * exactly what the field could not detect. It read as proof and was not one.
 *
 * Here every figure comes from the same place: opening balances plus journal
 * lines, each account placed by its type in the chart. The profit for the
 * period is the movement on the revenue and expense accounts, so it cannot
 * disagree with the sheet it appears on, and `imbalance` becomes a real check --
 * it is the sum of every line in the ledger, which double entry says is zero.
 *
 * Signs follow the postings: debit positive, credit negative. Liabilities and
 * equity are flipped once, at the point of presentation, so a reader sees the
 * positive figures a balance sheet is written with.
 */

export interface OpeningBalances {
  asAt: IsoDate;
  source?: string;
  /** Debit positive, credit negative, keyed by account code or bank account. */
  accounts: Record<string, Cents>;
  /** Balances for each financial year end date (e.g. "2024-03-31"). */
  byDate?: Record<IsoDate, Record<string, Cents>>;
}

/**
 * Re-key opening balances whose account has since been identified.
 *
 * A trial balance names its bank rows the way the other system does -- "BNZ 01
 * -  Harbour Roastery Account" -- and this ledger numbers them. If it is
 * loaded before anybody has said which is which, those rows are stored under
 * the name, and they sit apart from the account they belong to for ever:
 * reports show both, and neither is right.
 *
 * Saying which is which is a thing people do later, on the chart of accounts,
 * and doing it should settle the figures already loaded rather than leaving a
 * re-import as the only way. So this is applied when a link is made.
 *
 * Amounts are added where a key now resolves to one already present, because
 * two rows becoming the same account is exactly what has just been said. A key
 * that resolves to nothing, or to itself, is left alone.
 */
export function relabelOpeningBalances(
  balances: OpeningBalances,
  resolve: (key: string) => string | undefined,
): { balances: OpeningBalances; moved: string[] } {
  const moved: string[] = [];

  const relabel = (accounts: Record<string, Cents>): Record<string, Cents> => {
    const out: Record<string, Cents> = {};
    for (const [key, amount] of Object.entries(accounts)) {
      const to = resolve(key);
      const target = to === undefined || to === "" ? key : to;
      if (target !== key && !moved.includes(key)) moved.push(key);
      out[target] = (out[target] ?? 0) + amount;
    }
    return out;
  };

  const byDate = balances.byDate;
  return {
    balances: {
      ...balances,
      accounts: relabel(balances.accounts),
      ...(byDate
        ? {
            byDate: Object.fromEntries(
              Object.entries(byDate).map(([date, accounts]) => [date, relabel(accounts)]),
            ),
          }
        : {}),
    },
    moved,
  };
}

export interface BalanceSheetLine {
  code: string;
  name: string;
  opening: Cents;
  movement: Cents;
  closing: Cents;
}

export interface BalanceSheetSection {
  title: string;
  lines: BalanceSheetLine[];
  total: Cents;
}

export interface BalanceSheet {
  asAt: IsoDate;
  /** The date the opening figures are stated at, when there are any. */
  openingFrom: IsoDate | null;
  currentAssets: BalanceSheetSection;
  nonCurrentAssets: BalanceSheetSection;
  totalAssets: Cents;
  currentLiabilities: BalanceSheetSection;
  nonCurrentLiabilities: BalanceSheetSection;
  totalLiabilities: Cents;
  netAssets: Cents;
  equity: BalanceSheetSection;
  totalEquity: Cents;
  /** Profit for the period, from the revenue and expense postings. */
  profitForPeriod: Cents;
  /**
   * Net assets less total equity, which double entry says is zero.
   *
   * Anything else means the opening balances do not balance, or a journal does
   * not. The figure is the size of the problem rather than a rounding.
   */
  imbalance: Cents;
}

type Section =
  | "current-asset"
  | "non-current-asset"
  | "current-liability"
  | "non-current-liability"
  | "equity"
  | "profit-and-loss"
  | "ignore";

/**
 * Negative zero, turned back into zero.
 *
 * Flipping the sign of nothing gives -0 in JavaScript, which is not equal to 0
 * under Object.is and prints as "-0.00" on a balance sheet. It arrives here
 * whenever a period has no profit, which is not an exotic case.
 */
function flip(amount: Cents): Cents {
  return amount === 0 ? 0 : -amount;
}

/**
 * Which part of the sheet an account belongs to.
 *
 * By the chart's own type, never by the account number: a chart is somebody's
 * own and its numbering is a convention, while the type is what the accounting
 * system already committed to. An earlier version matched bank accounts by
 * specific prefixes and card suffixes hardcoded for a single client,
 * written into a library meant to work for anybody.
 */
function sectionFor(type: string, balance: Cents): Section {
  switch (type.trim().toLowerCase()) {
    case "bank":
    case "accounts receivable":
    case "current asset":
    case "inventory":
      return "current-asset";
    case "fixed asset":
      return "non-current-asset";
    case "accounts payable":
    case "current liability":
    case "unpaid expense claims":
      return "current-liability";
    case "non-current liability":
      return "non-current-liability";
    case "equity":
    case "retained earnings":
    case "historical":
      return "equity";
    // Every type a profit and loss can hold. "Depreciation" and "Sales" are
    // both types Xero writes; left out, a year's depreciation went to no
    // section while its accumulated depreciation stayed on the sheet, and the
    // demo books read out of balance by exactly that charge.
    case "revenue":
    case "sales":
    case "other income":
    case "direct costs":
    case "expense":
    case "overhead":
    case "depreciation":
      return "profit-and-loss";
    // GST is owed in one direction or the other and crosses between them within
    // a year, so it is placed by where it actually sits on the day.
    case "gst":
      return balance > 0 ? "current-asset" : "current-liability";
    // Rounding sits where it arose, by the same reasoning. Signed accounts are
    // stated in whole dollars, so a set of components can round down while
    // their total rounds up -- for instance, payables of 153 and 58,211,
    // printed with a total of 58,365. Carrying that dollar to equity would make
    // total liabilities, net assets and retained earnings each read a dollar
    // away from the statements they came from. Left on the side it came from,
    // all three tie.
    case "rounding":
      return balance > 0 ? "current-asset" : "current-liability";
    case "tracking":
      return "ignore";
    default:
      return "ignore";
  }
}

export function computeBalanceSheet(options: {
  asAt: IsoDate;
  openingBalances?: OpeningBalances;
  journals: readonly PostedJournal[];
  chart: readonly Account[];
  /**
   * Set a company's shareholder current accounts out as one current liability.
   *
   * A director's loan, their drawings and the funds they put in are one
   * running balance the company owes back, and signed statements print it as
   * "Shareholder Current Accounts" under current liabilities -- whatever types
   * the chart gave the accounts. Left to their types, the loan sat under
   * non-current liabilities and the drawings in equity: the totals the same,
   * but net assets read 23,000 lower than the statements beside them.
   */
  shareholderCurrentAccounts?: boolean;
  /**
   * Show the year's profit inside retained earnings, as the statements do,
   * rather than on a line of its own.
   */
  profitInRetainedEarnings?: boolean;
}): BalanceSheet {
  const { asAt, openingBalances, journals, chart } = options;
  const byCode = new Map(chart.map((a) => [a.code, a]));
  const opening = openingBalances?.accounts ?? {};
  const from = openingBalances?.asAt ?? null;

  const openingOf = new Map<string, Cents>(Object.entries(opening));
  const movementOf = new Map<string, Cents>();
  const nameOf = new Map<string, string>();

  for (const journal of journals) {
    if (journal.date > asAt) continue;
    // A journal dated before the opening balances is already inside them, so
    // counting it again would state the opening year twice.
    if (from !== null && journal.date < from) continue;
    for (const line of journal.lines) {
      const code = line.accountCode || line.accountName;
      movementOf.set(code, (movementOf.get(code) ?? 0) + line.amount);
      if (!nameOf.has(code)) nameOf.set(code, line.accountName || code);
    }
  }

  // Every account either source touches, so nothing is dropped for being
  // absent from one of them.
  const codes = new Set<string>([...openingOf.keys(), ...movementOf.keys()]);
  const sections = new Map<Section, BalanceSheetLine[]>();
  const shareholder = { opening: 0, movement: 0, closing: 0 };
  let profitForPeriod = 0;

  for (const code of [...codes].sort()) {
    const openingAmount = openingOf.get(code) ?? 0;
    const movement = movementOf.get(code) ?? 0;
    const closing = openingAmount + movement;
    if (openingAmount === 0 && movement === 0) continue;

    const account = byCode.get(code);
    // A posting whose code is not in the chart is a bank line: this app posts
    // the bank side against the account itself, which carries no chart code.
    // It is the only such posting, which is what makes the fallback safe.
    const type = account?.type ?? "Bank";
    if (
      options.shareholderCurrentAccounts === true &&
      account !== undefined &&
      isShareholderCurrentAccount(code, account.name, type)
    ) {
      shareholder.opening += openingAmount;
      shareholder.movement += movement;
      shareholder.closing += closing;
      continue;
    }
    const section = sectionFor(type, closing);
    if (section === "ignore") continue;

    if (section === "profit-and-loss") {
      profitForPeriod += movement;
      continue;
    }

    const line: BalanceSheetLine = {
      code,
      name: account?.name ?? nameOf.get(code) ?? code,
      opening: openingAmount,
      movement,
      closing,
    };
    const list = sections.get(section);
    if (list) list.push(line);
    else sections.set(section, [line]);
  }

  if (shareholder.opening !== 0 || shareholder.movement !== 0 || shareholder.closing !== 0) {
    const line: BalanceSheetLine = {
      code: "",
      name: "Shareholder current accounts",
      ...shareholder,
    };
    const list = sections.get("current-liability");
    if (list) list.push(line);
    else sections.set("current-liability", [line]);
  }

  /** A section as a reader sees it: liabilities and equity the right way up. */
  const present = (title: string, section: Section, reverse: boolean): BalanceSheetSection => {
    const lines = (sections.get(section) ?? []).map((line) =>
      reverse
        ? { ...line, opening: flip(line.opening), movement: flip(line.movement), closing: flip(line.closing) }
        : line,
    );
    return { title, lines, total: lines.reduce((sum, line) => sum + line.closing, 0) };
  };

  const currentAssets = present("Current assets", "current-asset", false);
  const nonCurrentAssets = present("Non-current assets", "non-current-asset", false);
  const currentLiabilities = present("Current liabilities", "current-liability", true);
  const nonCurrentLiabilities = present("Non-current liabilities", "non-current-liability", true);
  const held = present("Equity", "equity", true);

  const totalAssets = currentAssets.total + nonCurrentAssets.total;
  const totalLiabilities = currentLiabilities.total + nonCurrentLiabilities.total;
  const netAssets = totalAssets - totalLiabilities;

  // The period's result is equity too, and it is the movement on the revenue
  // and expense accounts rather than a figure worked out somewhere else. A
  // credit balance is a profit, so it flips with the rest of equity.
  const profitLine = {
    code: "",
    name: "Profit for the period",
    opening: 0,
    movement: flip(profitForPeriod),
    closing: flip(profitForPeriod),
  };
  const isRetained = (line: BalanceSheetLine): boolean =>
    byCode.get(line.code)?.type.trim().toLowerCase() === "retained earnings";
  const retained = held.lines.find(isRetained);
  const equityLines =
    options.profitInRetainedEarnings !== true
      ? [...held.lines, profitLine]
      : retained === undefined
        ? [...held.lines, { ...profitLine, name: "Retained earnings" }]
        : held.lines.map((line) =>
            line === retained
              ? {
                  ...line,
                  movement: line.movement + profitLine.movement,
                  closing: line.closing + profitLine.closing,
                }
              : line,
          );
  const equity: BalanceSheetSection = {
    title: "Equity",
    lines: equityLines,
    total: held.total - profitForPeriod,
  };

  return {
    asAt,
    openingFrom: from,
    currentAssets,
    nonCurrentAssets,
    totalAssets,
    currentLiabilities,
    nonCurrentLiabilities,
    totalLiabilities,
    netAssets,
    equity,
    totalEquity: equity.total,
    profitForPeriod: flip(profitForPeriod),
    imbalance: netAssets - equity.total === 0 ? 0 : netAssets - equity.total,
  };
}

/**
 * The other system's journal report, in the shape a balance sheet reads.
 *
 * So the imported basis is the other system's own answer rather than ours
 * under its heading: its journals, over the same opening balances, each
 * account placed by the same type. It used to be ours on every basis -- the
 * page said it was read from the file you loaded, and showed this ledger's
 * profit and this ledger's bank balances.
 *
 * The one translation is the bank. The report names a bank account ("BNZ 01 -
 * Harbour Roastery Account") where this ledger and its opening balances number
 * it, so a bank line is re-keyed through the link made on the chart. Left under
 * its name, the account's movement and its opening balance would sit on two
 * rows, and neither would be the balance.
 */
export function postedFromImported(
  journals: readonly Journal[],
  /** Which ledger account a bank named in the report is, or null when none. */
  bankAccountFor: (name: string) => string | null,
): PostedJournal[] {
  return journals.map(
    (journal): PostedJournal => ({
      transactionId: journal.id,
      date: journal.date,
      narration: journal.narration,
      // Somebody else's postings, taken as they stand -- the same footing as a
      // journal written by hand.
      source: "manual",
      taxBasis: "both",
      lines: journal.lines.map((line): PostedLine => {
        const bank = line.accountCode === "" ? bankAccountFor(line.accountName) : null;
        return {
          accountCode: bank ?? line.accountCode,
          accountName: line.accountName,
          amount: line.amount,
          taxType: "NONE",
          description: line.description,
        };
      }),
    }),
  );
}
