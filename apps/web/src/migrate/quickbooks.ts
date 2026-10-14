import { parseQuickBooksLedger } from "@nzosa/core";
import { asCsvText } from "../books.js";
import { booksCountry, booksCurrency } from "../country.js";
import { addTransactions } from "../daily/bank-import.js";
import { state } from "../state.js";

/**
 * The bank and card lines in a QuickBooks general ledger, put in as bank lines.
 *
 * The coding in the same file is read with the other coding history (see
 * loadReference); this is the other half. The bank and card accounts are the
 * chart's -- so the chart has to be in first, which the drop zone arranges --
 * and where it is not, they are guessed from their names.
 */
export async function loadQuickBooksBankLines(file: File): Promise<string> {
  const text = await asCsvText(file.name, new Uint8Array(await file.arrayBuffer()));
  const bank = state.chart.filter((a) => a.type === "Bank");
  const result = parseQuickBooksLedger(text, {
    ...(bank.length > 0
      ? {
          bankNames: bank.map((a) => a.name),
          cardNames: bank.filter((a) => a.description === "Credit Card").map((a) => a.name),
        }
      : {}),
    codes: new Map(state.chart.map((a) => [a.name, a.code])),
    dayFirst: booksCountry().dayFirst,
    currency: booksCurrency(),
    file: file.name,
  });
  if (result.transactions.length === 0) {
    return "no bank or card lines found in it.";
  }
  await addTransactions(result.transactions, {
    importer: "quickbooks-ledger",
    file: file.name,
    problems: result.problems,
  });
  const accounts = new Set(result.transactions.map((t) => t.account)).size;
  return (
    `${result.transactions.length} bank and card line${result.transactions.length === 1 ? "" : "s"} ` +
    `on ${accounts} account${accounts === 1 ? "" : "s"}.`
  );
}
