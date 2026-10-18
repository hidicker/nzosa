import { parseCsvRecords } from "./csv.js";
import { parseDate } from "./dates.js";
import { parseAmount } from "./money.js";
import type { Account } from "./chart.js";
import type { ImportProblem } from "./types.js";
import { quickBooksPlacement } from "./quickbooks.js";
import type { QuickBooksChart, QuickBooksEntry, QuickBooksLedgerOptions } from "./quickbooks.js";
import type { IifFile, ReadBooks } from "./iif.js";
import { booksWithChart } from "./slowbooks.js";

/**
 * QuickBooks Desktop's Transaction Detail by Account report, saved as CSV.
 *
 * The report a bookkeeper exports for everything (Reports > Accountant &
 * Taxes > Transaction Detail by Account, all dates): every deposit, check,
 * transfer, bill, invoice, journal entry and opening balance, listed under
 * each account it touches, the other side in Split. Desktop does not export
 * its transactions to IIF, so this is how they come across; the IIF file
 * brings the lists and the chart with its types.
 *
 * Its layout: a heading row for each account (a sub-account's indented one
 * column further, and named "Parent:Child" here as IIF names it), the
 * account's postings beneath with Type, Date, Num, Name, Memo, Split, Debit
 * and Credit -- QuickBooks puts an empty column between each -- and a "Total"
 * row for the account. Rows that share a type, date and name, and a number
 * where they have one, are one transaction.
 *
 * The whole file is checked before anything is taken: each account's
 * postings must come to the total QuickBooks printed for it, and every
 * transaction must balance. A file that fails is refused whole, with why.
 */

const NEEDED = ["Type", "Date", "Name", "Debit", "Credit"] as const;

/** The header row: the one naming Type, Date, Name, Debit and Credit, wherever they sit. */
function headerOf(records: { fields: readonly string[] }[]): { index: number; at: Map<string, number> } | null {
  for (let i = 0; i < Math.min(records.length, 15); i += 1) {
    const at = new Map<string, number>();
    (records[i]?.fields ?? []).forEach((cell, n) => {
      const name = cell.trim();
      if (name !== "" && !at.has(name)) at.set(name, n);
    });
    if (NEEDED.every((n) => at.has(n)) && (at.has("Split") || at.has("Num"))) return { index: i, at };
  }
  return null;
}

/** Whether text is QuickBooks Desktop's Transaction Detail by Account (or its General Ledger, the same shape). */
export function isQuickBooksDesktopDetail(text: string): boolean {
  const records = parseCsvRecords(text.slice(0, 20000));
  const header = headerOf(records);
  if (header === null) return false;
  // Desktop leaves the columns before Type for the account headings.
  return (header.at.get("Type") ?? 0) > 0 && records.slice(header.index + 1, header.index + 6).some((r) => {
    const t = header.at.get("Type") ?? 0;
    return r.fields.slice(0, t).some((c) => c.trim() !== "") && r.fields.slice(t).every((c) => c.trim() === "");
  });
}

/** "10100 · Checking" as its number and name; a name with no number as itself. */
function splitNumber(heading: string): { number: string; name: string } {
  const m = /^(\d[\d.-]*)\s*[··à•-]\s*(.+)$/.exec(heading.trim());
  return m === null ? { number: "", name: heading.trim() } : { number: m[1] ?? "", name: (m[2] ?? "").trim() };
}

/** The QuickBooks type an account's name (and number, where it has one) suggest, with no chart to say. */
function typeOfName(name: string, number: string): string {
  const leaf = name.split(":").pop() ?? name;
  const n = Number(number);
  if (/accounts receivable|\breceivable\b/i.test(leaf)) return "Accounts Receivable (A/R)";
  if (/accounts payable/i.test(leaf)) return "Accounts Payable (A/P)";
  if (/credit card|\bvisa\b|mastercard|\bamex\b|american express/i.test(leaf)) return "Credit Card";
  if (/checking|savings|\bbank\b|money market|petty cash|^cash\b/i.test(leaf) && !/charge|fee|interest/i.test(leaf)) return "Bank";
  if (/undeposited|clearing|prepaid|deposit|inventory asset/i.test(leaf)) return "Other Current Assets";
  if (/accumulated depreciation|equipment|vehicle|furniture|building|machinery|computer/i.test(leaf) && !/expense|repair|rent|lease/i.test(leaf)) return "Fixed Assets";
  if (/retained earnings|opening bal|equity|capital|draw|owner|shareholder|partner/i.test(leaf)) return "Equity";
  if (/payable|payroll liab|liabilit|loan|note|line of credit|accrued|unearned/i.test(leaf)) return "Other Current Liabilities";
  if (/cost of goods|\bcogs\b|cost of sales|purchases|materials|subcontract/i.test(leaf)) return "Cost of Goods Sold";
  if (/income|sales|revenue|fees earned|interest earned|discounts received/i.test(leaf)) return "Income";
  if (Number.isFinite(n) && number !== "") {
    if (n < 1500) return "Other Current Assets";
    if (n < 2000) return "Fixed Assets";
    if (n < 3000) return "Other Current Liabilities";
    if (n < 4000) return "Equity";
    if (n < 5000) return "Income";
    if (n < 6000) return "Cost of Goods Sold";
  }
  return "Expenses";
}

