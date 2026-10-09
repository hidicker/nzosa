import { redraw } from "../app.js";
import { record, saveManualJournals } from "../books.js";
import { $, state } from "../state.js";
import { savePart } from "../store.js";
import { amountCell, download, nameCell, note } from "../ui.js";
import {
  accountEntityKey,
  accountLabel,
  dayAfter,
  emptyEntityModel,
  endedWithMoneyLeft,
  grantOpen,
  grantPosition,
  grantReportRows,
  grantYearEnd,
  parseAmount,
  spreadsheetCell,
  unspentForBooks,
} from "@nzosa/core";
import type { Account, Cents, Entity, Grant, GrantPosition, IsoDate, Transaction } from "@nzosa/core";
import { taxYearEnd, taxYearEndSaid, taxYearOf } from "../tax-year.js";
import { booksLocale, moneyPlaces } from "../country.js";

/**
 * The grant register: each grant, what has come in against it, what has been
 * spent and what is left, and the report a funder asks for.
 *
 * Beside the books. A grant is linked to the bank lines that brought it in and
 * the lines that spent it; everything on this page is worked out from those
 * links. The one thing it can put into the books is the year-end entry for a
 * grant with conditions (see core's grants.ts).
 */

let editing: Grant | null = null;
/** The grant whose lines are being linked, and what has been typed to find them. */
let linking: string | null = null;
let finding = "";
/** The grants whose funder's report is open. */
const reporting = new Set<string>();

function money(cents: number): string {
  const text = (Math.abs(cents) / 100).toLocaleString(booksLocale(), {
    minimumFractionDigits: moneyPlaces(),
    maximumFractionDigits: moneyPlaces(),
  });
  return cents < 0 ? `(${text})` : text;
}

function today(): IsoDate {
  return new Date().toISOString().slice(0, 10);
}

function nonProfits(): Entity[] {
  return (state.ledger.entities ?? emptyEntityModel()).entities.filter((e) => e.kind === "nonprofit");
}

/** Whether there is any reason to offer the page at all. */
export function hasNonProfits(): boolean {
  return nonProfits().length > 0;
}

async function saveGrants(grants: Grant[], links: Record<string, string>, what: string): Promise<void> {
  const before = { grants: state.ledger.grants ?? [], grantLinks: state.ledger.grantLinks ?? {} };
  state.ledger = { ...state.ledger, grants, grantLinks: links };
  state.persistent = await savePart(state.ledger);
  await record("grants", what, before, { grants, grantLinks: links });
  redraw("grants");
}

function field(label: string, control: HTMLElement): HTMLLabelElement {
  const wrap = document.createElement("label");
  wrap.className = "year-end-field";
  wrap.append(`${label} `, control);
  return wrap;
}

function input(type: string, value: string): HTMLInputElement {
  const box = document.createElement("input");
  box.type = type;
  box.value = value;
  return box;
}

const dollars = (c: number): string => (c === 0 ? "" : (c / 100).toFixed(2));

