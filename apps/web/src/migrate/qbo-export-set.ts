import { parseQuickBooksExport, quickBooksChartFrom } from "@nzosa/core";
import type { Account, QuickBooksExportBooks, QuickBooksExportFile } from "@nzosa/core";

/**
 * QuickBooks Online's Export data comes as one zip of several reports, and the
 * Journal in it is only read rightly with the others beside it: the Balance
 * Sheet and the Profit and Loss say what type each account is, the trial
 * balance what the Journal must come to. The drop zone hands the files over
 * one at a time, so the ones that go with the Journal are kept here while it
 * is read.
 */
let companions: QuickBooksExportFile[] = [];

export function setQuickBooksExportCompanions(files: readonly QuickBooksExportFile[]): void {
  companions = [...files];
}

/** The export's books, its Journal read with the reports dropped with it. */
export function readQuickBooksExport(
  journal: QuickBooksExportFile,
  known: readonly Account[],
  options: { currency?: string; dayFirst?: boolean } = {},
): QuickBooksExportBooks {
  return parseQuickBooksExport(
    [journal, ...companions.filter((c) => c.name !== journal.name)],
    known.length > 0 ? quickBooksChartFrom([...known]) : null,
    { ...options, file: journal.name },
  );
}