interface Posting {
  account: string;
  type: string;
  date: string;
  num: string;
  name: string;
  memo: string;
  klass: string;
  /** Debit positive, in cents. */
  amount: number;
  line: number;
}

export function parseQuickBooksDesktopDetail(text: string, options: QuickBooksLedgerOptions = {}): IifFile {
  const records = parseCsvRecords(text);
  const header = headerOf(records);
  const problems: ImportProblem[] = [];
  const accounts: Account[] = [];
  const debitNormal: string[] = [];
  const bankNames: string[] = [];
  const cardNames: string[] = [];
  const classes = new Map<QuickBooksEntry, string>();
  const nothing = (message: string): IifFile => ({
    chart: { accounts: [], debitNormal: [], bankNames: [], cardNames: [] },
    entries: [],
    contacts: [],
    classes,
    items: [],
    problems: [{ line: 1, row: [], message }],
  });
  if (header === null) return nothing("Not QuickBooks Desktop's Transaction Detail by Account.");
  const col = (name: string): number => header.at.get(name) ?? -1;
  const typeAt = col("Type");
  const currency = options.currency ?? "USD";
  const get = (fields: readonly string[], name: string): string => {
    const n = col(name);
    return n < 0 ? "" : (fields[n] ?? "").trim();
  };

  // The headings open above a posting, outermost first, with what each has seen.
  const open: { name: string; number: string; depth: number; debit: number; credit: number }[] = [];
  const postings: Posting[] = [];
  const named = new Map<string, string>();
  const failures: string[] = [];

  const addAccount = (path: string, number: string): void => {
    if (named.has(path)) return;
    named.set(path, number);
    const type = typeOfName(path, number);
    const place = quickBooksPlacement(type, /retained earnings/i.test(path) ? "Retained Earnings" : "");
    accounts.push({ code: place.bank ? "" : number, name: path, type: place.type, taxCode: "", description: type === "Credit Card" ? "Credit Card" : "" } as Account);
    if (place.debit) debitNormal.push(path);
    if (place.bank) bankNames.push(path);
    if (place.card) cardNames.push(path);
  };

  for (let r = header.index + 1; r < records.length; r += 1) {
    const { fields, line } = records[r]!;
    const lead = fields.slice(0, Math.max(0, typeAt)).map((c) => c.trim());
    const depth = lead.findIndex((c) => c !== "");
    const type = get(fields, "Type");
    if (type === "") {
      if (depth < 0) continue;
      const said = lead[depth] ?? "";
      if (/^total$/i.test(said)) continue; // the report's grand total
      const total = /^Total\s+(.+)$/.exec(said);
      if (total !== null) {
        // The account this closes, and what QuickBooks says it came to.
        const shut = open.pop();
        if (shut === undefined) continue;
        const debit = parseAmount(get(fields, "Debit") || "0", currency) ?? 0;
        const credit = parseAmount(get(fields, "Credit") || "0", currency) ?? 0;
        if (debit !== shut.debit || credit !== shut.credit) {
          failures.push(
            `${shut.name}: its lines come to ${(shut.debit / 100).toFixed(2)} debit and ${(shut.credit / 100).toFixed(2)} credit, ` +
              `but QuickBooks totals it ${(debit / 100).toFixed(2)} and ${(credit / 100).toFixed(2)}`,
          );
        }
        continue;
      }
      // A heading: an account, or a sub-account beneath the one above it.
      while (open.length > 0 && (open[open.length - 1]?.depth ?? 0) >= depth) open.pop();
      const { name, number } = splitNumber(said);
      open.push({ name, number, depth, debit: 0, credit: 0 });
      continue;
    }
    if (open.length === 0) {
      problems.push({ line, row: [...fields], message: "A posting with no account above it" });
      continue;
    }
    const date = parseDate(get(fields, "Date"), { dayFirst: options.dayFirst ?? false });
    const debit = parseAmount(get(fields, "Debit") || "0", currency);
    const credit = parseAmount(get(fields, "Credit") || "0", currency);
    if (date === null || debit === null || credit === null) {
      failures.push(`line ${line}: an unreadable date or amount`);
      continue;
    }
    for (const heading of open) {
      heading.debit += debit;
      heading.credit += credit;
    }
    // The account is the innermost heading, named by its whole path.
    const path = open.map((h) => h.name).join(":");
    addAccount(path, open[open.length - 1]?.number ?? "");
    postings.push({
      account: path,
      type,
      date,
      num: get(fields, "Num"),
      name: get(fields, "Name"),
      memo: get(fields, "Memo"),
      klass: get(fields, "Class"),
      amount: debit - credit,
      line,
    });
  }

  // Put back together: by type, date and name first, then by number where
  // the rows carry one -- a journal entry's number is printed on some of its
  // lines only, so a row with none goes with the numbered group it balances.
  const groups = new Map<string, Posting[]>();
  for (const p of postings) {
    const key = `${p.type}\u0000${p.date}\u0000${p.name}`;
    const list = groups.get(key) ?? [];
    list.push(p);
    groups.set(key, list);
  }
  const entries: QuickBooksEntry[] = [];
  const sum = (list: readonly Posting[]): number => list.reduce((s, p) => s + p.amount, 0);
  const entryOf = (list: Posting[]): void => {
    const first = list[0]!;
    const entry: QuickBooksEntry = {
      date: first.date as QuickBooksEntry["date"],
      type: first.type,
      num: list.find((p) => p.num !== "")?.num ?? "",
      name: first.name,
      memo: list.find((p) => p.memo !== "")?.memo ?? "",
      legs: list.map((p) => ({ account: p.account, debit: p.amount, memo: p.memo })),
    };
    const klass = list.find((p) => p.klass !== "")?.klass;
    if (klass !== undefined) classes.set(entry, klass);
    entries.push(entry);
  };
  for (const list of groups.values()) {
    const nums = [...new Set(list.map((p) => p.num).filter((n) => n !== ""))];
    if (nums.length <= 1) {
      if (sum(list) !== 0) failures.push(`${list[0]!.type} ${list[0]!.date} ${list[0]!.name || list[0]!.memo}: does not balance`);
      else entryOf(list);
      continue;
    }
    const byNum = nums.map((n) => list.filter((p) => p.num === n));
    const loose = list.filter((p) => p.num === "");
    // Each numberless row to the numbered group it brings to balance.
    for (const p of loose) {
      const home = byNum.find((g) => sum(g) + p.amount === 0) ?? byNum.find((g) => sum(g) !== 0);
      if (home !== undefined) home.push(p);
      else byNum.push([p]);
    }
    for (const g of byNum) {
      if (sum(g) !== 0) failures.push(`${g[0]!.type} ${g[0]!.date} ${g[0]!.num} ${g[0]!.name}: does not balance`);
      else entryOf(g);
    }
  }

  if (failures.length > 0) {
    return nothing(
      `QuickBooks Desktop's report was not taken: ${failures.slice(0, 5).join("; ")}` +
        (failures.length > 5 ? `; and ${failures.length - 5} more` : "") +
        ". Export it again with all dates and every account.",
    );
  }
  const chart: QuickBooksChart = { accounts, debitNormal, bankNames, cardNames };
  return { chart, entries, contacts: [], classes, items: [], problems };
}

/** Everything QuickBooks Desktop's Transaction Detail by Account holds, as this app keeps it. */
export function parseQuickBooksDesktopDetailBooks(
  text: string,
  chart: QuickBooksChart | null,
  options: QuickBooksLedgerOptions = {},
): ReadBooks {
  return booksWithChart(
    parseQuickBooksDesktopDetail(text, options),
    chart,
    options,
    "transaction-detail-by-account.csv",
    "quickbooks-desktop-detail",
  );
}
