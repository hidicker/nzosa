import { parseCsvRecords } from "./csv.js";
import type { ReadonlyCsvRecord } from "./csv.js";
import { parseDate } from "./dates.js";
import { dedupeKey } from "./dedupe.js";
import { hash } from "./hash.js";
import { parseAmount } from "./money.js";
import type { ImportProblem, ImportResult, Transaction } from "./types.js";

/**
 * A bank file no importer knows, read by pointing out its columns.
 *
 * Banks lay their exports out every which way: one amount column or a pair
 * (money out, money in), the payee in its own column or folded into a
 * description, the date day first or month first. Rather than refuse a file
 * whose layout nothing recognises, the columns are guessed from the headings
 * and the data, shown, corrected where they are wrong, and remembered by the
 * file's headings so the next file from the same bank goes straight in.
 */

/** Which column holds what: indexes into the header row, or -1 for none. */
export interface BankLayout {
  /** The header row's position in the file. */
  headerRow: number;
  date: number;
  /** One signed amount, money out negative. Or -1, and the pair below. */
  amount: number;
  moneyOut: number;
  moneyIn: number;
  payee: number;
  description: number;
  reference: number;
  balance: number;
  /**
   * Which bank account each line is on, for a file that holds several. -1 or
   * absent (layouts kept before there was one) for a file of one account.
   */
  account?: number;
  /** Day first (13/04), month first (04/13), or null when the dates settle it themselves. */
  dayFirst: boolean | null;
  /** An amount column that shows money out as positive: turn it round. */
  outPositive?: boolean;
}

export interface BankLayoutGuess {
  layout: BankLayout;
  /** The header row's cells, as the file has them. */
  columns: string[];
  /** A few rows under the header, to show beside the choices. */
  sample: string[][];
}

const has = (text: string, ...words: RegExp[]): boolean => words.some((w) => w.test(text));

