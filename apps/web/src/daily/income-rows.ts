import { TAX_EXTRA_CATEGORIES, taxTypeOf } from "@nzosa/core";
import type { TaxExtra } from "@nzosa/core";

/**
 * Income from outside the books, a payer to a row, with what lies behind it.
 *
 * Each payer is one line -- the totals the return uses -- and the dated
 * amounts myIR lists under it are there to open, beneath it, so the totals
 * can be traced without a table forty rows long. Each line's tax credit is
 * named -- PAYE deductions, RWT, PIE tax credits -- in an accountant's words,
 * since they are not the same kind of credit.
 */

type IncomeLine = Pick<TaxExtra, "category" | "payer" | "gross" | "credits" | "imputation" | "note" | "details">;

function money(cents: number): string {
  return (cents / 100).toLocaleString("en-NZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** What kind of income a line is, in words, with the source's own name where it is narrower. */
function kindOf(line: IncomeLine): string {
  const label = TAX_EXTRA_CATEGORIES.find((c) => c.value === line.category)?.label ?? line.category;
  const named = (line.note ?? "").replace(/^From myIR income details:?\s*/, "");
  return named === "" ? label : `${label} (${named})`;
}

export const INCOME_HEAD = "<tr><th>Kind</th><th>Payer</th><th>Gross</th><th>Tax credits</th><th>Imputation credits</th><th></th></tr>";

/** The rows for these lines, each with its dated amounts folded beneath it. */
export function incomeRows(
  tbody: HTMLTableSectionElement,
  lines: readonly IncomeLine[],
  action?: (line: IncomeLine) => HTMLElement,
): void {
  for (const line of lines) {
    const tr = document.createElement("tr");
    const cell = (text: string, cls: string): HTMLTableCellElement => {
      const td = document.createElement("td");
      td.className = cls;
      td.textContent = text;
      return td;
    };
    const payer = cell(line.payer, "report-name");
    const details = line.details ?? [];
    const under: HTMLTableRowElement[] = [];
    if (details.length > 0) {
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "link-button";
      const label = (open: boolean): string =>
        `${open ? "▾" : "▸"} ${details.length} date${details.length === 1 ? "" : "s"}`;
      toggle.textContent = label(false);
      toggle.addEventListener("click", () => {
        const open = under[0]?.hidden ?? false;
        for (const row of under) row.hidden = !open;
        toggle.textContent = label(open);
      });
      payer.append(" ", toggle);
    }
    const tax = taxTypeOf(line);
    tr.append(
      cell(kindOf(line), "report-name"),
      payer,
      cell(money(line.gross), "report-amount"),
      cell(line.credits === 0 ? "" : `${money(line.credits)} ${tax}`, "report-amount"),
      cell(line.imputation === undefined ? "" : money(line.imputation), "report-amount"),
    );
    const last = document.createElement("td");
    last.className = "report-amount";
    if (action !== undefined) last.append(action(line));
    tr.append(last);
    tbody.append(tr);

    for (const d of [...details].sort((a, b) => a.date.localeCompare(b.date))) {
      const row = document.createElement("tr");
      row.className = "income-detail";
      row.hidden = true;
      row.append(
        cell("", ""),
        cell(d.date, "report-name"),
        cell(money(d.gross), "report-amount"),
        cell(d.credits === 0 ? "" : `${money(d.credits)} ${tax}`, "report-amount"),
        cell(d.imputation === undefined ? "" : money(d.imputation), "report-amount"),
        cell("", ""),
      );
      under.push(row);
      tbody.append(row);
    }
  }
}
