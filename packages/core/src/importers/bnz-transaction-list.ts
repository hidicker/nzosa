import { normaliseHeader } from "../csv.js";
import type { ReadonlyCsvRecord } from "../csv.js";
import { parseAmount } from "../money.js";
import { parseDate } from "../dates.js";
import { accountId, isAccountNumber, normaliseAccountNumber } from "../accounts.js";
import { ColumnReader } from "./shared.js";
import type {
  DetectionResult,
  Importer,
  ImportProblem,
  ImportResult,
  Transaction,
} from "../types.js";

const ID = "bnz-transaction-list";
const LABEL = "BNZ transaction list (all accounts)";

/**
 * The full canonical column set BNZ uses for this export.
 *
 * It is worth noting that this is exactly the thirteen-column shape the source
 * workbook normalises everything else into -- the spreadsheet's canonical row
 * was this export all along.
 */
const COLUMNS = [
  "Date",
  "Amount",
  "CCY",
  "Serial",
  "Trn",
  "Particulars",
  "Code",
  "Reference",
  "Other Party",
  "Origin",
  "Type",
  "Batch",
  "Other Party Account",
] as const;

/** `Kea Coffee Roasters - 02-1100-0022001-001`, `Visa Platinum - XXXX-XXXX-XXXX-4003`. */
const BLOCK_LABEL = /^(.+?)\s+-\s+([0-9X]{2,4}(?:-[0-9X]{2,7})+)$/;

/** `USD2300` in the Code column of a card row: USD 23.00 originally billed. */
const ORIGINAL_AMOUNT = /^([A-Za-z]{3})(\d+)$/;

/**
 * BNZ "Transaction list" export covering every account at once.
 *
 * Unlike the per-account exports this is a sequence of blocks: a label line
 * naming the account, a column header, the rows, and a `Total:` footer. Both
 * transaction accounts and credit cards appear, in the same thirteen columns --
 * cards simply leave serial, origin, batch and counterparty account empty.
 *
 * Because each block names its own account, this importer ignores any account
 * supplied by the caller. Getting that wrong would silently merge ten accounts
 * into one and make every balance meaningless.
 */
export const bnzTransactionList: Importer = {
  id: ID,
  label: LABEL,
  description:
    "Internet Banking > Transaction list. Select all accounts and a date range, export as CSV.",

  detect(records): DetectionResult {
    const header = findAnyHeader(records);
    if (!header) {
      return { importer: ID, score: 0, reason: `no ${COLUMNS.length}-column BNZ header row` };
    }

    const blocks = countBlocks(records);
    // Every column is required, so a match is unambiguous. The block count is
    // added to the score so that on a single-account export this still beats
    // any importer matching on a looser subset of the same columns.
    return {
      importer: ID,
      score: COLUMNS.length + blocks,
      reason: `${LABEL}: ${blocks} account block(s)`,
    };
  },

  parse(records, context): ImportResult {
    const transactions: Transaction[] = [];
    const problems: ImportProblem[] = [];
    const accounts: string[] = [];

    const currencyFallback = context.defaultCurrency ?? "NZD";
    const dayFirst = context.dayFirst ?? true;

    let reader: ColumnReader | undefined;
    let account = "";
    let accountLabel = "";
    let pendingLabel: { label: string; reference: string } | undefined;

    for (const record of records) {
      const { fields, line } = record;

      // A block label: a single cell of `Name - AccountReference`.
      if (nonEmptyCount(fields) === 1) {
        const match = BLOCK_LABEL.exec((fields[0] ?? "").trim());
        if (match) {
          pendingLabel = { label: (match[1] ?? "").trim(), reference: (match[2] ?? "").trim() };
          continue;
        }
      }

      if (isHeader(fields)) {
        reader = new ColumnReader(mapColumns(fields));
        if (pendingLabel) {
          accountLabel = pendingLabel.label;
          account = resolveAccount(pendingLabel.label, pendingLabel.reference);
          if (!accounts.includes(account)) accounts.push(account);
          pendingLabel = undefined;
        } else {
          // A header with no label above it means the export shape changed.
          // Guessing the account would silently mis-file every row below it.
          problems.push({
            line,
            row: [...fields],
            message: "Column header with no account label above it; rows below were skipped.",
          });
          reader = undefined;
        }
        continue;
      }

      if (reader === undefined) continue;

      // `Total:,0.00,NZD,Count:,0` closes a block.
      if ((fields[0] ?? "").startsWith("Total:")) {
        reader = undefined;
        account = "";
        accountLabel = "";
        continue;
      }

      const cells = reader.at(fields);
      const date = parseDate(cells.get("Date"), { dayFirst });
      const currency = cells.get("CCY") || currencyFallback;
      const amount = parseAmount(cells.get("Amount"), currency);

      if (date === null || amount === null) {
        problems.push({
          line,
          row: [...fields],
          message:
            date === null
              ? `Unreadable date ${JSON.stringify(cells.get("Date"))}`
              : `Unreadable amount ${JSON.stringify(cells.get("Amount"))}`,
        });
        continue;
      }

      const code = cells.get("Code");

      transactions.push({
        id: "",
        occurrence: 1,
        date,
        amount,
        currency,
        serial: cells.get("Serial"),
        trn: cells.get("Trn"),
        particulars: cells.get("Particulars"),
        code,
        reference: cells.get("Reference"),
        otherParty: cells.get("Other Party"),
        origin: cells.get("Origin"),
        type: cells.get("Type"),
        batch: cells.get("Batch"),
        otherPartyAccount: normaliseAccountNumber(cells.get("Other Party Account")),
        account,
        ...(foreignLeg(code, amount, currency) ?? {}),
        // The human-readable account name is worth keeping: "Kea Coffee
        // Trading" is what appears on the financial statements, while the
        // account id is what has to be stable.
        extras: { accountLabel },
        source: { importer: ID, file: context.file, line },
      });
    }

    return {
      importer: ID,
      file: context.file,
      // A multi-account file has no single account; report what it contained.
      account: accounts.length === 1 ? (accounts[0] as string) : `${accounts.length} accounts`,
      transactions,
      problems,
    };
  },
};

