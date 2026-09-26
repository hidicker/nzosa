import { redraw } from "../app.js";
import {
  postedJournals,
  prepaymentsFor,
  record,
  reclassify,
  vehicleAdjustments,
} from "../books.js";
import { state } from "../state.js";
import { savePart } from "../store.js";
import { amountCell, nameCell, note } from "../ui.js";
import { E12_ROWS, KILOMETRE_RATES, NOT_IN_E12, NO_LOGBOOK_LIMIT, emptyEntityModel } from "@nzosa/core";
import type { Cents, Entity, PostedJournal, Prepayment, VehicleFuel, VehicleUse } from "@nzosa/core";

/**
 * Year-end adjustments: the private use of a vehicle, and prepayments.
 *
 * What is entered here is the facts -- a logbook's percentage, what a payment
 * covered -- and the journals are worked out from them and from the books
 * every time, so correcting a date corrects the journal. The arithmetic and
 * the rules are in core, where they are tested.
 */

function money(cents: Cents): string {
  const text = (Math.abs(cents) / 100).toLocaleString("en-NZ", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return cents < 0 ? `(${text})` : text;
}

function field(label: string, control: HTMLElement): HTMLLabelElement {
  const wrap = document.createElement("label");
  wrap.className = "year-end-field";
  wrap.append(label, " ", control);
  return wrap;
}

function select(options: { value: string; label: string }[], chosen: string): HTMLSelectElement {
  const pick = document.createElement("select");
  for (const one of options) {
    const option = document.createElement("option");
    option.value = one.value;
    option.textContent = one.label;
    option.selected = one.value === chosen;
    pick.append(option);
  }
  return pick;
}

function input(type: string, value: string): HTMLInputElement {
  const box = document.createElement("input");
  box.type = type;
  box.value = value;
  return box;
}

async function saveYearEnd(
  next: { vehicleUse?: VehicleUse[]; prepayments?: Prepayment[] },
  what: string,
): Promise<void> {
  const before = { vehicleUse: state.ledger.vehicleUse ?? [], prepayments: state.ledger.prepayments ?? [] };
  const after = { ...before, ...next };
  state.ledger = { ...state.ledger, ...after };
  state.persistent = await savePart(state.ledger);
  await record("yearEnd", what, before, after);
  reclassify();
  redraw("reports");
}

function journalTable(journal: PostedJournal): HTMLTableElement {
  const table = document.createElement("table");
  table.className = "report-table opening-table";
  const head = document.createElement("thead");
  head.innerHTML = "<tr><th>Account</th><th>Debit</th><th>Credit</th></tr>";
  const body = document.createElement("tbody");
  for (const line of journal.lines) {
    const tr = document.createElement("tr");
    tr.append(
      nameCell(`${line.accountCode} ${line.accountName}`),
      amountCell(line.amount > 0 ? money(line.amount) : ""),
      amountCell(line.amount < 0 ? money(-line.amount) : ""),
    );
    body.append(tr);
  }
  table.append(head, body);
  return table;
}

// --- vehicles ---------------------------------------------------------------

let vehicleDraft: VehicleUse | null = null;

function isExpense(type: string): boolean {
  return /expense|overhead|direct cost|depreciation/i.test(type);
}

function vehicleEditor(draft: VehicleUse, entities: Entity[], year: number): HTMLElement {
  const box = document.createElement("div");
  box.className = "journal-card";

  const entity = select(
    [{ value: "", label: "Choose…" }, ...entities.map((e) => ({ value: e.id, label: e.name }))],
    draft.entityId,
  );
  const percent = input("number", String(draft.businessPercent));
  percent.min = "0";
  percent.max = "100";
  percent.step = "1";
  const logbook = input("date", draft.logbookFrom ?? "");
  const equity = state.chart.filter((a) => /equity/i.test(a.type) || /drawings|current account/i.test(a.name));
  const counter = select(
    [{ value: "", label: "Choose…" }, ...equity.map((a) => ({ value: a.code, label: `${a.code} ${a.name}` }))],
    draft.counterCode,
  );

  const method = select(
    [
      { value: "actual", label: "Actual costs (fuel, repairs, insurance, depreciation)" },
      { value: "kilometre", label: "Inland Revenue's kilometre rates" },
    ],
    draft.method ?? "actual",
  );
  const businessKm = input("number", draft.businessKm !== undefined ? String(draft.businessKm) : "");
  const totalKm = input("number", draft.totalKm !== undefined ? String(draft.totalKm) : "");
  const fuelPick = select(
    [
      { value: "petrol", label: "Petrol" },
      { value: "diesel", label: "Diesel" },
      { value: "hybrid", label: "Petrol hybrid" },
      { value: "electric", label: "Electric" },
    ],
    draft.fuel ?? "petrol",
  );
  const held = KILOMETRE_RATES[year];
  const tier1 = input("number", draft.rates ? String(draft.rates.tier1) : "");
  const tier2 = input("number", draft.rates ? String(draft.rates.tier2) : "");
  const changed = input("checkbox", "");
  changed.checked = draft.changedSinceLogbook === true;
  const changedLabel = document.createElement("label");
  changedLabel.className = "year-end-field";
  changedLabel.append(changed, " Business use has changed by more than 20% since the logbook");

  const kmBox = document.createElement("div");
  kmBox.append(
    field("Business km in the year", businessKm),
    field("Total km in the year", totalKm),
    field("Fuel", fuelPick),
  );
  if (held === undefined) {
    kmBox.append(
      note(
        `Kilometre rates for the year to 31 March ${year} are not held yet (Inland Revenue ` +
          "publishes them after the year ends). Enter them in cents from its kilometre rates page.",
      ),
      field("Tier 1 c/km", tier1),
      field("Tier 2 c/km", tier2),
    );
  }
  kmBox.append(
    note(
      "With kilometre rates, the rate is the whole claim: actual vehicle costs, depreciation and " +
        "GST claimed on them are removed, and no GST can be claimed. Business km still need a " +
        "logbook; without one, no more than 25% counts.",
    ),
  );
  const percentField = field("Business use %", percent);
  const syncMethod = (): void => {
    const km = method.value === "kilometre";
    kmBox.hidden = !km;
    percentField.hidden = km;
  };
  method.addEventListener("change", syncMethod);
  syncMethod();

  box.append(
    field("Entity", entity),
    field("Method", method),
    percentField,
    kmBox,
    field("Logbook started", logbook),
    changedLabel,
    note(
      "A logbook kept for at least 90 consecutive days sets business use for three years, unless " +
        `use changes by more than 20%. Without one, no more than ${NO_LOGBOOK_LIMIT}% can be ` +
        "claimed (section DE 4).",
    ),
    field("Private share to", counter),
  );

  const accountsHeading = document.createElement("p");
  accountsHeading.textContent = "The vehicle's running-cost accounts:";
  box.append(accountsHeading);
  const chosen = new Set(draft.accounts);
  const checks: [string, HTMLInputElement][] = [];
  const list = document.createElement("div");
  list.className = "year-end-checks";
  for (const account of state.chart.filter((a) => a.code !== "" && isExpense(a.type))) {
    const tick = input("checkbox", "");
    tick.checked = chosen.has(account.code);
    checks.push([account.code, tick]);
    const label = document.createElement("label");
    label.append(tick, ` ${account.code} ${account.name}`);
    list.append(label);
  }
  box.append(list);

  const types = [...new Set((state.ledger.assets ?? []).map((a) => a.type.trim()).filter((t) => t !== ""))];
  const typeChecks: [string, HTMLInputElement][] = [];
  if (types.length > 0) {
    const p = document.createElement("p");
    p.textContent = "Its depreciation, by asset class on the register:";
    box.append(p);
    const typeList = document.createElement("div");
    typeList.className = "year-end-checks";
    const on = new Set(draft.assetTypes ?? []);
    for (const type of types) {
      const tick = input("checkbox", "");
      tick.checked = on.has(type);
      typeChecks.push([type, tick]);
      const label = document.createElement("label");
      label.append(tick, ` ${type}`);
      typeList.append(label);
    }
    box.append(typeList);
  }

  const trouble = document.createElement("p");
  trouble.className = "cloud-said";
  const actions = document.createElement("div");
  actions.className = "migration-actions";
  const save = document.createElement("button");
  save.type = "button";
  save.className = "primary";
  save.textContent = "Save";
  save.addEventListener("click", () => {
    const km = method.value === "kilometre";
    const business = km ? 0 : Number(percent.value);
    const bKm = Number(businessKm.value);
    const tKm = Number(totalKm.value);
    const next: VehicleUse = {
      entityId: entity.value,
      year,
      businessPercent: business,
      ...(changed.checked ? { changedSinceLogbook: true } : {}),
      ...(km
        ? {
            method: "kilometre" as const,
            businessKm: bKm,
            totalKm: tKm,
            fuel: fuelPick.value as VehicleFuel,
            ...(held === undefined && tier1.value !== "" && tier2.value !== ""
              ? { rates: { tier1: Number(tier1.value), tier2: Number(tier2.value) } }
              : {}),
          }
        : {}),
      accounts: checks.filter(([, t]) => t.checked).map(([code]) => code),
      counterCode: counter.value,
      ...(logbook.value !== "" ? { logbookFrom: logbook.value } : {}),
      ...(typeChecks.some(([, t]) => t.checked)
        ? { assetTypes: typeChecks.filter(([, t]) => t.checked).map(([type]) => type) }
        : {}),
    };
    const problems = [
      next.entityId === "" ? "choose the entity" : "",
      !km && (!Number.isFinite(business) || business < 0 || business > 100)
        ? "business use is a percentage, 0 to 100"
        : "",
      km && !(tKm > 0 && bKm >= 0 && bKm <= tKm) ? "give business and total km, business no more than total" : "",
      next.accounts.length === 0 && (next.assetTypes ?? []).length === 0 ? "tick at least one account" : "",
      next.counterCode === "" ? "choose where the private share goes" : "",
    ].filter((p) => p !== "");
    if (problems.length > 0) {
      trouble.textContent = `Not saved: ${problems.join("; ")}.`;
      return;
    }
    const others = (state.ledger.vehicleUse ?? []).filter(
      (u) => !(u.entityId === draft.entityId && u.year === draft.year) && !(u.entityId === next.entityId && u.year === year),
    );
    vehicleDraft = null;
    const name = entities.find((e) => e.id === next.entityId)?.name ?? next.entityId;
    void saveYearEnd(
      { vehicleUse: [...others, next] },
      km
        ? `${name}: vehicle on kilometre rates, ${bKm} of ${tKm} km, ${year}`
        : `${name}: vehicle ${business}% business, ${year}`,
    );
  });
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", () => {
    vehicleDraft = null;
    redraw("reports");
  });
  actions.append(save, cancel);
  box.append(actions, trouble);
  return box;
}

