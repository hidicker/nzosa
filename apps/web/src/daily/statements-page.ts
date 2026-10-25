import { redraw } from "../app.js";
import { bankLabel, banks, record } from "../books.js";
import { booksMoney } from "../country.js";
import { $, state } from "../state.js";
import { savePart } from "../store.js";
import { download, note } from "../ui.js";
import { beginningBalance, clearedLines, parseAmount, reconciliationFigures, reconciliationReport, spreadsheetCell } from "@nzosa/core";
import type { BankReconciliation, IsoDate, Transaction } from "@nzosa/core";

/**
 * Reconcile a bank account to its statement.
 *
 * Choose the account, say the statement's date and ending balance, tick the
 * lines on it, and finish once the difference is nothing. Each finished
 * statement keeps the lines it cleared, so the next starts where it ended and
 * a line is never cleared twice.
 */

let account = "";
let statementDate = "";
let balanceText = "";
let owed = false;
const ticked = new Set<string>();

function done(): BankReconciliation[] {
  return state.ledger.reconciliations ?? [];
}

async function keep(next: BankReconciliation[], what: string): Promise<void> {
  const before = done();
  state.ledger = { ...state.ledger, reconciliations: next };
  state.persistent = await savePart(state.ledger);
  await record("reconciliation", what, before, next);
}

/** Whether a name says the account is a card, whose balance is what is owed. */
function looksLikeCard(id: string): boolean {
  const label = `${id} ${bankLabel(id)}`;
  const chart = state.chart.find((a) => a.name === bankLabel(id) || a.name === id);
  return chart?.description === "Credit Card" || /\b(visa|mastercard|amex|american express|credit card)\b/i.test(label);
}

function opening(id: string): number {
  return state.ledger.openingBalances?.accounts?.[id] ?? 0;
}

/** A finished statement as a CSV: where it began, its lines, its end, and what was still outstanding. */
function downloadReport(r: BankReconciliation): void {
  const report = reconciliationReport(state.ledger.transactions, done(), r.id, opening(r.account));
  if (report === null) return;
  const money = (c: number): string => (c / 100).toFixed(2);
  const line = (t: Transaction): string[] => [t.date, t.otherParty || t.particulars, t.reference, money(t.amount)];
  const rows: string[][] = [
    [`Bank reconciliation: ${bankLabel(r.account)}, statement of ${r.statementDate}`],
    [`Finished ${r.finishedAt.slice(0, 10)}${r.by ? ` by ${r.by}` : ""}`],
    [],
    ["Beginning balance", "", "", money(report.beginning)],
    [],
    ["Cleared on this statement"],
    ["Date", "Payee", "Reference", "Amount"],
    ...report.cleared.map(line),
    ["Total cleared", "", "", money(report.clearedTotal)],
    [],
    ["Statement ending balance", "", "", money(report.statement)],
    ["Difference", "", "", money(report.statement - report.beginning - report.clearedTotal)],
    [],
    [`In the books by ${r.statementDate}, not on this statement`],
    ["Date", "Payee", "Reference", "Amount"],
    ...report.outstanding.map(line),
    ["Total outstanding", "", "", money(report.outstandingTotal)],
  ];
  download(
    rows.map((row) => row.map(spreadsheetCell).join(",")).join("\n") + "\n",
    `reconciliation-${bankLabel(r.account).replace(/[^A-Za-z0-9]+/g, "-")}-${r.statementDate}.csv`,
    "text/csv",
  );
}

function reportButton(r: BankReconciliation): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "small";
  b.textContent = "report";
  b.title = "The statement as a CSV: its beginning balance, the lines it cleared, its ending balance, and what was in the books but not yet on it.";
  b.addEventListener("click", () => downloadReport(r));
  return b;
}

