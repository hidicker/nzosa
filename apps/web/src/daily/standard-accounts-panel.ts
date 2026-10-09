import { booksCountry } from "../country.js";
import { redraw } from "../app.js";
import { accountsForEditing, persistRules, reclassify, record } from "../books.js";
import { state } from "../state.js";
import { save, savePart } from "../store.js";
import {
  accountEntityKey,
  accountLabel,
  emptyEntityModel,
  isSuffix,
  renameAccount,
  standardAccounts,
  starterChartFor,
  suggestSuffix,
  suffixedCode,
} from "@nzosa/core";
import type { Account, Entity, EntityKind, EntityModel, RuleSet } from "@nzosa/core";
import type { RuleFileShape } from "../rules-ui.js";

/**
 * Standard accounts for an entity, chosen from a list rather than typed.
 *
 * Opened from the entity's row, and straight after an entity is added, since
 * that is when somebody needs them. The list is a preview: every account can
 * be left out, and one whose code is already in the chart is shown as there
 * rather than added twice.
 *
 * Two things it offers besides, both only when they apply:
 *
 *  * A new book starts with the standard business chart. For a person or a
 *    rental that is sixty-six accounts of noise, so while nothing is coded to
 *    it and it is still exactly as it arrived, it can go in the same step.
 *
 *  * With two or more entities, codes carry each entity's suffix -- 420MS --
 *    so two rentals can both have rates at 420. An entity set up while it was
 *    the only one has plain codes, and this offers to give them its suffix
 *    too, carrying the codings with them.
 */

/** The entity whose standard accounts are being chosen, if any. */
let openFor: string | null = null;

export function openStandardAccounts(entityId: string): void {
  openFor = entityId;
}

const KIND_NAME: Record<EntityKind, string> = {
  business: "business",
  residential: "residential rental",
  commercial: "commercial rental",
  personal: "person",
  nonprofit: "not-for-profit",
};

/** The chart is still the standard business chart exactly, and nothing uses it. */
function untouchedStarterChart(): boolean {
  const starter = starterChartFor(booksCountry().id);
  if (state.chart.length !== starter.length) return false;
  if (!state.chart.every((a, i) => a.code === starter[i]?.code && a.name === starter[i]?.name)) {
    return false;
  }
  const overrides = Object.values(state.ledger.overrides ?? {});
  return (
    !overrides.some((o) => (o.code ?? "") !== "") &&
    Object.keys(state.ledger.splits ?? {}).length === 0
  );
}

/** Suffixes other entities already use or would be given. */
function suffixesTaken(model: EntityModel, except: string): Set<string> {
  return new Set(
    model.entities
      .filter((e) => e.id !== except)
      .map((e) => e.codeSuffix ?? "")
      .filter((s) => s !== ""),
  );
}