function renderVehicles(body: HTMLElement, year: number, posted: readonly PostedJournal[]): void {
  const model = state.ledger.entities ?? emptyEntityModel();
  const entities = model.entities.filter((e) => e.kind !== "personal");

  const heading = document.createElement("h3");
  heading.textContent = "Vehicle private use";
  body.append(heading);
  body.append(
    note(
      "For a vehicle used partly privately, code its costs in full through the year. At balance " +
        "date the private share moves to drawings, and the GST claimed on it is returned in Box 9 " +
        "of the return covering 31 March.",
    ),
  );

  const actions = document.createElement("div");
  actions.className = "page-actions";
  const add = document.createElement("button");
  add.type = "button";
  add.textContent = "Add a vehicle";
  add.disabled = vehicleDraft !== null;
  add.addEventListener("click", () => {
    const drawings = state.chart.find((a) => /drawings/i.test(a.name));
    vehicleDraft = {
      entityId: entities.length === 1 ? (entities[0]?.id ?? "") : "",
      year,
      businessPercent: NO_LOGBOOK_LIMIT,
      accounts: state.chart
        .filter((a) => isExpense(a.type) && /vehicle|motor|fuel/i.test(a.name))
        .map((a) => a.code),
      counterCode: drawings?.code ?? "",
    };
    redraw("reports");
  });
  actions.append(add);
  body.append(actions);
  if (vehicleDraft !== null) body.append(vehicleEditor(vehicleDraft, entities, year));

  const inYear = vehicleAdjustments(posted).filter(({ use }) => use.year === year);
  if (inYear.length === 0) {
    body.append(note("None entered for this year."));
    return;
  }
  for (const { use, result } of inYear) {
    const entity = model.entities.find((e) => e.id === use.entityId);
    const card = document.createElement("div");
    card.className = "journal-card";
    const title = document.createElement("p");
    title.className = "journal-narration";
    title.textContent =
      `${entity?.name ?? use.entityId}: ${result.businessPercent}% business` +
      (use.method === "kilometre" ? " on kilometre rates" : "") +
      (use.logbookFrom ? `, logbook from ${use.logbookFrom}` : ", no logbook");
    card.append(title);
    const company =
      entity !== undefined &&
      ((entity.shareholders ?? []).length > 0 ||
        ((entity.owners ?? []).length === 0 && (entity.kind ?? "business") === "business"));
    if (company) {
      card.append(
        note(
          "This entity appears to be a company. Private use of a company vehicle by a " +
            "shareholder-employee is normally taxed through FBT, and this adjustment is not made. " +
            "Use it only if the company opted out of FBT: a close company with one or two such " +
            "vehicles and no other fringe benefits, electing in writing with the income tax return " +
            "for the year the vehicle was bought or first used for business, by that return's due date.",
        ),
      );
    }
    for (const said of result.notes) card.append(note(said));
    if (result.journal === null) {
      card.append(note("Nothing to adjust: no private share, or nothing coded to these accounts this year."));
    } else {
      card.append(journalTable(result.journal));
      card.append(note(`Box 9 of the return covering ${year}-03-31: ${money(result.privateGst)}.`));
    }
    const row = document.createElement("div");
    row.className = "migration-actions";
    const edit = document.createElement("button");
    edit.type = "button";
    edit.textContent = "Edit";
    edit.addEventListener("click", () => {
      vehicleDraft = { ...use };
      redraw("reports");
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => {
      const rest = (state.ledger.vehicleUse ?? []).filter((u) => u !== use);
      void saveYearEnd({ vehicleUse: rest }, `${entity?.name ?? use.entityId}: vehicle for ${year} removed`);
    });
    row.append(edit, remove);
    card.append(row);
    body.append(card);
  }
}

// --- prepayments --------------------------------------------------------------

let prepaymentDraft: boolean = false;

/** Lines coded to an expense in the year, largest first -- the payments that could be prepaid. */
function candidates(posted: readonly PostedJournal[], year: number) {
  const from = `${year - 1}-04-01`;
  const to = `${year}-03-31`;
  const expense = new Set(state.chart.filter((a) => isExpense(a.type)).map((a) => a.code));
  const out: { transactionId: string; code: string; label: string; amount: Cents }[] = [];
  for (const journal of posted) {
    if (journal.source === "adjustment" || journal.source === "depreciation") continue;
    if (journal.date < from || journal.date > to) continue;
    for (const line of journal.lines) {
      if (!expense.has(line.accountCode) || line.amount < 10_000) continue;
      out.push({
        transactionId: journal.transactionId,
        code: line.accountCode,
        amount: line.amount,
        label: `${journal.date} — ${journal.narration} — ${line.accountCode} ${line.accountName} — ${money(line.amount)}`,
      });
    }
  }
  return out.sort((a, b) => b.amount - a.amount).slice(0, 300);
}

function prepaymentEditor(posted: readonly PostedJournal[], year: number): HTMLElement {
  const box = document.createElement("div");
  box.className = "journal-card";
  const lines = candidates(posted, year);
  const payment = select(
    [{ value: "", label: "Choose the payment…" }, ...lines.map((l, i) => ({ value: String(i), label: l.label }))],
    "",
  );
  const from = input("date", "");
  const to = input("date", "");
  const category = select(
    [
      ...E12_ROWS.map((r) => ({ value: r.id, label: `(${r.id}) ${r.label}` })),
      { value: NOT_IN_E12, label: "None of these" },
    ],
    NOT_IN_E12,
  );
  const description = input("text", "");
  description.placeholder = "e.g. Business insurance, 12 months";
  box.append(
    field("Payment", payment),
    field("Covers from", from),
    field("to", to),
    field("Kind (Determination E12)", category),
    field("Description", description),
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
    const line = lines[Number(payment.value)];
    const problems = [
      payment.value === "" || line === undefined ? "choose the payment" : "",
      from.value === "" || to.value === "" ? "give the period it covers" : "",
      from.value !== "" && to.value !== "" && to.value < from.value ? "the period ends before it starts" : "",
    ].filter((p) => p !== "");
    if (problems.length > 0 || line === undefined) {
      trouble.textContent = `Not saved: ${problems.join("; ")}.`;
      return;
    }
    const next: Prepayment = {
      id: `p${Date.now().toString(36)}`,
      transactionId: line.transactionId,
      accountCode: line.code,
      from: from.value,
      to: to.value,
      category: category.value,
      ...(description.value.trim() !== "" ? { description: description.value.trim() } : {}),
    };
    prepaymentDraft = false;
    void saveYearEnd(
      { prepayments: [...(state.ledger.prepayments ?? []), next] },
      `Prepayment: ${next.description ?? line.label}`,
    );
  });
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", () => {
    prepaymentDraft = false;
    redraw("reports");
  });
  actions.append(save, cancel);
  box.append(actions, trouble);
  return box;
}

