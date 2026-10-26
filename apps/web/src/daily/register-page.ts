import { redraw } from "../app.js";
import { attachmentsControl } from "./attachments-ui.js";
import { bankLabel, banks, record, reclassify, reportEngine, saveEntities } from "../books.js";
import { combobox } from "../combobox.js";
import type { Combobox } from "../combobox.js";
import { booksCurrency, booksMoney } from "../country.js";
import type { RegisterSnapshot } from "../events.js";
import { $, state } from "../state.js";
import { save } from "../store.js";
import { askOnPage, note, tellOnPage } from "../ui.js";
import {
  accountId,
  attachmentsOf,
  emptyEntityModel,
  isRegisterEntry,
  knownCodes,
  parseAmount,
  registerProblem,
  registerRows,
  registerTransaction,
} from "@nzosa/core";
import type { IsoDate, SplitPart, Transaction } from "@nzosa/core";

/**
 * Registers: cash, petty cash and any account with no bank feed, typed in
 * line by line, each line to one account or split across several.
 *
 * A line typed here is a bank line like an imported one and is coded as it
 * is entered, so it needs nothing more on Reconcile. Lines typed here can be
 * changed or deleted here; imported lines are shown for the balance and are
 * changed where they came from.
 */

/** The account on show. */
let chosen = "";
/** Registers started in this visit that have no lines yet, by id: their names. */
const started = new Map<string, string>();
/** The line being changed, or null for a new one. */
let editing: string | null = null;

const today = (): IsoDate => new Date().toLocaleDateString("en-CA") as IsoDate;
const NOTE = "Entered in the register";

/** Every account a register can show: those holding lines, and those just started. */
function registerAccounts(): { id: string; label: string }[] {
  const ids = new Set(banks().accounts);
  for (const id of started.keys()) ids.add(id);
  return [...ids]
    .map((id) => ({ id, label: started.get(id) ?? bankLabel(id) }))
    .sort((a, b) => {
      // Accounts already typed into first: they are the ones a register is for.
      const typed = (id: string): number => (state.ledger.transactions.some((t) => t.account === id && isRegisterEntry(t)) || started.has(id) ? 0 : 1);
      return typed(a.id) - typed(b.id) || a.label.localeCompare(b.label);
    });
}

function labelled(text: string, control: HTMLElement, className = ""): HTMLLabelElement {
  const label = document.createElement("label");
  label.className = `register-field ${className}`.trim();
  const span = document.createElement("span");
  span.textContent = text;
  label.append(span, control);
  return label;
}

function input(type: string, value = "", placeholder = ""): HTMLInputElement {
  const el = document.createElement("input");
  el.type = type;
  el.value = value;
  el.placeholder = placeholder;
  el.autocomplete = "off";
  return el;
}

const centsText = (cents: number): string => (cents === 0 ? "" : (Math.abs(cents) / 100).toFixed(2));

/** Start a register for an account with no feed: its name and, with several entities, whose it is. */
async function startRegister(): Promise<void> {
  const box = document.createElement("dialog");
  box.className = "ask-on-page";
  const heading = document.createElement("p");
  heading.className = "ask-on-page-text";
  heading.textContent = "A register for cash, petty cash, or an account with no bank feed.";
  const name = input("text", "", "Petty cash");
  const model = state.ledger.entities ?? emptyEntityModel();
  const whose = document.createElement("select");
  for (const entity of model.entities) {
    const option = document.createElement("option");
    option.value = entity.id;
    option.textContent = entity.name;
    option.selected = entity.id === state.entityFilter;
    whose.append(option);
  }
  const said = document.createElement("p");
  said.className = "cloud-said";
  const actions = document.createElement("div");
  actions.className = "ask-on-page-actions";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "Cancel";
  const ok = document.createElement("button");
  ok.type = "button";
  ok.className = "primary";
  ok.textContent = "Start";
  actions.append(cancel, ok);
  box.append(heading, labelled("Name", name), ...(model.entities.length > 1 ? [labelled("Whose", whose)] : []), said, actions);
  document.body.append(box);
  box.showModal();
  name.focus();

  await new Promise<void>((resolve) => {
    const finish = (): void => {
      box.close();
      box.remove();
      resolve();
    };
    cancel.addEventListener("click", finish);
    box.addEventListener("cancel", (event) => {
      event.preventDefault();
      finish();
    });
    const go = (): void => {
      const label = name.value.trim();
      if (label === "") {
        said.textContent = "A name for the register.";
        return;
      }
      const id = accountId(label);
      if (banks().accounts.has(id) || started.has(id)) {
        said.textContent = `${label} is already here.`;
        return;
      }
      started.set(id, label);
      chosen = id;
      if (model.entities.length > 1 && whose.value !== "") {
        const live = state.ledger.entities ?? emptyEntityModel();
        void saveEntities({ ...live, banks: { ...live.banks, [id]: [whose.value] } });
      }
      finish();
      redraw("register");
    };
    ok.addEventListener("click", go);
    name.addEventListener("keydown", (event) => {
      if (event.key === "Enter") go();
    });
  });
}