function editor(draft: Grant, entities: Entity[]): HTMLElement {
  const box = document.createElement("div");
  box.className = "journal-card";

  const who = document.createElement("select");
  for (const e of entities) {
    const option = document.createElement("option");
    option.value = e.id;
    option.textContent = e.name;
    option.selected = e.id === draft.entityId;
    who.append(option);
  }
  const funder = input("text", draft.funder);
  funder.placeholder = "Who gave it";
  const purpose = input("text", draft.purpose);
  purpose.placeholder = "What it is for";
  const amount = input("text", dollars(draft.amount));
  amount.placeholder = "0.00";
  amount.className = "payroll-tiny-input";
  const from = input("date", draft.from ?? "");
  const to = input("date", draft.to ?? "");
  const conditions = document.createElement("textarea");
  conditions.rows = 3;
  conditions.value = draft.conditions ?? "";
  conditions.placeholder = "The funder's conditions and what it wants reported, in its words";
  const conditional = document.createElement("input");
  conditional.type = "checkbox";
  conditional.checked = draft.conditional;
  const due = input("date", draft.reportDue ?? "");

  const conditionalWrap = document.createElement("label");
  conditionalWrap.className = "feed-auto";
  conditionalWrap.append(conditional, " Has to be given back if it is not used for its purpose");

  box.append(
    ...(entities.length > 1 ? [field("Organisation", who)] : []),
    field("Funder", funder),
    field("For", purpose),
    field("Amount awarded $", amount),
    field("Covers from", from),
    field("to", to),
    field("Report due", due),
    conditions,
    conditionalWrap,
    note(
      "A grant that has to be returned if it is not spent for its purpose is not income until it is spent: " +
        "what is unspent at year end is held as a liability. Most grants have no such condition and are " +
        "income when they arrive; leave this unticked for those. An organisation reporting on the cash " +
        "basis (Tier 4) does not need the year-end entry either way.",
    ),
  );

  const trouble = document.createElement("p");
  trouble.className = "cloud-said";
  const actions = document.createElement("div");
  actions.className = "migration-actions";
  const save = document.createElement("button");
  save.type = "button";
  save.className = "primary";
  save.textContent = "Save";
  save.addEventListener("click", () => {
    const cents = parseAmount(amount.value) ?? 0;
    const problems = [
      funder.value.trim() === "" ? "say who gave it" : "",
      purpose.value.trim() === "" ? "say what it is for" : "",
      cents <= 0 ? "give the amount awarded" : "",
      from.value !== "" && to.value !== "" && to.value < from.value ? "the period ends before it starts" : "",
    ].filter((p) => p !== "");
    if (problems.length > 0) {
      trouble.textContent = `Not saved: ${problems.join("; ")}.`;
      return;
    }
    const next: Grant = {
      id: draft.id,
      entityId: who.value,
      funder: funder.value.trim(),
      purpose: purpose.value.trim(),
      amount: cents,
      conditional: conditional.checked,
      ...(from.value !== "" ? { from: from.value } : {}),
      ...(to.value !== "" ? { to: to.value } : {}),
      ...(conditions.value.trim() !== "" ? { conditions: conditions.value.trim() } : {}),
      ...(due.value !== "" ? { reportDue: due.value } : {}),
      ...(draft.reported !== undefined ? { reported: draft.reported } : {}),
      ...(draft.closed !== undefined ? { closed: draft.closed } : {}),
    };
    const others = (state.ledger.grants ?? []).filter((g) => g.id !== next.id);
    editing = null;
    void saveGrants([...others, next], state.ledger.grantLinks ?? {}, `Grant: ${next.funder}, ${next.purpose}`);
  });
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", () => {
    editing = null;
    redraw("grants");
  });
  actions.append(save, cancel);
  box.append(actions, trouble);
  return box;
}

/** The bank lines that could belong to an organisation: those of the accounts it uses. */
function linesFor(entity: Entity | undefined): Transaction[] {
  const model = state.ledger.entities ?? emptyEntityModel();
  const serves = (account: string): boolean => {
    const list = model.banks[account] ?? [];
    return list.length === 0 ? model.entities.length <= 1 : entity === undefined || list.includes(entity.id);
  };
  return state.ledger.transactions.filter((t) => serves(t.account));
}

function lineRow(t: Transaction, linked: boolean, toggle: () => void): HTMLElement {
  const label = document.createElement("label");
  label.className = "grant-line";
  const box = document.createElement("input");
  box.type = "checkbox";
  box.checked = linked;
  box.addEventListener("change", toggle);
  const what = [t.otherParty.trim(), t.particulars.trim(), t.reference.trim()].filter((x) => x !== "").join(" · ");
  label.append(box, ` ${t.date}  ${what}  `);
  const amount = document.createElement("strong");
  amount.textContent = money(t.amount);
  label.append(amount);
  return label;
}