export function standardPanel(model: EntityModel): HTMLElement | null {
  const entity = model.entities.find((e) => e.id === openFor);
  if (entity === undefined) {
    openFor = null;
    return null;
  }
  const kind = entity.kind ?? "business";
  const several = model.entities.length > 1;
  const taken = suffixesTaken(model, entity.id);

  const box = document.createElement("div");
  box.className = "account-add-form standard-accounts";
  const heading = document.createElement("h3");
  heading.textContent = `Standard accounts for ${entity.name}`;
  const intro = document.createElement("p");
  intro.className = "page-hint";
  intro.textContent =
    `The accounts a ${KIND_NAME[kind]} usually needs` +
    (kind === "residential" || kind === "commercial"
      ? ", matching the rental schedule's headings."
      : kind === "personal"
        ? ". Add more as you need them."
        : ".") +
    " Untick any you don't want.";
  box.append(heading, intro);

  // --- the suffix ---
  const suffix = document.createElement("input");
  suffix.type = "text";
  suffix.maxLength = 3;
  suffix.className = "suffix-input";
  suffix.value = entity.codeSuffix ?? (several ? suggestSuffix(entity.name, taken) : "");
  const suffixRow = document.createElement("label");
  suffixRow.className = "account-add-field suffix-field";
  const suffixCaption = document.createElement("span");
  suffixCaption.textContent = "Code suffix";
  const suffixHint = document.createElement("small");
  suffixHint.className = "field-hint";
  suffixHint.textContent = several
    ? "Added to each code to keep this entity's accounts separate: 420 becomes 420" +
      (suffix.value || "MS") +
      ". One to three capital letters."
    : "Needed only with more than one entity. Leave blank for plain codes.";
  suffixRow.append(suffixCaption, suffix, suffixHint);
  box.append(suffixRow);

  // --- replacing the business chart ---
  const replace = document.createElement("input");
  replace.type = "checkbox";
  const canReplace = kind !== "business" && untouchedStarterChart();
  replace.checked = canReplace;
  if (canReplace) {
    const wrap = document.createElement("label");
    wrap.className = "standard-replace";
    wrap.append(
      replace,
      document.createTextNode(
        ` Remove the standard business accounts (${state.chart.length}). Nothing is coded to them yet.`,
      ),
    );
    box.append(wrap);
  }

  // --- the list ---
  const table = document.createElement("table");
  table.className = "entity-table standard-table";
  const said = document.createElement("p");
  said.className = "cloud-said";
  let rows: { account: Account; tick: HTMLInputElement }[] = [];

  const draw = (): void => {
    const wanted = suffix.value.trim().toUpperCase();
    // Replacing takes the whole chart away, so nothing in it is "already there".
    const held = new Set(replace.checked && canReplace ? [] : state.chart.map((a) => a.code));
    table.textContent = "";
    table.innerHTML = "<thead><tr><th></th><th>Code</th><th>Name</th><th>Type</th><th>GST</th></tr></thead>";
    // Tick or untick every account not already in the chart at once.
    const all = document.createElement("input");
    all.type = "checkbox";
    all.title = "Tick or untick all";
    all.setAttribute("aria-label", "Tick or untick all");
    table.querySelector("th")?.append(all);
    const showAll = (): void => {
      const open = rows.filter((r) => !r.tick.disabled);
      const ticked = open.filter((r) => r.tick.checked).length;
      all.disabled = open.length === 0;
      all.checked = open.length > 0 && ticked === open.length;
      all.indeterminate = ticked > 0 && ticked < open.length;
    };
    all.addEventListener("change", () => {
      for (const r of rows) if (!r.tick.disabled) r.tick.checked = all.checked;
      showAll();
    });
    const tbody = document.createElement("tbody");
    rows = [];
    for (const account of standardAccounts(kind, {
      suffix: wanted,
      gstRegistered: entity.gstRegistered !== false,
    })) {
      const tr = document.createElement("tr");
      const tick = document.createElement("input");
      tick.type = "checkbox";
      const there = held.has(account.code);
      tick.checked = !there;
      tick.disabled = there;
      tick.addEventListener("change", () => showAll());
      const cells = [account.code, account.name, account.type, there ? "Already in the chart" : account.taxCode];
      const first = document.createElement("td");
      first.append(tick);
      tr.append(first);
      for (const text of cells) {
        const td = document.createElement("td");
        td.className = "entity-left";
        td.textContent = text;
        tr.append(td);
      }
      if (there) tr.className = "standard-there";
      tbody.append(tr);
      rows.push({ account, tick });
    }
    table.append(tbody);
    showAll();
  };
  suffix.addEventListener("input", () => {
    suffix.value = suffix.value.toUpperCase().replace(/[^A-Z]/g, "");
    draw();
  });
  replace.addEventListener("change", draw);
  draw();
  box.append(table);

  const add = document.createElement("button");
  add.type = "button";
  add.className = "primary";
  add.textContent = "Add the ticked accounts";
  add.addEventListener("click", () => {
    const wanted = suffix.value.trim();
    if (wanted !== "" && !isSuffix(wanted)) {
      said.textContent = "The suffix is one to three capital letters.";
      return;
    }
    if (several && wanted === "") {
      said.textContent = "With more than one entity, give this one a suffix so its codes stay separate.";
      return;
    }
    if (taken.has(wanted)) {
      said.textContent = `${wanted} is already another entity's suffix.`;
      return;
    }
    const chosen = rows.filter((r) => r.tick.checked && !r.tick.disabled).map((r) => r.account);
    add.disabled = true;
    void addStandard(entity, chosen, wanted, replace.checked && canReplace);
  });
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "Close";
  close.addEventListener("click", () => {
    openFor = null;
    redraw("entities");
  });
  const actions = document.createElement("div");
  actions.className = "migration-actions";
  actions.append(add, close);
  box.append(actions, said);

  // --- other entities' plain codes ---
  if (several) {
    for (const other of model.entities) {
      if (other.id === entity.id) continue;
      const offer = suffixOffer(model, other, new Set([...taken, suffix.value]));
      if (offer) box.append(offer);
    }
  }
  return box;
}

