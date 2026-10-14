import { parseQuickBooksBooks, parseQuickBooksLedger, quickBooksChartFrom } from "@nzosa/core";
import type { ManualJournal, SplitPart } from "@nzosa/core";
import { asCsvText, record, reclassify, saveManualJournals } from "../books.js";
import { booksCountry, booksCurrency } from "../country.js";
import { addTransactions } from "../daily/bank-import.js";
import { state } from "../state.js";
import { savePart } from "../store.js";

/** Journals made from QuickBooks carry this, so a second drop replaces them. */
const SOURCE = "QuickBooks";

/**
 * Everything in a QuickBooks general ledger, put into the books.
 *
 * The coding in the same file is read with the other coding history (see
 * loadReference). This is the rest: its bank and card postings as bank lines;
 * an entry QuickBooks spread over several accounts as a split on its bank
 * line; and every entry that touches no bank account -- invoices, bills,
 * credit memos, journal entries, stock adjustments -- as a journal, so the
 * profit and loss and the balance sheet come out as they do in QuickBooks.
 *
 * The chart has to be in first, which the drop zone arranges; where it is
 * not, only the bank and card lines can be read, from their names.
 */
export async function loadQuickBooksBankLines(file: File): Promise<string> {
  const text = await asCsvText(file.name, new Uint8Array(await file.arrayBuffer()));
  const options = { dayFirst: booksCountry().dayFirst, currency: booksCurrency(), file: file.name };

  if (state.chart.length === 0) {
    const only = parseQuickBooksLedger(text, options);
    if (only.transactions.length === 0) return "no bank or card lines found in it.";
    await addTransactions(only.transactions, { importer: "quickbooks-ledger", file: file.name, problems: only.problems });
    return (
      `${only.transactions.length} bank and card lines. Drop the chart of accounts too, ` +
      "to bring in the invoices, bills and journals."
    );
  }

  const books = parseQuickBooksBooks(text, quickBooksChartFrom(state.chart), options);
  if (books.transactions.length > 0) {
    await addTransactions(books.transactions, {
      importer: "quickbooks-ledger",
      file: file.name,
      problems: books.problems,
    });
  }

  // Splits, on the lines just added (their ids were made as they went in).
  let splitCount = 0;
  if (books.splits.length > 0) {
    const splits: Record<string, readonly SplitPart[]> = { ...(state.ledger.splits ?? {}) };
    for (const one of books.splits) {
      if (one.transaction.id === "" || splits[one.transaction.id] !== undefined) continue;
      splits[one.transaction.id] = one.parts.map((p) => ({ amount: p.amount, code: p.code, note: p.note }));
      splitCount += 1;
    }
    if (splitCount > 0) {
      state.ledger = { ...state.ledger, splits };
      state.persistent = await savePart(state.ledger);
      await record("split", `${splitCount} split${splitCount === 1 ? "" : "s"} from ${file.name}`, null, splitCount, file.name);
    }
  }

  // Transfers between the books' own accounts, paired as they are paired
  // everywhere else, so neither side is coded to an account.
  let transferCount = 0;
  if (books.transfers.length > 0) {
    const transfers: Record<string, string> = { ...(state.ledger.transfers ?? {}) };
    for (const [a, b] of books.transfers) {
      if (a.id === "" || b.id === "" || transfers[a.id] !== undefined || transfers[b.id] !== undefined) continue;
      transfers[a.id] = b.id;
      transfers[b.id] = a.id;
      transferCount += 1;
    }
    if (transferCount > 0) {
      state.ledger = { ...state.ledger, transfers };
      state.persistent = await savePart(state.ledger);
    }
  }

  // Journals, replacing the last drop's rather than adding to them.
  let journalCount = 0;
  if (books.journals.length > 0) {
    const keep = (state.ledger.manualJournals ?? []).filter((j) => j.source !== SOURCE);
    const made: ManualJournal[] = books.journals.map((j, i) => ({
      id: `qb${i + 1}`,
      date: j.date,
      narration: j.narration,
      lines: j.lines.map((l) => ({
        code: l.code,
        amount: l.amount,
        ...(l.description !== undefined ? { description: l.description } : {}),
      })),
      source: SOURCE,
    }));
    journalCount = made.length;
    await saveManualJournals([...keep, ...made], `${journalCount} journals from ${file.name}`);
  } else {
    reclassify();
  }

  const accounts = new Set(books.transactions.map((t) => t.account)).size;
  return (
    `${books.transactions.length} bank and card line${books.transactions.length === 1 ? "" : "s"} ` +
    `on ${accounts} account${accounts === 1 ? "" : "s"}` +
    (splitCount > 0 ? `, ${splitCount} split${splitCount === 1 ? "" : "s"}` : "") +
    (transferCount > 0 ? `, ${transferCount} transfer${transferCount === 1 ? "" : "s"} between accounts` : "") +
    (journalCount > 0 ? `, ${journalCount} journals (invoices, bills and the rest)` : "") +
    "."
  );
}
