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

const ID = "wise";
const LABEL = "Wise";

const REQUIRED = ["ID", "Status", "Direction", "Source amount (after fees)", "Source currency"];
const DISTINCTIVE = [
  "Target amount (after fees)",
  "Target currency",
  "Source fee amount",
  "Exchange rate",
  "Source name",
  "Target name",
];

/** Wise rows that never hit a balance. Imported as problems, not transactions. */
const NON_MOVEMENTS = new Set(["CANCELLED", "REJECTED", "FAILED"]);

/**
 * Wise statement export.
 *
 * Wise reports one row per balance movement rather than one per transfer, and
 * describes each row from both sides. Which side is "the account" depends on
 * `Direction`: on an OUT the source balance is yours and the target is the
 * counterparty; on an IN it is the other way round. Getting this backwards
 * silently inverts every foreign transaction, so it is handled explicitly.
 *
 * A card purchase funded partly from a held EUR balance and partly converted
 * from NZD appears as two rows sharing one ID, in different currencies. Both
 * are real movements; deduplication keys on currency and amount as well as the
 * reference, so they are correctly kept apart.
 */
export const wise: Importer = {
  id: ID,
  label: LABEL,
  description: "wise.com > Balances > Statement > Download CSV (choose 'All currencies').",

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

    const dayFirst = context.dayFirst ?? true;
    const reader = new ColumnReader(header.columns);

    for (let i = header.index + 1; i < records.length; i += 1) {
      const record = records[i];
      if (!record) continue;
      const { fields, line } = record;

      const cells = reader.at(fields);
      const status = cells.get("Status").toUpperCase();
      const reference = cells.get("ID");

      if (NON_MOVEMENTS.has(status)) {
        problems.push({
          line,
          row: [...fields],
          message: `Skipped ${reference || "row"}: status ${status} never moved money.`,
        });
        continue;
      }

      // Wise dates carry a time; only the calendar day is kept. `Finished on`
      // is when the balance actually moved, so it is preferred over creation.
      const date =
        parseDate(cells.get("Finished on"), { dayFirst }) ??
        parseDate(cells.get("Created on"), { dayFirst });

      const outgoing = cells.get("Direction").toUpperCase() !== "IN";

      const nearCurrency = (
        outgoing ? cells.get("Source currency") : cells.get("Target currency", "Source currency")
      ).toUpperCase();
      const farCurrency = (
        outgoing ? cells.get("Target currency") : cells.get("Source currency")
      ).toUpperCase();

      const nearRaw = outgoing
        ? cells.get("Source amount (after fees)")
        : cells.get("Target amount (after fees)");
      const farRaw = outgoing
        ? cells.get("Target amount (after fees)")
        : cells.get("Source amount (after fees)");

      const magnitude = parseAmount(nearRaw, nearCurrency || "NZD");

      if (date === null || magnitude === null) {
        problems.push({
          line,
          row: [...fields],
          message:
            date === null
              ? `Unreadable date on ${reference || "row"}`
              : `Unreadable amount ${JSON.stringify(nearRaw)} on ${reference || "row"}`,
        });
        continue;
      }

      if (magnitude === 0) {
        problems.push({
          line,
          row: [...fields],
          message: `Skipped ${reference || "row"}: zero amount (status ${status}).`,
        });
        continue;
      }

      const amount = outgoing ? -Math.abs(magnitude) : Math.abs(magnitude);
      const currency = nearCurrency || (context.defaultCurrency ?? "NZD");
      const counterparty = outgoing ? cells.get("Target name") : cells.get("Source name");

      const extras: Record<string, string> = { status };

      // The fee is reported alongside the movement rather than as its own row.
      // Whether `Source amount (after fees)` is inclusive of it depends on the
      // transfer type, so the fee is recorded but never folded into `amount`:
      // reconciling against the Wise balance is what settles that, and doing it
      // wrong here would be invisible.
      const feeCurrency = cells.get("Source fee currency") || currency;
      const fee = parseAmount(cells.get("Source fee amount"), feeCurrency);
      if (fee !== null && fee !== 0) {
        extras.sourceFee = formatAmount(fee, feeCurrency);
        extras.sourceFeeCurrency = feeCurrency;
      }

      const rate = cells.get("Exchange rate");
      if (rate !== "") extras.exchangeRate = rate;
      const category = cells.get("Category");
      if (category !== "") extras.category = category;
      const note = cells.get("Note");
      if (note !== "") extras.note = note;

      // Only record a foreign leg when the far side is genuinely another
      // currency; a NZD-to-NZD top-up has both sides equal and no conversion.
      const farAmount = parseAmount(farRaw, farCurrency || currency);
      const foreign =
        farCurrency !== "" && farCurrency !== currency && farAmount !== null && farAmount !== 0
          ? { currency: farCurrency, amount: Math.sign(amount) * Math.abs(farAmount) }
          : undefined;

      transactions.push({
        id: "",
        occurrence: 1,
        date,
        amount,
        currency,
        serial: "",
        trn: "",
        particulars: cells.get("Reference"),
        code: "",
        reference,
        otherParty: counterparty,
        origin: LABEL,
        type: referenceType(reference),
        batch: cells.get("Batch"),
        otherPartyAccount: "",
        account: `${context.account}:${currency}`,
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

/** `CARD_TRANSACTION-3600000001` -> `CARD_TRANSACTION`. */
function referenceType(reference: string): string {
  const dash = reference.indexOf("-");
  return dash === -1 ? "" : reference.slice(0, dash);
}
