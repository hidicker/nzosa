import { redraw } from "../app.js";
import { invoiceBalanceMap, record } from "../books.js";
import { booksCurrency, booksMoney } from "../country.js";
import { state } from "../state.js";
import { save } from "../store.js";
import { amountCell, nameCell, note, wideTable } from "../ui.js";
import { allocationProblem, creditsOnAccount, parseAmount, proposeAllocations } from "@nzosa/core";
import type { CreditAllocation, CreditOnAccount, InvoiceBalance, InvoiceKind, IsoDate } from "@nzosa/core";

/**
 * Credit on account: what a customer or supplier has in credit -- a credit
 * note not yet used up, or a document paid more than it asked -- and putting
 * it against their other documents, in whole or in part, when it is wanted.
 */

const today = (): IsoDate => new Date().toLocaleDateString("en-CA") as IsoDate;

/** Credit on account for a page's documents, by contact, with a way to use it. */
export function creditOnAccountSection(body: HTMLElement, balances: Map<string, InvoiceBalance>, kind: InvoiceKind): void {
  const credits = creditsOnAccount(balances.values(), kind, state.ledger.creditNotes ?? {});
  const used = (state.ledger.creditAllocations ?? []).filter((a) => balances.get(a.from)?.invoice.kind === kind);
  if (credits.length === 0 && used.length === 0) return;
  const heading = document.createElement("h3");
  heading.textContent = "Credit on account";
  body.append(heading);
  const who = kind === "sales" ? "customer" : "supplier";
  body.append(
    note(
      `What a ${who} has in credit — a credit note not used up, or more paid than was owed — ` +
        `held until it is put against their other ${kind === "sales" ? "invoices" : "bills"}, or paid back.`,
    ),
  );
  if (credits.length > 0) {
    const table = document.createElement("table");
    table.className = "report-table owner-table match-table";
    table.innerHTML = `<thead><tr><th>${kind === "sales" ? "Customer" : "Supplier"}</th><th>From</th><th>Credit</th><th>Owing on others</th><th></th></tr></thead>`;
    const tbody = document.createElement("tbody");
    for (const credit of credits) {
      const tr = document.createElement("tr");
      tr.append(nameCell(credit.contact));
      tr.append(nameCell(credit.sources.map((s) => s.balance.invoice.number).join(", ")));
      tr.append(amountCell(booksMoney(credit.available)));
      tr.append(amountCell(booksMoney(credit.open.reduce((s, b) => s + b.remaining, 0))));
      const cell = document.createElement("td");
      const use = document.createElement("button");
      use.type = "button";
      use.className = "small";
      use.textContent = "Use credit";
      use.disabled = credit.open.length === 0;
      use.title = credit.open.length === 0 ? `Nothing of theirs is owing. Paid back, the refund is matched to the ${credit.sources[0]?.balance.invoice.number ?? "credit"} on Reconcile.` : "";
      use.addEventListener("click", () => openUseCredit(credit));
      cell.append(use);
      tr.append(cell);
      tbody.append(tr);
    }
    table.append(tbody);
    body.append(wideTable(table));
  }
  if (used.length > 0) body.append(usedList(used));
}

/** The credit already used, each removable. */
function usedList(used: readonly CreditAllocation[]): HTMLElement {
  const details = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = `Credit used (${used.length})`;
  details.append(summary);
  const table = document.createElement("table");
  table.className = "report-table owner-table";
  table.innerHTML = "<thead><tr><th>Date</th><th>From</th><th>Against</th><th>Amount</th><th></th></tr></thead>";
  const tbody = document.createElement("tbody");
  for (const a of [...used].sort((x, y) => y.date.localeCompare(x.date))) {
    const tr = document.createElement("tr");
    tr.append(nameCell(a.date), nameCell(a.from), nameCell(a.to), amountCell(booksMoney(a.amount)));
    const cell = document.createElement("td");
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "small remove";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => {
      const all = state.ledger.creditAllocations ?? [];
      void keepAllocations(all.filter((x) => x !== a), `Took ${booksMoney(a.amount)} of ${a.from} back off ${a.to}`);
    });
    cell.append(remove);
    tr.append(cell);
    tbody.append(tr);
  }
  table.append(tbody);
  details.append(table);
  return details;
}

async function keepAllocations(next: CreditAllocation[], what: string): Promise<boolean> {
  const before = state.ledger.creditAllocations ?? [];
  const was = state.ledger;
  state.ledger = { ...state.ledger, creditAllocations: next };
  try {
    state.persistent = await save(state.ledger);
  } catch {
    state.ledger = was;
    return false;
  }
  await record("creditAllocations", what, before, next);
  redraw("invoices");
  redraw("bills");
  redraw("contacts");
  return true;
}

