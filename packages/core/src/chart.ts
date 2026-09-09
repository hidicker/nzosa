import { findHeaderRow, parseCsvRecords } from "./csv.js";
import { ColumnReader } from "./importers/shared.js";
import type { GstSide, GstTreatment } from "./gst.js";

/**
 * The chart of accounts.
 *
 * Without one, an account code is whatever string a rule happened to use, and
 * the same account appears under several spellings -- `200` and `200 - Sales`,
 * `506 - Stripe Fees` and `506 Stripe Fees`. Nothing that groups or compares by
 * account can be trusted until they resolve to one thing.
 *
 * The chart also carries a default tax treatment per account, which is the same
 * information our rules have been maintaining by hand.
 */

export interface Account {
  /** Chart code, e.g. `200`. Bank accounts in Xero's export have none. */
  code: string;
  name: string;
  /** The account type, e.g. `Revenue`, `Overhead`, `Current Liability`. */
  type: string;
  /** Tax code as the source names it, e.g. `15% GST on Income`. */
  taxCode: string;
  description: string;
  /**
   * Which entity this account belongs to.
   *
   * Xero has no such column, so it is only present in a file this app wrote.
   * Reading it back is what makes the chart the place entity assignments live,
   * rather than a browser database nobody can back up or diff.
   */
  entity?: string;
  /**
   * The GST treatment this app applies to anything coded here, in the wording
   * the app itself uses: `standard`, `out-of-scope`, `imports`, or a
   * percentage such as `standard 50%` for a half-deductible account.
   */
  gstTreatment?: string;
  /** Owners of this account's entity, e.g. `Ana 50%; Tom 50%`. */
  entityOwners?: string;
  /** What kind of income the entity produces: residential, commercial, business. */
  entityKind?: string;
  /**
   * For a bank account: which account in this ledger it is.
   *
   * The same real account has two names and neither system knows the other's.
   * A chart calls it "Platinum Credit Card used for Business Transactions";
   * the bank feed calls it by the id it issues. Import the chart and then the
   * transactions and both appear, so one card is two accounts -- one with a
   * name and no money, one with money and no name -- and no amount of matching
   * on words can safely join them, because to a computer that name and "BNZ
   * Advantage Visa Platinum" have nothing in common.
   *
   * So it is said once, by the person who knows, and kept with the chart where
   * the rest of the setup lives. Empty means not yet said; `none` means said
   * and the answer is that this ledger holds no money in it.
   */
  ledgerAccount?: string;
}

export interface ChartImportResult {
  accounts: Account[];
  problems: { message: string; line: number }[];
}

const REQUIRED = ["*Code", "*Name", "*Type"];

/** Read a Xero chart-of-accounts export. */
export function parseChartOfAccounts(text: string): ChartImportResult {
  const records = parseCsvRecords(text);
  const header = findHeaderRow(records, REQUIRED);

  if (!header) {
    return {
      accounts: [],
      problems: [{ message: "Not a chart of accounts: required columns missing.", line: 0 }],
    };
  }

  const reader = new ColumnReader(header.columns);
  const accounts: Account[] = [];
  const problems: { message: string; line: number }[] = [];
  const seen = new Set<string>();

  for (let i = header.index + 1; i < records.length; i += 1) {
    const record = records[i];
    if (!record) continue;

    const cells = reader.at(record.fields);
    const name = cells.get("*Name");
    if (name === "") continue;

    const code = cells.get("*Code");
    if (code !== "" && seen.has(code)) {
      problems.push({ message: `duplicate account code ${code}`, line: record.line });
    }
    if (code !== "") seen.add(code);

    // Our own columns, absent from a Xero export and present in one this app
    // wrote. Absent is not the same as empty: an empty cell in a file that has
    // the column means "deliberately unassigned".
    const entity = cells.get("Entity");
    const gstTreatment = cells.get("GST Treatment");
    const entityOwners = cells.get("Entity Owners");
    const entityKind = cells.get("Entity Kind");
    const ledgerAccount = cells.get("Ledger Account");

    accounts.push({
      code,
      name,
      type: cells.get("*Type"),
      taxCode: cells.get("*Tax Code"),
      description: cells.get("Description"),
      ...(entity !== "" ? { entity } : {}),
      ...(gstTreatment !== "" ? { gstTreatment } : {}),
      ...(entityOwners !== "" ? { entityOwners } : {}),
      ...(entityKind !== "" ? { entityKind } : {}),
      ...(ledgerAccount !== "" ? { ledgerAccount } : {}),
    });
  }

  return { accounts, problems };
}

