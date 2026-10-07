import { redraw, showPage } from "../app.js";
import {
  bankLabel,
  billEntities,
  billsAvailable,
  controlAccountFor,
  invoiceAssignments,
  invoiceBalanceMap,
  record,
  invoicesInPlay,
} from "../books.js";
import { $, state } from "../state.js";
import { savePart } from "../store.js";
import { amountCell, invoiceCell, nameCell, note } from "../ui.js";
import { approveBill, editBill, startNewBill } from "./invoices.js";
import { addPayableFor } from "./standard-accounts-panel.js";
import {
  accountEntityKey,
  daysBetween,
  documentStatus,
  emptyEntityModel,
  formatAmount,
  isPosted,
} from "@nzosa/core";
import type { DocumentStatus, Entity, Invoice, InvoiceBalance, OutsidePayment } from "@nzosa/core";
import { booksLocale, moneyPlaces } from "../country.js";

/**
 * Bills: what these books owe suppliers.
 *
 * Only for the entities that keep them -- companies and commercial rentals.
 * A bill is written as a draft, approved into the books, and paid by a bank
 * line matched to it on Reconcile. The one payment recorded here is the kind
 * no bank line shows, and that is asked for carefully, because recording a
 * payment the bank also shows pays the bill twice.
 */

/** The bill whose payment is being recorded, or null. */
let paying: string | null = null;

const today = (): string => new Date().toISOString().slice(0, 10);

const money = (cents: number): string =>
  (cents / 100).toLocaleString(booksLocale(), { minimumFractionDigits: moneyPlaces(), maximumFractionDigits: moneyPlaces() });

function entityName(id: string | undefined): string {
  if (id === undefined) return "";
  return (state.ledger.entities ?? emptyEntityModel()).entities.find((e) => e.id === id)?.name ?? "";
}

/** The bills on show: this entity's when one is chosen. */
function billsInView(): Invoice[] {
  const chosen = state.entityFilter;
  return invoicesInPlay().filter(
    (i) => i.kind === "purchase" && (chosen === "" || i.entityId === chosen),
  );
}

const FILTERS: readonly { value: string; label: string; keep: (s: DocumentStatus) => boolean }[] = [
  // Drafts included: a bill just saved should not vanish from the page it was saved on.
  { value: "open", label: "Open", keep: (s) => ["Draft", "Awaiting payment", "Part paid", "Overdue"].includes(s) },
  { value: "topay", label: "To pay", keep: (s) => s === "Awaiting payment" || s === "Part paid" || s === "Overdue" },
  { value: "draft", label: "Drafts", keep: (s) => s === "Draft" },
  { value: "overdue", label: "Overdue", keep: (s) => s === "Overdue" },
  { value: "paid", label: "Paid", keep: (s) => s === "Paid" },
  { value: "credit", label: "Credit notes", keep: (s) => s === "Credit note" },
  { value: "voided", label: "Voided", keep: (s) => s === "Voided" },
  { value: "all", label: "All", keep: () => true },
];

