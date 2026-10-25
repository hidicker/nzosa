import { spreadsheetCell, salesByCustomer, salesByItem } from "@nzosa/core";
import type { SalesAnalysis } from "@nzosa/core";
import { invoicesInPlay } from "../books.js";
import { booksMoney } from "../country.js";
import { state } from "../state.js";
import { amountCell, nameCell, note, wideTable } from "../ui.js";
import { periodFileName, periodHeading, reportRange } from "./report-period.js";

/**
 * Sales by customer and sales by item: the sales invoices dated in the period
 * chosen, added up. See sales-analysis.ts in core for what is counted.
 */

export type SalesKind = "salescustomer" | "salesitem";

function analysis(kind: SalesKind, year: number): SalesAnalysis {
  const range = reportRange(year);
  const entity = state.entityFilter === "" ? undefined : state.entityFilter;
  return kind === "salescustomer"
    ? salesByCustomer(invoicesInPlay(), range, entity)
    : salesByItem(invoicesInPlay(), range, entity);
}

export function renderSalesReport(body: HTMLElement, kind: SalesKind, year: number): void {
  const out = analysis(kind, year);
  const h = document.createElement("h3");
  h.textContent = `${kind === "salescustomer" ? "Sales by customer" : "Sales by item"}, ${periodHeading(year)}`;
  body.append(h);
  if (out.rows.length === 0) {
    body.append(note("No sales invoices are dated in this period. Sales banked without an invoice are on the profit and loss, not here."));
    return;
  }
  const byItem = kind === "salesitem";
  const table = document.createElement("table");
  table.className = "report-table";
  const head = document.createElement("thead");
  head.innerHTML =
    `<tr><th>${byItem ? "Item" : "Customer"}</th><th class="report-amount">${byItem ? "Lines" : "Invoices"}</th>` +
    (byItem ? '<th class="report-amount">Quantity</th>' : "") +
    '<th class="report-amount">Before tax</th><th class="report-amount">Tax</th><th class="report-amount">Total</th><th class="report-amount">Share</th></tr>';
  const tbody = document.createElement("tbody");
  const share = (net: number): string => (out.total.net === 0 ? "" : `${((net / out.total.net) * 100).toFixed(1)}%`);
  for (const row of out.rows) {
    const tr = document.createElement("tr");
    tr.append(nameCell(row.name), amountCell(String(row.count)));
    if (byItem) tr.append(amountCell(row.quantity === undefined ? "" : String(Math.round(row.quantity * 10_000) / 10_000)));
    tr.append(amountCell(booksMoney(row.net)), amountCell(booksMoney(row.tax)), amountCell(booksMoney(row.gross)), amountCell(share(row.net)));
    tbody.append(tr);
  }
  const foot = document.createElement("tfoot");
  const tr = document.createElement("tr");
  tr.className = "report-total";
  tr.append(nameCell("Total"), amountCell(String(out.total.count)));
  if (byItem) tr.append(amountCell(""));
  tr.append(amountCell(booksMoney(out.total.net)), amountCell(booksMoney(out.total.tax)), amountCell(booksMoney(out.total.gross)), amountCell(""));
  foot.append(tr);
  table.append(head, tbody, foot);
  body.append(
    wideTable(table),
    note(
      `${out.invoices} invoice${out.invoices === 1 ? "" : "s"} dated in the period, credit notes taken off. ` +
        "Sales banked without an invoice are on the profit and loss, not here.",
    ),
  );
}

export function salesCsv(kind: SalesKind, year: number): { text: string; name: string } | null {
  const out = analysis(kind, year);
  if (out.rows.length === 0) return null;
  const byItem = kind === "salesitem";
  const money = (c: number): string => (c / 100).toFixed(2);
  const rows: string[][] = [
    [byItem ? "Item" : "Customer", byItem ? "Lines" : "Invoices", ...(byItem ? ["Quantity"] : []), "Before tax", "Tax", "Total"],
    ...out.rows.map((r) => [r.name, String(r.count), ...(byItem ? [r.quantity === undefined ? "" : String(r.quantity)] : []), money(r.net), money(r.tax), money(r.gross)]),
    ["Total", String(out.total.count), ...(byItem ? [""] : []), money(out.total.net), money(out.total.tax), money(out.total.gross)],
  ];
  return {
    text: rows.map((r) => r.map(spreadsheetCell).join(",")).join("\n") + "\n",
    name: `${byItem ? "sales-by-item" : "sales-by-customer"}-${periodFileName(year)}.csv`,
  };
}
