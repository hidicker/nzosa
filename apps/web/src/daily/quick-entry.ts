import type { InvoiceKind } from "@nzosa/core";
import {
  addDays,
  billWarnings,
  documentsFromRows,
  termsDays,
  canonicalCodeFor,
  dateLooksWrong,
  emptyEntityModel,
  findContact,
  formatAmount,
  knownCodes,
  parseAmount,
  splitAccountLabel,
} from "@nzosa/core";
import { redraw } from "../app.js";
import { billEntities, controlAccountFor, record } from "../books.js";
import { booksCountry, booksCurrency, booksMoney, noSalesTax } from "../country.js";
import { state } from "../state.js";
import { savePart } from "../store.js";
import { askOnPage, tellOnPage } from "../ui.js";

/**
 * Quick entry: a pile of paper invoices or bills typed in one after another,
 * a row each. Enter moves along the row, and on its last field starts the
 * next, dated as the one before.
 *
 * Each row is one document of one line -- what a backlog of paper mostly is.
 * One with several lines is better done in the full editor.
 */

const TAX_TYPES: Record<InvoiceKind, readonly { value: string; label: string; taxed: boolean }[]> = {
  sales: [
    { value: "15% GST on Income", label: "GST", taxed: true },
    { value: "Zero Rated", label: "Zero rated", taxed: false },
    { value: "GST Exempt", label: "Exempt", taxed: false },
    { value: "No GST", label: "No GST", taxed: false },
  ],
  purchase: [
    { value: "15% GST on Expenses", label: "GST", taxed: true },
    { value: "Zero Rated Expenses", label: "Zero rated", taxed: false },
    { value: "GST Exempt", label: "Exempt", taxed: false },
    { value: "No GST", label: "No GST", taxed: false },
  ],
};

interface Row {
  tr: HTMLTableRowElement;
  date: HTMLInputElement;
  contact: HTMLInputElement;
  reference: HTMLInputElement;
  description: HTMLInputElement;
  account: HTMLInputElement;
  tax: HTMLSelectElement;
  amount: HTMLInputElement;
}