/** Every finished statement on every account, newest first. */
function allStatements(body: HTMLElement): void {
  const every = [...done()].sort((a, b) => b.statementDate.localeCompare(a.statementDate) || bankLabel(a.account).localeCompare(bankLabel(b.account)));
  if (every.length === 0 || new Set(every.map((r) => r.account)).size < 2) return;
  const heading = document.createElement("h3");
  heading.textContent = "Every finished statement";
  const table = document.createElement("table");
  table.className = "report-table";
  table.innerHTML = "<thead><tr><th>Account</th><th>Statement</th><th>Ending balance</th><th>Lines</th><th>Finished</th><th></th></tr></thead>";
  const tbody = document.createElement("tbody");
  for (const r of every) {
    const tr = document.createElement("tr");
    for (const [text, cls] of [
      [bankLabel(r.account), "report-name"],
      [r.statementDate, "report-date"],
      [`${booksMoney(r.statementBalance)}${r.owed ? " owed" : ""}`, "report-amount"],
      [String(r.cleared.length), "report-amount"],
      [`${r.finishedAt.slice(0, 10)}${r.by ? `, ${r.by}` : ""}`, "report-name"],
    ] as const) {
      const td = document.createElement("td");
      td.className = cls;
      td.textContent = text;
      tr.append(td);
    }
    const cell = document.createElement("td");
    cell.append(reportButton(r));
    tr.append(cell);
    tbody.append(tr);
  }
  table.append(tbody);
  body.append(heading, table);
}

