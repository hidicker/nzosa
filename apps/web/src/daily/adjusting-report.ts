import { adjustingEntries, adjustingEntriesCsv } from "@nzosa/core";
import type { PostedJournal } from "@nzosa/core";
import { postedJournals } from "../books.js";
import { booksMoney } from "../country.js";
import { state } from "../state.js";
import { amountCell, nameCell, note, wideTable } from "../ui.js";
import { periodFileName, periodHeading, reportRange } from "./report-period.js";

/**
 * Adjusting entries: the manual journals marked as adjusting, and the year-end
 * adjustments the books work out themselves, for the period chosen. The profit
 * and loss, the balance sheet and the trial balance can each be drawn without
 * them, to show the books before the adjustments.
 */

type InEntity = ((journal: PostedJournal) => boolean) | null;

function entries(year: number, inEntity: InEntity): PostedJournal[] {
  return adjustingEntries(postedJournals(), state.ledger.manualJournals ?? [], reportRange(year)).filter(
    (j) => inEntity === null || inEntity(j),
  );
}

export function renderAdjusting(body: HTMLElement, year: number, inEntity: InEntity): void {
  const heading = document.createElement("h3");
  heading.textContent = `Adjusting entries, ${periodHeading(year)}`;
  body.append(heading);
  const list = entries(year, inEntity);
  if (list.length === 0) {
    body.append(
      note(
        "None in this period. Mark a manual journal as an adjusting entry when you write it, or with " +
          "Mark as adjusting on Manual journals; the year-end adjustments for vehicles and prepayments are listed here by themselves.",
      ),
    );
    return;
  }
  body.append(
    note(
      `${list.length} ${list.length === 1 ? "entry" : "entries"}. Tick "Without adjusting entries" on the profit and loss, ` +
        "the balance sheet or the trial balance to see the figures before them.",
    ),
  );
  const table = document.createElement("table");
  table.className = "report-table";
  table.innerHTML = "<thead><tr><th>Date</th><th>Narration</th><th>Account</th><th>Debit</th><th>Credit</th></tr></thead>";
  const tbody = document.createElement("tbody");
  let debits = 0;
  let credits = 0;
  for (const j of list) {
    j.lines.forEach((line, n) => {
      const tr = document.createElement("tr");
      tr.append(
        nameCell(n === 0 ? j.date : ""),
        nameCell(n === 0 ? `${j.narration}${j.source === "adjustment" ? " (year-end adjustment)" : ""}` : ""),
        nameCell(line.accountCode === "" ? line.accountName : `${line.accountName} (${line.accountCode})`),
        amountCell(line.amount > 0 ? booksMoney(line.amount) : ""),
        amountCell(line.amount < 0 ? booksMoney(-line.amount) : ""),
      );
      if (line.amount > 0) debits += line.amount;
      else credits -= line.amount;
      tbody.append(tr);
    });
  }
  const total = document.createElement("tr");
  total.className = "report-total";
  total.append(nameCell("Total"), nameCell(""), nameCell(""), amountCell(booksMoney(debits)), amountCell(booksMoney(credits)));
  tbody.append(total);
  table.append(tbody);
  body.append(wideTable(table));
}

export function adjustingCsv(year: number, inEntity: InEntity): { text: string; name: string } | null {
  const list = entries(year, inEntity);
  if (list.length === 0) return null;
  return { text: adjustingEntriesCsv(list), name: `adjusting-entries-${periodFileName(year)}.csv` };
}