/** Open quick entry for invoices or bills. */
export function openQuickEntry(kind: InvoiceKind): void {
  const bills = kind === "purchase";
  const noun = bills ? "bill" : "invoice";
  const nouns = bills ? "bills" : "invoices";
  const hideTax = noSalesTax() || booksCountry().id === "us";
  const codes = knownCodes(state.rules, state.ledger.overrides ?? {}, state.chart);

  const box = document.createElement("dialog");
  box.className = "ask-on-page payment-file-view quick-entry";
  const heading = document.createElement("h3");
  heading.textContent = `Quick entry: ${nouns}`;
  const intro = document.createElement("p");
  intro.className = "payment-file-said";
  intro.textContent =
    `One ${noun} a row. Enter moves to the next box, and from the amount starts a new row dated as the last. ` +
    `Each is saved as a ${noun} of one line, numbered in turn.`;
  box.append(heading, intro);

  // Whose bills, where the books keep them for more than one entity.
  const keepers = bills ? billEntities() : [];
  const entity = document.createElement("select");
  if (keepers.length > 1) {
    const label = document.createElement("label");
    label.className = "contact-field";
    const span = document.createElement("span");
    span.textContent = "Entity";
    const choose = document.createElement("option");
    choose.value = "";
    choose.textContent = "Choose whose bills these are";
    entity.append(choose);
    for (const one of keepers) {
      const option = document.createElement("option");
      option.value = one.id;
      option.textContent = one.name;
      entity.append(option);
    }
    entity.value = keepers.some((e) => e.id === state.entityFilter) ? state.entityFilter : "";
    label.append(span, entity);
    box.append(label);
  }
  const entityId = (): string | undefined =>
    keepers.length === 1 ? keepers[0]!.id : keepers.length > 1 && entity.value !== "" ? entity.value : undefined;

  // Contacts and accounts offered as they are typed.
  const contactList = document.createElement("datalist");
  contactList.id = `quick-contacts-${kind}`;
  const names = new Set<string>();
  for (const c of state.ledger.contacts ?? []) {
    if (c.active === false || (c.kind !== "both" && c.kind !== (bills ? "vendor" : "customer"))) continue;
    names.add(c.name);
  }
  for (const i of state.ledger.invoices ?? []) if (i.kind === kind && i.contact.trim() !== "") names.add(i.contact.trim());
  for (const name of [...names].sort((a, b) => a.localeCompare(b))) {
    const option = document.createElement("option");
    option.value = name;
    contactList.append(option);
  }
  const accountList = document.createElement("datalist");
  accountList.id = `quick-accounts-${kind}`;
  for (const code of codes) {
    const option = document.createElement("option");
    option.value = code;
    accountList.append(option);
  }
  box.append(contactList, accountList);

  const scroll = document.createElement("div");
  scroll.className = "move-lines-scroll quick-entry-scroll";
  const table = document.createElement("table");
  table.className = "report-table quick-entry-table";
  const head = document.createElement("thead");
  head.innerHTML =
    `<tr><th>Date</th><th>${bills ? "Supplier" : "Customer"}</th><th>${bills ? "Their number" : "Reference"}</th>` +
    `<th>Description</th><th>Account</th>${hideTax ? "" : "<th>GST</th>"}<th class="n">Amount</th><th></th></tr>`;
  const body = document.createElement("tbody");
  table.append(head, body);
  scroll.append(table);
  box.append(scroll);

  const footer = document.createElement("p");
  footer.className = "quick-entry-total";
  box.append(footer);

  const rows: Row[] = [];
  const refreshTotal = (): void => {
    const filled = rows.filter((r) => (parseAmount(r.amount.value.trim(), booksCurrency()) ?? 0) !== 0);
    const total = filled.reduce((sum, r) => sum + (parseAmount(r.amount.value.trim(), booksCurrency()) ?? 0), 0);
    footer.textContent = `${filled.length} ${filled.length === 1 ? noun : nouns}, ${booksMoney(total)} in all`;
    go.textContent = filled.length === 0 ? `Save ${nouns}` : `Save ${filled.length} ${filled.length === 1 ? noun : nouns}`;
  };

  /** What this contact's last document of the kind was coded to. */
  const usualFor = (name: string): { account?: string; taxType?: string } => {
    const key = name.trim().toLowerCase();
    if (key === "") return {};
    const last = [...(state.ledger.invoices ?? [])]
      .filter((i) => i.kind === kind && i.contact.trim().toLowerCase() === key && i.lines.length > 0)
      .sort((a, b) => b.issued.localeCompare(a.issued))[0];
    const contact = findContact(state.ledger.contacts ?? [], name);
    const code = contact?.defaultAccount ?? last?.lines[0]?.accountCode;
    const label = code === undefined || code === "" ? undefined : (canonicalCodeFor(splitAccountLabel(code).code || code, codes) ?? code);
    return {
      ...(label !== undefined ? { account: label } : {}),
      ...(last?.lines[0]?.taxType !== undefined ? { taxType: last.lines[0].taxType } : {}),
    };
  };

  const addRow = (date: string): Row => {
    const tr = document.createElement("tr");
    const cell = (control: HTMLElement): void => {
      const td = document.createElement("td");
      td.append(control);
      tr.append(td);
    };
    const input = (type: string, placeholder = ""): HTMLInputElement => {
      const el = document.createElement("input");
      el.type = type;
      el.placeholder = placeholder;
      return el;
    };
    const dateIn = input("date");
    dateIn.value = date;
    const contact = input("text", bills ? "Who sent it" : "Who to");
    contact.setAttribute("list", contactList.id);
    const reference = input("text");
    const description = input("text", "What for");
    const account = input("text", "Account");
    account.setAttribute("list", accountList.id);
    const tax = document.createElement("select");
    for (const t of TAX_TYPES[kind]) {
      const option = document.createElement("option");
      option.value = t.value;
      option.textContent = t.label;
      tax.append(option);
    }
    if (hideTax) tax.value = "No GST";
    else if (bills) {
      const e = (state.ledger.entities ?? emptyEntityModel()).entities.find((x) => x.id === entityId());
      if (e?.gstRegistered === false) tax.value = "No GST";
    }
    const amount = input("text", "0.00");
    amount.inputMode = "decimal";
    amount.className = "invoice-amount";
    const drop = document.createElement("button");
    drop.type = "button";
    drop.className = "line-drop";
    drop.textContent = "×";
    drop.title = "Remove this row";
    cell(dateIn);
    cell(contact);
    cell(reference);
    cell(description);
    cell(account);
    if (!hideTax) cell(tax);
    cell(amount);
    cell(drop);
    body.append(tr);
    const row: Row = { tr, date: dateIn, contact, reference, description, account, tax, amount };
    rows.push(row);

    contact.addEventListener("change", () => {
      const usual = usualFor(contact.value);
      if (account.value.trim() === "" && usual.account !== undefined) account.value = usual.account;
      if (!hideTax && usual.taxType !== undefined && TAX_TYPES[kind].some((t) => t.value === usual.taxType)) tax.value = usual.taxType;
    });
    amount.addEventListener("input", refreshTotal);
    drop.addEventListener("click", () => {
      rows.splice(rows.indexOf(row), 1);
      tr.remove();
      if (rows.length === 0) addRow(date).date.focus();
      refreshTotal();
    });

    // Enter goes on to the next box; from the amount, to a new row.
    const fields: HTMLElement[] = [dateIn, contact, reference, description, account, ...(hideTax ? [] : [tax]), amount];
    fields.forEach((field, index) => {
      field.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" || event.isComposing) return;
        event.preventDefault();
        const next = fields[index + 1];
        if (next !== undefined) {
          next.focus();
          return;
        }
        if ((parseAmount(amount.value.trim(), booksCurrency()) ?? 0) === 0) return;
        const after = rows.indexOf(row) === rows.length - 1 ? addRow(dateIn.value) : rows[rows.indexOf(row) + 1]!;
        after.date.focus();
        refreshTotal();
      });
    });
    return row;
  };

  const actions = document.createElement("div");
  actions.className = "ask-on-page-actions";
  const another = document.createElement("button");
  another.type = "button";
  another.textContent = "Add a row";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "Close";
  const go = document.createElement("button");
  go.type = "button";
  go.className = "primary";
  actions.append(another, cancel, go);
  box.append(actions);

  const today = new Date().toLocaleDateString("en-CA");
  addRow(today);
  refreshTotal();
  another.addEventListener("click", () => {
    addRow(rows.at(-1)?.date.value || today).date.focus();
  });

  const finish = (): void => {
    box.close();
    box.remove();
  };
  const leave = async (): Promise<void> => {
    const typed = rows.some((r) => r.contact.value.trim() !== "" || r.amount.value.trim() !== "");
    if (typed && !await askOnPage(`Close without saving the ${nouns} typed here?`)) return;
    finish();
  };
  cancel.addEventListener("click", () => void leave());
  box.addEventListener("cancel", (event) => {
    event.preventDefault();
    void leave();
  });

  go.addEventListener("click", () => {
    void (async () => {
      for (const r of rows) r.tr.classList.remove("match-off");
      const filled = rows.filter(
        (r) => r.amount.value.trim() !== "" || r.contact.value.trim() !== "" || r.description.value.trim() !== "",
      );
      if (filled.length === 0) {
        await tellOnPage(`Type at least one ${noun}.`);
        return;
      }
      const problems: string[] = [];
      const typed = filled.map((r, index) => {
        const gross = parseAmount(r.amount.value.trim(), booksCurrency()) ?? 0;
        const label = codes.includes(r.account.value.trim()) ? r.account.value.trim() : canonicalCodeFor(r.account.value.trim(), codes);
        const said: string[] = [];
        if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date.value)) said.push("a date");
        if (r.contact.value.trim() === "") said.push(bills ? "a supplier" : "a customer");
        if (label === null) said.push("an account from the chart");
        if (gross === 0) said.push("an amount");
        if (said.length > 0) {
          r.tr.classList.add("match-off");
          problems.push(`Row ${index + 1} needs ${said.join(", ")}.`);
        }
        const days = termsDays(findContact(state.ledger.contacts ?? [], r.contact.value)?.terms);
        return {
          date: r.date.value,
          contact: r.contact.value.trim(),
          reference: r.reference.value.trim(),
          description: r.description.value.trim(),
          accountCode: label === null ? "" : splitAccountLabel(label).code || label,
          taxType: r.tax.value,
          gross,
          due: days === null || r.date.value === "" ? null : addDays(r.date.value, days),
        };
      });
      if (problems.length > 0) {
        await tellOnPage(problems.join("\n"));
        return;
      }
      // Years typed wrong, asked about together.
      const now = new Date().toLocaleDateString("en-CA");
      const slips = typed.map((t, i) => [i, dateLooksWrong(t.date, now)] as const).filter(([, s]) => s !== null);
      if (slips.length > 0 && !(await askOnPage(`${slips.map(([i, s]) => `Row ${i + 1}: ${s}`).join("\n")}\n\nSave them with these dates?`))) return;
      const owner = entityId();
      if (bills && keepers.length > 0) {
        if (owner === undefined) {
          await tellOnPage("Choose whose bills these are.");
          return;
        }
        if (controlAccountFor(owner, "purchase") === undefined) {
          await tellOnPage("That entity has no Accounts Payable account for bills to sit in. Add one from the Bills page first.");
          return;
        }
      }
      const existing = state.ledger.invoices ?? [];
      const made = documentsFromRows(typed, kind, existing, {
        taxed: (taxType) => TAX_TYPES[kind].some((t) => t.value === taxType && t.taxed),
        currency: booksCurrency(),
        status: "Awaiting Payment",
        ...(owner !== undefined ? { entityId: owner } : {}),
      });
      // A supplier's number already on file is most often the same bill twice.
      if (bills) {
        const warned = made.flatMap((bill) => billWarnings(bill, existing).map((w) => `${bill.contact} ${bill.reference}: ${w.message}`));
        if (warned.length > 0 && !await askOnPage(`Before saving:\n\n${warned.map((w) => `- ${w}`).join("\n")}\n\nSave them as they are?`)) return;
      }
      const invoices = [...existing, ...made];
      state.ledger = { ...state.ledger, invoices };
      state.persistent = await savePart(state.ledger, "invoices");
      const total = made.reduce((sum, d) => sum + d.total, 0);
      const numbers = made.length === 1 ? made[0]!.number : `${made[0]!.number} to ${made.at(-1)!.number}`;
      await record(
        "invoiceBatch",
        `${made.length} ${made.length === 1 ? noun : nouns} entered, ${numbers}, ${formatAmount(total)}`,
        null,
        made,
      );
      finish();
      redraw("invoices");
      redraw("bills");
      await tellOnPage(made.length === 1 ? `Saved ${noun} ${numbers}.` : `Saved ${made.length} ${nouns}, ${numbers}.`);
    })();
  });

  document.body.append(box);
  box.showModal();
  rows[0]!.date.focus();
}