/** One line of a split: an account and an amount. */
interface SplitRow {
  row: HTMLElement;
  account: Combobox;
  amount: HTMLInputElement;
}

/**
 * The entry form: a new line, or the line being changed. Coded as it is
 * typed, to one account or split across several.
 */
function entryForm(account: string, existing: Transaction | undefined): HTMLElement {
  const box = document.createElement("div");
  box.className = "register-entry";
  const codes = knownCodes(state.rules, state.ledger.overrides ?? {}, state.chart);
  const was = existing === undefined ? undefined : state.ledger.overrides?.[existing.id];
  const wasSplit = existing === undefined ? undefined : state.ledger.splits?.[existing.id];

  const date = input("date", existing?.date ?? today());
  const payee = input("text", existing?.otherParty ?? "", "Who");
  const what = input("text", existing?.particulars ?? "", "What for");
  const ref = input("text", existing?.reference ?? "", "Receipt no.");
  const paidOut = input("text", existing !== undefined && existing.amount < 0 ? centsText(existing.amount) : "", "0.00");
  paidOut.inputMode = "decimal";
  const paidIn = input("text", existing !== undefined && existing.amount > 0 ? centsText(existing.amount) : "", "0.00");
  paidIn.inputMode = "decimal";
  const single = combobox(codes, was?.code ?? null, "Account");
  const singleField = labelled("Account", single.element);

  const splitHost = document.createElement("div");
  splitHost.className = "register-split";
  splitHost.hidden = wasSplit === undefined;
  const splitRows: SplitRow[] = [];
  const left = document.createElement("p");
  left.className = "register-left";
  const addSplitRow = (code: string | null, cents: number): void => {
    const row = document.createElement("div");
    row.className = "register-split-row";
    const account = combobox(codes, code, "Account", () => showLeft());
    const amount = input("text", centsText(cents), "0.00");
    amount.inputMode = "decimal";
    amount.addEventListener("input", () => showLeft());
    const drop = document.createElement("button");
    drop.type = "button";
    drop.className = "small";
    drop.textContent = "×";
    drop.setAttribute("aria-label", "Take this line out");
    const one: SplitRow = { row, account, amount };
    drop.addEventListener("click", () => {
      splitRows.splice(splitRows.indexOf(one), 1);
      row.remove();
      showLeft();
    });
    row.append(account.element, amount, drop);
    splitRows.push(one);
    splitHost.insertBefore(row, addLine);
  };
  const addLine = document.createElement("button");
  addLine.type = "button";
  addLine.className = "small";
  addLine.textContent = "Add a line";
  addLine.addEventListener("click", () => addSplitRow(null, 0));
  splitHost.append(addLine, left);

  const total = (): number => (parseAmount(paidIn.value || "0", booksCurrency()) ?? 0) - (parseAmount(paidOut.value || "0", booksCurrency()) ?? 0);
  const splitTotal = (): number => splitRows.reduce((s, r) => s + (parseAmount(r.amount.value || "0", booksCurrency()) ?? 0), 0);
  function showLeft(): void {
    const remaining = Math.abs(total()) - splitTotal();
    left.textContent = remaining === 0 ? "Split in full." : `${booksMoney(Math.abs(remaining))} ${remaining > 0 ? "still to split" : "split too much"}.`;
  }
  paidIn.addEventListener("input", showLeft);
  paidOut.addEventListener("input", showLeft);
  if (wasSplit !== undefined) for (const part of wasSplit) addSplitRow(part.code ?? null, part.amount);

  const splitToggle = document.createElement("button");
  splitToggle.type = "button";
  splitToggle.className = "small";
  splitToggle.textContent = splitHost.hidden ? "Split" : "One account";
  splitToggle.addEventListener("click", () => {
    splitHost.hidden = !splitHost.hidden;
    singleField.hidden = !splitHost.hidden;
    splitToggle.textContent = splitHost.hidden ? "Split" : "One account";
    if (!splitHost.hidden && splitRows.length === 0) {
      addSplitRow(single.value || null, Math.abs(total()));
      addSplitRow(null, 0);
    }
    showLeft();
  });
  singleField.hidden = !splitHost.hidden;
  showLeft();

  const said = document.createElement("p");
  said.className = "cloud-said";
  said.setAttribute("role", "alert");
  const saveButton = document.createElement("button");
  saveButton.type = "button";
  saveButton.className = "primary";
  saveButton.textContent = existing === undefined ? "Add" : "Save";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "Cancel";
  cancel.hidden = existing === undefined;
  cancel.addEventListener("click", () => {
    editing = null;
    redraw("register");
  });

  saveButton.addEventListener("click", () => {
    said.textContent = "";
    const outCents = parseAmount(paidOut.value || "0", booksCurrency());
    const inCents = parseAmount(paidIn.value || "0", booksCurrency());
    if (outCents === null || inCents === null || outCents < 0 || inCents < 0) {
      said.textContent = "Amounts as numbers, such as 12.50.";
      return;
    }
    if (outCents > 0 && inCents > 0) {
      said.textContent = "Money in or money out, not both.";
      return;
    }
    const draft = {
      account,
      date: date.value as IsoDate,
      payee: payee.value,
      description: what.value,
      reference: ref.value,
      amount: inCents - outCents,
      currency: booksCurrency(),
    };
    const problem = registerProblem(draft);
    if (problem !== null) {
      said.textContent = problem;
      return;
    }
    const sign = draft.amount > 0 ? 1 : -1;
    let coding: { code: string } | { parts: SplitPart[] };
    if (splitHost.hidden) {
      if (single.value === "") {
        said.textContent = "The account it goes to.";
        return;
      }
      coding = { code: single.value };
    } else {
      const parts: SplitPart[] = [];
      for (const r of splitRows) {
        const cents = parseAmount(r.amount.value || "0", booksCurrency());
        if (cents === null || cents < 0) {
          said.textContent = "Each split line's amount as a number.";
          return;
        }
        if (cents === 0 && r.account.value === "") continue;
        if (r.account.value === "") {
          said.textContent = "An account for each split line.";
          return;
        }
        parts.push({ amount: sign * cents, code: r.account.value, note: "" });
      }
      if (parts.length < 2) {
        said.textContent = "A split needs two lines or more; or choose One account.";
        return;
      }
      if (parts.reduce((s, p) => s + p.amount, 0) !== draft.amount) {
        said.textContent = "The split lines need to add up to the amount.";
        return;
      }
      coding = { parts };
    }
    void keepEntry(existing, draft, coding, said);
  });

  const row = document.createElement("div");
  row.className = "register-entry-fields";
  row.append(
    labelled("Date", date),
    labelled("Who", payee, "wide"),
    labelled("What for", what, "wide"),
    labelled("Reference", ref),
    labelled("Money out", paidOut),
    labelled("Money in", paidIn),
  );
  const coded = document.createElement("div");
  coded.className = "register-entry-coding";
  coded.append(singleField, splitToggle);
  const actions = document.createElement("div");
  actions.className = "migration-actions";
  actions.append(saveButton, cancel);
  box.append(row, coded, splitHost, said, actions);
  // The receipt or voucher, kept with the line once it is in.
  if (existing !== undefined) box.append(attachmentsControl({ kind: "line", id: existing.id }, existing.otherParty || existing.particulars || "this entry"));
  return box;
}

