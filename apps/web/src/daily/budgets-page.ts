import { redraw } from "../app.js";
import { record } from "../books.js";
import { booksMoney } from "../country.js";
import { $, state } from "../state.js";
import { savePart } from "../store.js";
import { taxYearEndShort, taxYearOf } from "../tax-year.js";
import { note } from "../ui.js";
import { parseAmount } from "@nzosa/core";

/**
 * Budgets: what each income and expense account is expected to come to in a
 * year. One figure an account a year; the report spreads it evenly over the
 * months when it is set beside the year to date.
 */

// The books' year, by the year it ends in, as the Reports page counts it.
let year = taxYearOf(new Date().toISOString().slice(0, 10));

const isIncome = (type: string): boolean => /revenue|income|sales/i.test(type);
const isCost = (type: string): boolean => /expense|overhead|direct|cost/i.test(type);

export function renderBudgets(): void {
  const body = $("budgets-body");
  body.textContent = "";
  const accounts = state.chart.filter((a) => isIncome(a.type) || isCost(a.type));
  if (accounts.length === 0) {
    body.append(note("No income or expense accounts yet. Set up the chart of accounts first."));
    return;
  }
  const controls = document.createElement("div");
  controls.className = "contacts-controls";
  const pick = document.createElement("select");
  const now = taxYearOf(new Date().toISOString().slice(0, 10));
  for (const y of [now - 1, now, now + 1]) {
    const option = document.createElement("option");
    option.value = String(y);
    option.textContent = `Year to ${taxYearEndShort(y)}`;
    option.selected = y === year;
    pick.append(option);
  }
  pick.addEventListener("change", () => {
    year = Number(pick.value);
    redraw("budgets");
  });
  controls.append(pick);
  body.append(controls);

  const held = state.ledger.budgets?.[String(year)] ?? {};
  const table = document.createElement("table");
  table.className = "report-table owner-table";
  table.innerHTML = "<thead><tr><th>Account</th><th>Type</th><th>Budget for the year</th></tr></thead>";
  const tbody = document.createElement("tbody");
  for (const account of accounts) {
    const tr = document.createElement("tr");
    const name = document.createElement("td");
    name.className = "report-name";
    name.textContent = `${account.code} ${account.name}`.trim();
    const type = document.createElement("td");
    type.className = "report-name";
    type.textContent = isIncome(account.type) ? "Income" : "Expense";
    const cell = document.createElement("td");
    const box = document.createElement("input");
    box.type = "text";
    box.inputMode = "decimal";
    box.value = held[account.code] === undefined ? "" : (held[account.code]! / 100).toFixed(2);
    box.placeholder = "0.00";
    box.setAttribute("aria-label", `Budget for ${account.name}`);
    box.addEventListener("change", () => {
      const text = box.value.trim();
      const parsed = text === "" ? 0 : parseAmount(text, "USD");
      if (parsed === null) {
        box.value = held[account.code] === undefined ? "" : (held[account.code]! / 100).toFixed(2);
        return;
      }
      const before = state.ledger.budgets ?? {};
      const forYear = { ...(before[String(year)] ?? {}) };
      if (parsed === 0) delete forYear[account.code];
      else forYear[account.code] = parsed;
      const next = { ...before, [String(year)]: forYear };
      state.ledger = { ...state.ledger, budgets: next };
      box.value = parsed === 0 ? "" : (parsed / 100).toFixed(2);
      void savePart(state.ledger).then(() =>
        record("budgets", `Budget ${year} for ${account.name}: ${booksMoney(parsed)}`, before, next),
      );
    });
    cell.append(box);
    tr.append(name, type, cell);
    tbody.append(tr);
  }
  table.append(tbody);
  const scroller = document.createElement("div");
  scroller.className = "table-scroll";
  scroller.append(table);
  body.append(scroller);
}