/** Use a contact's credit against their documents still owing. */
function openUseCredit(credit: CreditOnAccount): void {
  const box = document.createElement("dialog");
  box.className = "ask-on-page payment-file-view";
  const heading = document.createElement("h3");
  heading.textContent = `${credit.contact}: ${booksMoney(credit.available)} in credit`;
  const from = document.createElement("p");
  from.className = "payment-file-said";
  from.textContent = `From ${credit.sources.map((s) => `${s.balance.invoice.number} (${booksMoney(s.available)})`).join(", ")}.`;

  const date = document.createElement("input");
  date.type = "date";
  const latestSource = credit.sources.reduce((d, s) => (s.balance.invoice.issued > d ? s.balance.invoice.issued : d), "");
  date.value = today() < latestSource ? latestSource : today();
  const dateLabel = document.createElement("label");
  dateLabel.className = "contact-field";
  const dateWord = document.createElement("span");
  dateWord.textContent = "Used on";
  dateLabel.append(dateWord, date);

  // Proposed: oldest due first, as much as the credit covers.
  const proposed = proposeAllocations(credit, undefined, date.value as IsoDate);
  const firstGuess = new Map<string, number>();
  for (const a of proposed) firstGuess.set(a.to, (firstGuess.get(a.to) ?? 0) + a.amount);

  const table = document.createElement("table");
  table.className = "report-table payment-file-table";
  table.innerHTML = "<thead><tr><th>Document</th><th>Date</th><th>Due</th><th style=\"text-align:right\">Owing</th><th style=\"text-align:right\">Use</th></tr></thead>";
  const tbody = document.createElement("tbody");
  const boxes = new Map<string, HTMLInputElement>();
  for (const b of credit.open) {
    const tr = document.createElement("tr");
    tr.append(nameCell(b.invoice.number), nameCell(b.invoice.issued), nameCell(b.invoice.due ?? ""), amountCell(booksMoney(b.remaining)));
    const cell = document.createElement("td");
    cell.className = "report-amount";
    const amount = document.createElement("input");
    amount.type = "text";
    amount.inputMode = "decimal";
    amount.style.width = "7em";
    amount.style.textAlign = "right";
    const guess = firstGuess.get(b.invoice.number) ?? 0;
    amount.value = guess === 0 ? "" : (guess / 100).toFixed(2);
    amount.setAttribute("aria-label", `Credit to use on ${b.invoice.number}`);
    amount.addEventListener("input", () => showTotal());
    boxes.set(b.invoice.number, amount);
    cell.append(amount);
    tr.append(cell);
    tbody.append(tr);
  }
  table.append(tbody);

  const total = document.createElement("p");
  total.className = "payment-file-total";
  const said = document.createElement("p");
  said.className = "cloud-said";
  said.setAttribute("role", "alert");
  const wanted = (): Map<string, number> | null => {
    const out = new Map<string, number>();
    for (const [number, input] of boxes) {
      const cents = parseAmount(input.value.trim() || "0", booksCurrency());
      if (cents === null || cents < 0) return null;
      out.set(number, cents);
    }
    return out;
  };
  function showTotal(): void {
    const w = wanted();
    if (w === null) {
      total.textContent = "";
      return;
    }
    const sum = [...w.values()].reduce((s, x) => s + x, 0);
    const left = credit.available - sum;
    total.textContent = `Using ${booksMoney(sum)}, ${left >= 0 ? `${booksMoney(left)} left on account` : `${booksMoney(-left)} more than the credit`}.`;
  }
  showTotal();

  const actions = document.createElement("div");
  actions.className = "ask-on-page-actions";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "Cancel";
  const go = document.createElement("button");
  go.type = "button";
  go.className = "primary";
  go.textContent = "Use credit";
  actions.append(cancel, go);
  const finish = (): void => {
    box.close();
    box.remove();
  };
  cancel.addEventListener("click", finish);
  box.addEventListener("cancel", (event) => {
    event.preventDefault();
    finish();
  });
  go.addEventListener("click", () => {
    said.textContent = "";
    const w = wanted();
    if (w === null) {
      said.textContent = "Amounts as numbers, such as 120.00.";
      return;
    }
    const sum = [...w.values()].reduce((s, x) => s + x, 0);
    if (sum === 0) {
      said.textContent = "Say how much to use on at least one.";
      return;
    }
    if (sum > credit.available) {
      said.textContent = `There is ${booksMoney(credit.available)} of credit to use.`;
      return;
    }
    for (const b of credit.open) {
      if ((w.get(b.invoice.number) ?? 0) > b.remaining) {
        said.textContent = `${b.invoice.number} owes ${booksMoney(b.remaining)}.`;
        return;
      }
    }
    const on = date.value as IsoDate;
    const made = proposeAllocations(credit, w, on);
    const problem = allocationProblem(made, invoiceBalanceMap());
    if (problem !== null) {
      said.textContent = problem;
      return;
    }
    go.disabled = true;
    const targets = [...new Set(made.map((a) => a.to))].join(", ");
    void keepAllocations(
      [...(state.ledger.creditAllocations ?? []), ...made],
      `${booksMoney(sum)} of ${credit.contact}'s credit used on ${targets}`,
    ).then((ok) => {
      if (ok) finish();
      else {
        go.disabled = false;
        said.textContent = "Not saved: the date may be in a locked period.";
      }
    });
  });

  box.append(heading, from, dateLabel, table, total, said, actions);
  document.body.append(box);
  box.showModal();
  go.focus();
}

/** Whether a credit note has been used in part, and so cannot also be applied whole. */
export function usedInPart(number: string): boolean {
  return (state.ledger.creditAllocations ?? []).some((a) => a.from === number);
}
