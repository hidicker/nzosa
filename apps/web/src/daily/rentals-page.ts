import { redraw } from "../app.js";
import { postedJournals, record } from "../books.js";
import { $, state } from "../state.js";
import { savePart } from "../store.js";
import { amountCell, nameCell, note } from "../ui.js";
import { accountEntityKey, bondStatus, emptyEntityModel, parseAmount, rentOn, rentPosition, rentSources } from "@nzosa/core";
import type { Account, Cents, Entity, IsoDate, RentFrequency, RentSource, Tenancy } from "@nzosa/core";
import { tripsPanel } from "./vehicle-trips-panel.js";
import { propertyCarePanel } from "./property-care-panel.js";
import { vehiclesBox } from "./rental-year-end.js";
import { taxYearEndSaid, taxYearOf } from "../tax-year.js";
import { booksLocale, moneyPlaces } from "../country.js";

/**
 * Rental information: each tenancy's rent, its changes and its bond, and
 * whether the tenants are behind or ahead.
 *
 * Beside the books rather than in them. Nothing here posts: what was due is
 * worked out from the tenancy, what was paid is read from the rent account,
 * and the two are set against each other.
 */

let editing: Tenancy | null = null;

function money(cents: Cents): string {
  const text = (Math.abs(cents) / 100).toLocaleString(booksLocale(), {
    minimumFractionDigits: moneyPlaces(),
    maximumFractionDigits: moneyPlaces(),
  });
  return cents < 0 ? `(${text})` : text;
}

function rentals(): Entity[] {
  const model = state.ledger.entities ?? emptyEntityModel();
  return model.entities.filter((e) => e.kind === "residential" || e.kind === "commercial");
}

/** Whether the menu should offer the page at all. */
export function hasRentals(): boolean {
  return rentals().length > 0;
}