/** The lines to tick: those linked here, then the loose ones near the grant's dates. */
function linkPanel(grant: Grant, entity: Entity | undefined): HTMLElement {
  const box = document.createElement("div");
  box.className = "grant-link-panel";
  const links = state.ledger.grantLinks ?? {};
  const all = linesFor(entity);

  const change = (id: string, to: string | null, what: string): void => {
    const next = { ...links };
    if (to === null) delete next[id];
    else next[id] = to;
    void saveGrants(state.ledger.grants ?? [], next, what);
  };

  const search = input("text", finding);
  search.placeholder = "Find a line: a name, a word or an amount";
  search.addEventListener("input", () => {
    finding = search.value;
  });
  search.addEventListener("keydown", (event) => {
    if (event.key === "Enter") redraw("grants");
  });
  const go = document.createElement("button");
  go.type = "button";
  go.textContent = "Find";
  go.addEventListener("click", () => redraw("grants"));
  const finder = document.createElement("div");
  finder.className = "page-actions";
  finder.append(search, go);
  box.append(finder);

  const needle = finding.trim().toLowerCase();
  const matches = (t: Transaction): boolean =>
    needle === "" ||
    `${t.otherParty} ${t.particulars} ${t.reference} ${(t.amount / 100).toFixed(2)} ${t.date}`.toLowerCase().includes(needle);

  const mine = all.filter((t) => links[t.id] === grant.id).sort((a, b) => b.date.localeCompare(a.date));
  const start = new Date(`${grant.from ?? taxYearEnd(taxYearOf(today()) - 1)}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - (grant.from === undefined ? 0 : 60));
  const earliest = start.toISOString().slice(0, 10);
  const loose = all
    .filter((t) => links[t.id] === undefined && t.date >= earliest && matches(t))
    .sort((a, b) => b.date.localeCompare(a.date));

  const section = (title: string, rows: Transaction[], linked: boolean, limit: number): void => {
    const h = document.createElement("h5");
    h.textContent = `${title} (${rows.length})`;
    box.append(h);
    for (const t of rows.slice(0, limit)) {
      box.append(
        lineRow(t, linked, () =>
          change(t.id, linked ? null : grant.id, `${linked ? "Unlinked" : "Linked"} from ${grant.funder}'s grant: ${t.otherParty}`),
        ),
      );
    }
    if (rows.length > limit) box.append(note(`${rows.length - limit} more. Type in the box to narrow them.`));
  };
  section("Linked to this grant", mine, true, 200);
  section("In: money received", loose.filter((t) => t.amount > 0), false, 25);
  section("Out: money spent", loose.filter((t) => t.amount < 0), false, 40);
  return box;
}