export function renderStatements(): void {
  const body = $("statements-body");
  body.textContent = "";
  const accounts = [...banks().accounts];
  if (accounts.length === 0) {
    body.append(note("No bank accounts yet. Bring in bank lines first."));
    return;
  }
  if (account === "" || !accounts.includes(account)) {
    account = accounts[0] ?? "";
    owed = looksLikeCard(account);
    ticked.clear();
  }
  const transactions = state.ledger.transactions.filter((t) => t.account === account);
  const finished = clearedLines(done(), account);
  const last = [...done()].filter((r) => r.account === account).sort((a, b) => b.statementDate.localeCompare(a.statementDate))[0];
  if (statementDate === "") {
    const latest = transactions.map((t) => t.date).sort().pop() ?? "";
    statementDate = latest;
  }

  const controls = document.createElement("div");
  controls.className = "contacts-controls";
  const pick = document.createElement("select");
  for (const id of accounts) {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = bankLabel(id);
    option.selected = id === account;
    pick.append(option);
  }
  pick.addEventListener("change", () => {
    account = pick.value;
    owed = looksLikeCard(account);
    ticked.clear();
    statementDate = "";
    balanceText = "";
    redraw("statements");
  });
  const date = document.createElement("input");
  date.type = "date";
  date.value = statementDate;
  date.addEventListener("change", () => {
    statementDate = date.value;
    redraw("statements");
  });
  const balance = document.createElement("input");
  balance.type = "text";
  balance.inputMode = "decimal";
  balance.placeholder = "Ending balance on the statement";
  balance.value = balanceText;
  balance.addEventListener("input", () => {
    balanceText = balance.value;
    paintFigures();
  });
  const kindLabel = document.createElement("label");
  const owedBox = document.createElement("input");
  owedBox.type = "checkbox";
  owedBox.checked = owed;
  owedBox.addEventListener("change", () => {
    owed = owedBox.checked;
    paintFigures();
  });
  kindLabel.append(owedBox, document.createTextNode(" A balance owed, as on a card"));
  controls.append(pick, date, balance, kindLabel);
  body.append(controls);

  const open = transactions
    .filter((t) => !finished.has(t.id) && (statementDate === "" || t.date <= statementDate))
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  for (const id of [...ticked]) if (!open.some((t) => t.id === id)) ticked.delete(id);

  const figures = document.createElement("table");
  figures.className = "report-table";
  const cell = (label: string, id: string): HTMLTableRowElement => {
    const tr = document.createElement("tr");
    const n = document.createElement("td");
    n.className = "report-name";
    n.textContent = label;
    const v = document.createElement("td");
    v.className = "report-amount";
    v.id = id;
    tr.append(n, v);
    return tr;
  };
  figures.append(
    cell(last === undefined ? "Starts at" : `Starts at (statement of ${last.statementDate})`, "stmt-beginning"),
    cell("Lines ticked", "stmt-ticked"),
    cell("Statement ending balance", "stmt-statement"),
    cell("Difference", "stmt-difference"),
  );
  body.append(figures);

  const finish = document.createElement("button");
  finish.type = "button";
  finish.className = "primary";
  finish.textContent = "Finish this statement";

  const tableOf = (): Transaction[] => open.filter((t) => ticked.has(t.id));
  function paintFigures(): void {
    const parsed = parseAmount(balanceText.trim() === "" ? "0" : balanceText, "USD");
    const f = reconciliationFigures(parsed ?? 0, owed, beginningBalance(state.ledger.transactions, done(), account, opening(account)), tableOf());
    const set = (id: string, cents: number): void => {
      const el = document.getElementById(id);
      if (el !== null) el.textContent = booksMoney(cents);
    };
    set("stmt-beginning", f.beginning);
    set("stmt-ticked", f.ticked);
    set("stmt-statement", f.statement);
    const diff = document.getElementById("stmt-difference");
    if (diff !== null) {
      diff.textContent = booksMoney(f.difference);
      diff.style.fontWeight = "700";
    }
    finish.disabled = parsed === null || balanceText.trim() === "" || f.difference !== 0 || ticked.size === 0;
  }

  if (open.length === 0) {
    body.append(note("Nothing left on this account to clear up to that date."));
  } else {
    const table = document.createElement("table");
    table.className = "report-table owner-table";
    const head = document.createElement("thead");
    head.innerHTML = "<tr><th></th><th>Date</th><th>Payee</th><th>Money in</th><th>Money out</th></tr>";
    const tbody = document.createElement("tbody");
    for (const t of open) {
      const tr = document.createElement("tr");
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = ticked.has(t.id);
      box.setAttribute("aria-label", `Cleared: ${t.date} ${t.otherParty}`);
      box.addEventListener("change", () => {
        if (box.checked) ticked.add(t.id);
        else ticked.delete(t.id);
        paintFigures();
      });
      const tick = document.createElement("td");
      tick.append(box);
      tr.append(tick);
      for (const [text, cls] of [
        [t.date, "report-name"],
        [t.otherParty || t.particulars, "report-name"],
        [t.amount > 0 ? booksMoney(t.amount) : "", "report-amount"],
        [t.amount < 0 ? booksMoney(-t.amount) : "", "report-amount"],
      ] as const) {
        const td = document.createElement("td");
        td.className = cls;
        td.textContent = text;
        tr.append(td);
      }
      tbody.append(tr);
    }
    table.append(head, tbody);
    const scroller = document.createElement("div");
    scroller.className = "table-scroll";
    scroller.append(table);

    const actions = document.createElement("div");
    actions.className = "migration-actions";
    const all = document.createElement("button");
    all.type = "button";
    all.textContent = "Tick all";
    all.addEventListener("click", () => {
      for (const t of open) ticked.add(t.id);
      redraw("statements");
    });
    const none = document.createElement("button");
    none.type = "button";
    none.textContent = "Clear all";
    none.addEventListener("click", () => {
      ticked.clear();
      redraw("statements");
    });
    actions.append(all, none, finish);
    body.append(actions, scroller);
  }

  finish.addEventListener("click", () => {
    const parsed = parseAmount(balanceText, "USD");
    if (parsed === null) return;
    const made: BankReconciliation = {
      id: `${account}-${statementDate}-${done().length + 1}`,
      account,
      statementDate: statementDate as IsoDate,
      statementBalance: parsed,
      owed,
      cleared: [...ticked],
      finishedAt: new Date().toISOString(),
      ...(state.who !== "" ? { by: state.who } : {}),
    };
    ticked.clear();
    balanceText = "";
    void keep([...done(), made], `${bankLabel(account)} reconciled to the statement of ${statementDate}`).then(() => redraw("statements"));
  });

  // Statements already finished, newest first, the latest one undoable.
  const past = done().filter((r) => r.account === account).sort((a, b) => b.statementDate.localeCompare(a.statementDate));
  if (past.length > 0) {
    const heading = document.createElement("h3");
    heading.textContent = "Finished statements";
    body.append(heading);
    const list = document.createElement("ul");
    past.forEach((r, index) => {
      const li = document.createElement("li");
      li.textContent = `${r.statementDate}: ${booksMoney(r.statementBalance)}${r.owed ? " owed" : ""}, ${r.cleared.length} lines `;
      li.append(reportButton(r), " ");
      if (index === 0) {
        const undo = document.createElement("button");
        undo.type = "button";
        undo.className = "small";
        undo.textContent = "Undo";
        undo.addEventListener("click", () => {
          void keep(
            done().filter((x) => x.id !== r.id),
            `Undid the statement of ${r.statementDate} on ${bankLabel(account)}`,
          ).then(() => redraw("statements"));
        });
        li.append(undo);
      }
      list.append(li);
    });
    body.append(list);
  }
  allStatements(body);
  paintFigures();
}