/**
 * Put the chosen accounts in the chart, assigned to the entity, as one change.
 *
 * The GST treatment comes with each account's tax code, the way a loaded
 * chart's does, so nothing else has to be set before coding to them.
 */
async function addStandard(
  entity: Entity,
  accounts: readonly Account[],
  suffix: string,
  replaceStarter: boolean,
): Promise<void> {
  const model = state.ledger.entities ?? emptyEntityModel();
  const assign: Record<string, string> = { ...model.accounts };
  let chart = [...state.chart];
  let removed = 0;
  if (replaceStarter) {
    // Assignments go first and by the old accounts' keys: the new accounts
    // share some of those codes, and must not inherit the old owner.
    for (const account of chart) delete assign[accountEntityKey(account)];
    removed = chart.length;
    chart = [];
    // And their GST settings, which a new book keeps in the rule file. Left
    // there, each is still an account by its label -- and a new account with
    // the same number takes that label, so Personal income at 200 became
    // "Sales - 200" at 15%.
    const file = state.rules as RuleFileShape | undefined;
    if (file?.codeTreatments !== undefined) {
      const gone = new Set(
        accountsForEditing()
          .filter((r) => state.chart.includes(r.account))
          .map((r) => r.label),
      );
      const codeTreatments = Object.fromEntries(
        Object.entries(file.codeTreatments).filter(([label]) => !gone.has(label)),
      );
      state.rules = { ...file, codeTreatments } as RuleSet;
      await persistRules();
    }
  }
  chart.push(...accounts);
  for (const account of accounts) assign[accountEntityKey(account)] = entity.id;

  const entities = model.entities.map((e) =>
    e.id !== entity.id ? e : suffix === "" ? e : { ...e, codeSuffix: suffix },
  );
  state.chart = chart;
  state.ledger = { ...state.ledger, chart, entities: { ...model, entities, accounts: assign } };
  state.persistent = await savePart(state.ledger, "chart", "entities");
  await record(
    "chart",
    `Added ${accounts.length} standard account${accounts.length === 1 ? "" : "s"} for ${entity.name}` +
      (removed > 0 ? `, replacing the ${removed} unused standard business accounts` : ""),
    null,
    accounts,
  );
  openFor = null;
  reclassify();
  redraw("entities");
}

/**
 * Give an entity an Accounts Payable account, for its bills to sit in.
 *
 * Coded as its other accounts are -- 800 with its suffix where the books keep
 * several entities -- and the next free 80x when that is taken. Returns the
 * code it was given.
 */
