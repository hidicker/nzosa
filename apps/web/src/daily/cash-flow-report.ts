import { accountsForEditing, bankLabel, reportEngine } from "../books.js";
import { state } from "../state.js";
import { note } from "../ui.js";
import { cashFlowStatement, emptyEntityModel } from "@nzosa/core";
import type { CashFlowStatement, DateRange } from "@nzosa/core";
import { taxYearEnd, taxYearStart } from "../tax-year.js";
import { booksLocale } from "../country.js";

/**
 * The statement of cash flows, for the entity the page is filtered to.
 *
 * Built from the same coding as the profit and loss, splits expanded, so a
 * line coded to sales is operating cash here and sales there. The entity's
 * own bank accounts are the ones it holds money in -- as ticked on Entities &
 * accounts -- and with no entity chosen, every account in these books.
 */

function money(cents: number): string {
  const text = (Math.abs(cents) / 100).toLocaleString(booksLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return cents < 0 ? `(${text})` : text;
}

function statementFor(period: DateRange, banks: ReadonlySet<string>): CashFlowStatement | null {
  const engine = reportEngine();
  if (engine === null) return null;
  const rows = accountsForEditing();
  const types = new Map(rows.map(({ account, label }) => [label, account.type]));
  const names = new Map(rows.map(({ account, label }) => [label, account.name]));
  const opening = state.ledger.openingBalances;
  return cashFlowStatement({
    transactions: engine.transactions,
    codeOf: engine.codeOf,
    typeOf: (code) => types.get(code) ?? null,
    nameOf: (code) => names.get(code) ?? code,
    period,
    banks,
    transfers: state.ledger.transfers ?? {},
    loanAccounts: new Set([...banks].filter(isLoanAccount)),
    accountName: (account) => bankLabel(account),
    ...(opening !== undefined ? { opening: { asAt: opening.asAt, accounts: opening.accounts } } : {}),
  });
}

/**
 * Whether a bank account is a loan rather than cash: a home loan, a term loan
 * or a mortgage, fed in like an account, by what it is called.
 */
function isLoanAccount(account: string): boolean {
  return /loan|mortgage|total ?money|line of credit/i.test(`${bankLabel(account)} ${account}`);
}

/** The bank accounts the page's entity holds money in, or every one. */
function banksNow(): { banks: Set<string>; title: string } {
  const model = state.ledger.entities ?? emptyEntityModel();
  const entity = model.entities.find((e) => e.id === state.entityFilter);
  const all = new Set(state.ledger.transactions.map((t) => t.account));
  if (entity === undefined) return { banks: all, title: "All accounts" };
  const mine = new Set(
    Object.entries(model.banks)
      .filter(([, ids]) => ids.includes(entity.id))
      .map(([bank]) => bank),
  );
  return { banks: mine, title: entity.name };
}

let byMonth = false;

export function renderCashFlow(body: HTMLElement, year: number): void {
  const { banks, title } = banksNow();
  const heading = document.createElement("h3");
  heading.textContent = `${title} — Statement of cash flows, year to 31 March ${year}`;
  body.append(heading);
  if (banks.size === 0) {
    body.append(
      note(
        `No bank account is ticked for ${title}, so it holds no cash here. Tick its accounts on ` +
          "Entities & accounts, or choose all entities.",
      ),
    );
    return;
  }
  const period = { from: taxYearStart(year), to: taxYearEnd(year) };
  const statement = statementFor(period, banks);
  if (statement === null) {
    body.append(note("No transactions yet."));
    return;
  }

  const toggle = document.createElement("label");
  const tick = document.createElement("input");
  tick.type = "checkbox";
  tick.checked = byMonth;
  tick.addEventListener("change", () => {
    byMonth = tick.checked;
    body.textContent = "";
    renderCashFlow(body, year);
  });
  toggle.append(tick, " Month by month");
  body.append(toggle);

  if (byMonth) {
    body.append(monthly(year, banks));
  } else {
    const table = document.createElement("table");
    table.className = "report-table";
    const tbody = document.createElement("tbody");
    const row = (label: string, amount: number | null, cls = ""): void => {
      const tr = document.createElement("tr");
      if (cls !== "") tr.className = cls;
      const name = document.createElement("td");
      name.className = "report-name";
      name.textContent = label;
      const value = document.createElement("td");
      value.className = "report-amount";
      value.textContent = amount === null ? "" : money(amount);
      tr.append(name, value);
      tbody.append(tr);
    };
    for (const section of statement.sections) {
      row(section.title, null, "report-section");
      for (const line of section.lines) row(line.label, line.amount);
      if (section.activity === "operating" && statement.uncodedCount > 0) {
        row(`Not coded to an account yet (${statement.uncodedCount} lines)`, statement.uncoded);
      }
      row(`Net cash from ${section.activity} activities`, section.total, "report-total");
    }
    row("Net increase (decrease) in cash", statement.netChange, "report-total");
    row(`Cash at 1 April ${year - 1}`, statement.openingCash);
    row(`Cash at 31 March ${year}`, statement.closingCash, "report-total");
    table.append(tbody);
    body.append(table);
  }

  if (!statement.openingKnown) {
    body.append(
      note(
        "Not every bank account has an opening balance, so cash at the start counts only the ones " +
          "that do. Enter them on Opening balances.",
      ),
    );
  }
  if (statement.uncodedCount > 0) {
    body.append(
      note(
        `${statement.uncodedCount} bank lines in the year are not coded yet, so they are shown on their ` +
          "own under operating activities. Coding them puts each under its proper heading.",
      ),
    );
  }
  const cash = [...banks].filter((b) => !isLoanAccount(b));
  const loans = [...banks].filter(isLoanAccount);
  body.append(
    note(
      `Cash is the money in ${cash.map((b) => bankLabel(b)).join(", ")}. A transfer between two of ` +
        "these is not cash moving and is left out; one to another entity's account is financing." +
        (loans.length > 0
          ? ` ${loans.map((b) => bankLabel(b)).join(", ")} ${loans.length === 1 ? "is a loan" : "are loans"}, ` +
            "not cash: money paid into or drawn from one is shown under financing."
          : ""),
    ),
  );
}

/** The three headings, the change and the closing cash, a column for each month. */
function monthly(year: number, banks: ReadonlySet<string>): HTMLElement {
  const months: { label: string; s: CashFlowStatement | null }[] = [];
  for (let i = 0; i < 12; i++) {
    const y = i < 9 ? year - 1 : year;
    const m = ((i + 3) % 12) + 1;
    const from = `${y}-${String(m).padStart(2, "0")}-01`;
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const to = `${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
    months.push({
      label: new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(booksLocale(), { month: "short", timeZone: "UTC" }),
      s: statementFor({ from, to }, banks),
    });
  }
  const table = document.createElement("table");
  table.className = "report-table cash-flow-months";
  const head = document.createElement("thead");
  head.innerHTML = `<tr><th></th>${months.map((m) => `<th class="report-amount">${m.label}</th>`).join("")}</tr>`;
  const tbody = document.createElement("tbody");
  const row = (label: string, pick: (s: CashFlowStatement) => number, cls = ""): void => {
    const tr = document.createElement("tr");
    if (cls !== "") tr.className = cls;
    const name = document.createElement("td");
    name.className = "report-name";
    name.textContent = label;
    tr.append(name);
    for (const m of months) {
      const td = document.createElement("td");
      td.className = "report-amount";
      td.textContent = m.s === null ? "" : money(pick(m.s));
      tr.append(td);
    }
    tbody.append(tr);
  };
  row("Operating", (s) => s.sections[0]?.total ?? 0);
  row("Investing", (s) => s.sections[1]?.total ?? 0);
  row("Financing", (s) => s.sections[2]?.total ?? 0);
  row("Net change", (s) => s.netChange, "report-total");
  row("Cash at month end", (s) => s.closingCash, "report-total");
  table.append(head, tbody);
  const wrap = document.createElement("div");
  wrap.className = "table-scroll";
  wrap.append(table);
  return wrap;
}