/**
 * Turn a block label into a stable account id.
 *
 * Bank accounts use their account number, which is canonical and survives the
 * account being renamed. Cards are identified only by a masked PAN, so the id
 * combines the label with the last four digits -- enough to stay stable and
 * distinct without recording a card number.
 */
function resolveAccount(label: string, reference: string): string {
  if (isAccountNumber(reference)) return normaliseAccountNumber(reference);

  const lastGroup = reference.split("-").pop() ?? "";
  const digits = /^\d+$/.test(lastGroup) ? lastGroup : "";
  return digits === "" ? accountId(label) : `${accountId(label)}-${digits}`;
}

/** Card rows carry the originally billed currency and amount in `Code`. */
function foreignLeg(
  code: string,
  amount: number,
  accountCurrency: string,
): { foreign: { currency: string; amount: number } } | undefined {
  const match = ORIGINAL_AMOUNT.exec(code);
  if (!match) return undefined;

  const currency = (match[1] ?? "").toUpperCase();
  if (currency === accountCurrency.toUpperCase()) return undefined;

  // Already in minor units, so read as an integer rather than a decimal.
  const value = Number(match[2] ?? "");
  if (!Number.isFinite(value) || value === 0) return undefined;

  return { foreign: { currency, amount: Math.sign(amount) * value } };
}

function isHeader(fields: readonly string[]): boolean {
  if (fields.length < COLUMNS.length) return false;
  return COLUMNS.every((column, index) => normaliseHeader(fields[index] ?? "") === normaliseHeader(column));
}

function mapColumns(fields: readonly string[]): Map<string, number> {
  const columns = new Map<string, number>();
  for (let i = 0; i < fields.length; i += 1) {
    const key = normaliseHeader(fields[i] ?? "");
    if (key !== "" && !columns.has(key)) columns.set(key, i);
  }
  return columns;
}

function findAnyHeader(records: readonly ReadonlyCsvRecord[]): boolean {
  return records.some((record) => isHeader(record.fields));
}

function countBlocks(records: readonly ReadonlyCsvRecord[]): number {
  return records.reduce((total, record) => (isHeader(record.fields) ? total + 1 : total), 0);
}

function nonEmptyCount(fields: readonly string[]): number {
  return fields.reduce((total, field) => (field.trim() === "" ? total : total + 1), 0);
}
