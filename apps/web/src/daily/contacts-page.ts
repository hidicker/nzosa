import { redraw } from "../app.js";
import { invoiceBalanceMap, record } from "../books.js";
import { supplierFor } from "./invoices.js";
import { booksMoney, documentOptions } from "../country.js";
import { $, state } from "../state.js";
import { savePart } from "../store.js";
import { download, note } from "../ui.js";
import { contactKey, customerStatement, isPosted, mergeContacts } from "@nzosa/core";
import type { Contact, ContactKind } from "@nzosa/core";

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
function owing(): Map<string, { owedToUs: number; weOwe: number; documents: number }> {
  const out = new Map<string, { owedToUs: number; weOwe: number; documents: number }>();
  for (const balance of invoiceBalanceMap().values()) {
    // An estimate or a draft is not owed yet.
    if (!isPosted(balance.invoice)) continue;
    const key = contactKey(balance.invoice.contact);
    const one = out.get(key) ?? { owedToUs: 0, weOwe: 0, documents: 0 };
    one.documents += 1;
    if (balance.invoice.kind === "sales") one.owedToUs += balance.remaining;
    else one.weOwe += balance.remaining;
    out.set(key, one);
  }
  return out;
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
  controls.append(choose, search, add);
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
    if (contact.kind !== "vendor" && sums !== undefined && sums.owedToUs !== 0) {
      const statement = document.createElement("button");
      statement.type = "button";
      statement.className = "small";
      statement.textContent = "Statement";
      statement.addEventListener("click", () => {
        const mine = [...invoiceBalanceMap().values()].filter(
          (b) => b.invoice.kind === "sales" && contactKey(b.invoice.contact) === contactKey(contact.name),
        );
        const first = mine[0]?.invoice;
        const supplier = first === undefined ? null : supplierFor(first);
        if (supplier === null) {
          window.alert("Say which entity is sending it first: add an entity on Entities & accounts.");
          return;
        }
        const today = new Date().toISOString().slice(0, 10);
        const html = customerStatement(
          contact.name,
          mine.map((b) => ({
            number: b.invoice.number,
            issued: b.invoice.issued,
            due: b.invoice.due,
            total: b.invoice.total,
            owing: b.remaining,
            reference: b.invoice.reference === "QuickBooks" ? "" : b.invoice.reference,
          })),
          today,
          supplier,
          documentOptions(),
        );
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