async function saveTenancies(next: Tenancy[], what: string): Promise<void> {
  const before = state.ledger.tenancies ?? [];
  state.ledger = { ...state.ledger, tenancies: next };
  state.persistent = await savePart(state.ledger);
  await record("tenancies", what, before, next);
  redraw("tenancies");
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

/**
 * The income accounts a property's rent can be coded to: its own, where the
 * chart says which are whose, or every income account where it does not.
 */
function incomeAccounts(entityId: string): Account[] {
  const income = state.chart.filter((a) => a.code !== "" && /revenue|income|sales/i.test(a.type));
  const owners = (state.ledger.entities ?? emptyEntityModel()).accounts;
  const own = income.filter((a) => owners[accountEntityKey(a)] === entityId);
  return own.length > 0 ? own : income;
}

const dollars = (c: Cents | undefined): string => (c === undefined || c === 0 ? "" : (c / 100).toFixed(2));

function editor(draft: Tenancy, entities: Entity[]): HTMLElement {
  const box = document.createElement("div");
  box.className = "journal-card";

  const entity = document.createElement("select");
  for (const e of entities) {
    const option = document.createElement("option");
    option.value = e.id;
    option.textContent = e.name;
    option.selected = e.id === draft.entityId;
    entity.append(option);
  }
  const tenant = input("text", draft.tenant);
  tenant.placeholder = "Tenant's name";
  const start = input("date", draft.start);
  const end = input("date", draft.end ?? "");
  const frequency = document.createElement("select");
  for (const [value, caption] of [
    ["weekly", "Weekly"],
    ["fortnightly", "Fortnightly"],
    ["monthly", "Monthly"],
  ] as const) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = caption;
    option.selected = draft.frequency === value;
    frequency.append(option);
  }

  // The rent from the start of the tenancy, then each change with the day it
  // starts. The first has no date of its own: it runs from the tenancy start.
  const rentRows = document.createElement("div");
  const rents = draft.rents.length > 0
    ? [...draft.rents].sort((a, b) => a.from.localeCompare(b.from))
    : [{ from: draft.start, amount: 0 }];
  const rentInputs: [HTMLInputElement, HTMLInputElement][] = [];
  const drawRents = (): void => {
    rentRows.textContent = "";
    rentInputs.length = 0;
    rents.forEach((r, i) => {
      const from = input("date", r.from);
      const amount = input("text", dollars(r.amount));
      amount.placeholder = "0.00";
      amount.className = "payroll-tiny-input";
      rentInputs.push([from, amount]);
      const row = document.createElement("div");
      if (i === 0) row.append(field("Rent per period $", amount));
      else row.append(field("Changed from", from), field("to $", amount));
      rentRows.append(row);
    });
  };
  drawRents();
  const addChange = document.createElement("button");
  addChange.type = "button";
  addChange.textContent = "Add a change of rent";
  addChange.addEventListener("click", () => {
    rentInputs.forEach(([f, a], i) => (rents[i] = { from: f.value, amount: parseAmount(a.value) ?? 0 }));
    rents.push({ from: "", amount: 0 });
    drawRents();
  });

  const bondAmount = input("text", dollars(draft.bond?.amount));
  bondAmount.placeholder = "0.00";
  const bondPaid = input("date", draft.bond?.paidOn ?? "");
  const bondLodged = input("date", draft.bond?.lodgedOn ?? "");
  const bondRef = input("text", draft.bond?.reference ?? "");
  bondRef.placeholder = "Bond number";

  // Where the rent comes from: a line per person paying, each its account AND
  // every word it gives. One account to a line, so a line saved with several
  // becomes several lines -- the same payments either way.
  const lines: RentSource[] = rentSources(draft).flatMap((source) =>
    (source.accounts.length > 0 ? source.accounts : [""]).map((code) => ({
      accounts: code === "" ? [] : [code],
      ...(source.mentioning !== undefined ? { mentioning: source.mentioning } : {}),
    })),
  );
  if (lines.length === 0) lines.push({ accounts: [] });
  const lineRows = document.createElement("div");
  const lineInputs: [HTMLSelectElement, HTMLInputElement][] = [];
  const readLines = (): void => {
    lineInputs.forEach(([code, words], i) => {
      lines[i] = {
        accounts: code.value === "" ? [] : [code.value],
        ...(words.value.trim() !== "" ? { mentioning: words.value.trim() } : {}),
      };
    });
  };
  const drawLines = (): void => {
    lineRows.textContent = "";
    lineInputs.length = 0;
    lines.forEach((line, i) => {
      const code = document.createElement("select");
      const none = document.createElement("option");
      none.value = "";
      none.textContent = "Choose the account";
      code.append(none);
      const offered = incomeAccounts(entity.value);
      const held = line.accounts[0];
      if (held !== undefined && !offered.some((a) => a.code === held)) {
        const kept = state.chart.find((a) => a.code === held);
        if (kept !== undefined) offered.unshift(kept);
      }
      for (const a of offered) {
        const option = document.createElement("option");
        option.value = a.code;
        option.textContent = `${a.code} ${a.name}`;
        option.selected = line.accounts[0] === a.code;
        code.append(option);
      }
      const words = input("text", line.mentioning ?? "");
      words.placeholder = i === 0 ? "e.g. SMITH, RENT (optional)" : "e.g. RIMU K";
      lineInputs.push([code, words]);
      const row = document.createElement("div");
      row.className = "rent-source";
      row.append(field(i === 0 ? "Rent is coded to" : "and rent coded to", code), field("AND mentioning", words));
      if (lines.length > 1) {
        const drop = document.createElement("button");
        drop.type = "button";
        drop.className = "link-button";
        drop.textContent = "\u2715";
        drop.title = "Remove this line";
        drop.addEventListener("click", () => {
          readLines();
          lines.splice(i, 1);
          drawLines();
        });
        row.append(drop);
      }
      lineRows.append(row);
    });
  };
  drawLines();
  // Another property, another set of accounts to choose from.
  entity.addEventListener("change", () => {
    readLines();
    drawLines();
  });
  const addLine = document.createElement("button");
  addLine.type = "button";
  addLine.textContent = "Add another person paying";
  addLine.addEventListener("click", () => {
    readLines();
    lines.push({ accounts: lines[0]?.accounts ?? [] });
    drawLines();
  });

  box.append(
    field("Property", entity),
    field("Tenant", tenant),
    field("Tenancy starts", start),
    field("Ended", end),
    field("Rent paid", frequency),
    rentRows,
    addChange,
    document.createElement("hr"),
    field("Bond $", bondAmount),
    field("Bond paid", bondPaid),
    field("Bond lodged", bondLodged),
    field("Bond number", bondRef),
    document.createElement("hr"),
    lineRows,
    addLine,
    note(
      "Rent is read from the account it is coded to, including rent a property manager " +
        "collected. Where the account holds more than one tenant, give words from this " +
        "tenant's payments: a payment must mention every word on its line (SMITH, RENT takes " +
        "Smith's rent and not Smith's other payments). Add a line for each other person who " +
        "pays rent for this tenancy. Rent paid up to 90 days before the tenancy starts counts " +
        "toward the first weeks.",
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
    const changes = rentInputs
      .map(([f, a], i) => ({ from: (i === 0 ? start.value : f.value) as IsoDate, amount: parseAmount(a.value) ?? 0 }))
      .filter((r) => r.from !== "" && r.amount > 0);
    readLines();
    const sources = lines.filter((line) => line.accounts.length > 0);
    const chosen = [...new Set(sources.flatMap((line) => line.accounts))];
    const problems = [
      tenant.value.trim() === "" ? "name the tenant" : "",
      start.value === "" ? "give the start date" : "",
      changes.length === 0 ? "give the rent" : "",
      chosen.length === 0 ? "choose the account rent is coded to" : "",
    ].filter((p) => p !== "");
    if (problems.length > 0) {
      trouble.textContent = `Not saved: ${problems.join("; ")}.`;
      return;
    }
    const bondCents = parseAmount(bondAmount.value) ?? 0;
    const next: Tenancy = {
      id: draft.id,
      entityId: entity.value,
      tenant: tenant.value.trim(),
      start: start.value,
      ...(end.value !== "" ? { end: end.value } : {}),
      frequency: frequency.value as RentFrequency,
      rents: changes,
      ...(bondCents > 0
        ? {
            bond: {
              amount: bondCents,
              ...(bondPaid.value !== "" ? { paidOn: bondPaid.value } : {}),
              ...(bondLodged.value !== "" ? { lodgedOn: bondLodged.value } : {}),
              ...(bondRef.value.trim() !== "" ? { reference: bondRef.value.trim() } : {}),
            },
          }
        : {}),
      accounts: chosen,
      sources,
    };
    const others = (state.ledger.tenancies ?? []).filter((t) => t.id !== next.id);
    editing = null;
    void saveTenancies([...others, next], `Tenancy: ${next.tenant}`);
  });
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", () => {
    editing = null;
    redraw("tenancies");
  });
  actions.append(save, cancel);
  box.append(actions, trouble);
  return box;
}