export async function addPayableFor(entity: Entity): Promise<string> {
  const model = state.ledger.entities ?? emptyEntityModel();
  const several = model.entities.length > 1;
  // The suffix the entity has, or the one its accounts already carry, or the
  // one the panel would have suggested.
  const carried = state.chart
    .filter((a) => model.accounts[accountEntityKey(a)] === entity.id)
    .map((a) => /^\d{3,4}([A-Z]{1,3})$/.exec(a.code.trim())?.[1])
    .find((s) => s !== undefined);
  const suffix =
    entity.codeSuffix ?? carried ?? (several ? suggestSuffix(entity.name, suffixesTaken(model, entity.id)) : "");
  const held = new Set(state.chart.map((a) => a.code.trim()));

  // An entity with no accounts at all gets its whole usual set, which holds
  // Accounts Payable. Adding the payable alone left it looking set up, and
  // Start here then stopped offering the rest.
  const hasAny = state.chart.some((a) => model.accounts[accountEntityKey(a)] === entity.id);
  if (!hasAny) {
    const usual = standardAccounts(entity.kind ?? "business", {
      suffix,
      gstRegistered: entity.gstRegistered !== false,
    }).filter((a) => !held.has(a.code.trim()));
    const payable = usual.find((a) => /accounts\s+payable/i.test(a.type));
    if (payable !== undefined) {
      await addStandard(entity, usual, suffix, false);
      return payable.code;
    }
  }

  let code = `800${suffix}`;
  for (let n = 801; held.has(code) && n <= 809; n++) code = `${n}${suffix}`;
  await addStandard(
    entity,
    [{
      code,
      name: "Accounts Payable",
      type: "Accounts Payable",
      taxCode: "No GST",
      description: "Approved bills not yet paid",
    }],
    suffix,
    false,
  );
  return code;
}

/**
 * Every listed entity's usual accounts, in one go, where Start here asks.
 *
 * The same accounts the panel offers, each entity with the suffix the panel
 * would suggest, and nothing that is already in the chart. The business
 * starter chart new books begin with is taken out only where no entity here
 * is a business -- otherwise it may be that business's chart -- and only
 * while nothing is coded to it. Four trips to another page and back become
 * one press.
 */
export async function addStandardForAll(entities: readonly Entity[]): Promise<number> {
  const model = state.ledger.entities ?? emptyEntityModel();
  const several = model.entities.length > 1;
  let replace =
    untouchedStarterChart() && model.entities.every((e) => (e.kind ?? "business") !== "business");
  let added = 0;
  for (const listed of entities) {
    const live = state.ledger.entities ?? emptyEntityModel();
    const entity = live.entities.find((e) => e.id === listed.id);
    if (entity === undefined) continue;
    const taken = suffixesTaken(live, entity.id);
    const suffix = entity.codeSuffix ?? (several ? suggestSuffix(entity.name, taken) : "");
    const held = new Set(replace ? [] : state.chart.map((a) => a.code));
    const accounts = standardAccounts(entity.kind ?? "business", {
      suffix,
      gstRegistered: entity.gstRegistered !== false,
    }).filter((a) => !held.has(a.code));
    if (accounts.length === 0) continue;
    await addStandard(entity, accounts, suffix, replace);
    replace = false;
    added += accounts.length;
  }
  return added;
}

/**
 * The offer to give another entity's plain codes its suffix.
 *
 * Only for what a rename carries -- codings, split parts, rules, GST
 * treatments and the entity assignment. An account named in a journal, an
 * opening balance, an invoice or a tenancy is left alone and said so, since
 * renaming it there is not something this does yet.
 */
