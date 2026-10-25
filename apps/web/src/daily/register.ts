import { record, reclassify } from "../books.js";
import { combobox } from "../combobox.js";
import type { Combobox } from "../combobox.js";
import { booksCurrency, booksMoney } from "../country.js";
import { pickableCodes } from "../reconcile.js";
import { state } from "../state.js";
import { savePart } from "../store.js";
import { askOnPage, askTextOnPage, note, tellOnPage } from "../ui.js";
import { emptyEntityModel, isTyped, parseAmount, registerLines, typedLine } from "@nzosa/core";
import type { SplitPart, Transaction, TransactionOverride } from "@nzosa/core";

/**
 * Registers typed into, on Bank import: cash, petty cash, any account with no
 * bank file. A line typed here is coded as it is typed -- one account, or split
 * across several -- and from then on is a bank line like any other.
 */

let chosen = "";

/** Draw the register section again, where it sits. */
function again(): void {
  const host = document.getElementById("register-body");
  if (host !== null) renderRegister(host);
}

function registers(): string[] {
  const typed = state.ledger.transactions.filter(isTyped).map((t) => t.account);
  return [...new Set([...(state.ledger.registers ?? []), ...typed])].sort((a, b) => a.localeCompare(b));
}

const today = (): string => new Date().toLocaleDateString("en-CA");

async function addRegister(): Promise<void> {
  const name = (await askTextOnPage("What is the register called? For example: Petty cash, Cash tin, Market takings.", "Petty cash"))?.trim() ?? "";
  if (name === "") return;
  const taken = new Set(state.ledger.transactions.map((t) => t.account));
  if (registers().includes(name) || taken.has(name)) {
    await tellOnPage(`${name} is already an account in these books.`);
    return;
  }
  const before = state.ledger.registers ?? [];
  // With entities, a register belongs to one: the one chosen at the top, or the only one.
  const model = state.ledger.entities ?? emptyEntityModel();
  const entity = model.entities.find((e) => e.id === state.entityFilter) ?? (model.entities.length === 1 ? model.entities[0] : undefined);
  state.ledger = {
    ...state.ledger,
    registers: [...before, name],
    ...(entity !== undefined ? { entities: { ...model, banks: { ...model.banks, [name]: [entity.id] } } } : {}),
  };
  state.persistent = await savePart(state.ledger, ...(entity !== undefined ? (["entities"] as const) : []));
  chosen = name;
  again();
}

export function renderRegister(body: HTMLElement): void {
  body.textContent = "";
  const all = registers();
  const add = document.createElement("button");
  add.type = "button";
  add.textContent = all.length === 0 ? "Start a register…" : "Another register…";
  add.addEventListener("click", () => void addRegister());
  if (all.length === 0) {
    body.append(add);
    return;
  }
  if (!all.includes(chosen)) chosen = all[0] ?? "";

  const pick = document.createElement("select");
  for (const name of all) {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    option.selected = name === chosen;
    pick.append(option);
  }
  pick.addEventListener("change", () => {
    chosen = pick.value;
    again();
  });
  const head = document.createElement("div");
  head.className = "migration-actions";
  head.append(pick, add);
  body.append(head, entryForm(chosen), lineList(chosen));
}

/** A row of the split: an account and an amount. */
interface PartRow {
  account: Combobox;
  amount: HTMLInputElement;
  row: HTMLElement;
}

function entryForm(account: string): HTMLElement {
  const box = document.createElement("div");
  box.className = "invoice-editor";
  const grid = document.createElement("div");
  grid.className = "invoice-fields";
  const field = (label: string, control: HTMLElement): void => {
    const wrap = document.createElement("label");
    const span = document.createElement("span");
    span.textContent = label;
    wrap.append(span, control);
    grid.append(wrap);
  };
  const date = document.createElement("input");
  date.type = "date";
  date.value = today();
  const direction = document.createElement("select");
  for (const [value, text] of [["out", "Money out"], ["in", "Money in"]] as const) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = text;
    direction.append(option);
  }
  const amount = document.createElement("input");
  amount.type = "text";
  amount.inputMode = "decimal";
  amount.placeholder = "0.00";
  const payee = document.createElement("input");
  payee.type = "text";
  payee.placeholder = "Who it was paid to, or from";
  const reference = document.createElement("input");
  reference.type = "text";
  reference.placeholder = "Receipt number, what for";
  field("Date", date);
  field("In or out", direction);
  field("Amount", amount);
  field("Payee", payee);
  field("Reference", reference);
  box.append(grid);

  // The coding: one account, or more with an amount each.
  const codes = pickableCodes(state.rules, state.ledger.overrides ?? {}, state.chart);
  const parts: PartRow[] = [];
  const partsHost = document.createElement("div");
  const addPart = (): void => {
    const row = document.createElement("div");
    row.className = "invoice-line";
    const picker = combobox(codes, null, "Account");
    const each = document.createElement("input");
    each.type = "text";
    each.inputMode = "decimal";
    each.placeholder = parts.length === 0 ? "All of it" : "0.00";
    each.className = "invoice-amount";
    row.append(picker.element, each);
    partsHost.append(row);
    parts.push({ account: picker, amount: each, row });
  };
  addPart();
  const more = document.createElement("button");
  more.type = "button";
  more.textContent = "Split across another account";
  more.addEventListener("click", addPart);
  const said = document.createElement("p");
  said.className = "cloud-said";
  const save = document.createElement("button");
  save.type = "button";
  save.className = "primary";
  save.textContent = "Add the line";
  save.addEventListener("click", () => {
    void (async () => {
      const total = parseAmount(amount.value, booksCurrency());
      if (date.value === "") return void (said.textContent = "The date it happened.");
      if (total === null || total <= 0) return void (said.textContent = "The amount, such as 12.50.");
      if (payee.value.trim() === "") return void (said.textContent = "Who it was paid to, or from.");
      const sign = direction.value === "out" ? -1 : 1;
      const chosenParts = parts.filter((p) => p.account.value !== "");
      if (chosenParts.length === 0) return void (said.textContent = "The account it is for.");
      // One account takes it all; several each take what is typed beside them.
      let split: SplitPart[] | undefined;
      if (chosenParts.length > 1) {
        const amounts = chosenParts.map((p) => parseAmount(p.amount.value, booksCurrency()));
        if (amounts.some((a) => a === null || a <= 0)) return void (said.textContent = "An amount beside each account.");
        const sum = (amounts as number[]).reduce((s, a) => s + a, 0);
        if (sum !== total) {
          return void (said.textContent = `The parts come to ${booksMoney(sum)}; the line is ${booksMoney(total)}.`);
        }
        split = chosenParts.map((p, i) => ({ amount: sign * (amounts[i] as number), code: p.account.value, note: reference.value.trim() || payee.value.trim() }));
      }
      const held = state.ledger.transactions.filter((t) => t.account === account);
      const transaction = typedLine({
        account,
        date: date.value,
        amount: sign * total,
        currency: booksCurrency(),
        payee: payee.value,
        reference: reference.value,
        serial: `${Date.now().toString(36)}${held.length}`,
        line: held.length + 1,
      });
      const override: TransactionOverride = {
        ...(split === undefined ? { code: chosenParts[0]?.account.value ?? "" } : {}),
        contact: payee.value.trim(),
        confirmed: true,
        note: "Typed into the register",
        at: today(),
      };
      await keepLine({ transaction, override, ...(split !== undefined ? { split } : {}) }, null);
    })();
  });
  const actions = document.createElement("div");
  actions.className = "migration-actions";
  actions.append(save, more);
  box.append(partsHost, actions, said);
  return box;
}

