import { redraw } from "../app.js";
import { invoiceBalanceMap, record } from "../books.js";
import { supplierFor } from "./invoices.js";
import { booksMoney, documentOptions } from "../country.js";
import { $, state } from "../state.js";
import { savePart } from "../store.js";
import { download, note } from "../ui.js";
import {
  collectionLetter,
  contactKey,
  customerStatement,
  isPosted,
  lateFee,
  mergeContacts,
  nextInvoiceNumber,
  parseAmount,
  reminderStageFor,
} from "@nzosa/core";
import type { Contact, ContactKind, Invoice } from "@nzosa/core";
import { booksCurrency } from "../country.js";

/**
 * Customers and vendors: who the books deal with.
 *
 * A record is looked up by name from invoices and bills, so adding one posts
 * nothing and changes no figure. What it holds is for the person: an address
 * and email to send to, terms, and for a vendor whether a W-9 is on file and
 * whether they are to be sent a 1099.
 */

type Filter = "all" | "customer" | "vendor" | "inactive";

let filter: Filter = "all";
let query = "";
/** The id being edited, or "new" for a record not made yet. */
let editing: string | null = null;

const KIND_WORD: Record<ContactKind, string> = { customer: "Customer", vendor: "Vendor", both: "Customer and vendor" };

function held(): Contact[] {
  return state.ledger.contacts ?? [];
}

async function keep(next: Contact[], what: string): Promise<void> {
  const before = held();
  state.ledger = { ...state.ledger, contacts: next };
  state.persistent = await savePart(state.ledger);
  await record("contacts", what, before, next);
  redraw("contacts");
}

/** What each name is owed or owes, from the documents in play. */
interface Owing {
  owedToUs: number;
  weOwe: number;
  documents: number;
  /** What a customer owes on invoices past their due date. */
  pastDue: number;
  /** Days past due of the oldest of them. */
  lateDays: number;
}

// The day where the person is: these books are kept in their own country.
const today = (): string => new Date().toLocaleDateString("en-CA");

function owing(): Map<string, Owing> {
  const out = new Map<string, Owing>();
  const now = today();
  for (const balance of invoiceBalanceMap().values()) {
    // An estimate or a draft is not owed yet.
    if (!isPosted(balance.invoice)) continue;
    const key = contactKey(balance.invoice.contact);
    const one = out.get(key) ?? { owedToUs: 0, weOwe: 0, documents: 0, pastDue: 0, lateDays: 0 };
    one.documents += 1;
    if (balance.invoice.kind === "sales") {
      one.owedToUs += balance.remaining;
      const due = balance.invoice.due ?? balance.invoice.issued;
      if (balance.remaining > 0 && due < now) {
        one.pastDue += balance.remaining;
        const days = Math.round((Date.parse(`${now}T00:00:00Z`) - Date.parse(`${due}T00:00:00Z`)) / 86_400_000);
        one.lateDays = Math.max(one.lateDays, days);
      }
    } else one.weOwe += balance.remaining;
    out.set(key, one);
  }
  return out;
}

/** A customer's posted invoices and what is left on each. */
function salesFor(name: string): { invoice: Invoice; remaining: number }[] {
  return [...invoiceBalanceMap().values()].filter(
    (b) => b.invoice.kind === "sales" && isPosted(b.invoice) && contactKey(b.invoice.contact) === contactKey(name),
  );
}

function statementLines(mine: readonly { invoice: Invoice; remaining: number }[]) {
  return mine.map((b) => ({
    number: b.invoice.number,
    issued: b.invoice.issued,
    due: b.invoice.due,
    total: b.invoice.total,
    owing: b.remaining,
    reference: b.invoice.reference === "QuickBooks" ? "" : b.invoice.reference,
  }));
}

/**
 * A late fee, drafted as an invoice: a percentage of what is past due, coded
 * to a late fee or finance charge account where the chart has one. A draft
 * posts nothing until it is approved on Invoices.
 */