function suffixOffer(model: EntityModel, other: Entity, taken: Set<string>): HTMLElement | null {
  const rows = accountsForEditing().filter(
    ({ account }) =>
      /^\d{3,4}$/.test(account.code.trim()) &&
      account.type.trim().toLowerCase() !== "bank" &&
      model.accounts[accountEntityKey(account)] === other.id,
  );
  if (rows.length === 0) return null;
  const suffix = other.codeSuffix ?? suggestSuffix(other.name, taken);
  if (suffix === "") return null;

  const box = document.createElement("div");
  box.className = "suffix-offer";
  const text = document.createElement("p");
  const sample = rows[0]?.account.code ?? "420";

  const elsewhere = heldElsewhere(rows.map((r) => r.label));
  if (elsewhere.length > 0) {
    text.textContent =
      `${other.name}'s ${rows.length} account${rows.length === 1 ? "" : "s"} have plain codes. ` +
      `${elsewhere.slice(0, 3).join(", ")}${elsewhere.length > 3 ? " and others" : ""} ` +
      "are used in journals, opening balances, invoices or tenancies; rename those individually.";
    box.append(text);
    return box;
  }

  text.textContent =
    `${other.name}'s ${rows.length} account${rows.length === 1 ? "" : "s"} have plain codes. ` +
    `Add the suffix ${suffix} to them too (${sample} → ${sample}${suffix})? ` +
    "Coding, rules and GST settings move with them.";
  const go = document.createElement("button");
  go.type = "button";
  go.textContent = `Add ${suffix} to ${other.name}'s codes`;
  go.addEventListener("click", () => {
    go.disabled = true;
    void suffixEntity(other, suffix);
  });
  box.append(text, go);
  return box;
}

/** Labels that appear in a part of the books a rename does not rewrite. */
function heldElsewhere(labels: readonly string[]): string[] {
  const {
    transactions: _t,
    overrides: _o,
    splits: _s,
    chart: _c,
    entities: _e,
    ...rest
  } = state.ledger as unknown as Record<string, unknown>;
  const text = JSON.stringify(rest);
  return labels.filter((label) => text.includes(JSON.stringify(label)));
}

/** Rename each of an entity's plain codes to carry its suffix, as one change. */
async function suffixEntity(entity: Entity, suffix: string): Promise<void> {
  const model = state.ledger.entities ?? emptyEntityModel();
  const housePrefixed = accountsForEditing().some((r) => /^NB\s+/i.test(r.label));
  let refs = {
    chart: state.chart,
    overrides: state.ledger.overrides ?? {},
    splits: state.ledger.splits ?? {},
    rules: state.rules,
    accountEntities: model.accounts,
  };
  let renamed = 0;
  const skipped: string[] = [];
  const codings = { count: 0 };
  for (const { account, label } of accountsForEditing()) {
    if (!/^\d{3,4}$/.test(account.code.trim())) continue;
    if (account.type.trim().toLowerCase() === "bank") continue;
    if (model.accounts[accountEntityKey(account)] !== entity.id) continue;
    const code = suffixedCode(account.code, suffix);
    if (refs.chart.some((a) => a.code === code)) {
      skipped.push(code);
      continue;
    }
    const after = renameAccount(
      refs,
      account,
      { code, name: account.name },
      label,
      accountLabel(code, account.name, housePrefixed),
    );
    codings.count += after.moved.codings + after.moved.splitParts;
    refs = after;
    renamed += 1;
  }

  const entities = model.entities.map((e) => (e.id === entity.id ? { ...e, codeSuffix: suffix } : e));
  state.chart = refs.chart;
  state.ledger = {
    ...state.ledger,
    chart: refs.chart,
    overrides: refs.overrides,
    splits: refs.splits,
    entities: { ...model, entities, accounts: refs.accountEntities },
  };
  // Saved whole, as a single rename is: the chart, the codings and the
  // assignments move together or not at all.
  state.persistent = await save(state.ledger);
  state.rules = refs.rules;
  await persistRules();
  await record(
    "chart",
    `${entity.name}'s codes given the suffix ${suffix}: ${renamed} account${renamed === 1 ? "" : "s"}` +
      (codings.count > 0 ? `, carrying ${codings.count} coding${codings.count === 1 ? "" : "s"}` : "") +
      (skipped.length > 0 ? `; ${skipped.join(", ")} already existed and were left` : ""),
    null,
    null,
  );
  openFor = null;
  reclassify();
  redraw("entities");
}
