import { parseCsvRecords } from "./csv.js";
import { parseDate } from "./dates.js";
import { parseAmount } from "./money.js";
import type { Cents } from "./money.js";
import type { Account } from "./chart.js";
import type { ImportProblem } from "./types.js";
import { quickBooksPlacement } from "./quickbooks.js";
import type { QuickBooksChart, QuickBooksEntry, QuickBooksLedgerOptions } from "./quickbooks.js";
import { booksFromEntries } from "./iif.js";
import type { ReadBooks } from "./iif.js";
import { quickBooksTypeFromName } from "./qb-desktop-detail.js";

/**
 * QuickBooks Online's Export data (the gear > Tools > Export data): one zip of
 * workbooks any user can download, in place of exporting reports one by one.
 *
 * - **Journal**: every transaction, in blocks -- the first row with the date,
 *   type, number and name, one row per account, a totals row, a blank row.
 * - **Balance Sheet** and **Profit and Loss**: each account under the
 *   section that says what it is (Bank Accounts, Credit Cards, Expenses...),
 *   indented three spaces a level, a sub-account beneath its parent.
 * - **Trial Balance**: on the accrual basis, what the Journal must come to.
 *   On the cash basis it does not, and is set aside.
 * - **Customers** and **Vendors**: read by the contact list reader.
 *
 * Every figure is written as formula text, "=4010.00".
 */

/** Read a figure the way the export writes it: "=4010.00", "=-250.00", or plain. */
function figure(text: string, currency: string): Cents | null {
  const plain = text.trim().replace(/^=/, "");
  if (plain === "") return 0;
  return parseAmount(plain, currency);
}

const cells = (fields: readonly string[]): string[] => fields.map((f) => f.trim());

/** The Journal's header row, wherever it sits. */
function journalHeader(records: { fields: readonly string[] }[]): { index: number; at: Map<string, number> } | null {
  for (let i = 0; i < Math.min(records.length, 12); i += 1) {
    const at = new Map<string, number>();
    cells(records[i]?.fields ?? []).forEach((c, n) => {
      if (c !== "" && !at.has(c)) at.set(c, n);
    });
    if (["Date", "Transaction Type", "Account", "Debit", "Credit"].every((n) => at.has(n))) return { index: i, at };
  }
  return null;
}

/** The report's title: the first few rows' text, as "Journal", "Balance Sheet"... */
function titleOf(text: string): string {
  const rows = parseCsvRecords(text.slice(0, 2000)).slice(0, 4);
  return rows.map((r) => cells(r.fields).filter((c) => c !== "").join(" ")).join(" | ");
}

export function isQuickBooksExportJournal(text: string): boolean {
  return /\bJournal\b/.test(titleOf(text)) && journalHeader(parseCsvRecords(text.slice(0, 20000))) !== null;
}

export function isQuickBooksExportStatement(text: string): "balance-sheet" | "profit-and-loss" | "trial-balance" | null {
  const title = titleOf(text);
  if (/\bBalance Sheet\b/i.test(title)) return "balance-sheet";
  if (/\bProfit and Loss\b/i.test(title)) return "profit-and-loss";
  if (/\bTrial Balance\b/i.test(title)) return "trial-balance";
  return null;
}

/** The section headings of the two statements, and the QuickBooks type of an account under each. */
const SECTION_TYPE: Readonly<Record<string, string | null>> = {
  assets: null,
  "current assets": null,
  "bank accounts": "Bank",
  "accounts receivable": "Accounts Receivable (A/R)",
  "other current assets": "Other Current Assets",
  "fixed assets": "Fixed Assets",
  "other assets": "Other Assets",
  "liabilities and equity": null,
  liabilities: null,
  "current liabilities": null,
  "credit cards": "Credit Card",
  "accounts payable": "Accounts Payable (A/P)",
  "other current liabilities": "Other Current Liabilities",
  "long-term liabilities": "Long Term Liabilities",
  "long term liabilities": "Long Term Liabilities",
  equity: "Equity",
  income: "Income",
  "cost of goods sold": "Cost of Goods Sold",
  expenses: "Expenses",
  "other income": "Other Income",
  "other expenses": "Other Expense",
  "other expense": "Other Expense",
};
/** Rows the statements work out, which are not accounts. */
const WORKED = /^(net income|net operating income|net other income|gross profit|total\b)/i;

