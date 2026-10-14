import { redraw } from "../app.js";
import { bankLabel, banks, record } from "../books.js";
import { booksMoney } from "../country.js";
import { $, state } from "../state.js";
import { savePart } from "../store.js";
import { note } from "../ui.js";
import { beginningBalance, clearedLines, parseAmount, reconciliationFigures } from "@nzosa/core";
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
  paintFigures();
}