const DATE_WORDS = [/\bdate\b/i, /\bposted\b/i, /\bposting\b/i, /\bvalue date\b/i];
const AMOUNT_WORDS = [/^amount\b/i, /\bamount\b/i, /\bvalue\b/i, /\bsum\b/i];
const OUT_WORDS = [/\bdebit\b/i, /\bwithdraw/i, /\bmoney out\b/i, /\bpaid out\b/i, /\bspent\b/i, /\bpayments?\b/i, /\bout\b/i, /\bdr\b/i];
const IN_WORDS = [/\bcredit\b/i, /\bdeposit/i, /\bmoney in\b/i, /\bpaid in\b/i, /\breceived\b/i, /\breceipts?\b/i, /\bin\b/i, /\bcr\b/i];
const PAYEE_WORDS = [/\bpayee\b/i, /\bname\b/i, /\bother party\b/i, /\bmerchant\b/i, /\bfrom\/to\b/i, /\bcounterparty\b/i, /\bbeneficiary\b/i];
const DESCRIPTION_WORDS = [/\bdescription\b/i, /\bdetails?\b/i, /\bnarrative\b/i, /\bmemo\b/i, /\bparticulars\b/i, /\bnarration\b/i, /\btransaction\b/i];
const REFERENCE_WORDS = [/\breference\b/i, /\bref\b/i, /\bcode\b/i, /\bcheque\b/i, /\bcheck\b/i];
const BALANCE_WORDS = [/\bbalance\b/i];
/** The account itself, not the other party's: "Account", "Account name", "Acct no". */
const ACCOUNT_WORDS = [/^\s*(bank\s+)?(account|acct|a\/c)(\s+(name|number|no\.?|#))?\s*$/i];

const looksLikeDate = (cell: string): boolean =>
  /^\s*(\d{1,4}[\/\-.]\d{1,2}[\/\-.]\d{1,4}|\d{1,2}\s+[a-z]{3,9}\s+\d{2,4})/i.test(cell);
const looksLikeMoney = (cell: string): boolean => /^\s*[-+(]?\s*[$£€¥₩]?\s*-?[\d,]+(\.\d+)?\s*\)?\s*(cr|dr)?\s*$/i.test(cell) && /\d/.test(cell);

/**
 * The header row: the first row of several cells with a date in the row under
 * it. -1 when the file has none -- Commonwealth Bank's export, among others,
 * starts straight in with a dated line -- so every row is a line.
 */
function headerRowOf(records: readonly ReadonlyCsvRecord[]): number {
  for (let i = 0; i < Math.min(records.length - 1, 30); i += 1) {
    const row = records[i]?.fields ?? [];
    const next = records[i + 1]?.fields ?? [];
    const filled = row.filter((c) => c.trim() !== "").length;
    if (filled >= 2 && row.every((c) => !looksLikeDate(c)) && next.some(looksLikeDate)) return i;
  }
  return (records[0]?.fields ?? []).some(looksLikeDate) ? -1 : 0;
}

/** The headings, or for a file with none, "Column 1", "Column 2" and so on. */
function headingsOf(records: readonly ReadonlyCsvRecord[], headerRow: number): string[] {
  if (headerRow >= 0) return [...(records[headerRow]?.fields ?? [])].map((c) => c.trim());
  const widest = Math.max(0, ...records.slice(0, 20).map((r) => r.fields.length));
  return Array.from({ length: widest }, (_, i) => `Column ${i + 1}`);
}

/** Which way round the dates go, from any with a part past 12; null when none says. */
function dateOrderIn(rows: readonly (readonly string[])[], column: number): boolean | null {
  let first = false;
  let second = false;
  for (const row of rows) {
    const match = /^\s*(\d{1,2})[\/\-.](\d{1,2})[\/\-.]\d{2,4}/.exec(row[column] ?? "");
    if (match === null) continue;
    if (Number(match[1]) > 12) first = true;
    if (Number(match[2]) > 12) second = true;
  }
  if (first && !second) return true;
  if (second && !first) return false;
  return null;
}

/** A first guess at a file's layout, from its headings and what is under them. */
export function guessBankLayout(text: string): BankLayoutGuess {
  const records = parseCsvRecords(text);
  const headerRow = headerRowOf(records);
  const columns = headingsOf(records, headerRow);
  const body = records.slice(headerRow + 1).map((r) => [...r.fields]).filter((r) => r.some((c) => c.trim() !== ""));
  const sample = body.slice(0, 5);
  const taken = new Set<number>();
  const pick = (words: RegExp[], test?: (column: number) => boolean): number => {
    const at = columns.findIndex((name, i) => !taken.has(i) && has(name, ...words) && (test === undefined || test(i)));
    if (at >= 0) taken.add(at);
    return at;
  };
  const mostly = (column: number, check: (cell: string) => boolean): boolean => {
    const cells = body.slice(0, 40).map((r) => r[column] ?? "").filter((c) => c.trim() !== "");
    return cells.length > 0 && cells.filter(check).length >= cells.length * 0.8;
  };

  let date = pick(DATE_WORDS, (i) => mostly(i, looksLikeDate));
  if (date < 0) {
    date = columns.findIndex((_, i) => !taken.has(i) && mostly(i, looksLikeDate));
    if (date >= 0) taken.add(date);
  }
  const balance = pick(BALANCE_WORDS);
  const moneyOut = pick(OUT_WORDS, (i) => mostly(i, looksLikeMoney));
  const moneyIn = moneyOut >= 0 ? pick(IN_WORDS, (i) => mostly(i, looksLikeMoney)) : -1;
  let amount = -1;
  if (moneyOut < 0 || moneyIn < 0) {
    if (moneyOut >= 0) taken.delete(moneyOut);
    amount = pick(AMOUNT_WORDS, (i) => mostly(i, looksLikeMoney));
    if (amount < 0) {
      amount = columns.findIndex((_, i) => !taken.has(i) && mostly(i, looksLikeMoney));
      if (amount >= 0) taken.add(amount);
    }
  }
  const account = pick(ACCOUNT_WORDS);
  const payee = pick(PAYEE_WORDS);
  let description = pick(DESCRIPTION_WORDS);
  const reference = pick(REFERENCE_WORDS);
  // With no headings to go by, the contents say. A running balance is the
  // money column that moves by each line's amount; what each line was is the
  // column of words.
  let found = balance;
  if (found < 0 && amount >= 0) {
    const cents = (cell: string | undefined): number | null => {
      const n = Number((cell ?? "").replace(/[,$\s+]/g, ""));
      return (cell ?? "").trim() === "" || !Number.isFinite(n) ? null : Math.round(n * 100);
    };
    found = columns.findIndex((_, i) => {
      if (taken.has(i) || !mostly(i, looksLikeMoney)) return false;
      let agree = 0;
      let tried = 0;
      for (let r = 1; r < Math.min(body.length, 40); r += 1) {
        const before = cents(body[r - 1]?.[i]);
        const now = cents(body[r]?.[i]);
        const moved = cents(body[r]?.[amount]);
        if (before === null || now === null || moved === null) continue;
        tried += 1;
        // Newest first or oldest first, the balance moves by the line either way.
        if (now - before === moved || before - now === cents(body[r - 1]?.[amount])) agree += 1;
      }
      return tried > 0 && agree >= tried * 0.8;
    });
    if (found >= 0) taken.add(found);
  }
  if (payee < 0 && description < 0) {
    description = columns.findIndex(
      (_, i) => !taken.has(i) && mostly(i, (c) => /[a-z]{3}/i.test(c) && !looksLikeDate(c) && !looksLikeMoney(c)),
    );
    if (description >= 0) taken.add(description);
  }
  const pair = amount < 0 && moneyOut >= 0 && moneyIn >= 0;
  return {
    layout: {
      headerRow,
      date,
      amount: pair ? -1 : amount,
      moneyOut: pair ? moneyOut : -1,
      moneyIn: pair ? moneyIn : -1,
      payee,
      description,
      reference,
      balance: found,
      account,
      dayFirst: date < 0 ? null : dateOrderIn(body, date),
    },
    columns,
    sample,
  };
}

/** What a layout is known by: the file's headings, in order, without case or spacing. */
export function layoutSignature(columns: readonly string[]): string {
  return columns.map((c) => c.trim().toLowerCase().replace(/\s+/g, " ")).join("|");
}

/** The headings of a file, for looking up a layout remembered for them. */
export function bankFileSignature(text: string): string {
  const records = parseCsvRecords(text);
  // A file with no headings is known by its column count: "column 1|column 2|...",
  // the names the layout was chosen and kept under.
  return layoutSignature(headingsOf(records, headerRowOf(records)));
}

/** What is wrong with a layout before it can be used, or null. */
export function layoutProblem(layout: BankLayout): string | null {
  if (layout.date < 0) return "Choose the column with the date.";
  if (layout.amount < 0 && (layout.moneyOut < 0 || layout.moneyIn < 0)) {
    return "Choose the amount column, or both the money out and money in columns.";
  }
  if (layout.payee < 0 && layout.description < 0) return "Choose a column saying who or what each line was.";
  return null;
}

/** A money cell's value in cents, minus signs, brackets and DR/CR read. */
function moneyOf(cell: string, currency: string): number | null {
  const text = cell.trim();
  if (text === "") return 0;
  const negative = /^\(.*\)$/.test(text) || /\bdr\b/i.test(text);
  const value = parseAmount(text.replace(/[()]/g, "").replace(/\b(cr|dr)\b/gi, "").trim(), currency);
  if (value === null) return null;
  return negative ? -Math.abs(value) : value;
}

/** `Business Cheque 123` as `business-cheque-123`: an id for an account the file names. */
function accountIdOf(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "bank"
  );
}

/**
 * The file's lines, read with a layout: ids and occurrence numbers given the
 * same way every importer gives them, so a file read this way and the same
 * lines read any other way are recognised as the same.
 */
export function importWithLayout(
  text: string,
  layout: BankLayout,
  options: { file: string; account: string; accountLabel?: string; currency: string; dayFirst?: boolean },
): ImportResult {
  const records = parseCsvRecords(text);
  const transactions: Transaction[] = [];
  const problems: ImportProblem[] = [];
  const dayFirst = layout.dayFirst ?? options.dayFirst ?? true;
  const cell = (fields: readonly string[], at: number): string => (at < 0 ? "" : (fields[at] ?? "").trim());
  // A file naming several accounts puts each line on its own; naming one (or
  // none), every line goes on the account chosen for the file, as before.
  const accountColumn = layout.account ?? -1;
  const named = new Set<string>();
  if (accountColumn >= 0) {
    for (const record of records.slice(layout.headerRow + 1)) {
      const name = cell(record.fields, accountColumn);
      if (name !== "") named.add(name);
    }
  }
  const several = named.size > 1;
  for (const record of records.slice(layout.headerRow + 1)) {
    const { fields, line } = record;
    if (fields.every((f) => f.trim() === "")) continue;
    const date = parseDate(cell(fields, layout.date), { dayFirst });
    let amount: number | null;
    if (layout.amount >= 0) {
      const raw = moneyOf(cell(fields, layout.amount), options.currency);
      amount = raw === null ? null : layout.outPositive === true ? -raw : raw;
    } else {
      const out = moneyOf(cell(fields, layout.moneyOut), options.currency);
      const into = moneyOf(cell(fields, layout.moneyIn), options.currency);
      amount = out === null || into === null ? null : Math.abs(into) - Math.abs(out);
    }
    if (date === null) {
      // A total or a footer line has no date: said, not imported.
      problems.push({ line, row: [...fields], message: `No date in ${JSON.stringify(cell(fields, layout.date))}` });
      continue;
    }
    if (amount === null) {
      problems.push({ line, row: [...fields], message: "Unreadable amount" });
      continue;
    }
    if (amount === 0) continue;
    const payee = cell(fields, layout.payee);
    const description = cell(fields, layout.description);
    const balance = layout.balance >= 0 ? moneyOf(cell(fields, layout.balance), options.currency) : null;
    const accountName = several ? cell(fields, accountColumn) : "";
    const label = accountName !== "" ? accountName : options.accountLabel;
    transactions.push({
      id: "",
      occurrence: 1,
      date,
      amount,
      currency: options.currency,
      serial: "",
      trn: "",
      particulars: description,
      code: "",
      reference: cell(fields, layout.reference),
      otherParty: payee || description,
      origin: "",
      type: amount < 0 ? "DEBIT" : "CREDIT",
      batch: "",
      otherPartyAccount: "",
      account: accountName !== "" ? accountIdOf(accountName) : options.account,
      extras: {
        ...(label !== undefined ? { accountLabel: label } : {}),
        ...(balance !== null && balance !== 0 ? { balance: (balance / 100).toFixed(2) } : {}),
      },
      source: { importer: "columns", file: options.file, line },
    });
  }
  // Numbered and given ids as every importer's lines are.
  const counts = new Map<string, number>();
  for (const t of transactions) {
    const key = dedupeKey(t);
    const next = (counts.get(key) ?? 0) + 1;
    counts.set(key, next);
    t.occurrence = next;
  }
  for (const t of transactions) t.id = hash(dedupeKey(t));
  return {
    importer: "columns",
    file: options.file,
    account: several ? (transactions[0]?.account ?? options.account) : options.account,
    transactions,
    problems,
  };
}