/** Each account a statement names, by its whole Parent:Child name, with its QuickBooks type. */
export function quickBooksStatementAccounts(text: string): Map<string, string> {
  const out = new Map<string, string>();
  // Untrimmed: the indentation is what says which account is beneath which.
  const rows = parseCsvRecords(text, { trim: false }).map((r) => r.fields);
  // The open headings: sections (which give the type) and parent accounts.
  const stack: { level: number; label: string; section: boolean; type: string | null }[] = [];
  for (const fields of rows) {
    const raw = fields[0] ?? "";
    const label = raw.trim();
    if (label === "" || WORKED.test(label)) continue;
    const level = Math.floor((raw.length - raw.trimStart().length) / 3);
    while (stack.length > 0 && (stack[stack.length - 1]?.level ?? 0) >= level) stack.pop();
    const key = label.toLowerCase();
    // A heading named as a section is one -- unless that section is already
    // open: QuickBooks' own Cost of Goods Sold account sits under the section
    // of the same name.
    const section =
      key in SECTION_TYPE &&
      !fields.slice(1).some((c) => c.trim() !== "") &&
      !stack.some((s) => s.section && s.label.toLowerCase() === key);
    const inherited = [...stack].reverse().find((s) => s.type !== null)?.type ?? null;
    if (section) {
      stack.push({ level, label, section: true, type: SECTION_TYPE[key] ?? inherited });
      continue;
    }
    // An account: its name is its parents' names and its own.
    const path = [...stack.filter((s) => !s.section).map((s) => s.label), label].join(":");
    if (inherited !== null) out.set(path, inherited);
    stack.push({ level, label, section: false, type: inherited });
  }
  return out;
}

/** The trial balance's accounts and their balances, debit positive. */
function trialBalanceOf(text: string, currency: string): { basis: "cash" | "accrual" | null; balances: Map<string, Cents> } {
  const balances = new Map<string, Cents>();
  const rows = parseCsvRecords(text).map((r) => cells(r.fields));
  let basis: "cash" | "accrual" | null = null;
  for (const row of rows) {
    const joined = row.join(" ");
    if (/cash basis/i.test(joined)) basis = "cash";
    if (/accrual basis/i.test(joined)) basis = "accrual";
    const name = row[0] ?? "";
    if (name === "" || /^total$/i.test(name) || row.length < 3) continue;
    const debit = figure(row[1] ?? "", currency);
    const credit = figure(row[2] ?? "", currency);
    if (debit === null || credit === null || (debit === 0 && credit === 0 && !/[=\d]/.test(row[1] ?? "") && !/[=\d]/.test(row[2] ?? ""))) continue;
    balances.set(name, debit - credit);
  }
  return { basis, balances };
}

export interface QuickBooksExportFile {
  name: string;
  text: string;
}

export interface QuickBooksExportBooks extends ReadBooks {
  /** What the trial balance said, where one came: agreed, or each account it differs on. */
  verified: string | null;
}