function renderPrepayments(body: HTMLElement, year: number, posted: readonly PostedJournal[]): void {
  const heading = document.createElement("h3");
  heading.textContent = "Prepayments";
  body.append(heading);
  body.append(
    note(
      "For payments covering a period past 31 March, such as a year's insurance paid in " +
        "January. The unused part is carried to next year (section EA 3) unless Determination " +
        "E12 exempts it; most small or short prepayments are claimed when paid. Choose the " +
        "payment, period and kind to work out the adjustment.",
    ),
  );
  const actions = document.createElement("div");
  actions.className = "page-actions";
  const add = document.createElement("button");
  add.type = "button";
  add.textContent = "Add a prepayment";
  add.disabled = prepaymentDraft;
  add.addEventListener("click", () => {
    prepaymentDraft = true;
    redraw("reports");
  });
  actions.append(add);
  body.append(actions);
  if (prepaymentDraft) body.append(prepaymentEditor(posted, year));

  const result = prepaymentsFor(posted, year);
  for (const said of result.notes) body.append(note(said));
  if (result.lines.length === 0) {
    body.append(note("None running past this balance date."));
    return;
  }
  const table = document.createElement("table");
  table.className = "report-table";
  table.innerHTML =
    "<thead><tr><th>Prepayment</th><th>Covers</th><th>Deducted</th><th>Unused at 31 March</th><th>Treatment</th><th></th></tr></thead>";
  const tbody = document.createElement("tbody");
  for (const line of result.lines) {
    const tr = document.createElement("tr");
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => {
      const rest = (state.ledger.prepayments ?? []).filter((p) => p.id !== line.prepayment.id);
      void saveYearEnd({ prepayments: rest }, `Prepayment removed: ${line.prepayment.description ?? line.prepayment.id}`);
    });
    const cell = document.createElement("td");
    cell.append(remove);
    tr.append(
      nameCell(line.prepayment.description ?? line.prepayment.accountCode),
      nameCell(`${line.prepayment.from} to ${line.prepayment.to}`),
      amountCell(money(line.amount)),
      amountCell(money(line.unexpired)),
      nameCell(line.excusedBy ?? "Added back, and claimed on 1 April"),
      cell,
    );
    tbody.append(tr);
  }
  table.append(tbody);
  body.append(table);
  for (const journal of result.journals) {
    const title = document.createElement("p");
    title.className = "journal-narration";
    title.textContent = `${journal.date}: ${journal.narration}`;
    body.append(title, journalTable(journal));
  }
}

/** The page, for one income year. */
export function renderYearEnd(body: HTMLElement, year: number): void {
  const heading = document.createElement("h3");
  heading.textContent = `Year-end adjustments, year ended 31 March ${year}`;
  body.append(heading);
  const posted = postedJournals();
  renderVehicles(body, year, posted);
  renderPrepayments(body, year, posted);
}
