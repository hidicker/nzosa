import { findHeaderRow } from "../csv.js";
import { parseAmount } from "../money.js";
import { parseDate } from "../dates.js";
import { ColumnReader, scoreColumns } from "./shared.js";
import type {
  DetectionResult,
  Importer,
  ImportProblem,
  ImportResult,
  Transaction,
} from "../types.js";

const ID = "bnz-card";
const LABEL = "BNZ credit card";

const REQUIRED = ["Date", "Amount", "Payee", "Tran Type"];
const DISTINCTIVE = ["Particulars", "Code", "Reference", "Processed Date"];

/**
 * The card feed encodes the original billed amount in the `Code` column as a
 * currency prefix followed by minor units: `NZD2599` is NZD 25.99, `USD2900`
 * is USD 29.00 on a purchase that was converted to NZD in `Amount`.
 */
const ORIGINAL_AMOUNT = /^([A-Za-z]{3})(\d+)$/;

/**
 * BNZ credit card export (Advantage Visa Platinum / Classic).
 *
 * Sparser than the account feed: no serial, no batch, no account numbers. That
 * makes deduplication rely on date + amount + payee, which is why the card
 * feeds are the ones that need the "legitimate duplicate" allowlist.
 */
export const bnzCard: Importer = {
  id: ID,
  label: LABEL,
  description: "Internet Banking > select credit card > Export. Choose CSV with headers.",

  detect(records): DetectionResult {
    const result = scoreColumns(records, REQUIRED, DISTINCTIVE, ID, LABEL);
    if (result.score === 0) return result;

    // Both BNZ feeds share this column core. `This Party Account` only exists
    // on the transaction-account export, so its presence means this file
    // belongs to the other importer and this one should stand down.
    const header = findHeaderRow(records, REQUIRED);
    if (header?.columns.has("thispartyaccount")) {
      return { importer: ID, score: 0, reason: "has This Party Account: an account export, not a card" };
    }
    return result;
  },

  parse(records, context): ImportResult {
    const header = findHeaderRow(records, REQUIRED);
    const transactions: Transaction[] = [];
    const problems: ImportProblem[] = [];

    if (!header) {
      return {
        importer: ID,
        file: context.file,
        account: context.account,
        transactions,
        problems: [
          { line: 1, row: [], message: `Not a ${LABEL} export: no header row found.` },
        ],
      };
    }

    const currency = context.defaultCurrency ?? "NZD";
    const dayFirst = context.dayFirst ?? true;
    const reader = new ColumnReader(header.columns);

    for (let i = header.index + 1; i < records.length; i += 1) {
      const record = records[i];
      if (!record) continue;
      const { fields, line } = record;

      const cells = reader.at(fields);
      const date = parseDate(cells.get("Date"), { dayFirst });
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
      const foreign = parseOriginalAmount(code, amount, currency);

      const extras: Record<string, string> = {};
      const processed = parseDate(cells.get("Processed Date"), { dayFirst });
      if (processed !== null && processed !== date) extras.processedDate = processed;
      // `BNZCreditCards` exports carry a card name; keep it so several cards
      // can share one file without losing which is which.
      const card = cells.get("Account", "Card");
      if (card !== "") extras.card = card;

      transactions.push({
        id: "",
        occurrence: 1,
        date,
        amount,
        currency,
        serial: "",
        trn: "",
        particulars: cells.get("Particulars"),
        code,
        reference: cells.get("Reference"),
        otherParty: cells.get("Payee"),
        origin: "",
        type: cells.get("Tran Type"),
        batch: "",
        otherPartyAccount: "",
        account: card !== "" ? `${context.account}:${card}` : context.account,
        ...(foreign ? { foreign } : {}),
        extras,
        source: { importer: ID, file: context.file, line },
      });
    }

    return {
      importer: ID,
      file: context.file,
      account: context.account,
      transactions,
      problems,
    };
  },
};

/**
 * Read `USD2900` into a foreign-currency leg.
 *
 * Returns undefined when the code is absent, unparseable, or already in the
 * account currency -- a NZD purchase on a NZD card has no foreign leg to record.
 */
function parseOriginalAmount(
  code: string,
  amount: number,
  accountCurrency: string,
): { currency: string; amount: number } | undefined {
  const match = ORIGINAL_AMOUNT.exec(code);
  if (!match) return undefined;

  const currency = (match[1] ?? "").toUpperCase();
  if (currency === accountCurrency.toUpperCase()) return undefined;

  const digits = match[2] ?? "";
  // The code is already in minor units, so it is read as an integer rather
  // than through parseAmount, which would treat it as a major-unit decimal.
  const value = Number(digits);
  if (!Number.isFinite(value)) return undefined;

  return { currency, amount: Math.sign(amount) * value };
}