/** Everything QuickBooks Online's Export data holds, as this app keeps it. */
export function parseQuickBooksExport(
  files: readonly QuickBooksExportFile[],
  chart: QuickBooksChart | null,
  options: QuickBooksLedgerOptions = {},
): QuickBooksExportBooks {
  const currency = options.currency ?? "USD";
  const problems: ImportProblem[] = [];
  const journal = files.find((f) => isQuickBooksExportJournal(f.text));
  const types = new Map<string, string>();
  for (const file of files) {
    const kind = isQuickBooksExportStatement(file.text);
    if (kind === "balance-sheet" || kind === "profit-and-loss") {
      for (const [name, type] of quickBooksStatementAccounts(file.text)) types.set(name, type);
    }
  }

  // The Journal's blocks.
  const entries: QuickBooksEntry[] = [];
  if (journal !== undefined) {
    const records = parseCsvRecords(journal.text);
    const header = journalHeader(records);
    if (header !== null) {
      const at = (row: readonly string[], name: string): string => (row[header.at.get(name) ?? -1] ?? "").trim();
      let entry: QuickBooksEntry | null = null;
      const close = (line: number): void => {
        if (entry === null) return;
        const sum = entry.legs.reduce((s, l) => s + l.debit, 0);
        if (sum !== 0) problems.push({ line, row: [], message: `${entry.date} ${entry.type} ${entry.num}: does not balance and was left out` });
        else if (entry.legs.length > 0) entries.push(entry);
        entry = null;
      };
      for (const { fields, line } of records.slice(header.index + 1)) {
        const row = cells(fields);
        if (row.every((c) => c === "")) {
          close(line);
          continue;
        }
        const dateText = at(row, "Date");
        if (dateText !== "") {
          close(line);
          const date = parseDate(dateText, { dayFirst: options.dayFirst ?? false });
          if (date === null) {
            problems.push({ line, row: [...fields], message: `Unreadable date ${JSON.stringify(dateText)}` });
            continue;
          }
          entry = {
            date,
            type: at(row, "Transaction Type"),
            num: at(row, "Num"),
            name: at(row, "Name"),
            memo: at(row, "Memo/Description"),
            legs: [],
          };
        }
        const account = at(row, "Account");
        // A totals row, a subtotal or an item with no account: not a posting.
        if (entry === null || account === "") continue;
        const debit = figure(at(row, "Debit"), currency);
        const credit = figure(at(row, "Credit"), currency);
        if (debit === null || credit === null) {
          problems.push({ line, row: [...fields], message: "Unreadable debit or credit" });
          continue;
        }
        if (debit === 0 && credit === 0) continue;
        (entry as QuickBooksEntry).legs.push({ account, debit: debit - credit, memo: at(row, "Memo/Description") });
      }
      close(records.length);
    }
  } else {
    problems.push({ line: 0, row: [], message: "The export's Journal was not among the files." });
  }

  // The chart: the books' own where they have one, then each account the
  // Journal names, typed by the statements, by its parent, or by its name.
  const accounts: Account[] = [];
  const debitNormal: string[] = [];
  const bankNames: string[] = [];
  const cardNames: string[] = [];
  const have = new Set((chart?.accounts ?? []).map((a) => a.name.trim().toLowerCase()));
  const used = [...new Set(entries.flatMap((e) => e.legs.map((l) => l.account)))];
  // QuickBooks Online numbers no accounts unless told to: each is given one
  // from its type, clear of the numbers the books already use.
  const taken = new Set((chart?.accounts ?? []).map((a) => a.code).filter((c) => c !== ""));
  const next = new Map<number, number>();
  for (const name of used) {
    if (have.has(name.toLowerCase())) continue;
    const parent = name.split(":").slice(0, -1);
    let type = types.get(name);
    for (let n = parent.length; type === undefined && n > 0; n -= 1) type = types.get(parent.slice(0, n).join(":"));
    type ??= quickBooksTypeFromName(name, "");
    const place = quickBooksPlacement(type, /retained earnings/i.test(name) ? "Retained Earnings" : "");
    let code = "";
    if (place.base !== null) {
      let n = next.get(place.base) ?? place.base;
      while (taken.has(String(n))) n += 10;
      code = String(n);
      taken.add(code);
      next.set(place.base, n + 10);
    }
    accounts.push({ code, name, type: place.type, taxCode: "", description: type === "Credit Card" ? "Credit Card" : "" } as Account);
    if (place.debit) debitNormal.push(name);
    if (place.bank) bankNames.push(name);
    if (place.card) cardNames.push(name);
  }
  const merged: QuickBooksChart = {
    accounts: [...(chart?.accounts ?? []), ...accounts],
    debitNormal: [...(chart?.debitNormal ?? []), ...debitNormal],
    bankNames: [...(chart?.bankNames ?? []), ...bankNames],
    cardNames: [...(chart?.cardNames ?? []), ...cardNames],
  };

  // Checked against the trial balance where it is on the Journal's basis.
  let verified: string | null = null;
  const tb = files.map((f) => (isQuickBooksExportStatement(f.text) === "trial-balance" ? trialBalanceOf(f.text, currency) : null)).find((t) => t !== null && t.basis !== "cash");
  const cashOnly = files.some((f) => isQuickBooksExportStatement(f.text) === "trial-balance" && trialBalanceOf(f.text, currency).basis === "cash");
  if (tb !== undefined && tb !== null) {
    const ours = new Map<string, number>();
    for (const e of entries) for (const l of e.legs) ours.set(l.account, (ours.get(l.account) ?? 0) + l.debit);
    // Assets and liabilities only: QuickBooks' trial balance carries each
    // earlier year's profit in retained earnings, the Journal in the income
    // and expense accounts it was earned in.
    const sheet = new Set(["Bank", "Accounts Receivable", "Current Asset", "Fixed Asset", "Non-current Asset", "Accounts Payable", "Current Liability", "Non-current Liability"]);
    const typeOf = new Map(merged.accounts.map((a) => [a.name, a.type as string]));
    const onSheet = (name: string): boolean => {
      const own = typeOf.get(name);
      if (own !== undefined) return sheet.has(own);
      const t = types.get(name);
      return t !== undefined && sheet.has(quickBooksPlacement(t, "").type);
    };
    const differ: string[] = [];
    for (const name of [...new Set([...ours.keys(), ...tb.balances.keys()])].filter(onSheet)) {
      const a = ours.get(name) ?? 0;
      const b = tb.balances.get(name) ?? 0;
      if (a !== b) differ.push(`${name} ${(a / 100).toFixed(2)} against ${(b / 100).toFixed(2)}`);
    }
    verified =
      differ.length === 0
        ? "every asset and liability balance agrees with QuickBooks' trial balance"
        : `${differ.length} asset and liability balance${differ.length === 1 ? " differs" : "s differ"} from QuickBooks' trial balance: ${differ.slice(0, 5).join("; ")}`;
  } else if (cashOnly) {
    verified = "the trial balance in the export is on the cash basis, which the Journal is not, so it was set aside";
  }

  const books = booksFromEntries(
    { chart: merged, entries, contacts: [], classes: new Map(), items: [], problems },
    merged,
    { ...options, file: options.file ?? journal?.name ?? "Journal.xlsx" },
    "quickbooks-export",
  );
  return { ...books, verified };
}
