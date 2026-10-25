import { redraw } from "../app.js";
import { record } from "../books.js";
import { booksCurrency } from "../country.js";
import { state } from "../state.js";
import { savePart } from "../store.js";
import { note, wideTable } from "../ui.js";
import { isPosted, parseAmount } from "@nzosa/core";
import type { CreditApplication, InvoiceBalance, InvoiceKind } from "@nzosa/core";

/**
 * Credit held on account, and applying it: a credit note, or what an invoice
 * or bill was overpaid by, kept as credit for the customer or supplier until
 * it is applied to other documents of theirs -- part to one, part to another,
 * whenever it is wanted. Nothing posts: the credit and the documents are all
 * in receivables (or payables) already, so applying credit moves what each
 * one owes and leaves the total where it was.
 */

async function keep(next: Record<string, CreditApplication[]>, what: string): Promise<void> {
  const before = state.ledger.creditApplications ?? {};
  state.ledger = { ...state.ledger, creditApplications: next };
  state.persistent = await savePart(state.ledger);
  await record("creditApplications", what, before, next);
  redraw("invoices");
  redraw("bills");
}

const today = (): string => new Date().toLocaleDateString("en-CA");

export function creditOnAccountSection(
  body: HTMLElement,
  balances: Map<string, InvoiceBalance>,
  kind: InvoiceKind,
  money: (cents: number) => string,
): void {
  const applications = state.ledger.creditApplications ?? {};
  const sources = [...balances.values()].filter(
    (b) => b.invoice.kind === kind && isPosted(b.invoice) && (b.available > 0 || (applications[b.invoice.number] ?? []).length > 0),
  );
  if (sources.length === 0) return;
  const heading = document.createElement("h3");
  heading.textContent = `Credit on account (${sources.filter((s) => s.available > 0).length})`;
  body.append(
    heading,
    note(
      `Credit notes and overpayments not yet used, held for the ${kind === "sales" ? "customer" : "supplier"}. ` +
        `Apply any part of one to another ${kind === "sales" ? "invoice" : "bill"} of theirs; what each owes moves, the total does not.`,
    ),
  );

  const table = document.createElement("table");
  table.className = "report-table owner-table match-table";
  table.innerHTML = "<thead><tr><th>From</th><th>Contact</th><th>Credit</th><th>Applied</th><th>Available</th><th>Apply to</th></tr></thead>";
  const tbody = document.createElement("tbody");
  // Documents of the same kind still owing, the same contact's first.
  const owing = [...balances.values()].filter((b) => b.invoice.kind === kind && isPosted(b.invoice) && b.remaining > 0 && b.invoice.total > 0);
  for (const source of sources) {
    const from = source.invoice;
    const tr = document.createElement("tr");
    const credit = source.available + source.applied;
    for (const [text, cls] of [
      [from.number, "report-name"],
      [from.contact, "report-name"],
      [money(credit), "report-amount"],
      [source.applied === 0 ? "" : money(source.applied), "report-amount"],
      [money(source.available), "report-amount"],
    ] as const) {
      const td = document.createElement("td");
      td.className = cls;
      td.textContent = text;
      tr.append(td);
    }
    const cell = document.createElement("td");
    // What it has gone to already, each removable.
    for (const [index, one] of (applications[from.number] ?? []).entries()) {
      const line = document.createElement("div");
      line.textContent = `${one.invoice}: ${money(one.amount)}${one.on ? ` on ${one.on}` : ""} `;
      const undo = document.createElement("button");
      undo.type = "button";
      undo.className = "small";
      undo.textContent = "Take back";
      undo.addEventListener("click", () => {
        const list = (applications[from.number] ?? []).filter((_, i) => i !== index);
        const next = { ...applications };
        if (list.length === 0) delete next[from.number];
        else next[from.number] = list;
        void keep(next, `${money(one.amount)} of ${from.number}'s credit taken back from ${one.invoice}`);
      });
      line.append(undo);
      cell.append(line);
    }
    if (source.available > 0) {
      const contact = from.contact.trim().toLowerCase();
      const targets = [
        ...owing.filter((b) => b.invoice.contact.trim().toLowerCase() === contact),
        ...owing.filter((b) => b.invoice.contact.trim().toLowerCase() !== contact),
      ].filter((b) => b.invoice.number !== from.number);
      if (targets.length > 0) {
        const pick = document.createElement("select");
        for (const t of targets) {
          const option = document.createElement("option");
          option.value = t.invoice.number;
          option.textContent = `${t.invoice.number} · ${t.invoice.contact} · ${money(t.remaining)} owing`;
          pick.append(option);
        }
        const amount = document.createElement("input");
        amount.type = "text";
        amount.inputMode = "decimal";
        amount.size = 8;
        const suggest = (): void => {
          const target = targets.find((t) => t.invoice.number === pick.value);
          amount.value = (Math.min(source.available, target?.remaining ?? 0) / 100).toFixed(2);
        };
        pick.addEventListener("change", suggest);
        suggest();
        const apply = document.createElement("button");
        apply.type = "button";
        apply.className = "small primary";
        apply.textContent = "Apply";
        apply.addEventListener("click", () => {
          const cents = parseAmount(amount.value, booksCurrency());
          const target = targets.find((t) => t.invoice.number === pick.value);
          if (cents === null || cents <= 0 || target === undefined) return;
          // No more than is held, and no more than the other one owes.
          const used = Math.min(cents, source.available, target.remaining);
          const next = { ...applications, [from.number]: [...(applications[from.number] ?? []), { invoice: target.invoice.number, amount: used, on: today() }] };
          void keep(next, `${money(used)} of ${from.number}'s credit applied to ${target.invoice.number}`);
        });
        const row = document.createElement("div");
        row.append(pick, " ", amount, " ", apply);
        cell.append(row);
      }
    }
    tr.append(cell);
    tbody.append(tr);
  }
  table.append(tbody);
  body.append(wideTable(table));
}
