import { redraw } from "../app.js";
import { postedJournals, record, saveManualJournals, stockAccounts, stockTracked } from "../books.js";
import { booksCountry, booksCurrency, booksMoney, noSalesTax } from "../country.js";
import { $, state } from "../state.js";
import { savePart } from "../store.js";
import { askOnPage, download, note, tellOnPage } from "../ui.js";
import { formatItems, itemKey, lowStock, parseAmount, parseProductList, splitAccountLabel, stockAdjustment, stockAsAt, stockValue } from "@nzosa/core";
import type { Item, StockCount, StockMove } from "@nzosa/core";

/** Products and services: a price list that fills in an invoice line from a name. */

let editing: string | null = null;
/** The day stock is shown as at, or null for now. */
let stockDate: string | null = null;

const round = (n: number): number => Math.round(n * 100) / 100;

/** A chart code for what a spreadsheet says an item sells to: a code, a coding label, or a name. */
function chartCodeFor(said: string | undefined): string | undefined {
  const text = (said ?? "").trim();
  if (text === "") return undefined;
  if (state.chart.some((a) => a.code.trim() === text)) return text;
  const { code, name } = splitAccountLabel(text);
  if (code !== "" && state.chart.some((a) => a.code.trim() === code)) return code;
  const byName = state.chart.find((a) => a.name.trim().toLowerCase() === (name || text).trim().toLowerCase() && a.code.trim() !== "");
  return byName?.code.trim();
}

/**
 * Products and services from a spreadsheet: new ones added, and ones already
 * here (by name) given the file's price, cost and the rest. Asked first.
 */
async function loadItems(fileName: string, text: string): Promise<void> {
  const read = parseProductList(text, booksCurrency());
  if (read.length === 0) {
    await tellOnPage(`${fileName}: no products or services could be read. It needs a name, a type and a price or cost.`);
    return;
  }
  const byKey = new Map(held().map((i) => [itemKey(i.name), i]));
  let added = 0;
  let changed = 0;
  const next = [...held()];
  for (const one of read) {
    const accountCode = chartCodeFor(one.incomeAccount);
    const found = byKey.get(itemKey(one.item.name));
    const merged: Item = {
      ...(found ?? { id: `item${Date.now().toString(36)}${added}` }),
      ...one.item,
      ...(accountCode !== undefined ? { accountCode } : found?.accountCode !== undefined ? { accountCode: found.accountCode } : {}),
    } as Item;
    if (found === undefined) {
      next.push(merged);
      added += 1;
    } else if (JSON.stringify(merged) !== JSON.stringify(found)) {
      next[next.indexOf(found)] = merged;
      changed += 1;
    }
  }
  if (added + changed === 0) {
    await tellOnPage(`${fileName}: every product and service in it is here already, as it is.`);
    return;
  }
  if (!await askOnPage(`${fileName}: ${added} new, and ${changed} already here would take the file's price, cost and details. Go ahead?`)) return;
  await keep(next, `${fileName}: ${added} products and services added, ${changed} updated`);
}