async function draftLateFee(customer: string, pastDue: number): Promise<void> {
  const said = window.prompt(
    `Late fee for ${customer}, as a percentage of the ${booksMoney(pastDue)} past due:`,
    "1.5",
  );
  if (said === null) return;
  const percent = Number(said.replace("%", "").trim());
  if (!Number.isFinite(percent) || percent <= 0) {
    window.alert("A percentage, such as 1.5.");
    return;
  }
  const amount = lateFee(pastDue, percent);
  const income = state.chart.filter((a) => /revenue|income|sales/i.test(a.type));
  const account =
    income.find((a) => /late fee|finance charge|interest/i.test(a.name)) ??
    income.find((a) => /other income/i.test(a.type)) ??
    income[0];
  const late = salesFor(customer).filter((b) => b.remaining > 0 && (b.invoice.due ?? b.invoice.issued) < today());
  const issued = today();
  const draft: Invoice = {
    number: nextInvoiceNumber("sales", state.ledger.invoices ?? []),
    kind: "sales",
    contact: customer,
    reference: "Late fee",
    issued,
    due: issued,
    total: amount,
    tax: 0,
    paid: 0,
    outstanding: amount,
    currency: booksCurrency(),
    status: "Draft",
    lines: [
      {
        description: `Late fee, ${percent}% of ${booksMoney(pastDue)} past due on ${late.map((b) => b.invoice.number).join(", ")}`,
        accountCode: account?.code.trim() ?? "",
        taxType: "No GST",
        net: amount,
        tax: 0,
        gross: amount,
      },
    ],
  };
  state.ledger = { ...state.ledger, invoices: [...(state.ledger.invoices ?? []), draft] };
  state.persistent = await savePart(state.ledger, "invoices");
  await record("invoice", `Created ${draft.number} — ${customer} late fee ${booksMoney(amount)}`, null, draft, draft.number);
  window.alert(`${draft.number} for ${booksMoney(amount)} is drafted on Invoices. Approve it there to post it.`);
  redraw("contacts");
  redraw("invoices");
}

/**
 * Small balances left on customers' invoices -- a few cents short, a bank fee
 * the customer took off -- written off in one go to a bad debts account. Each
 * is recorded on its invoice as settled outside the bank, so it posts bad
 * debts against receivables on today's date, and each can be undone on its own
 * in History.
 */
async function writeOffSmall(): Promise<void> {
  const said = window.prompt("Write off what customers still owe on an invoice when it is no more than:", "5.00");
  if (said === null) return;
  const limit = parseAmount(said, booksCurrency());
  if (limit === null || limit <= 0) {
    window.alert("An amount, such as 5.00.");
    return;
  }
  const expense = state.chart.filter((a) => /expense|overhead/i.test(a.type));
  const account = expense.find((a) => /bad debt|write.?off|uncollect/i.test(a.name));
  if (account === undefined) {
    window.alert("Add an expense account for bad debts on Entities & accounts first, such as Bad debts.");
    return;
  }
  const small = [...invoiceBalanceMap().values()].filter(
    (b) => b.invoice.kind === "sales" && isPosted(b.invoice) && b.remaining > 0 && b.remaining <= limit,
  );
  if (small.length === 0) {
    window.alert(`No invoice has ${booksMoney(limit)} or less left to pay.`);
    return;
  }
  const total = small.reduce((sum, b) => sum + b.remaining, 0);
  if (
    !window.confirm(
      `Write off ${small.length} balance${small.length === 1 ? "" : "s"}, ${booksMoney(total)} in all, ` +
        `to ${account.code} ${account.name}?\n\n` +
        small.map((b) => `${b.invoice.number} ${b.invoice.contact}: ${booksMoney(b.remaining)}`).join("\n"),
    )
  ) {
    return;
  }
  const on = today();
  const label = `${account.name} - ${account.code.trim()}`;
  const changed = new Map<Invoice, Invoice>();
  for (const b of small) {
    changed.set(b.invoice, {
      ...b.invoice,
      paidOutside: [...(b.invoice.paidOutside ?? []), { date: on, amount: b.remaining, accountCode: label, note: "Written off" }],
      paid: b.invoice.paid + b.remaining,
      outstanding: Math.max(0, b.invoice.outstanding - b.remaining),
    });
  }
  state.ledger = { ...state.ledger, invoices: (state.ledger.invoices ?? []).map((i) => changed.get(i) ?? i) };
  state.persistent = await savePart(state.ledger, "invoices");
  for (const [before, after] of changed) {
    const amount = (after.paidOutside ?? []).at(-1)?.amount ?? 0;
    await record("invoice", `${after.number} — ${after.contact}: ${booksMoney(amount)} written off`, before, after, after.number);
  }
  redraw("contacts");
  redraw("invoices");
}