/**
 * Resolve one of our free-text codes to a chart account.
 *
 * Three ways, in order of how much they can be trusted:
 *
 *  1. a chart code appearing anywhere in the string -- the workbook writes
 *     `NB Sales - 200` with the code at the end, while rules write `200 - Sales`
 *     with it at the front, and both mean account 200;
 *  2. an exact account name;
 *  3. a name ignoring case, spacing and punctuation.
 *
 * Returns null rather than guessing. A code belonging to a different entity --
 * `Totara Place Rates`, `Home Loan ANZ 1001 Interest` -- genuinely has no place in
 * this chart, and inventing a match for it would be worse than saying so.
 */
export function resolveAccount(text: string, accounts: readonly Account[]): Account | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;

  const byCode = new Map(accounts.filter((a) => a.code !== "").map((a) => [a.code, a]));
  for (const digits of trimmed.match(/\d{3,4}/g) ?? []) {
    const hit = byCode.get(digits);
    if (hit) return hit;
  }

  const exact = accounts.find((a) => a.name === trimmed);
  if (exact) return exact;

  const flatten = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
  const flat = flatten(trimmed);
  const loose = accounts.filter((a) => flatten(a.name) === flat);
  // Only when unambiguous: two accounts flattening to the same name is a
  // question for a person, not something to resolve by picking the first.
  return loose.length === 1 ? (loose[0] ?? null) : null;
}

/**
 * The GST treatment an account implies, from its tax code.
 *
 * A default, not a rule: the account says what is normally true, and a
 * transaction's own coding or an override still wins.
 *
 * Order matters. "Zero Rated Income" and "GST on Imports" both contain a word
 * the standard-rated tests look for, so the specific treatments are checked
 * first and the plain income/expense codes are what is left.
 */
export function accountTreatment(
  account: Account,
): { treatment: GstTreatment; side?: GstSide } | null {
  const code = account.taxCode.toLowerCase();
  if (code === "") return null;

  // GST charged at the border is the tax itself rather than a tax-inclusive
  // cost, and is claimed through Box 13.
  if (code.includes("import")) return { treatment: "standard", side: "imports" };

  if (code.includes("exempt")) return { treatment: "exempt", side: "none" };
  if (code.includes("no gst")) return { treatment: "out-of-scope", side: "none" };

  // Side is left open on zero-rated: exports are sales and a zero-rated
  // purchase is a purchase, and the sign of the transaction says which without
  // having to guess from the account.
  if (code.includes("zero")) return { treatment: "zero-rated" };

  if (code.includes("income")) return { treatment: "standard", side: "sales" };
  if (code.includes("expense")) return { treatment: "standard", side: "purchases" };
  return null;
}

/** Columns a Xero import expects, in the order it expects them. */
const XERO_COLUMNS = [
  "*Code",
  "*Name",
  "*Type",
  "*Tax Code",
  "Description",
  "Dashboard",
  "Expense Claims",
  "Enable Payments",
] as const;

/** Our own columns, appended so the file still imports into Xero unchanged. */
const OUR_COLUMNS = [
  "Entity",
  "GST Treatment",
  "Entity Owners",
  "Entity Kind",
  "Ledger Account",
] as const;

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * Write a chart of accounts back out.
 *
 * Deliberately the same shape Xero exports, with our two columns on the end
 * rather than woven in: a spreadsheet or Xero itself reads the file either
 * way, and a column it does not know about is ignored rather than fatal. That
 * keeps one file as the source of truth for what the accounts are, which
 * entity each belongs to, and how each is treated for GST -- instead of the
 * last two living only in a browser database.
 */
export function formatChartOfAccounts(accounts: readonly Account[]): string {
  const lines = [[...XERO_COLUMNS, ...OUR_COLUMNS].join(",")];

  for (const account of accounts) {
    lines.push(
      [
        account.code,
        account.name,
        account.type,
        account.taxCode,
        account.description,
        "",
        "",
        "",
        account.entity ?? "",
        account.gstTreatment ?? "",
        account.entityOwners ?? "",
        account.entityKind ?? "",
        account.ledgerAccount ?? "",
      ]
        .map(csvCell)
        .join(","),
    );
  }

  return `${lines.join("\r\n")}\r\n`;
}
