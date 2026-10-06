import { postedJournals, reportEngine, varianceInput } from "../books.js";
import { chosenStartDate } from "../migrate/onboarding-state.js";
import { state } from "../state.js";
import { note } from "../ui.js";
import { computeOurReturns } from "../variance.js";
import {
  accountEntityKey,
  emptyEntityModel,
  formatAmount,
  gstAccountReconciliation,
  isGstControlCode,
  splitAccountLabel,
} from "@nzosa/core";
import type { Cents } from "@nzosa/core";

/**
 * The GST account on the balance sheet, against the returns and Inland
 * Revenue, at each period end.
 *
 * The comparison above sets each return beside the one filed. This is the
 * other half of a GST reconciliation: whether the GST control account in the
 * books holds what the returns say should be owing, once payments are taken
 * off, and whether Inland Revenue's account says the same.
 */

/** The GST control accounts in scope: the entity the page is on, or all of them. */
function controlCodes(): Set<string> {
  const model = state.ledger.entities ?? emptyEntityModel();
  const entity = model.entities.find((e) => e.id === state.entityFilter);
  return new Set(
    state.chart
      .filter((a) => isGstControlCode(a.code))
      .filter((a) => entity === undefined || model.accounts[accountEntityKey(a)] === entity.id)
      .map((a) => a.code.trim()),
  );
}

export function gstAccountSection(): HTMLElement | null {
  const codes = controlCodes();
  if (codes.size === 0 || state.ledger.transactions.length === 0) return null;

  const start = state.ledger.openingBalances?.asAt ?? chosenStartDate() ?? "";
  const dates = state.ledger.transactions.map((t) => t.date).sort();
  const from = start || dates[0] || "";
  const to = dates[dates.length - 1] ?? "";
  if (from === "" || to === "") return null;

  const returns = computeOurReturns(varianceInput(), from, to).map((r) => ({
    periodEnd: r.period.to,
    box15: r.boxes.box15 as Cents,
  }));

  const postings: { date: string; amount: Cents }[] = [];
  for (const journal of postedJournals()) {
    for (const line of journal.lines) {
      if (codes.has(line.accountCode.trim())) postings.push({ date: journal.date, amount: line.amount });
    }
  }

  // Payments to Inland Revenue, and refunds from it: bank lines coded to the
  // GST account itself.
  const engine = reportEngine();
  const payments: { date: string; amount: Cents }[] = [];
  for (const t of engine?.transactions ?? []) {
    const code = engine?.codeOf(t);
    if (code === null || code === undefined) continue;
    if (codes.has(splitAccountLabel(code).code.trim())) payments.push({ date: t.date, amount: -t.amount as Cents });
  }

  const opening = Object.entries(state.ledger.openingBalances?.accounts ?? {})
    .filter(([key]) => codes.has(key.trim()) || codes.has(splitAccountLabel(key).code.trim()))
    .reduce((s, [, v]) => s + v, 0);

  // Inland Revenue's GST account, where its transactions are loaded.
  const model = state.ledger.entities ?? emptyEntityModel();
  const entity = model.entities.find((e) => e.id === state.entityFilter);
  const ird: { date: string; amount: Cents }[] = [];
  for (const record of state.ledger.irdRecords ?? []) {
    if (record.kind !== "account" || !/gst/i.test(`${record.taxType} ${record.accountId}`)) continue;
    if (entity !== undefined && record.entityId !== undefined && record.entityId !== entity.id) continue;
    for (const row of record.rows) ird.push({ date: row.date, amount: row.amount });
  }

  const rows = gstAccountReconciliation({
    returns,
    postings,
    payments,
    opening: opening as Cents,
    booksStart: from,
    ird,
  });
  // Periods still running are not a period end yet.
  const today = new Date().toISOString().slice(0, 10);
  const ended = rows.filter((r) => r.periodEnd <= today);
  if (ended.length === 0) return null;

  const box = document.createElement("details");
  box.className = "gst-account";
  const out = ended.filter((r) => Math.abs(r.booksDifference) > 100 || (r.irDifference !== null && Math.abs(r.irDifference) > 100));
  box.open = out.length > 0;
  const summary = document.createElement("summary");
  summary.textContent =
    `The GST account, against the returns and Inland Revenue (${[...codes].join(", ")})` +
    (out.length === 0 ? ": agrees" : `: ${out.length} period end${out.length === 1 ? "" : "s"} to look at`);
  box.append(
    summary,
    note(
      "At each period end: what the books' returns say should be owing to Inland Revenue -- every " +
        "return to date, less GST paid -- beside the GST account's balance in the books, and " +
        "beside Inland Revenue's own account where its transactions are loaded. Owing is " +
        "positive, a refund due negative.",
    ),
  );

  const table = document.createElement("table");
  table.className = "report-table";
  table.innerHTML =
    "<thead><tr><th>Period end</th><th>Returns to date</th><th>Paid to date</th><th>Should be owing</th>" +
    "<th>GST account says</th><th>Difference</th><th>Inland Revenue says</th><th>Difference</th></tr></thead>";
  const tbody = document.createElement("tbody");
  for (const r of ended) {
    const tr = document.createElement("tr");
    const cells = [
      r.periodEnd,
      formatAmount(r.returnsToDate),
      formatAmount(r.paidToDate),
      formatAmount(r.shouldOwe),
      formatAmount(r.booksOwe),
      Math.abs(r.booksDifference) <= 100 ? "✓" : formatAmount(r.booksDifference),
      r.irOwe === null ? "not loaded" : formatAmount(r.irOwe),
      r.irDifference === null ? "" : Math.abs(r.irDifference) <= 100 ? "✓" : formatAmount(r.irDifference),
    ];
    cells.forEach((text, i) => {
      const td = document.createElement("td");
      td.className = i === 0 ? "report-name" : "report-amount";
      td.textContent = text;
      tr.append(td);
    });
    tbody.append(tr);
  }
  table.append(tbody);
  box.append(table);
  box.append(
    note(
      "A difference with the GST account is GST posted that no return counted, or a return " +
        "counting GST the books did not post -- or something other than GST coded to the GST " +
        "account. A difference with Inland Revenue is often only timing: a return not yet " +
        "assessed at the period end, or a payment on its way. Interest and penalties show there too.",
    ),
  );
  // More paid than the returns asked for, by more than one period's worth:
  // lines coded to the GST account that are not GST payments, almost always.
  const last = ended[ended.length - 1];
  if (last !== undefined && last.shouldOwe < 0 && last.paidToDate > last.returnsToDate * 1.5) {
    box.append(
      note(
        `${formatAmount(last.paidToDate)} is coded to the GST account as paid to Inland Revenue, ` +
          `against ${formatAmount(last.returnsToDate)} the returns ask for. Lines coded to the GST ` +
          "account are taken as GST payments and refunds: check that each one is.",
      ),
    );
  }
  if (ird.length === 0) {
    box.append(
      note(
        "To compare with Inland Revenue, load the GST account's transactions from myIR on " +
          "Inland Revenue records.",
      ),
    );
  }
  return box;
}
