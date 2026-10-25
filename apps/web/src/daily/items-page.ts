import { redraw } from "../app.js";
import { postedJournals, record, saveManualJournals, stockAccounts, stockTracked } from "../books.js";
import { booksCountry, booksCurrency, booksMoney, noSalesTax } from "../country.js";
import { $, state } from "../state.js";
import { savePart } from "../store.js";
import { download, note } from "../ui.js";
import { itemKey, parseAmount, spreadsheetCell, stockAdjustment, stockValuation, stockValue } from "@nzosa/core";
import type { Item, StockCount, StockMovement } from "@nzosa/core";

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
  const cost = document.createElement("input");
  cost.type = "text";
  cost.inputMode = "decimal";
  cost.placeholder = "Not kept in stock";
  cost.value = existing?.unitCost === undefined ? "" : (existing.unitCost / 100).toFixed(2);
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
  // United States sales tax is charged on a line only where it is taxable.
  const taxable = document.createElement("input");
  taxable.type = "checkbox";
  taxable.checked = existing?.taxable !== false;
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
    const unit = cost.value.trim() === "" ? null : parseAmount(cost.value, booksCurrency());
    if (unit === null && cost.value.trim() !== "") {
      problem.textContent = "A cost as a number, such as 4.50.";
      return;
    }
    const fields = {
      ...(unit !== null && kind.value === "product" ? { unitCost: unit } : {}),
      name: said,
      kind: kind.value as Item["kind"],
      ...(description.value.trim() !== "" ? { description: description.value.trim() } : {}),
      ...(cents !== null ? { price: cents } : {}),
      ...(account.value !== "" ? { accountCode: account.value } : {}),
      ...(booksCountry().id === "us" && !taxable.checked ? { taxable: false } : {}),
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
    label(noSalesTax() ? "Usual price" : "Usual price, including GST", price),
    label("Sale coded to", account),
    ...(booksCountry().id === "us" ? [label("Charged sales tax", taxable)] : []),
    label(noSalesTax() ? "Cost a unit, for products kept in stock" : "Cost a unit before GST, for products kept in stock", cost),
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
  stockSection(body);
}

let counting = false;

/** What the books hold in an account at the end of a day. */
function bookedAt(code: string, date: string): number {
  const opening = state.ledger.openingBalances;
  let sum = opening !== undefined && opening.asAt <= date ? (opening.accounts[code] ?? 0) : 0;
  for (const journal of postedJournals()) {
    if (journal.date > date || (opening !== undefined && journal.date <= opening.asAt)) continue;
    for (const line of journal.lines) if (line.accountCode.trim() === code) sum += line.amount;
  }
  return sum;
}

/** Which product's movements are open. */
let showingMovements: string | null = null;

/** A product's movements, newest first: what changed, why, and what was left. */
function movementsRow(moves: readonly StockMovement[]): HTMLTableRowElement {
  const tr = document.createElement("tr");
  const cell = document.createElement("td");
  cell.colSpan = 6;
  if (moves.length === 0) {
    cell.append(note("Not bought, sold or counted yet."));
    tr.append(cell);
    return tr;
  }
  const table = document.createElement("table");
  table.className = "report-table";
  table.innerHTML =
    "<thead><tr><th>Date</th><th>What</th><th>Document</th><th>Change</th><th>Value</th><th>On hand after</th><th>Worth after</th></tr></thead>";
  const tbody = document.createElement("tbody");
  for (const m of [...moves].reverse().slice(0, 40)) {
    const row = document.createElement("tr");
    for (const [text, cls] of [
      [m.date, "report-date"],
      [m.kind, "report-name"],
      [m.reference, "report-name"],
      [`${m.quantity > 0 ? "+" : ""}${Math.round(m.quantity * 10_000) / 10_000}`, "report-amount"],
      [booksMoney(m.value), "report-amount"],
      [String(Math.round(m.onHand * 10_000) / 10_000), "report-amount"],
      [booksMoney(m.valueAfter), "report-amount"],
    ] as const) {
      const td = document.createElement("td");
      td.className = cls;
      td.textContent = text;
      row.append(td);
    }
    tbody.append(row);
  }
  table.append(tbody);
  cell.append(table);
  if (moves.length > 40) cell.append(note(`The latest 40 of ${moves.length}.`));
  tr.append(cell);
  return tr;
}

/**
 * Stock: products kept in stock are counted at a date and valued at their
 * unit cost, and the inventory account is put to that value.
 */