/** A tick and a date: the day the tenant was told they were behind. */
function toldBehind(t: Tenancy, asAt: IsoDate): HTMLElement {
  const wrap = document.createElement("label");
  wrap.className = "feed-auto";
  const box = document.createElement("input");
  box.type = "checkbox";
  box.checked = t.toldBehind !== undefined;
  const when = input("date", t.toldBehind ?? asAt);
  when.max = asAt;
  const store = (): void => {
    const { toldBehind: _old, ...rest } = t;
    const next: Tenancy = box.checked && when.value !== "" ? { ...rest, toldBehind: when.value } : rest;
    const others = (state.ledger.tenancies ?? []).map((x) => (x.id === t.id ? next : x));
    void saveTenancies(others, box.checked ? `Told ${t.tenant} they are behind, ${when.value}` : `Not told: ${t.tenant}`);
  };
  box.addEventListener("change", store);
  when.addEventListener("change", () => {
    if (box.checked) store();
  });
  wrap.append(box, " Tenant told they are behind, on ", when);
  return wrap;
}

const PERIOD_WORD: Record<RentFrequency, string> = { weekly: "week", fortnightly: "fortnight", monthly: "month" };

function card(t: Tenancy, entities: Entity[], asAt: IsoDate): HTMLElement {
  const box = document.createElement("div");
  box.className = "journal-card";
  const entity = entities.find((e) => e.id === t.entityId);
  const position = rentPosition(t, postedJournals(), asAt);

  const title = document.createElement("p");
  title.className = "journal-narration";
  const current = rentOn(t.rents, asAt);
  title.textContent =
    `${t.tenant} — ${entity?.name ?? "?"}: $${money(current)} a ${PERIOD_WORD[t.frequency]}, from ${t.start}` +
    (t.end ? ` to ${t.end}` : "");
  box.append(title);

  // The answer first.
  const verdict = document.createElement("p");
  const b = position.balance;
  const word = PERIOD_WORD[t.frequency];
  verdict.className = b > 0 ? "journal-out" : "rent-ok";
  verdict.textContent =
    b > 0
      ? `Behind by $${money(b)} — about ${position.periodsBehind} ${position.periodsBehind === 1 ? `${word}'s` : `${word}s'`} rent.`
      : b < 0
        ? `In advance by $${money(-b)} — about ${-position.periodsBehind} ${word}${position.periodsBehind === -1 ? "" : "s"}.`
        : "Up to date.";
  if (position.paidTo !== null) verdict.textContent += ` Paid to ${position.paidTo}.`;
  box.append(verdict);
  for (const said of position.notes) box.append(note(said));
  box.append(note(`Bond: ${bondStatus(t.bond, entity?.kind === "residential", asAt)}${t.bond ? ` $${money(t.bond.amount)}.` : ""}`));
  // Behind: whether the tenant has been told, and when.
  if (b > 0) box.append(toldBehind(t, asAt));

  // The table: newest first, each period's due, paid and running balance.
  const details = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = `Rent due and paid (${position.periods.length} ${word}s, $${money(position.totalDue)} due, $${money(position.totalPaid)} paid)`;
  details.append(summary);
  const table = document.createElement("table");
  table.className = "report-table";
  table.innerHTML = "<thead><tr><th>Due</th><th>Rent</th><th>Paid in period</th><th>Owing (in advance)</th></tr></thead>";
  const rows = document.createElement("tbody");
  for (const p of [...position.periods].reverse()) {
    const tr = document.createElement("tr");
    tr.append(nameCell(p.due), amountCell(money(p.amount)), amountCell(money(p.paid)), amountCell(money(p.balance)));
    rows.append(tr);
  }
  table.append(rows);
  details.append(table);
  box.append(details);

  const row = document.createElement("div");
  row.className = "migration-actions";
  const edit = document.createElement("button");
  edit.type = "button";
  edit.textContent = "Edit";
  edit.addEventListener("click", () => {
    editing = { ...t };
    redraw("tenancies");
  });
  const remove = document.createElement("button");
  remove.type = "button";
  remove.textContent = "Remove";
  remove.addEventListener("click", () => {
    if (!confirm(`Remove the tenancy for ${t.tenant}? The books are not touched.`)) return;
    void saveTenancies((state.ledger.tenancies ?? []).filter((x) => x.id !== t.id), `Tenancy removed: ${t.tenant}`);
  });
  row.append(edit, remove);
  box.append(row);
  return box;
}