export function renderBills(): void {
  const body = $("bills-body");
  body.textContent = "";

  if (!billsAvailable()) {
    body.append(
      note(
        "Bills are kept for companies and commercial rentals, where a bill sits in Accounts Payable " +
          "until it is paid. None of the entities here is one: a household or a residential rental " +
          "records its bills as the bank lines that pay them. Say an entity's kind and structure on " +
          "the Entities page if that is wrong.",
      ),
    );
    return;
  }

  // An entity with nowhere to hold what it owes cannot approve a bill.
  for (const entity of billEntities()) {
    if (state.entityFilter !== "" && state.entityFilter !== entity.id) continue;
    if (controlAccountFor(entity.id, "purchase") !== undefined) continue;
    body.append(payableMissing(entity));
  }

  const balances = invoiceBalanceMap();
  const now = today();
  const bills = billsInView();
  const rows = bills
    .map((bill) => {
      const balance = balances.get(bill.number);
      return balance === undefined ? null : { bill, balance, status: documentStatus(balance, now) };
    })
    .filter((r): r is { bill: Invoice; balance: InvoiceBalance; status: DocumentStatus } => r !== null);

  body.append(summary(rows, now));

  if (paying !== null) {
    const row = rows.find((r) => r.bill.number === paying);
    if (row === undefined) paying = null;
    else body.append(payPanel(row.bill, row.balance));
  }

  const filter = $<HTMLSelectElement>("bill-filter");
  if (filter.options.length === 0) {
    for (const one of FILTERS) {
      const option = document.createElement("option");
      option.value = one.value;
      option.textContent = one.label;
      filter.append(option);
    }
    filter.value = "open";
  }
  const keep = FILTERS.find((f) => f.value === filter.value)?.keep ?? (() => true);
  const needle = $<HTMLInputElement>("bill-search").value.trim().toLowerCase();
  const shown = rows
    .filter((r) => keep(r.status))
    .filter(
      (r) =>
        needle === "" ||
        `${r.bill.number} ${r.bill.contact} ${r.bill.reference}`.toLowerCase().includes(needle),
    )
    .sort((a, b) => (a.bill.due ?? a.bill.issued).localeCompare(b.bill.due ?? b.bill.issued));

  if (bills.length === 0) {
    body.append(
      note(
        "No bills yet. Press New bill to enter one. Approving it puts the cost and its GST in the " +
          "books on the bill date; matching its payment on Reconcile clears it.",
      ),
    );
    return;
  }
  if (shown.length === 0) {
    body.append(note("Nothing here under this filter."));
    return;
  }

  const several = billEntities().length > 1 && state.entityFilter === "";
  const table = document.createElement("table");
  table.className = "report-table owner-table match-table bills-table";
  const head = document.createElement("thead");
  head.innerHTML =
    "<tr><th>Bill</th>" +
    (several ? "<th>Entity</th>" : "") +
    "<th>Date</th><th>Due</th><th>Total</th><th>Owing</th><th>Status</th><th></th></tr>";
  const tbody = document.createElement("tbody");
  for (const { bill, balance, status } of shown) {
    const tr = document.createElement("tr");
    tr.append(invoiceCell(bill, bill.number));
    if (several) tr.append(nameCell(entityName(bill.entityId)));
    tr.append(nameCell(bill.issued));
    const due = nameCell(bill.due ?? "");
    if (status === "Overdue" && bill.due !== null) {
      due.classList.add("match-off");
      due.title = `${daysBetween(bill.due, now)} days overdue`;
    }
    tr.append(due);
    tr.append(amountCell(money(bill.total)));
    const owing = amountCell(status === "Draft" || status === "Voided" ? "" : money(balance.remaining));
    tr.append(owing);
    const statusCell = nameCell(status);
    statusCell.className = `report-name bill-status bill-status-${status.toLowerCase().replace(/\s+/g, "-")}`;
    tr.append(statusCell);
    tr.append(actionsCell(bill, balance, status));
    tbody.append(tr);

    // Payments no bank line shows, under the bill they paid, each removable.
    for (const [index, payment] of (bill.paidOutside ?? []).entries()) {
      tbody.append(outsideRow(bill, payment, index, several));
    }
  }
  table.append(head, tbody);
  body.append(table);
}

function summary(
  rows: readonly { bill: Invoice; balance: InvoiceBalance; status: DocumentStatus }[],
  now: string,
): HTMLElement {
  const box = document.createElement("div");
  box.className = "check-summary";
  const open = rows.filter((r) => ["Awaiting payment", "Part paid", "Overdue"].includes(r.status));
  const overdue = rows.filter((r) => r.status === "Overdue");
  const soon = open.filter((r) => r.bill.due !== null && r.bill.due >= now && daysBetween(now, r.bill.due) <= 7);
  const sum = (list: typeof rows): number => list.reduce((s, r) => s + Math.max(0, r.balance.remaining), 0);
  for (const [value, label] of [
    [money(sum(open)), `owing on ${open.length} bill${open.length === 1 ? "" : "s"}`],
    [money(sum(overdue)), `overdue on ${overdue.length}`],
    [money(sum(soon)), "due in the next 7 days"],
    [String(rows.filter((r) => r.status === "Draft").length), "drafts, not in the books"],
  ] as const) {
    const cell = document.createElement("div");
    cell.className = "check-stat";
    const big = document.createElement("span");
    big.className = "check-value";
    big.textContent = value;
    const small = document.createElement("span");
    small.className = "check-label";
    small.textContent = label;
    cell.append(big, small);
    box.append(cell);
  }
  return box;
}