/** Save a line, new or changed, with its coding, as one change on History. */
async function keepEntry(
  existing: Transaction | undefined,
  draft: Parameters<typeof registerTransaction>[0],
  coding: { code: string } | { parts: SplitPart[] },
  said: HTMLElement,
): Promise<void> {
  const id = existing?.id ?? `reg-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const before = snapshot(id);
  const label = started.get(draft.account) ?? bankLabel(draft.account);
  const line = registerTransaction(draft, id, state.ledger.transactions);
  // The account's name rides on its lines, as an import's does, so a register
  // started here keeps its name in reports and after a reload.
  const t: Transaction = { ...line, extras: { ...line.extras, accountLabel: label } };
  const at = new Date().toISOString();
  const overrides = { ...(state.ledger.overrides ?? {}) };
  const splits = { ...(state.ledger.splits ?? {}) };
  if ("code" in coding) {
    overrides[id] = { ...(overrides[id] ?? {}), code: coding.code, confirmed: true, note: NOTE, at };
    delete splits[id];
  } else {
    const { code: _code, ...rest } = overrides[id] ?? { note: NOTE };
    overrides[id] = { ...rest, confirmed: true, note: NOTE, at };
    splits[id] = coding.parts;
  }
  const was = state.ledger;
  state.ledger = {
    ...state.ledger,
    transactions: existing === undefined ? [...state.ledger.transactions, t] : state.ledger.transactions.map((x) => (x.id === id ? t : x)),
    overrides,
    splits,
  };
  try {
    state.persistent = await save(state.ledger);
  } catch (error) {
    // Refused, as for a locked period: nothing was kept.
    state.ledger = was;
    said.textContent = error instanceof Error ? error.message : String(error);
    return;
  }
  started.delete(draft.account);
  const who = draft.payee.trim() || draft.description.trim();
  await record("register", `${existing === undefined ? "Entered" : "Changed"} ${who} ${booksMoney(Math.abs(draft.amount))} in ${label}`, before, snapshot(id), id);
  editing = null;
  reclassify();
  redraw("register");
}

/** A line as History keeps it, or null when there is none. */
function snapshot(id: string): RegisterSnapshot | null {
  const transaction = state.ledger.transactions.find((t) => t.id === id);
  if (transaction === undefined) return null;
  return {
    transaction,
    override: state.ledger.overrides?.[id] ?? null,
    split: state.ledger.splits?.[id] === undefined ? null : [...(state.ledger.splits[id] ?? [])],
  };
}

async function deleteEntry(t: Transaction): Promise<void> {
  const who = t.otherParty || t.particulars;
  if (!(await askOnPage(`Delete ${who}, ${booksMoney(Math.abs(t.amount))} on ${t.date}? History keeps it, to undo.`, "Delete"))) return;
  const before = snapshot(t.id);
  const overrides = { ...(state.ledger.overrides ?? {}) };
  const splits = { ...(state.ledger.splits ?? {}) };
  delete overrides[t.id];
  delete splits[t.id];
  const was = state.ledger;
  state.ledger = { ...state.ledger, transactions: state.ledger.transactions.filter((x) => x.id !== t.id), overrides, splits };
  try {
    state.persistent = await save(state.ledger);
  } catch (error) {
    state.ledger = was;
    await tellOnPage(error instanceof Error ? error.message : String(error));
    return;
  }
  await record("register", `Deleted ${who} ${booksMoney(Math.abs(t.amount))} from ${bankLabel(t.account)}`, before, null, t.id);
  reclassify();
  redraw("register");
}

export function renderRegister(): void {
  const body = $("register-body");
  body.textContent = "";
  const accounts = registerAccounts();

  const pick = $<HTMLSelectElement>("register-account");
  pick.textContent = "";
  for (const a of accounts) {
    const option = document.createElement("option");
    option.value = a.id;
    option.textContent = a.label;
    pick.append(option);
  }
  if (!accounts.some((a) => a.id === chosen)) chosen = accounts[0]?.id ?? "";
  pick.value = chosen;
  pick.hidden = accounts.length === 0;

  if (chosen === "") {
    body.append(note("No accounts yet. Start a register for cash or petty cash, or import a bank statement."));
    return;
  }

  const lines = state.ledger.transactions;
  const editingLine = editing === null ? undefined : lines.find((t) => t.id === editing);
  const heading = document.createElement("h3");
  heading.textContent = editingLine === undefined ? "New entry" : "Change this entry";
  body.append(heading, entryForm(chosen, editingLine));

  const opening = state.ledger.openingBalances?.accounts[chosen] ?? 0;
  const rows = registerRows(lines, chosen, opening);
  if (rows.length === 0) {
    body.append(note("Nothing in this register yet. Each entry goes in the books as it is added."));
    return;
  }
  const engine = reportEngine();
  const splits = state.ledger.splits ?? {};
  const table = document.createElement("table");
  table.className = "report-table register-table";
  table.innerHTML =
    "<thead><tr><th>Date</th><th>Who</th><th>What for</th><th>Account</th>" +
    "<th style=\"text-align:right\">Out</th><th style=\"text-align:right\">In</th><th style=\"text-align:right\">Balance</th><th></th></tr></thead>";
  const tbody = document.createElement("tbody");
  const shown = rows.slice(-300).reverse();
  for (const { transaction: t, balance } of shown) {
    const tr = document.createElement("tr");
    if (t.id === editing) tr.classList.add("register-editing");
    const parts = splits[t.id];
    const coded = parts !== undefined ? `Split ${parts.length} ways` : (engine?.codeOf(t) ?? "");
    const files = attachmentsOf(state.ledger.attachments, { kind: "line", id: t.id }).length;
    const filesWord = files === 0 ? "" : `${files} ${files === 1 ? "file" : "files"}`;
    for (const text of [t.date, t.otherParty, [t.particulars, t.reference, filesWord].filter(Boolean).join(" · "), coded || "Not coded"]) {
      const td = document.createElement("td");
      td.textContent = text;
      tr.append(td);
    }
    if (coded === "") tr.lastElementChild?.classList.add("match-off");
    for (const [cents, always] of [[t.amount < 0 ? -t.amount : 0, false], [t.amount > 0 ? t.amount : 0, false], [balance, true]] as const) {
      const td = document.createElement("td");
      td.className = "report-amount";
      td.textContent = cents === 0 && !always ? "" : booksMoney(cents);
      tr.append(td);
    }
    const actions = document.createElement("td");
    if (isRegisterEntry(t)) {
      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "small";
      edit.textContent = "Change";
      edit.addEventListener("click", () => {
        editing = t.id;
        redraw("register");
        $("register-body").scrollIntoView({ block: "start" });
      });
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "small remove";
      remove.textContent = "Delete";
      remove.addEventListener("click", () => void deleteEntry(t));
      actions.append(edit, " ", remove);
    } else {
      actions.className = "register-imported";
      actions.textContent = "From the bank";
    }
    tr.append(actions);
    tbody.append(tr);
  }
  table.append(tbody);
  body.append(table);
  if (rows.length > 300) body.append(note(`Showing the latest 300 of ${rows.length} lines.`));
}

export function wireRegister(): void {
  $<HTMLSelectElement>("register-account").addEventListener("change", (event) => {
    chosen = (event.target as HTMLSelectElement).value;
    editing = null;
    redraw("register");
  });
  $("register-new").addEventListener("click", () => void startRegister());
}