function reportBox(position: GrantPosition, entityName: string): HTMLElement {
  const box = document.createElement("div");
  box.className = "grant-report";
  const rows = grantReportRows(position, entityName, today());
  const table = document.createElement("table");
  table.className = "report-table";
  const body = document.createElement("tbody");
  for (const row of rows) {
    const tr = document.createElement("tr");
    if (row.length === 0) {
      tr.append(document.createElement("td"));
    } else if (row.length <= 2) {
      tr.append(nameCell(row[0] ?? ""), amountCell(row[1] ?? ""));
    } else {
      for (const cell of row) tr.append(nameCell(cell));
    }
    body.append(tr);
  }
  table.append(body);
  const wrap = document.createElement("div");
  wrap.className = "table-scroll";
  wrap.append(table);
  const save = document.createElement("button");
  save.type = "button";
  save.textContent = "Download for the funder (CSV)";
  save.addEventListener("click", () => {
    const text = rows.map((row) => row.map((cell) => spreadsheetCell(cell)).join(",")).join("\r\n");
    const slug = `${position.grant.funder}-${position.grant.purpose}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 50);
    download(text, `grant-report-${slug}.csv`, "text/csv");
  });
  const sent = document.createElement("button");
  sent.type = "button";
  sent.textContent = position.grant.reported === undefined ? "Mark as reported today" : "Reported " + position.grant.reported;
  sent.disabled = position.grant.reported !== undefined;
  sent.addEventListener("click", () => {
    const grants = (state.ledger.grants ?? []).map((g) => (g.id === position.grant.id ? { ...g, reported: today() } : g));
    void saveGrants(grants, state.ledger.grantLinks ?? {}, `Reported to ${position.grant.funder}`);
  });
  const actions = document.createElement("div");
  actions.className = "migration-actions";
  actions.append(save, sent);
  box.append(wrap, actions);
  return box;
}

function card(position: GrantPosition, entities: Entity[]): HTMLElement {
  const { grant } = position;
  const entity = entities.find((e) => e.id === grant.entityId);
  const box = document.createElement("div");
  box.className = "journal-card";

  const title = document.createElement("p");
  title.className = "journal-narration";
  title.textContent = `${grant.funder}: ${grant.purpose}` + (entities.length > 1 ? ` (${entity?.name ?? "?"})` : "");
  box.append(title);

  const figures = document.createElement("p");
  figures.textContent =
    `Awarded $${money(grant.amount)} · received $${money(position.received)} · spent $${money(position.spent)} · ` +
    `held $${money(position.held)}` +
    (position.awaiting > 0 ? ` · still to come $${money(position.awaiting)}` : "");
  box.append(figures);
  if (grant.from !== undefined || grant.to !== undefined) {
    box.append(note(`Covers ${grant.from ?? "…"} to ${grant.to ?? "…"}.` + (grant.conditional ? " Has to be returned if not used for its purpose." : "")));
  } else if (grant.conditional) {
    box.append(note("Has to be returned if not used for its purpose."));
  }
  if (grant.conditions !== undefined) box.append(note(grant.conditions));
  if (grant.reportDue !== undefined) {
    const late = grant.reported === undefined && grant.reportDue < today();
    const said = document.createElement("p");
    said.className = late ? "journal-out" : "";
    said.textContent =
      grant.reported !== undefined
        ? `Reported ${grant.reported}.`
        : `Report due ${grant.reportDue}${late ? ": overdue" : ""}.`;
    box.append(said);
  }

  const actions = document.createElement("div");
  actions.className = "migration-actions";
  const button = (label: string, act: () => void): HTMLButtonElement => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.addEventListener("click", act);
    actions.append(b);
    return b;
  };
  button(linking === grant.id ? "Done linking" : "Link bank lines", () => {
    linking = linking === grant.id ? null : grant.id;
    finding = "";
    redraw("grants");
  });
  button(reporting.has(grant.id) ? "Hide the funder's report" : "Funder's report", () => {
    if (reporting.has(grant.id)) reporting.delete(grant.id);
    else reporting.add(grant.id);
    redraw("grants");
  });
  button("Edit", () => {
    editing = { ...grant };
    redraw("grants");
  });
  button(grantOpen(grant) ? "Finished with it" : "Reopen", () => {
    const grants = (state.ledger.grants ?? []).map((g) => {
      if (g.id !== grant.id) return g;
      const { closed: _was, ...rest } = g;
      return grantOpen(g) ? { ...rest, closed: today() } : rest;
    });
    void saveGrants(grants, state.ledger.grantLinks ?? {}, `${grantOpen(grant) ? "Finished" : "Reopened"}: ${grant.funder}, ${grant.purpose}`);
  });
  button("Remove", () => {
    if (!confirm(`Remove the grant from ${grant.funder}? The bank lines and the books are not touched.`)) return;
    const links = Object.fromEntries(Object.entries(state.ledger.grantLinks ?? {}).filter(([, id]) => id !== grant.id));
    void saveGrants((state.ledger.grants ?? []).filter((g) => g.id !== grant.id), links, `Grant removed: ${grant.funder}`);
  });
  box.append(actions);

  if (linking === grant.id) box.append(linkPanel(grant, entity));
  if (reporting.has(grant.id)) box.append(reportBox(position, entity?.name ?? ""));
  return box;
}

/** The chart's accounts for a grant's year-end entry, found by name, preferring the entity's own. */
function accountsFor(entity: Entity | undefined): { income: string; inAdvance: string } | null {
  const owned = (state.ledger.entities ?? emptyEntityModel()).accounts;
  const find = (name: RegExp, type?: RegExp): Account | undefined => {
    const fits = state.chart.filter((a) => name.test(a.name) && (type === undefined || type.test(a.type)));
    return fits.find((a) => entity !== undefined && owned[accountEntityKey(a)] === entity.id) ?? fits[0];
  };
  const income = find(/^grants$/i, /revenue|income/i);
  const inAdvance = find(/grants received in advance|grants? in advance|income in advance/i);
  return income === undefined || inAdvance === undefined
    ? null
    : { income: accountLabel(income.code, income.name), inAdvance: accountLabel(inAdvance.code, inAdvance.name) };
}

/**
 * For the last year end: each grant with conditions that still held money,
 * and a button to post the entry and its reversal -- unless it has been.
 */
function yearEndBox(positions: GrantPosition[], entities: Entity[]): HTMLElement | null {
  const balance = taxYearEnd(taxYearOf(today()) - 1);
  if (balance >= today()) return null;
  const posted = new Set((state.ledger.manualJournals ?? []).map((j) => j.id));
  const due = positions
    .filter((p) => grantOpen(p.grant) && p.grant.conditional)
    .map((p) => {
      const entity = entities.find((e) => e.id === p.grant.entityId);
      const at = grantPosition(p.grant, state.ledger.grantLinks ?? {}, state.ledger.transactions, balance);
      return { grant: p.grant, entity, amount: unspentForBooks(at, entity?.gstRegistered === true) };
    })
    .filter((x) => x.amount > 0 && !posted.has(`grant-${x.grant.id}-${balance}`));
  if (due.length === 0) return null;

  const box = document.createElement("div");
  box.className = "journal-card";
  const title = document.createElement("p");
  title.className = "journal-narration";
  title.textContent = `Unspent grants with conditions at ${taxYearEndSaid(taxYearOf(balance))}`;
  box.append(title);
  box.append(
    note(
      "What was unspent on balance date is a liability, not income. Posting moves it out of Grants into " +
        "Grants received in advance, and reverses it the next day. Skip this if you report on the cash basis.",
    ),
  );
  for (const x of due) {
    const accounts = accountsFor(x.entity);
    const row = document.createElement("p");
    row.append(`${x.grant.funder}: ${x.grant.purpose} — $${money(x.amount)} `);
    if (accounts === null) {
      row.append("(add the Grants and Grants received in advance accounts first, under Entities & accounts)");
    } else {
      const post = document.createElement("button");
      post.type = "button";
      post.textContent = "Post the entry";
      post.addEventListener("click", () => {
        const entries = grantYearEnd(x.grant, x.amount as Cents, balance, accounts, dayAfter(balance));
        if (entries === null) return;
        const mine = new Set(entries.map((e) => e.id));
        const kept = (state.ledger.manualJournals ?? []).filter((j) => !mine.has(j.id));
        void saveManualJournals([...kept, ...entries], `Unspent grant at year end: ${x.grant.funder}`);
        redraw("grants");
      });
      row.append(post);
    }
    box.append(row);
  }
  return box;
}

export function renderGrantsPage(): void {
  const body = $("grants-body");
  body.textContent = "";
  const entities = nonProfits();
  if (entities.length === 0) {
    body.append(note("No not-for-profit organisations. On Entities & accounts, add one: a charity, society or club."));
    return;
  }
  const asAt = today();
  const grants = state.ledger.grants ?? [];
  const links = state.ledger.grantLinks ?? {};
  const shown = grants.filter((g) => state.entityFilter === "" || g.entityId === state.entityFilter);
  const positions = shown.map((g) => grantPosition(g, links, state.ledger.transactions, asAt));

  const actions = document.createElement("div");
  actions.className = "page-actions";
  const add = document.createElement("button");
  add.type = "button";
  add.className = "primary";
  add.textContent = "Add a grant";
  add.disabled = editing !== null;
  add.addEventListener("click", () => {
    const first = entities.find((e) => e.id === state.entityFilter) ?? entities[0];
    editing = { id: `g${Date.now().toString(36)}`, entityId: first?.id ?? "", funder: "", purpose: "", amount: 0, conditional: false };
    redraw("grants");
  });
  actions.append(add);
  body.append(actions);
  if (editing !== null) body.append(editor(editing, entities));

  const yearEnd = yearEndBox(positions, entities);
  if (yearEnd !== null) body.append(yearEnd);

  const left = endedWithMoneyLeft(shown, links, state.ledger.transactions, asAt);
  for (const p of left) {
    body.append(note(`${p.grant.funder}'s grant for ${p.grant.purpose} ended ${p.grant.to} with $${money(p.held)} still held. Check what the funder wants done with it.`));
  }

  if (shown.length === 0) {
    body.append(note("No grants yet. Add one with its funder, purpose and amount, then link the bank lines that brought it in and the lines that spent it."));
    return;
  }
  for (const p of positions.filter((x) => grantOpen(x.grant))) body.append(card(p, entities));
  const done = positions.filter((x) => !grantOpen(x.grant));
  if (done.length > 0) {
    const h = document.createElement("h3");
    h.textContent = "Finished grants";
    body.append(h);
    for (const p of done) body.append(card(p, entities));
  }
  body.append(
    note(
      "Grants are coded to the Grants account in Reconcile as they arrive. This register links them to the " +
        "lines that spent them, so a funder can be shown what became of its money.",
    ),
  );
}
