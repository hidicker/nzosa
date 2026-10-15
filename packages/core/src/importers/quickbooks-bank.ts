import { findHeaderRow, parseCsvRecords } from "../csv.js";
import type { ReferenceLine } from "../coding-check.js";
import { parseAmount } from "../money.js";
import { parseDate } from "../dates.js";
import { ColumnReader, scoreColumns } from "./shared.js";
import type { ReadonlyCsvRecord } from "../csv.js";
import type { DetectionResult, Importer, ImportProblem, ImportResult, Transaction } from "../types.js";

const ID = "quickbooks-bank";
const LABEL = "QuickBooks bank register";

const REQUIRED = ["Date", "Bank description", "Spent", "Received"];
const DISTINCTIVE = ["From/To", "Match/Categorize"];

/**
 * A bank account's lines exported from QuickBooks Online's Banking page
 * (Transactions > Bank transactions > the export button): one row a line,
 * money out under Spent and in under Received, who it was with under From/To,
 * and under Match/Categorize the account QuickBooks put it to, where it has.
 *
 * The lines come in as bank lines like any bank's file. The account each was
 * put to is kept on the line, and read as QuickBooks' coding by the coding
 * check (see quickBooksBankCoding).
 */
export const quickBooksBank: Importer = {
  id: ID,
  label: LABEL,
  description: "QuickBooks Online > Transactions > Bank transactions > Export.",

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
    const reader = new ColumnReader(header.columns);
    const dayFirst = dateOrder(records, header.index, reader) ?? context.dayFirst ?? false;
    const currency = context.defaultCurrency ?? "USD";
    // QuickBooks names the export after the bank account it is from, so with
    // no account chosen the file's name is the account's.
    const named = context.account === ID || context.account === "";
    const label = context.file.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").trim() || "QuickBooks bank";
    const account = named ? label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || ID : context.account;

    for (let i = header.index + 1; i < records.length; i += 1) {
      const record = records[i];
      if (!record) continue;
      const { fields, line } = record;
      if (fields.every((f) => f.trim() === "")) continue;
      const cells = reader.at(fields);
      const date = parseDate(cells.get("Date"), { dayFirst });
      const spent = cells.get("Spent").trim();
      const received = cells.get("Received").trim();
      const out = spent === "" ? 0 : parseAmount(spent, currency);
      const into = received === "" ? 0 : parseAmount(received, currency);
      if (date === null || out === null || into === null) {
        problems.push({
          line,
          row: [...fields],
          message: date === null ? `Unreadable date ${JSON.stringify(cells.get("Date"))}` : "Unreadable amount",
        });
        continue;
      }
      const amount = Math.abs(into) - Math.abs(out);
      if (amount === 0) continue;
      const description = cells.get("Bank description").trim();
      const party = cells.get("From/To").trim();
      const category = cells.get("Match/Categorize").trim();
      transactions.push({
        id: "",
        occurrence: 1,
        date,
        amount,
        currency,
        serial: "",
        trn: "",
        particulars: description,
        code: "",
        reference: "",
        otherParty: party || description,
        origin: "QuickBooks",
        type: amount < 0 ? "DEBIT" : "CREDIT",
        batch: "",
        otherPartyAccount: "",
        account,
        extras: { ...(named ? { accountLabel: label } : {}), ...(category !== "" ? { category } : {}) },
        source: { importer: ID, file: context.file, line },
      });
    }
    return { importer: ID, file: context.file, account: context.account, transactions, problems };
  },
};

/** Day first when a date's first part is past 12, month first when its second is; null when none says. */
function dateOrder(records: readonly ReadonlyCsvRecord[], from: number, reader: ColumnReader): boolean | null {
  let first = false;
  let second = false;
  for (const record of records.slice(from + 1)) {
    const match = /^(\d{1,2})\/(\d{1,2})\/\d{2,4}$/.exec(reader.at(record.fields).get("Date").trim());
    if (match === null) continue;
    if (Number(match[1]) > 12) first = true;
    if (Number(match[2]) > 12) second = true;
  }
  if (first && !second) return true;
  if (second && !first) return false;
  return null;
}

/** Whether a file is QuickBooks' bank register export: its own column names, Match/Categorize among them. */
export function isQuickBooksBankExport(text: string): boolean {
  const records = parseCsvRecords(text.slice(0, 20000));
  const header = findHeaderRow(records, [...REQUIRED, "Match/Categorize"], 12);
  return header !== null;
}

/**
 * The account QuickBooks put each line to, as coding to check these books
 * against: one reference line for each line that was categorised.
 */
export function quickBooksBankCoding(text: string, file: string, dayFirst?: boolean): ReferenceLine[] {
  const result = quickBooksBank.parse(parseCsvRecords(text), {
    file,
    account: "",
    ...(dayFirst !== undefined ? { dayFirst } : {}),
  });
  const out: ReferenceLine[] = [];
  for (const t of result.transactions) {
    const category = t.extras?.["category"];
    if (category === undefined || category === "") continue;
    out.push({
      date: t.date,
      amount: t.amount,
      code: category,
      label: category,
      source: file,
      ...(t.otherParty !== "" ? { contact: t.otherParty } : {}),
      ...(t.particulars !== "" ? { description: t.particulars } : {}),
      bankFields: {
        ...(t.particulars !== "" ? { particulars: t.particulars } : {}),
        ...(t.otherParty !== "" ? { otherParty: t.otherParty } : {}),
      },
    } as ReferenceLine);
  }
  return out;
}