function payableMissing(entity: Entity): HTMLElement {
  const box = document.createElement("div");
  box.className = "provisional-note";
  const text = document.createElement("p");
  text.textContent =
    `${entity.name} has no Accounts Payable account, where an approved bill waits until it is paid. ` +
    "Its bills can be written as drafts, but not approved until it has one.";
  const add = document.createElement("button");
  add.type = "button";
  add.textContent = `Add Accounts Payable for ${entity.name}`;
  add.addEventListener("click", () => {
    add.disabled = true;
    void addPayableFor(entity).then((code) => {
      state.invoiceMessage = "";
      alert(`Added ${code} Accounts Payable for ${entity.name}.`);
      redraw("bills");
    });
  });
  box.append(text, add);
  return box;
}

function button(label: string, action: () => void, title?: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  if (title !== undefined) b.title = title;
  b.addEventListener("click", action);
  return b;
}

function actionsCell(bill: Invoice, balance: InvoiceBalance, status: DocumentStatus): HTMLTableCellElement {
  const td = document.createElement("td");
  td.className = "report-amount bill-actions";
  td.append(button("edit", () => editBill(bill.number)));
  if (status === "Draft") {
    const approve = button("approve", () => void approveBill(bill.number),
      "Post it: the cost and GST on the bill date, the amount owing in Accounts Payable.");
    approve.className = "primary";
    td.append(approve);
  }
  if (isPosted(bill) && balance.remaining > 0 && status !== "Credit note") {
    td.append(
      button("mark paid", () => {
        paying = bill.number;
        redraw("bills");
        document.getElementById("bill-pay")?.scrollIntoView({ block: "nearest" });
      }, "Record a payment that no bank line in these books shows"),
    );
  }
  if (status !== "Voided") {
    td.append(button("void", () => void voidBill(bill, balance), "Take it back out of the books"));
  }
  return td;
}

function outsideRow(bill: Invoice, payment: OutsidePayment, index: number, several: boolean): HTMLTableRowElement {
  const tr = document.createElement("tr");
  tr.className = "bill-payment-row";
  const cell = document.createElement("td");
  cell.colSpan = several ? 5 : 4;
  cell.className = "report-name match-sub";
  cell.textContent =
    `Paid ${payment.date} from ${payment.accountCode}, not through a bank line` +
    (payment.note ? `: ${payment.note}` : "");
  tr.append(cell, amountCell(money(-Math.abs(payment.amount))), nameCell(""));
  const actions = document.createElement("td");
  actions.className = "report-amount";
  actions.append(button("remove", () => void removeOutside(bill, index)));
  tr.append(actions);
  return tr;
}

/**
 * Bank lines that look like this payment: money out, the amount owing, from
 * the bill date on, and not already settling something.
 */
function lookalikes(bill: Invoice, owing: number): { date: string; amount: number; who: string; account: string }[] {
  const assigned = invoiceAssignments();
  const firstWord = bill.contact.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  return state.ledger.transactions
    .filter((t) => t.amount < 0 && !assigned.has(t.id) && t.date >= bill.issued)
    .filter((t) => {
      const same = Math.abs(t.amount) === owing || Math.abs(t.amount) === bill.total;
      const named = firstWord.length >= 3 && `${t.otherParty} ${t.particulars} ${t.reference}`.toLowerCase().includes(firstWord);
      return same && (named || daysBetween(bill.issued, t.date) <= 60);
    })
    .slice(0, 4)
    .map((t) => ({
      date: t.date,
      amount: t.amount,
      who: t.otherParty || t.particulars || "(no payee)",
      account: bankLabel(t.account),
    }));
}

/**
 * The accounts a bill can be paid from other than the bank.
 *
 * Who really paid: a shareholder or director (their current account or loan),
 * an owner (funds introduced), or a card or account whose statements are not
 * loaded. Not tax, wages or suspense accounts, and not another control
 * account -- paying a bill from any of those is a mistake the list should not
 * make easy.
 */
