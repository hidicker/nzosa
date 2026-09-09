import { findHeaderRow } from "../csv.js";
import { parseAmount, formatAmount } from "../money.js";
import { parseDate } from "../dates.js";
import { ColumnReader, scoreColumns } from "./shared.js";
import type {
  DetectionResult,
  Importer,
  ImportProblem,
  ImportResult,
  Transaction,
} from "../types.js";

const ID = "anz-loan";
const LABEL = "ANZ loan";

const REQUIRED = ["Date", "Details", "Amount"];
const DISTINCTIVE = ["Principal Balance", "Balance"];

/**
 * ANZ home-loan statement export.
 *
 * The thinnest feed of all: date, a `Details` label such as "Loan Interest" or
 * "Loan Payment", an amount, and a running principal balance. There is no
 * serial and no counterparty, so a loan that charges interest twice in a month
 * at the same rate produces genuinely identical rows. The running balance is
 * kept in `extras` and used as a tiebreaker during deduplication.
 */
export const anzLoan: Importer = {
  id: ID,
  label: LABEL,
  description: "ANZ Internet Banking > loan account > Export transactions as CSV.",

  detect(records): DetectionResult {
    const result = scoreColumns(records, REQUIRED, DISTINCTIVE, ID, LABEL);
    if (result.score === 0) return result;

    // `Details` plus no `Payee` is what distinguishes ANZ from the BNZ feeds.
    const header = findHeaderRow(records, REQUIRED);
    if (header?.columns.has("payee")) {
      return { importer: ID, score: 0, reason: "has Payee: a BNZ-style export" };
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
          { line: 1, row: [], message: `Not an ${LABEL} export: no header row found.` },
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

      const extras: Record<string, string> = {};
      const balance = parseAmount(cells.get("Principal Balance", "Balance"), currency);
      if (balance !== null) extras.principalBalance = formatAmount(balance, currency);

      const details = cells.get("Details");

      transactions.push({
        id: "",
        occurrence: 1,
        date,
        amount,
        currency,
        serial: "",
        trn: "",
        particulars: details,
        code: "",
        reference: "",
        otherParty: details,
        origin: "",
        type: "",
        batch: "",
        otherPartyAccount: "",
        account: context.account,
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