function stockSection(body: HTMLElement): void {
  const stocked = held().filter((i) => i.kind === "product" && i.unitCost !== undefined && i.active !== false);
  const title = document.createElement("h3");
  title.textContent = "Stock";
  body.append(title);
  if (stocked.length === 0) {
    body.append(note("Give a product a cost a unit to keep it in stock and count it here."));
    return;
  }
  // What is on hand now, from the bills, invoices and counts.
  const tracked = stockTracked();
  if (tracked !== null) {
    const valued = stockValuation(held(), tracked.onHand);
    const low = valued.rows.filter((r) => r.low);
    if (low.length > 0) {
      body.append(
        note(
          `Time to order: ${low.map((r) => `${r.name} (${r.quantity} on hand, reorder at ${r.reorderPoint})`).join("; ")}.`,
        ),
      );
    }
    const table = document.createElement("table");
    table.className = "report-table owner-table";
    table.innerHTML =
      "<thead><tr><th>Product</th><th>On hand</th><th>Reorder at</th><th>Average cost</th><th>Value</th><th></th></tr></thead>";
    const tbody = document.createElement("tbody");
    for (const row of valued.rows) {
      const tr = document.createElement("tr");
      if (row.low) tr.classList.add("match-off");
      const cells: [string, string][] = [
        [row.name + (row.low ? " · low" : ""), "report-name"],
        [String(row.quantity), "report-amount"],
      ];
      for (const [text, cls] of cells) {
        const td = document.createElement("td");
        td.className = cls;
        td.textContent = text;
        tr.append(td);
      }
      // The reorder point, set where it is read.
      const reorderCell = document.createElement("td");
      const reorder = document.createElement("input");
      reorder.type = "text";
      reorder.inputMode = "decimal";
      reorder.size = 5;
      reorder.placeholder = "none";
      reorder.value = row.reorderPoint === undefined ? "" : String(row.reorderPoint);
      reorder.addEventListener("change", () => {
        const text = reorder.value.trim();
        const at = text === "" ? undefined : Number(text.replace(",", "."));
        if (at !== undefined && (!Number.isFinite(at) || at < 0)) {
          reorder.setCustomValidity("A number of units, such as 10, or nothing.");
          reorder.reportValidity();
          return;
        }
        const next = held().map((i) => {
          if (i.id !== row.itemId) return i;
          const { reorderPoint: _old, ...rest } = i;
          return at === undefined ? rest : { ...rest, reorderPoint: at };
        });
        void keep(next, at === undefined ? `${row.name}: no reorder point` : `${row.name}: reorder at ${at}`);
      });
      reorderCell.append(reorder);
      tr.append(reorderCell);
      for (const [text, cls] of [
        [booksMoney(row.averageCost), "report-amount"],
        [booksMoney(row.value), "report-amount"],
      ] as const) {
        const td = document.createElement("td");
        td.className = cls;
        td.textContent = text;
        tr.append(td);
      }
      const actions = document.createElement("td");
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "small";
      toggle.textContent = showingMovements === row.itemId ? "Hide movements" : "Movements";
      toggle.addEventListener("click", () => {
        showingMovements = showingMovements === row.itemId ? null : row.itemId;
        redraw("items");
      });
      actions.append(toggle);
      tr.append(actions);
      tbody.append(tr);
      if (showingMovements === row.itemId) tbody.append(movementsRow(tracked.movements.get(row.itemId) ?? []));
    }
    const foot = document.createElement("tr");
    foot.className = "report-total";
    foot.innerHTML = '<td class="report-name">Total</td><td></td><td></td><td></td>';
    const sum = document.createElement("td");
    sum.className = "report-amount";
    sum.textContent = booksMoney(valued.total);
    foot.append(sum, document.createElement("td"));
    tbody.append(foot);
    table.append(tbody);
    body.append(table);
    const csv = document.createElement("button");
    csv.type = "button";
    csv.textContent = "Stock valuation CSV";
    csv.addEventListener("click", () => {
      const money = (c: number): string => (c / 100).toFixed(2);
      const rows = [
        ["Product", "On hand", "Reorder at", "Average cost", "Value"],
        ...valued.rows.map((r) => [r.name, String(r.quantity), r.reorderPoint === undefined ? "" : String(r.reorderPoint), money(r.averageCost), money(r.value)]),
        ["Total", "", "", "", money(valued.total)],
      ];
      download(rows.map((r) => r.map(spreadsheetCell).join(",")).join("\n") + "\n", `stock-valuation-${new Date().toLocaleDateString("en-CA")}.csv`, "text/csv");
    });
    body.append(csv);
    const { inventory, cost } = stockAccounts();
    body.append(
      note(
        inventory === undefined || cost === undefined
          ? "Add an Inventory asset account and a cost of goods sold account to post the cost of what is sold."
          : `Bought on a bill line with the product's name: into ${inventory.code} ${inventory.name}. ` +
              `Sold on an invoice line: its cost moves to ${cost.code} ${cost.name} on the invoice's date, at the average cost.`,
      ),
    );
  }
  const counts = state.ledger.stockCounts ?? [];
  const last = [...counts].sort((a, b) => a.date.localeCompare(b.date)).pop();
  if (last !== undefined) {
    body.append(note(`Last counted ${last.date}: ${booksMoney(stockValue(last))} on hand${last.journalId === undefined ? ", not posted" : ""}.`));
  }
  const start = document.createElement("button");
  start.type = "button";
  start.className = "primary";
  start.textContent = "Count stock";
  start.hidden = counting;
  start.addEventListener("click", () => {
    counting = true;
    redraw("items");
  });
  body.append(start);
  if (!counting) return;

  const { inventory, cost } = stockAccounts();
  const box = document.createElement("div");
  box.className = "contact-form";
  const date = document.createElement("input");
  date.type = "date";
  date.value = new Date().toLocaleDateString("en-CA");
  const dateLabel = document.createElement("label");
  dateLabel.className = "contact-field";
  dateLabel.append(Object.assign(document.createElement("span"), { textContent: "Counted on" }), date);
  box.append(dateLabel);
  const table = document.createElement("table");
  table.className = "report-table owner-table";
  table.innerHTML = "<thead><tr><th>Product</th><th>Cost a unit</th><th>Counted</th><th>Value</th></tr></thead>";
  const tbody = document.createElement("tbody");
  const boxes: { item: Item; input: HTMLInputElement; value: HTMLTableCellElement }[] = [];
  const before = new Map((last?.lines ?? []).map((l) => [l.itemId, l.quantity]));
  for (const item of stocked) {
    const tr = document.createElement("tr");
    const name = document.createElement("td");
    name.className = "report-name";
    name.textContent = item.name;
    const unit = document.createElement("td");
    unit.className = "report-amount";
    unit.textContent = booksMoney(item.unitCost ?? 0);
    const cell = document.createElement("td");
    const input = document.createElement("input");
    input.type = "text";
    input.inputMode = "decimal";
    input.placeholder = String(before.get(item.id) ?? 0);
    cell.append(input);
    const value = document.createElement("td");
    value.className = "report-amount";
    tr.append(name, unit, cell, value);
    tbody.append(tr);
    boxes.push({ item, input, value });
  }
  table.append(tbody);
  box.append(table);
  const said = document.createElement("p");
  said.className = "page-hint";
  box.append(said);
  const problem = document.createElement("p");
  problem.className = "cloud-said";
  box.append(problem);

  const lines = (): StockCount["lines"] | null => {
    const out: StockCount["lines"] = [];
    for (const { item, input } of boxes) {
      const text = input.value.trim() === "" ? input.placeholder : input.value.trim();
      const quantity = Number(text.replace(",", "."));
      if (!Number.isFinite(quantity) || quantity < 0) return null;
      out.push({ itemId: item.id, quantity, unitCost: item.unitCost ?? 0 });
    }
    return out;
  };
  const refresh = (): void => {
    const read = lines();
    for (const { item, input, value } of boxes) {
      const q = Number((input.value.trim() === "" ? input.placeholder : input.value).replace(",", "."));
      value.textContent = Number.isFinite(q) ? booksMoney(Math.round(q * (item.unitCost ?? 0))) : "";
    }
    if (read === null) {
      said.textContent = "";
      return;
    }
    const counted = stockValue({ lines: read });
    said.textContent =
      inventory === undefined
        ? `Counted ${booksMoney(counted)}.`
        : `Counted ${booksMoney(counted)}. ${inventory.code} ${inventory.name} holds ${booksMoney(bookedAt(inventory.code, date.value))} on that day.`;
  };
  for (const { input } of boxes) input.addEventListener("input", refresh);
  date.addEventListener("change", refresh);
  refresh();

  const post = document.createElement("button");
  post.type = "button";
  post.className = "primary";
  post.textContent = "Save the count and post it";
  post.title = "Put the inventory account to the counted value, the difference to cost of goods sold.";
  post.addEventListener("click", () => {
    const read = lines();
    if (read === null) {
      problem.textContent = "Each count as a number, such as 12.";
      return;
    }
    if (inventory === undefined || cost === undefined) {
      problem.textContent =
        "Add an Inventory asset account and a cost of goods sold account on Entities & accounts first.";
      return;
    }
    void (async () => {
      const count: StockCount = { id: `count-${Date.now().toString(36)}`, date: date.value, lines: read };
      const counted = stockValue(count);
      const booked = bookedAt(inventory.code, date.value);
      const adjust = stockAdjustment(counted, booked, `${inventory.name} - ${inventory.code}`, `${cost.name} - ${cost.code}`);
      if (adjust.length > 0) {
        const journal = {
          id: `stock-${count.id}`,
          date: count.date,
          narration: `Stock count ${count.date}: ${booksMoney(counted)} on hand`,
          lines: adjust,
          source: "Stock count",
        };
        await saveManualJournals([...(state.ledger.manualJournals ?? []), journal], `Stock count ${count.date}`);
        count.journalId = journal.id;
      }
      const before = state.ledger.stockCounts ?? [];
      const next = [...before, count];
      state.ledger = { ...state.ledger, stockCounts: next };
      state.persistent = await savePart(state.ledger);
      await record("stock", `Stock counted ${count.date}: ${booksMoney(counted)}`, before, next);
      counting = false;
      redraw("items");
    })();
  });
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", () => {
    counting = false;
    redraw("items");
  });
  const row = document.createElement("div");
  row.className = "migration-actions";
  row.append(post, cancel);
  box.append(problem, row);
  body.append(box);
}