function payFromAccounts(bill: Invoice): { value: string; label: string }[] {
  const model = state.ledger.entities ?? emptyEntityModel();
  const payable = bill.entityId === undefined ? undefined : controlAccountFor(bill.entityId, "purchase");
  const fits = /liabilit|equity|bank|credit card/i;
  const never = /gst|payable|receivable|tax|paye|wages|kiwisaver|suspense|rounding|historical|tracking|bond|provision/i;
  return state.chart
    .filter((a) => fits.test(a.type) && !never.test(`${a.type} ${a.name}`))
    .filter((a) => a.code !== payable?.code)
    .filter((a) => bill.entityId === undefined || model.accounts[accountEntityKey(a)] === bill.entityId)
    .map((a) => ({ value: a.code || a.name, label: `${a.code ? `${a.code} ` : ""}${a.name}` }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function payPanel(bill: Invoice, balance: InvoiceBalance): HTMLElement {
  const box = document.createElement("div");
  box.id = "bill-pay";
  box.className = "invoice-editor bill-pay";

  const heading = document.createElement("h3");
  heading.textContent = `Mark ${bill.number} paid (${bill.contact}, ${money(balance.remaining)} owing)`;
  box.append(heading);

  // The warning comes before the form, because it decides whether the form
  // should be used at all.
  const warning = document.createElement("div");
  warning.className = "provisional-note bill-warning";
  const lines = [
    "Only for a payment that no bank line in these books shows, such as a credit card whose " +
      "statements aren't loaded, or a shareholder or owner paying from their own money.",
    "It posts debit Accounts Payable and credit the account you choose, and claims the bill's GST in " +
      "the GST period of the payment date.",
    "If the money left a bank account that is in these books, match that bank line to the bill on " +
      "Reconcile instead. Recording it here as well would pay the bill twice and claim its GST twice.",
  ];
  for (const line of lines) {
    const p = document.createElement("p");
    p.textContent = line;
    warning.append(p);
  }
  const alike = lookalikes(bill, balance.remaining);
  if (alike.length > 0) {
    const p = document.createElement("p");
    p.className = "match-off";
    p.textContent =
      "These bank lines look like this payment: " +
      alike.map((a) => `${a.date} ${formatAmount(a.amount)} ${a.who} (${a.account})`).join("; ") +
      ".";
    const go = button("Match on Reconcile", () => {
      paying = null;
      showPage("reconcile");
    });
    warning.append(p, go);
  }
  box.append(warning);

  const grid = document.createElement("div");
  grid.className = "invoice-fields";
  const field = (label: string, control: HTMLElement): void => {
    const wrap = document.createElement("label");
    const name = document.createElement("span");
    name.textContent = label;
    wrap.append(name, control);
    grid.append(wrap);
  };

  const date = document.createElement("input");
  date.type = "date";
  date.value = today() < bill.issued ? bill.issued : today();
  field("Paid on", date);

  const amount = document.createElement("input");
  amount.type = "text";
  amount.className = "invoice-amount";
  amount.value = (balance.remaining / 100).toFixed(2);
  field("Amount", amount);

  const from = document.createElement("select");
  const choices = payFromAccounts(bill);
  const pick = document.createElement("option");
  pick.value = "";
  pick.textContent = choices.length === 0 ? "No account to choose: add one on Chart of accounts" : "Choose the account";
  from.append(pick);
  for (const choice of choices) {
    const option = document.createElement("option");
    option.value = choice.value;
    option.textContent = choice.label;
    from.append(option);
  }
  field("Paid from", from);

  const memo = document.createElement("input");
  memo.type = "text";
  memo.placeholder = "e.g. Paid by Ana on her own card";
  field("Note", memo);
  box.append(grid);

  const filedNote = document.createElement("p");
  filedNote.className = "match-off";
  const checkFiled = (): void => {
    const filed = state.filed.find(
      (f) => date.value <= f.periodEnd && (f.periodStart === null || date.value >= f.periodStart),
    );
    filedNote.textContent =
      filed === undefined
        ? ""
        : `The GST period to ${filed.periodEnd} is already filed. A payment dated in it changes that ` +
          "return; date it when it was really paid, and claim it in the next return if it was missed.";
  };
  date.addEventListener("change", checkFiled);
  checkFiled();
  box.append(filedNote);

  const confirmLabel = document.createElement("label");
  confirmLabel.className = "bill-confirm";
  const tick = document.createElement("input");
  tick.type = "checkbox";
  confirmLabel.append(tick, " No bank line in these books shows this payment");
  box.append(confirmLabel);

  const actions = document.createElement("div");
  actions.className = "invoice-actions";
  const save = button("Record payment", () => {
    const cents = Math.round(Number(amount.value.replace(/[$,\s]/g, "")) * 100);
    if (!tick.checked) return alert("Tick that no bank line shows this payment first.");
    if (from.value === "") return alert("Choose the account it was paid from.");
    if (!Number.isFinite(cents) || cents <= 0) return alert("Enter the amount paid.");
    if (cents > balance.remaining) {
      return alert(`That is more than the ${money(balance.remaining)} still owing.`);
    }
    if (date.value === "" || date.value < bill.issued) {
      return alert("The payment date can't be before the bill date.");
    }
    void recordOutside(bill, {
      date: date.value,
      amount: cents,
      accountCode: from.value,
      ...(memo.value.trim() !== "" ? { note: memo.value.trim() } : {}),
    });
  });
  save.className = "primary";
  save.disabled = true;
  tick.addEventListener("change", () => {
    save.disabled = !tick.checked;
  });
  const cancel = button("Cancel", () => {
    paying = null;
    redraw("bills");
  });
  actions.append(save, cancel);
  box.append(actions);
  return box;
}

async function replaceBill(before: Invoice, after: Invoice, what: string): Promise<void> {
  const invoices = (state.ledger.invoices ?? []).map((i) => (i === before ? after : i));
  state.ledger = { ...state.ledger, invoices };
  state.persistent = await savePart(state.ledger, "invoices");
  await record("invoice", what, before, after, after.number);
  redraw("bills");
  redraw("invoices");
}

async function recordOutside(bill: Invoice, payment: OutsidePayment): Promise<void> {
  paying = null;
  await replaceBill(
    bill,
    { ...bill, paidOutside: [...(bill.paidOutside ?? []), payment] },
    `${bill.number} ${bill.contact}: ${formatAmount(payment.amount)} paid ${payment.date} from ` +
      `${payment.accountCode}, not through a bank line`,
  );
}

async function removeOutside(bill: Invoice, index: number): Promise<void> {
  const payment = bill.paidOutside?.[index];
  if (payment === undefined) return;
  if (!confirm(`Remove the ${formatAmount(payment.amount)} payment of ${bill.number} on ${payment.date}?`)) return;
  const rest = (bill.paidOutside ?? []).filter((_, i) => i !== index);
  const { paidOutside: _was, ...without } = bill;
  await replaceBill(
    bill,
    rest.length === 0 ? without : { ...without, paidOutside: rest },
    `${bill.number}: removed the ${formatAmount(payment.amount)} payment of ${payment.date}`,
  );
}

/**
 * Take a bill back out of the books.
 *
 * Not while anything has paid it: the payment would be left settling a bill
 * that is not there, and the money with nowhere to go.
 */
async function voidBill(bill: Invoice, balance: InvoiceBalance): Promise<void> {
  if (balance.assigned > 0 || balance.paidOutside > 0) {
    alert(
      `${bill.number} has payments against it. Unmatch the bank lines on Reconcile, and remove any ` +
        "payment recorded here, before voiding it.",
    );
    return;
  }
  if (!confirm(`Void ${bill.number} from ${bill.contact}? It leaves the books; History can undo it.`)) return;
  await replaceBill(bill, { ...bill, status: "Voided" }, `Voided ${bill.number} — ${bill.contact} ${formatAmount(bill.total)}`);
}

export function wireBills(): void {
  $("bill-new").addEventListener("click", () => startNewBill());
  $<HTMLInputElement>("bill-search").addEventListener("input", () => redraw("bills"));
  $<HTMLSelectElement>("bill-filter").addEventListener("change", () => redraw("bills"));
}
