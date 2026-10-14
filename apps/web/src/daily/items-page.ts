import { redraw } from "../app.js";
import { record } from "../books.js";
import { booksCurrency, booksMoney } from "../country.js";
import { $, state } from "../state.js";
import { savePart } from "../store.js";
import { note } from "../ui.js";
import { itemKey, parseAmount } from "@nzosa/core";
import type { Item } from "@nzosa/core";

/** Products and services: a price list that fills in an invoice line from a name. */

let editing: string | null = null;

const held = (): Item[] => state.ledger.items ?? [];

async function keep(next: Item[], what: string): Promise<void> {
  const before = held();
  state.ledger = { ...state.ledger, items: next };
  state.persistent = await savePart(state.ledger);
  await record("items", what, before, next);
  redraw("items");
}

function incomeAccounts(): { code: string; name: string }[] {
  return state.chart
    .filter((a) => /revenue|income|sales/i.test(a.type))
    .map((a) => ({ code: a.code.trim(), name: a.name }));
}

function form(existing: Item | null): HTMLElement {
  const box = document.createElement("div");
  box.className = "contact-form";
  const label = (text: string, control: HTMLElement): HTMLElement => {
    const wrap = document.createElement("label");
    wrap.className = "contact-field";
    const span = document.createElement("span");
    span.textContent = text;
    wrap.append(span, control);
    return wrap;
  };
  const name = document.createElement("input");
  name.type = "text";
  name.value = existing?.name ?? "";
  const kind = document.createElement("select");
  for (const [value, text] of [
    ["service", "Service"],
    ["product", "Product"],
  ] as const) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = text;
    option.selected = (existing?.kind ?? "service") === value;
    kind.append(option);
  }
  const description = document.createElement("input");
  description.type = "text";
  description.value = existing?.description ?? "";
  const price = document.createElement("input");
  price.type = "text";
  price.inputMode = "decimal";
  price.value = existing?.price === undefined ? "" : (existing.price / 100).toFixed(2);
  const account = document.createElement("select");
  const none = document.createElement("option");
  none.value = "";
  none.textContent = "Not set";
  account.append(none);
  for (const a of incomeAccounts()) {
    const option = document.createElement("option");
    option.value = a.code;
    option.textContent = `${a.code} ${a.name}`;
    option.selected = existing?.accountCode === a.code;
    account.append(option);
  }
  const problem = document.createElement("p");
  problem.className = "cloud-said";
  const save = document.createElement("button");
  save.type = "button";
  save.className = "primary";
  save.textContent = existing === null ? "Add" : "Save";
  save.addEventListener("click", () => {
    const said = name.value.trim();
    if (said === "") {
      problem.textContent = "A name, as it will be written on an invoice line.";
      return;
    }
    if (held().some((i) => itemKey(i.name) === itemKey(said) && i.id !== existing?.id)) {
      problem.textContent = `${said} is already here.`;
      return;
    }
    const cents = price.value.trim() === "" ? null : parseAmount(price.value, booksCurrency());
    if (cents === null && price.value.trim() !== "") {
      problem.textContent = "A price as a number, such as 49.50.";
      return;
    }
    const fields = {
      name: said,
      kind: kind.value as Item["kind"],
      ...(description.value.trim() !== "" ? { description: description.value.trim() } : {}),
      ...(cents !== null ? { price: cents } : {}),
      ...(account.value !== "" ? { accountCode: account.value } : {}),
    };
    editing = null;
    if (existing === null) {
      const id = `item-${Date.now().toString(36)}`;
      void keep([...held(), { id, ...fields }], `Added ${said}`);
    } else {
      void keep(
        held().map((i) =>
          i.id === existing.id ? { id: i.id, ...(i.active === false ? { active: false } : {}), ...fields } : i,
        ),
        `Changed ${said}`,
      );
    }
  });
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", () => {
    editing = null;
    redraw("items");
  });
  const row = document.createElement("div");
  row.className = "migration-actions";
  row.append(save, cancel);
  box.append(
    label("Name", name),
    label("Product or service", kind),
    label("Line description", description),
    label("Usual price", price),
    label("Sale coded to", account),
    problem,
    row,
  );
  return box;
}

export function renderItems(): void {
  const body = $("items-body");
  body.textContent = "";
  const add = document.createElement("button");
  add.type = "button";
  add.className = "primary";
  add.textContent = "New product or service";
  add.addEventListener("click", () => {
    editing = "new";
    redraw("items");
  });
  body.append(add);
  if (editing === "new") body.append(form(null));
  if (held().length === 0 && editing !== "new") {
    body.append(note("No products or services yet."));
    return;
  }
  const table = document.createElement("table");
  table.className = "report-table owner-table";
  table.innerHTML = "<thead><tr><th>Name</th><th>Is</th><th>Price</th><th>Coded to</th><th></th></tr></thead>";
  const tbody = document.createElement("tbody");
  const names = new Map(incomeAccounts().map((a) => [a.code, a.name]));
  for (const item of [...held()].sort((a, b) => a.name.localeCompare(b.name))) {
    const tr = document.createElement("tr");
    if (item.active === false) tr.className = "event-reverted";
    for (const [text, cls] of [
      [item.name, "report-name"],
      [item.kind === "product" ? "Product" : "Service", "report-name"],
      [item.price === undefined ? "" : booksMoney(item.price), "report-amount"],
      [
        item.accountCode === undefined ? "" : `${item.accountCode} ${names.get(item.accountCode) ?? ""}`.trim(),
        "report-name",
      ],
    ] as const) {
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
      editing = item.id;
      redraw("items");
    });
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "small";
    toggle.textContent = item.active === false ? "Make active" : "Make inactive";
    toggle.addEventListener("click", () => {
      void keep(
        held().map((i) => (i.id === item.id ? { ...i, active: i.active === false } : i)),
        `${item.name} made ${item.active === false ? "active" : "inactive"}`,
      );
    });
    actions.append(edit, toggle);
    tr.append(actions);
    tbody.append(tr);
    if (editing === item.id) {
      const editor = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 5;
      cell.append(form(item));
      editor.append(cell);
      tbody.append(editor);
    }
  }
  table.append(tbody);
  const scroller = document.createElement("div");
  scroller.className = "table-scroll";
  scroller.append(table);
  body.append(scroller);
}