function field(label: string, control: HTMLElement): HTMLElement {
  const wrap = document.createElement("label");
  wrap.className = "contact-field";
  const text = document.createElement("span");
  text.textContent = label;
  wrap.append(text, control);
  return wrap;
}

function input(value: string | undefined, type = "text"): HTMLInputElement {
  const el = document.createElement("input");
  el.type = type;
  el.value = value ?? "";
  return el;
}

function form(existing: Contact | null): HTMLElement {
  const box = document.createElement("div");
  box.className = "contact-form";
  const name = input(existing?.name);
  const kind = document.createElement("select");
  for (const [value, text] of Object.entries(KIND_WORD)) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = text;
    option.selected = (existing?.kind ?? "customer") === value;
    kind.append(option);
  }
  const company = input(existing?.company);
  const email = input(existing?.email, "email");
  const phone = input(existing?.phone, "tel");
  const address = document.createElement("textarea");
  address.rows = 3;
  address.value = existing?.address ?? "";
  const terms = input(existing?.terms);
  terms.placeholder = "Net 30";
  const taxId = input(existing?.taxId);
  const w9 = input(undefined, "checkbox");
  w9.checked = existing?.w9 === true;
  const is1099 = input(undefined, "checkbox");
  is1099.checked = existing?.is1099 === true;
  const notes = document.createElement("textarea");
  notes.rows = 2;
  notes.value = existing?.notes ?? "";

  const ticks = document.createElement("div");
  ticks.className = "contact-ticks";
  const w9Label = document.createElement("label");
  w9Label.append(w9, document.createTextNode(" W-9 on file"));
  const tenLabel = document.createElement("label");
  tenLabel.append(is1099, document.createTextNode(" Send a 1099-NEC"));
  ticks.append(w9Label, tenLabel);

  const problem = document.createElement("p");
  problem.className = "cloud-said";

  const save = document.createElement("button");
  save.type = "button";
  save.className = "primary";
  save.textContent = existing === null ? "Add" : "Save";
  save.addEventListener("click", () => {
    const said = name.value.trim();
    if (said === "") {
      problem.textContent = "A name, as it appears on invoices and bills.";
      return;
    }
    const clash = held().find((c) => contactKey(c.name) === contactKey(said) && c.id !== existing?.id);
    if (clash !== undefined) {
      problem.textContent = `${clash.name} is already here.`;
      return;
    }
    const fields = {
      name: said,
      kind: kind.value as ContactKind,
      ...(company.value.trim() !== "" ? { company: company.value.trim() } : {}),
      ...(email.value.trim() !== "" ? { email: email.value.trim() } : {}),
      ...(phone.value.trim() !== "" ? { phone: phone.value.trim() } : {}),
      ...(address.value.trim() !== "" ? { address: address.value.trim() } : {}),
      ...(terms.value.trim() !== "" ? { terms: terms.value.trim() } : {}),
      ...(taxId.value.trim() !== "" ? { taxId: taxId.value.trim() } : {}),
      ...(notes.value.trim() !== "" ? { notes: notes.value.trim() } : {}),
      ...(w9.checked ? { w9: true } : {}),
      ...(is1099.checked ? { is1099: true } : {}),
    };
    editing = null;
    if (existing === null) {
      void keep(mergeContacts(held(), [fields]), `Added ${said}`);
    } else {
      const next = held().map((c) =>
        c.id === existing.id
          ? { id: c.id, ...(c.active === false ? { active: false } : {}), ...(c.source !== undefined ? { source: c.source } : {}), ...fields }
          : c,
      );
      void keep(next as Contact[], `Changed ${said}`);
    }
  });
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", () => {
    editing = null;
    redraw("contacts");
  });

  box.append(
    field("Name", name),
    field("Customer or vendor", kind),
    field("Company", company),
    field("Email", email),
    field("Phone", phone),
    field("Address", address),
    field("Payment terms", terms),
    field("Tax ID (EIN, SSN or IRD number)", taxId),
    ticks,
    field("Notes", notes),
    problem,
  );
  const row = document.createElement("div");
  row.className = "migration-actions";
  row.append(save, cancel);
  box.append(row);
  return box;
}

