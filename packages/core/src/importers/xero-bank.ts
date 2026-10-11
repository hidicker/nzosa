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

const ID = "xero-bank";
const LABEL = "Xero bank account";

const REQUIRED = ["Date", "Source", "Debit", "Credit", "Account"];
const DISTINCTIVE = ["Related Account", "Contact", "Gross", "Account Type"];

/** A bank account by its name, where the report gives nothing else to go on. */
const BANKISH = /\b(bank|card|visa|mastercard|cheque|savings|wise|paypal|stripe)\b/i;

/** `Business Bank Account` as `business-bank-account`: an id for an account the file names. */
function accountId(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "xero-bank"
  );
}

/**
 * Xero's Account Transactions report, for a bank account, as bank lines.
 *
 * What somebody leaving Xero without a bank feed has: Xero holds the bank's
 * lines, and this report is how they come out -- for one bank account (Xero's
 * own "Bank transactions" for an account is this report filtered to it), or
 * for every account, of which only the bank accounts' rows are kept. Each row
 * is one posting to the bank account: money in is its debit, money out its
 * credit. Xero's own fields stand in for the bank's: the contact as the payee,
 * the description as particulars, the reference as the reference, and the
 * kind of entry ("Spend Money", "Receivable Payment") as the type.
 */
export const xeroBank: Importer = {
  id: ID,
  label: LABEL,
  description:
    "Xero: Reporting > Account Transactions for the bank account, all columns, grouping None > Export to Excel or CSV.",

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
        problems: [{ line: 1, row: [], message: `Not a ${LABEL} export: no header row found.` }],
      };
    }

    const currency = context.defaultCurrency ?? "NZD";
    const dayFirst = context.dayFirst ?? true;
    const reader = new ColumnReader(header.columns);
    const rows = records.slice(header.index + 1).filter((r) => r !== undefined);

    // Which of the report's accounts are bank accounts: all of them where it
    // covers one, and otherwise those Xero calls a bank, those with no code
    // (Xero gives bank accounts none by default), or those named like one.
    const names = new Set<string>();
    for (const record of rows) {
      const name = reader.at(record.fields).get("Account").trim();
      if (name !== "") names.add(name);
    }
    const isBank = (fields: readonly string[]): boolean => {
      const cells = reader.at(fields);
      const name = cells.get("Account").trim();
      if (name === "") return false;
      if (names.size === 1) return true;
      // Bank Fees and Stripe Fees are named like banks and are expenses: an
      // account Xero types as income, an expense or equity is never one.
      const type = cells.get("Account Type");
      if (/expense|overhead|direct|revenue|income|sales|equity|depreciation/i.test(type)) return false;
      return /bank/i.test(type) || cells.get("Account Code").trim() === "" || BANKISH.test(name);
    };

    for (const record of rows) {
      const { fields, line } = record;
      if (!isBank(fields)) continue;
      const cells = reader.at(fields);
      const name = cells.get("Account").trim();
      const date = parseDate(cells.get("Date"), { dayFirst });
      const debit = parseAmount(cells.get("Debit") || "0", currency);
      const credit = parseAmount(cells.get("Credit") || "0", currency);
      if (date === null || debit === null || credit === null) {
        // Total and heading rows have no date; only a dated row is a problem.
        if (cells.get("Date").trim() !== "" && !/^total/i.test(cells.get("Date"))) {
          problems.push({
            line,
            row: [...fields],
            message:
              date === null
                ? `Unreadable date ${JSON.stringify(cells.get("Date"))}`
                : `Unreadable amount ${JSON.stringify(cells.get("Debit") || cells.get("Credit"))}`,
          });
        }
        continue;
      }
      const amount = debit - credit;
      if (amount === 0) continue;

      const contact = cells.get("Contact");
      const description = cells.get("Description");
      transactions.push({
        id: "",
        occurrence: 1,
        date,
        amount,
        currency,
        serial: "",
        trn: "",
        particulars: description,
        code: cells.get("Invoice Number"),
        reference: cells.get("Reference"),
        otherParty: contact || description,
        origin: "",
        type: cells.get("Source"),
        batch: "",
        otherPartyAccount: "",
        // The account chosen on the page, for a report of one account; else
        // the one Xero names. Nothing chosen comes through as this importer's
        // own id, which is not an account.
        account: context.account !== "" && context.account !== ID && names.size === 1 ? context.account : accountId(name),
        extras: { accountLabel: name },
        source: { importer: ID, file: context.file, line },
      });
    }

    return {
      importer: ID,
      file: context.file,
      account: transactions[0]?.account ?? context.account,
      transactions,
      problems,
    };
  },
};