interface Typed {
  transaction: Transaction;
  override?: TransactionOverride;
  split?: SplitPart[];
}

/** Put a line in (after) or take one out (before), with its coding and split, as one History entry. */
async function keepLine(after: Typed | null, before: Typed | null): Promise<void> {
  const one = after ?? before;
  if (one === null) return;
  const id = one.transaction.id;
  const overrides = { ...(state.ledger.overrides ?? {}) };
  const splits = { ...(state.ledger.splits ?? {}) };
  let transactions = state.ledger.transactions;
  if (after !== null) {
    transactions = [...transactions, after.transaction];
    if (after.override !== undefined) overrides[id] = after.override;
    if (after.split !== undefined) splits[id] = after.split;
  } else {
    transactions = transactions.filter((t) => t.id !== id);
    delete overrides[id];
    delete splits[id];
  }
  state.ledger = { ...state.ledger, transactions, overrides, splits };
  state.persistent = await savePart(state.ledger);
  const t = one.transaction;
  await record(
    "register",
    `${after !== null ? "Typed" : "Took out"} ${booksMoney(t.amount)} ${t.otherParty} on ${t.date} (${t.account})`,
    before,
    after,
    id,
  );
  reclassify();
  again();
}

function lineList(account: string): HTMLElement {
  const wrap = document.createElement("div");
  const opening = state.ledger.openingBalances?.accounts?.[account] ?? 0;
  const lines = registerLines(state.ledger.transactions, account, opening);
  if (lines.length === 0) {
    wrap.append(note("No lines yet. The first one typed starts it."));
    return wrap;
  }
  const table = document.createElement("table");
  table.className = "report-table owner-table";
  table.innerHTML =
    "<thead><tr><th>Date</th><th>Payee</th><th>Reference</th><th>Coded to</th><th>In</th><th>Out</th><th>Balance</th><th></th></tr></thead>";
  const tbody = document.createElement("tbody");
  for (const { transaction: t, balance } of [...lines].reverse().slice(0, 100)) {
    const tr = document.createElement("tr");
    const split = state.ledger.splits?.[t.id];
    const coded = split !== undefined ? split.map((p) => p.code).join(", ") : (state.ledger.overrides?.[t.id]?.code ?? "");
    for (const [text, cls] of [
      [t.date, "report-date"],
      [t.otherParty, "report-name"],
      [t.reference, "report-name"],
      [coded, "report-name"],
      [t.amount > 0 ? booksMoney(t.amount) : "", "report-amount"],
      [t.amount < 0 ? booksMoney(-t.amount) : "", "report-amount"],
      [booksMoney(balance), "report-amount"],
    ] as const) {
      const td = document.createElement("td");
      td.className = cls;
      td.textContent = text;
      tr.append(td);
    }
    const cell = document.createElement("td");
    if (isTyped(t)) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "small";
      remove.textContent = "Delete";
      remove.addEventListener("click", async () => {
        if (!(await askOnPage(`Take out ${booksMoney(t.amount)} ${t.otherParty} on ${t.date}?`, "Take it out"))) return;
        const override = state.ledger.overrides?.[t.id];
        const splitNow = state.ledger.splits?.[t.id];
        await keepLine(null, {
          transaction: t,
          ...(override !== undefined ? { override } : {}),
          ...(splitNow !== undefined ? { split: [...splitNow] } : {}),
        });
      });
      cell.append(remove);
    }
    tr.append(cell);
    tbody.append(tr);
  }
  table.append(tbody);
  const scroller = document.createElement("div");
  scroller.className = "table-scroll";
  scroller.append(table);
  wrap.append(scroller);
  if (lines.length > 100) wrap.append(note(`The latest 100 of ${lines.length}.`));
  return wrap;
}