/** Which properties are open, so saving does not fold the page up. */
const opened = new Set<string>();
let openedOnce = false;

function newTenancy(entityId: string, asAt: IsoDate): Tenancy {
  const rentAccount = incomeAccounts(entityId).find((a) => /rent/i.test(a.name));
  return {
    id: `t${Date.now().toString(36)}`,
    entityId,
    tenant: "",
    start: asAt,
    frequency: "weekly",
    rents: [],
    accounts: rentAccount ? [rentAccount.code] : [],
  };
}

/**
 * The tenancies page, property by property, as Rental year end is: each
 * property a heading with its tenancies, current then ended, and the trips
 * made to it in the owners' own cars this year.
 */
export function renderRentalsPage(): void {
  const body = $("tenancies-body");
  body.textContent = "";
  const entities = rentals();
  if (entities.length === 0) {
    body.append(note("No rental properties. On Entities & accounts, mark a property residential or commercial."));
    return;
  }
  const asAt = new Date().toISOString().slice(0, 10);
  const year = taxYearOf(asAt);
  const tenancies = state.ledger.tenancies ?? [];
  const shown = entities.filter((e) => state.entityFilter === "" || e.id === state.entityFilter);
  // Open to start with: every property with a current tenancy, or the only one.
  if (!openedOnce) {
    openedOnce = true;
    for (const e of shown) {
      const current = tenancies.some((t) => t.entityId === e.id && (t.end === undefined || t.end >= asAt));
      if (current || shown.length === 1) opened.add(e.id);
    }
  }

  for (const entity of shown) {
    const mine = tenancies.filter((t) => t.entityId === entity.id);
    const current = mine.filter((t) => t.end === undefined || t.end >= asAt);
    const past = mine.filter((t) => t.end !== undefined && t.end < asAt);

    const section = document.createElement("details");
    section.className = "rental-year";
    section.open = opened.has(entity.id) || editing?.entityId === entity.id;
    section.addEventListener("toggle", () => {
      if (section.open) opened.add(entity.id);
      else opened.delete(entity.id);
    });
    const summary = document.createElement("summary");
    const name = document.createElement("span");
    name.className = "rental-year-name";
    name.textContent = entity.name;
    const meta = document.createElement("span");
    meta.className = "rental-year-meta";
    const behind = current
      .map((t) => rentPosition(t, postedJournals(), asAt).balance)
      .filter((b) => b > 0)
      .reduce((sum, b) => sum + b, 0);
    meta.textContent =
      current.length === 0
        ? "no current tenancy"
        : current.map((t) => t.tenant).join(", ") + (behind > 0 ? ` · behind $${money(behind)}` : " · up to date");
    summary.append(name, meta);
    section.append(summary);

    const actions = document.createElement("div");
    actions.className = "page-actions";
    const add = document.createElement("button");
    add.type = "button";
    add.textContent = "Add a tenancy";
    add.disabled = editing !== null;
    add.addEventListener("click", () => {
      editing = newTenancy(entity.id, asAt);
      opened.add(entity.id);
      redraw("tenancies");
    });
    actions.append(add);
    section.append(actions);
    if (editing !== null && editing.entityId === entity.id) section.append(editor(editing, entities));

    if (mine.length === 0) section.append(note("No tenancies yet. Add one with its start date, rent and bond."));
    for (const t of current) section.append(card(t, entities, asAt));
    if (past.length > 0) {
      const h = document.createElement("h4");
      h.textContent = "Ended tenancies";
      section.append(h);
      for (const t of past) section.append(card(t, entities, asAt));
    }

    section.append(propertyCarePanel(entity.id, renderRentalsPage));
    const trips = document.createElement("h4");
    trips.textContent = `Trips to the property in your own vehicle, year to ${taxYearEndSaid(year)}`;
    section.append(vehiclesBox(year, renderRentalsPage), trips, tripsPanel(year, renderRentalsPage, entity.id));
    body.append(section);
  }
  // A tenancy for a property not shown -- the filter moved since -- is still drawn.
  if (editing !== null && !shown.some((e) => e.id === editing?.entityId)) body.append(editor(editing, entities));

  body.append(
    note(
      "Rent is due in advance on the first day of each period. A managed property is only as " +
        "current as its latest property manager statement.",
    ),
  );
}
