import { invoiceBalanceMap, invoicesInPlay } from "../books.js";
import { statTiles } from "../charts.js";
import { booksMoney } from "../country.js";
import { state } from "../state.js";
import { amountCell, download, nameCell, note } from "../ui.js";
import {
  addDays,
  cashForecast,
  daysSalesOutstanding,
  documentCashEvents,
  emptyEntityModel,
  isPosted,
  margins,
  recurringCashEvents,
  resolveAccount,
  spreadsheetCell,
} from "@nzosa/core";
import type { Cents, InvoiceBalance, ProfitAndLoss } from "@nzosa/core";

/**
 * On the Charts report, below the year's pictures: how long customers take to
 * pay, what is kept of each dollar of sales, and the bank balance week by week
 * for the next thirteen, from what is owed in and out.
 */

const today = (): string => new Date().toLocaleDateString("en-CA");

/** Whether a bank account belongs to the entity chosen, or every account when none is. */
function bankInView(account: string): boolean {
  const chosen = state.entityFilter;
  if (chosen === "") return true;
  const model = state.ledger.entities ?? emptyEntityModel();
  const owners = model.banks[account];
  return owners === undefined ? model.entities.length <= 1 : owners.includes(chosen);
}

function documentInView(b: InvoiceBalance): boolean {
  const chosen = state.entityFilter;
  return chosen === "" || b.invoice.entityId === undefined || b.invoice.entityId === chosen;
}

/** Money held across the bank accounts in view, today. */
function cashNow(on: string): Cents {
  const opening = state.ledger.openingBalances;
  const accounts = new Set(state.ledger.transactions.map((t) => t.account).filter(bankInView));
  let total = 0;
  for (const account of accounts) {
    total += opening?.accounts?.[account] ?? 0;
    for (const t of state.ledger.transactions) {
      if (t.account !== account || t.date > on) continue;
      if (opening !== undefined && t.date <= opening.asAt) continue;
      total += t.amount;
    }
  }
  return total as Cents;
}

export function renderAnalytics(body: HTMLElement, whole: ProfitAndLoss, year: number): void {
  const now = today();
  const balances = [...invoiceBalanceMap().values()].filter(documentInView);

  // --- how long customers take, and what is kept -----------------------------
  const yearAgo = addDays(now, -365);
  const sales = invoicesInPlay()
    .filter((i) => i.kind === "sales" && isPosted(i) && i.issued > yearAgo && i.issued <= now)
    .filter((i) => state.entityFilter === "" || i.entityId === undefined || i.entityId === state.entityFilter)
    .reduce((s, i) => s + i.total, 0);
  const owed = balances.filter((b) => b.invoice.kind === "sales" && isPosted(b.invoice)).reduce((s, b) => s + Math.max(0, b.remaining), 0);
  const dso = daysSalesOutstanding(owed as Cents, sales as Cents, 365);
  const direct = whole.expenses
    .filter((line) => /direct cost|cost of (sales|goods)/i.test(resolveAccount(line.code, state.chart)?.type ?? ""))
    .reduce((s, line) => s + line.net, 0);
  const margin = margins(whole.totalIncome, direct as Cents, whole.netProfit);
  const heading = document.createElement("h3");
  heading.className = "chart-heading";
  heading.textContent = "Being paid, and what is kept";
  body.append(
    heading,
    statTiles([
      {
        label: "Days to be paid",
        value: dso ?? 0,
        note: dso === null ? "No invoiced sales in the last twelve months." : `Owed now, ${booksMoney(owed)}, against the last twelve months' invoiced sales.`,
        format: (n: number) => (dso === null ? "—" : `${n} days`),
      },
      {
        label: "Gross margin",
        value: margin.gross ?? 0,
        note: direct === 0 ? "No direct-cost accounts this year: the same as income." : `After direct costs of ${booksMoney(Math.abs(direct))}, FY${year}.`,
        format: (n: number) => (margin.gross === null ? "—" : `${n}%`),
      },
      {
        label: "Net margin",
        value: margin.net ?? 0,
        note: `Net profit as a share of income, FY${year}.`,
        format: (n: number) => (margin.net === null ? "—" : `${n}%`),
      },
    ]),
  );

  // --- the next thirteen weeks ------------------------------------------------
  const until = addDays(now, 90);
  const recurring = (state.ledger.recurring ?? []).filter((s) => state.entityFilter === "" || s.entityId === undefined || s.entityId === state.entityFilter);
  const events = [...documentCashEvents(balances, now), ...recurringCashEvents(recurring, now, until)];
  const opening = cashNow(now);
  const forecast = cashForecast(opening, now, events);
  const head = document.createElement("h3");
  head.className = "chart-heading";
  head.textContent = "Cash over the next 90 days";
  body.append(
    head,
    note(
      `From ${booksMoney(opening)} in the bank today: invoices still owing come in on their due dates, bills go out on theirs, ` +
        "and recurring invoices are made as scheduled. Nothing else is guessed at: wages, rent paid without a bill and " +
        "card spending are not in it. " +
        (forecast.lowest.balance === opening && forecast.lowest.date === now
          ? "On what is known, it does not fall below today's balance."
          : `Lowest point: ${booksMoney(forecast.lowest.balance)}, in the week to ${forecast.lowest.date}.`) +
        (forecast.overdueIn > 0 || forecast.overdueOut > 0
          ? ` Overdue, counted in the first week: ${booksMoney(forecast.overdueIn)} in, ${booksMoney(forecast.overdueOut)} out.`
          : ""),
    ),
  );
  const table = document.createElement("table");
  table.className = "report-table";
  table.innerHTML = "<thead><tr><th>Week</th><th>In</th><th>Out</th><th>Balance</th><th>What</th></tr></thead>";
  const tbody = document.createElement("tbody");
  for (const w of forecast.weeks) {
    const tr = document.createElement("tr");
    const balance = amountCell(booksMoney(w.closing));
    if (w.closing < 0) balance.classList.add("journal-out");
    const what = nameCell(
      w.events.length === 0 ? "" : w.events.slice(0, 3).map((e) => e.what).join("; ") + (w.events.length > 3 ? `; and ${w.events.length - 3} more` : ""),
    );
    tr.append(nameCell(`${w.from} to ${w.to}`), amountCell(w.in === 0 ? "" : booksMoney(w.in)), amountCell(w.out === 0 ? "" : booksMoney(w.out)), balance, what);
    tbody.append(tr);
  }
  table.append(tbody);
  const scroller = document.createElement("div");
  scroller.className = "table-scroll";
  scroller.append(table);
  const save = document.createElement("button");
  save.type = "button";
  save.textContent = "Download the forecast (CSV)";
  save.addEventListener("click", () => {
    const rows = [
      ["Week from", "Week to", "In", "Out", "Balance"],
      ...forecast.weeks.map((w) => [w.from, w.to, (w.in / 100).toFixed(2), (w.out / 100).toFixed(2), (w.closing / 100).toFixed(2)]),
      [],
      ["Date", "What", "Amount", "Overdue"],
      ...forecast.weeks.flatMap((w) => w.events.map((e) => [e.date, e.what, (e.amount / 100).toFixed(2), e.overdue === true ? "yes" : ""])),
    ];
    download(rows.map((r) => r.map(spreadsheetCell).join(",")).join("\r\n") + "\r\n", `cash-forecast-${now}.csv`, "text/csv");
  });
  body.append(scroller, save);
}
