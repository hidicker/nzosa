import { redraw } from "../app.js";
import { postedJournals, record } from "../books.js";
import { $, state } from "../state.js";
import { savePart } from "../store.js";
import { amountCell, nameCell, note } from "../ui.js";
import { bondStatus, emptyEntityModel, parseAmount, rentOn, rentPosition } from "@nzosa/core";
import type { Cents, Entity, IsoDate, RentFrequency, Tenancy } from "@nzosa/core";

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
  const text = (Math.abs(cents) / 100).toLocaleString("en-NZ", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
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

  const accounts = document.createElement("select");
  accounts.multiple = true;
  accounts.size = 4;
  const income = state.chart.filter((a) => a.code !== "" && /revenue|income|sales/i.test(a.type));
  for (const a of income) {
    const option = document.createElement("option");
    option.value = a.code;
    option.textContent = `${a.code} ${a.name}`;
    option.selected = draft.accounts.includes(a.code);
    accounts.append(option);
  }
  const payer = input("text", draft.payer ?? "");
  payer.placeholder = "e.g. SMITH J (optional)";

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
    field("Rent is coded to", accounts),
    field("Only payments mentioning", payer),
    note(
      "Rent is read from the account the rent is coded to, including rent a property manager " +
        "collected. If one account holds more than one tenant, give words from this tenant's " +
        "payments (a name or reference); separate several with commas. Rent paid in advance up to " +
        "90 days before the tenancy starts is counted toward the first weeks.",
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
    const chosen = [...accounts.selectedOptions].map((o) => o.value);
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
      ...(payer.value.trim() !== "" ? { payer: payer.value.trim() } : {}),
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

export function renderRentalsPage(): void {
  const body = $("tenancies-body");
  body.textContent = "";
  const entities = rentals();
  if (entities.length === 0) {
    body.append(note("No rental properties. On Entities & accounts, mark a property residential or commercial."));
    return;
  }
  const asAt = new Date().toISOString().slice(0, 10);

  const actions = document.createElement("div");
  actions.className = "page-actions";
  const add = document.createElement("button");
  add.type = "button";
  add.className = "primary";
  add.textContent = "Add a tenancy";
  add.disabled = editing !== null;
  add.addEventListener("click", () => {
    const first = entities.find((e) => e.id === state.entityFilter) ?? entities[0];
    const rentAccount = state.chart.find(
      (a) => /rent/i.test(a.name) && /revenue|income|sales/i.test(a.type) && (first === undefined || true),
    );
    editing = {
      id: `t${Date.now().toString(36)}`,
      entityId: first?.id ?? "",
      tenant: "",
      start: asAt,
      frequency: "weekly",
      rents: [],
      accounts: rentAccount ? [rentAccount.code] : [],
    };
    redraw("tenancies");
  });
  actions.append(add);
  body.append(actions);
  if (editing !== null) body.append(editor(editing, entities));

  const all = (state.ledger.tenancies ?? []).filter(
    (t) => state.entityFilter === "" || t.entityId === state.entityFilter,
  );
  if (all.length === 0) {
    body.append(note("No tenancies yet. Add one with its start date, rent and bond."));
    return;
  }
  const current = all.filter((t) => t.end === undefined || t.end >= asAt);
  const past = all.filter((t) => t.end !== undefined && t.end < asAt);
  for (const t of current) body.append(card(t, entities, asAt));
  if (past.length > 0) {
    const h = document.createElement("h3");
    h.textContent = "Ended tenancies";
    body.append(h);
    for (const t of past) body.append(card(t, entities, asAt));
  }
  body.append(
    note(
      "Rent is due on the first day of each period, as it is paid in advance. A property " +
        "manager's statement posts its rent on the statement's last day, so a managed property is " +
        "only as current as its latest statement.",
    ),
  );
}