/** A product's every movement in and out, with what was on hand after each. */
function openMovements(item: Item, moves: readonly StockMove[]): void {
  const box = document.createElement("dialog");
  box.className = "ask-on-page payment-file-view";
  const heading = document.createElement("h3");
  heading.textContent = `${item.name}: movements`;
  const table = document.createElement("table");
  table.className = "report-table payment-file-table";
  table.innerHTML =
    '<thead><tr><th>Date</th><th>What</th><th>Document</th><th style="text-align:right">In</th><th style="text-align:right">Out</th><th style="text-align:right">Cost</th><th style="text-align:right">On hand</th><th style="text-align:right">Worth</th></tr></thead>';
  const tbody = document.createElement("tbody");
  for (const m of [...moves].reverse()) {
    const tr = document.createElement("tr");
    for (const [text, right] of [
      [m.date, false],
      [m.what, false],
      [m.number, false],
      [m.quantity > 0 ? String(round(m.quantity)) : "", true],
      [m.quantity < 0 ? String(round(-m.quantity)) : "", true],
      [booksMoney(Math.abs(m.value)), true],
      [String(round(m.onHand)), true],
      [booksMoney(m.worth), true],
    ] as const) {
      const td = document.createElement("td");
      td.textContent = text;
      if (right) td.className = "report-amount";
      tr.append(td);
    }
    tbody.append(tr);
  }
  table.append(tbody);
  const scroll = document.createElement("div");
  scroll.className = "move-lines-scroll";
  scroll.append(table);
  const actions = document.createElement("div");
  actions.className = "ask-on-page-actions";
  const close = document.createElement("button");
  close.type = "button";
  close.className = "primary";
  close.textContent = "Close";
  actions.append(close);
  box.append(heading, scroll, actions);
  const finish = (): void => {
    box.close();
    box.remove();
  };
  close.addEventListener("click", finish);
  box.addEventListener("cancel", (event) => {
    event.preventDefault();
    finish();
  });
  document.body.append(box);
  box.showModal();
}

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
  const reorder = document.createElement("input");
  reorder.type = "text";
  reorder.inputMode = "decimal";
  reorder.placeholder = "None";
  reorder.value = existing?.reorderAt === undefined ? "" : String(existing.reorderAt);
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
    const reorderAt = reorder.value.trim() === "" ? null : Number(reorder.value.trim());
    if (reorderAt !== null && (!Number.isFinite(reorderAt) || reorderAt < 0)) {
      problem.textContent = "A reorder point as a number of units, such as 10.";
      return;
    }
    const fields = {
      ...(unit !== null && kind.value === "product" ? { unitCost: unit } : {}),
      ...(reorderAt !== null && kind.value === "product" ? { reorderAt } : {}),
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
    label("Reorder when this many or fewer are on hand", reorder),
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
  // The whole list as a spreadsheet, and one brought back in.
  const save = document.createElement("button");
  save.type = "button";
  save.textContent = "Download (CSV)";
  save.disabled = held().length === 0;
  save.addEventListener("click", () => download(formatItems(held()), "products-and-services.csv", "text/csv"));
  const load = document.createElement("button");
  load.type = "button";
  load.textContent = "Load from a spreadsheet…";
  load.title = "A list with a name, a type and a price: this app's download, or QuickBooks' or SlowBooks' products and services";
  const picker = document.createElement("input");
  picker.type = "file";
  picker.accept = ".csv,text/csv";
  picker.hidden = true;
  load.addEventListener("click", () => picker.click());
  picker.addEventListener("change", () => {
    const file = picker.files?.[0];
    picker.value = "";
    if (file !== undefined) void file.text().then((text) => loadItems(file.name, text));
  });
  body.append(add, " ", save, " ", load, picker);
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
  // What is on hand, from the bills, invoices and counts: now, or as at a day.
  const tracked = stockTracked();
  if (tracked !== null) {
    const now = new Date().toLocaleDateString("en-CA");
    const low = lowStock(stocked, tracked.onHand);
    if (low.length > 0) {
      const warn = document.createElement("p");
      warn.className = "variance-note warn";
      warn.textContent =
        `Low on ${low.length === 1 ? "one product" : `${low.length} products`}: ` +
        low.map((x) => `${x.item.name} (${round(x.onHand)} on hand, reorder at ${round(x.reorderAt)})`).join("; ") +
        ".";
      body.append(warn);
    }
    const asAtWrap = document.createElement("label");
    asAtWrap.className = "stock-as-at";
    const asAt = document.createElement("input");
    asAt.type = "date";
    asAt.value = stockDate ?? now;
    asAt.max = now;
    asAt.addEventListener("change", () => {
      stockDate = asAt.value === "" || asAt.value >= now ? null : asAt.value;
      redraw("items");
    });
    asAtWrap.append(Object.assign(document.createElement("span"), { textContent: "Stock on hand as at" }), asAt);
    body.append(asAtWrap);
    const shown = stockDate === null ? tracked.onHand : stockAsAt(tracked.history, stockDate);
    const table = document.createElement("table");
    table.className = "report-table owner-table";
    table.innerHTML = "<thead><tr><th>Product</th><th>On hand</th><th>Reorder at</th><th>Average cost</th><th>Value</th><th></th></tr></thead>";
    const tbody = document.createElement("tbody");
    let total = 0;
    for (const item of stocked) {
      const held = shown.get(item.id) ?? { quantity: 0, value: 0 };
      total += held.value;
      const tr = document.createElement("tr");
      if (stockDate === null && item.reorderAt !== undefined && held.quantity <= item.reorderAt) tr.className = "stock-low";
      for (const [text, cls] of [
        [item.name, "report-name"],
        [String(round(held.quantity)), "report-amount"],
        [item.reorderAt === undefined ? "" : String(round(item.reorderAt)), "report-amount"],
        [held.quantity > 0 ? booksMoney(Math.round(held.value / held.quantity)) : booksMoney(item.unitCost ?? 0), "report-amount"],
        [booksMoney(held.value), "report-amount"],
      ] as const) {
        const td = document.createElement("td");
        td.className = cls;
        td.textContent = text;
        tr.append(td);
      }
      const cell = document.createElement("td");
      const moves = document.createElement("button");
      moves.type = "button";
      moves.className = "small";
      moves.textContent = "Movements";
      moves.disabled = (tracked.history.get(item.id) ?? []).length === 0;
      moves.addEventListener("click", () => openMovements(item, tracked.history.get(item.id) ?? []));
      cell.append(moves);
      tr.append(cell);
      tbody.append(tr);
    }
    const foot = document.createElement("tr");
    foot.className = "report-total";
    foot.innerHTML = '<td class="report-name">Total</td><td></td><td></td><td></td>';
    const sum = document.createElement("td");
    sum.className = "report-amount";
    sum.textContent = booksMoney(total);
    foot.append(sum, document.createElement("td"));
    tbody.append(foot);
    table.append(tbody);
    body.append(table);
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