export function renderContacts(): void {
  const body = $("contacts-body");
  body.textContent = "";
  const all = held();

  const controls = document.createElement("div");
  controls.className = "contacts-controls";
  const choose = document.createElement("select");
  choose.id = "contacts-filter";
  for (const [value, text] of [
    ["all", "Everyone"],
    ["customer", "Customers"],
    ["vendor", "Vendors"],
    ["inactive", "Inactive"],
  ] as const) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = text;
    option.selected = filter === value;
    choose.append(option);
  }
  choose.addEventListener("change", () => {
    filter = choose.value as Filter;
    redraw("contacts");
  });
  const search = input(query, "search");
  search.id = "contacts-search";
  search.placeholder = "Search by name, company or email";
  search.addEventListener("input", () => {
    query = search.value;
    redraw("contacts");
    document.getElementById("contacts-search")?.focus();
  });
  const add = document.createElement("button");
  add.type = "button";
  add.className = "primary";
  add.textContent = "New customer or vendor";
  add.addEventListener("click", () => {
    editing = "new";
    redraw("contacts");
  });
  const writeOff = document.createElement("button");
  writeOff.type = "button";
  writeOff.textContent = "Write off small balances";
  writeOff.title = "Clear what is left on invoices under an amount you choose, to a bad debts account.";
  writeOff.addEventListener("click", () => void writeOffSmall());
  controls.append(choose, search, add, writeOff);
  body.append(controls);

  if (editing === "new") body.append(form(null));

  if (all.length === 0 && editing !== "new") {
    body.append(
      note(
        "No customers or vendors yet. Add one, or drop a list exported from your other system on Setup: " +
          "invoices and bills name them already, and bringing in a QuickBooks ledger adds them by name.",
      ),
    );
    return;
  }

  const money = owing();
  const needle = query.trim().toLowerCase();
  const shown = all
    .filter((c) =>
      filter === "inactive"
        ? c.active === false
        : c.active !== false && (filter === "all" || c.kind === filter || c.kind === "both"),
    )
    .filter(
      (c) =>
        needle === "" ||
        [c.name, c.company, c.email].some((text) => (text ?? "").toLowerCase().includes(needle)),
    )
    .sort((a, b) => a.name.localeCompare(b.name));

  const table = document.createElement("table");
  table.className = "report-table owner-table contacts-table";
  const head = document.createElement("thead");
  head.innerHTML =
    "<tr><th>Name</th><th>Is</th><th>Email</th><th>Phone</th><th>Owes you</th><th>You owe</th><th></th></tr>";
  const tbody = document.createElement("tbody");
  for (const contact of shown) {
    const sums = money.get(contactKey(contact.name));
    const tr = document.createElement("tr");
    if (contact.active === false) tr.className = "event-reverted";
    const cells: [string, string][] = [
      [contact.name + (contact.company !== undefined ? ` — ${contact.company}` : ""), "report-name"],
      [KIND_WORD[contact.kind] + (contact.is1099 === true ? ", 1099" : ""), "report-name"],
      [contact.email ?? "", "report-name"],
      [contact.phone ?? "", "report-name"],
      [sums !== undefined && sums.owedToUs !== 0 ? booksMoney(sums.owedToUs) : "", "report-amount"],
      [sums !== undefined && sums.weOwe !== 0 ? booksMoney(sums.weOwe) : "", "report-amount"],
    ];
    for (const [text, cls] of cells) {
      const td = document.createElement("td");
      td.className = cls;
      td.textContent = text;
      tr.append(td);
    }
    const actions = document.createElement("td");
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "small";
    edit.textContent = "Edit";
    edit.addEventListener("click", () => {
      editing = contact.id;
      redraw("contacts");
    });
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "small";
    toggle.textContent = contact.active === false ? "Make active" : "Make inactive";
    toggle.addEventListener("click", () => {
      const next = held().map((c) => (c.id === contact.id ? { ...c, active: c.active === false } : c));
      void keep(next, `${contact.name} made ${contact.active === false ? "active" : "inactive"}`);
    });
    actions.append(edit, toggle);
    if (contact.kind !== "vendor" && sums !== undefined && sums.pastDue > 0) {
      const remind = document.createElement("button");
      remind.type = "button";
      remind.className = "small";
      remind.textContent = "Reminder";
      const stage = reminderStageFor(sums.lateDays);
      remind.title =
        stage === 1 ? "A first, friendly reminder" : stage === 2 ? "A second notice" : "A final notice";
      remind.addEventListener("click", () => {
        const mine = salesFor(contact.name);
        const supplier = mine[0] === undefined ? null : supplierFor(mine[0].invoice);
        if (supplier === null) {
          window.alert("Say which entity is sending it first: add an entity on Entities & accounts.");
          return;
        }
        const html = collectionLetter(contact.name, statementLines(mine), today(), supplier, stage, documentOptions());
        download(html, `reminder-${contact.name.replace(/[^A-Za-z0-9]+/g, "-")}.html`, "text/html;charset=utf-8");
      });
      const fee = document.createElement("button");
      fee.type = "button";
      fee.className = "small";
      fee.textContent = "Late fee";
      fee.title = "Draft an invoice for a late fee on what is past due, to check and approve on Invoices.";
      const pastDue = sums.pastDue;
      fee.addEventListener("click", () => void draftLateFee(contact.name, pastDue));
      actions.append(remind, fee);
    }
    if (contact.kind !== "vendor" && sums !== undefined && sums.owedToUs !== 0) {
      const statement = document.createElement("button");
      statement.type = "button";
      statement.className = "small";
      statement.textContent = "Statement";
      statement.addEventListener("click", () => {
        const mine = salesFor(contact.name);
        const first = mine[0]?.invoice;
        const supplier = first === undefined ? null : supplierFor(first);
        if (supplier === null) {
          window.alert("Say which entity is sending it first: add an entity on Entities & accounts.");
          return;
        }
        const html = customerStatement(contact.name, statementLines(mine), today(), supplier, documentOptions());
        download(html, `statement-${contact.name.replace(/[^A-Za-z0-9]+/g, "-")}.html`, "text/html;charset=utf-8");
      });
      actions.append(statement);
    }
    tr.append(actions);
    tbody.append(tr);
    if (editing === contact.id) {
      const editor = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 7;
      cell.append(form(contact));
      editor.append(cell);
      tbody.append(editor);
    }
  }
  table.append(head, tbody);
  const scroller = document.createElement("div");
  scroller.className = "table-scroll";
  scroller.append(table);
  body.append(scroller);

  const count = document.createElement("p");
  count.className = "page-hint";
  count.textContent = `${shown.length} of ${all.length}.`;
  body.append(count);
}
