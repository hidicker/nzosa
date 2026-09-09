import { findHeaderRow } from "../csv.js";
import { parseAmount } from "../money.js";
import { parseDate } from "../dates.js";
import { normaliseAccountNumber } from "../accounts.js";
import { ColumnReader, scoreColumns } from "./shared.js";
import type {
  DetectionResult,
  Importer,
  ImportProblem,
  ImportResult,
  Transaction,
} from "../types.js";

const ID = "bnz-account";
const LABEL = "BNZ account";

/** Columns that must be present for this to be a BNZ transaction account export. */
const REQUIRED = ["Date", "Amount", "Payee", "Tran Type", "This Party Account"];

/** Columns that raise confidence but are not fatal if a variant omits them. */
const DISTINCTIVE = [
  "Other Party Account",
  "Serial",
  "Transaction Code",
  "Batch Number",
  "Originating Bank/Branch",
  "Processed Date",
];

/**
 * BNZ transaction account export -- the "Payment" and "Spending" downloads.
 *
 * This is the richest feed: it carries the serial, transaction code and batch
 * number that make deduplication reliable, plus both sides' account numbers.
 */
export const bnzAccount: Importer = {
  id: ID,
  label: LABEL,
  description:
    "Internet Banking > Accounts > select account > Export. Choose CSV with headers.",

  detect(records): DetectionResult {
    return scoreColumns(records, REQUIRED, DISTINCTIVE, ID, LABEL);
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
    let resolvedAccount = context.account;

    for (let i = header.index + 1; i < records.length; i += 1) {
      const record = records[i];
      if (!record) continue;
      const { fields, line } = record;

      const cells = reader.at(fields);
      const date = parseDate(cells.get("Date"), { dayFirst });
      const amount = parseAmount(cells.get("Amount"), currency);

      if (date === null || amount === null) {
        // BNZ appends a "Total:" / "Count:" footer to some exports. Skipping it
        // quietly would be indistinguishable from dropping a real transaction,
        // so every skipped row is reported.
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

      // The account number lives in every row rather than in a header line, so
      // the file itself is authoritative about which account it describes.
      const thisParty = normaliseAccountNumber(cells.get("This Party Account"));
      if (thisParty !== "") resolvedAccount = thisParty;

      const extras: Record<string, string> = {};
      const processed = parseDate(cells.get("Processed Date"), { dayFirst });
      if (processed !== null && processed !== date) extras.processedDate = processed;

      transactions.push({
        id: "",
        occurrence: 1,
        date,
        amount,
        currency,
        serial: cells.get("Serial"),
        trn: cells.get("Transaction Code"),
        particulars: cells.get("Particulars"),
        code: cells.get("Code"),
        reference: cells.get("Reference"),
        otherParty: cells.get("Payee"),
        origin: cells.get("Originating Bank/Branch", "Originating Bank Branch"),
        type: cells.get("Tran Type"),
        batch: cells.get("Batch Number"),
        otherPartyAccount: normaliseAccountNumber(cells.get("Other Party Account")),
        account: thisParty !== "" ? thisParty : context.account,
        extras,
        source: { importer: ID, file: context.file, line },
      });
    }

    return {
      importer: ID,
      file: context.file,
      account: resolvedAccount,
      transactions,
      problems,
    };
  },
};
