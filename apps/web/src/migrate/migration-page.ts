import { showPage } from "../app.js";
import { saveEntities } from "../books.js";
import { createBook } from "../cloud.js";
import { $, state } from "../state.js";
import { backendKind, openCloudBook, save, switchLedger, writesToFolder } from "../store.js";
import { note } from "../ui.js";
import { DEFAULT_ENTITY_NAME, emptyEntityModel, entityId } from "@nzosa/core";
import type { Entity, EntityKind, EntityModel } from "@nzosa/core";
import { borrow, returnBorrowed } from "../borrow.js";
import { renderFeed } from "../daily/bank-import.js";
import { bankLinkTable } from "../daily/entities.js";
import { loadWhatever } from "./file-intake.js";
import { loadDemoData, setupSteps, xeroMigrationFiles } from "./setup-wizard.js";
import type { SetupStep } from "./setup-wizard.js";
import {
  booksKey,
  booksStartDate,
  forgetOnboarding,
  onboarding,
  rememberOnboarding,
  rememberSource,
  sourceForTheseBooks,
} from "./onboarding-state.js";
import type { Onboarding, PlannedEntity, Source, Step } from "./onboarding-state.js";

/**
 * Migration: the guided start.
 *
 * Setup lists everything a set of books can be given and ticks it off, which
 * suits somebody who already knows what they have. Somebody new does not, and
 * the first thing they need is not a file -- it is to know how many sets of
 * books they are making, because that is not cheap to undo once there are
 * figures in them.
 *
 * So: one question on screen at a time, each answered one collapsing to a
 * line. Where the books are coming from, the day they start, whether this is
 * one entity or several, and -- when it is several -- whether any account is
 * shared, which is the fact that decides one set of books or several.
 *
 * What it learns, it fills in. The entities are written into the books, the
 * start date becomes the date opening balances open on, and Setup opens on the
 * source that was chosen with the steps this answered already ticked. Nothing
 * here is new accounting: they are Setup's own fields, asked in an order that
 * makes sense to somebody who has just arrived.
 */

const KINDS: readonly (readonly [EntityKind, string])[] = [
  ["business", "Business"],
  ["residential", "Residential rental"],
  ["commercial", "Commercial rental"],
  ["personal", "Personal"],
];

function kindName(kind: EntityKind | undefined): string {
  return KINDS.find(([value]) => value === (kind ?? "business"))?.[1] ?? "Business";
}

// --- the shape of the questions --------------------------------------------

/**
 * Which questions apply, in order.
 *
 * The date is only worth asking when there are figures to bring in, and the
 * shared-account question only when there is more than one entity to share
 * between -- so neither is a step somebody has to answer "not applicable" to.
 */
function stepsFor(held: Onboarding): Step[] {
  const steps: Step[] = ["source"];
  if (held.opening === true) steps.push("date");
  steps.push("one");
  if (held.onlyOne === false) steps.push("shared");
  steps.push("entities", "plan", "bank");
  if (held.source === "xero" || held.source === "sheet") steps.push("files");
  steps.push("checklist", "done");
  return steps;
}

/** The step after this one, for a "Continue" that does not care which it is. */
function nextAfter(held: Onboarding, step: Step): Step {
  const steps = stepsFor(held);
  return steps[steps.indexOf(step) + 1] ?? "done";
}

/** One entity at a time, except where they genuinely share a set of books. */
function oneAtATime(held: Onboarding): boolean {
  return held.onlyOne === true || held.shared === false;
}

/** The entities that already have a set of books of their own. */
function started(held: Onboarding): PlannedEntity[] {
  return (held.entities ?? []).filter((e) => e.name.trim() !== "" && e.book !== undefined);
}

/** The one being set up now: the last named that has nowhere to live yet. */
function pending(held: Onboarding): PlannedEntity | undefined {
  const waiting = (held.entities ?? []).filter((e) => e.name.trim() !== "" && e.book === undefined);
  return waiting[waiting.length - 1];
}

function at(held: Onboarding): Step {
  const steps = stepsFor(held);
  const wanted = held.at;
  return wanted !== undefined && steps.includes(wanted) ? wanted : "source";
}

export function renderMigration(): void {
  const body = $("migration-body");
  // Anything a step borrowed from another page goes back before the step that
  // borrowed it is thrown away, or emptying this would take it with it.
  returnBorrowed();
  body.textContent = "";
  const held = onboarding();
  const here = at(held);
  const steps = stepsFor(held);
  const reached = steps.indexOf(here);

  if (held.at === undefined) body.append(haveALook());

  steps.forEach((step, index) => {
    if (index < reached) body.append(summary(step, held));
    else if (index === reached) body.append(question(index + 1, step, held));
  });

  if (held.at !== undefined) body.append(startAgain());
}

/**
 * Somewhere to look before answering anything.
 *
 * Every question below asks about books that do not exist yet, which is hard
 * to answer if you have never seen what the answers lead to. The demo is a
 * complete set of books in its own right, so it can be walked around without
 * touching anything -- and on a copy running in somebody's browser, the one
 * online is a link rather than a download.
 */
function haveALook(): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "migration-look";
  const text = document.createElement("p");
  text.textContent =
    "Never seen it work? There is a complete invented set of books -- a coffee roastery " +
    "and a rental, part way through a year, with codings, splits, invoices and a transfer. " +
    "It opens in books of its own, so nothing of yours is touched.";
  wrap.append(text);

  const row = document.createElement("div");
  row.className = "migration-actions";
  const open = document.createElement("button");
  open.type = "button";
  open.textContent = writesToFolder() ? "Open the demo books" : "Load the demo books";
  open.addEventListener("click", () => void loadDemoData(open));
  row.append(open);

  const online = document.createElement("a");
  online.className = "migration-look-link";
  online.href = "https://nbparagliding.nz/nzosa_demo/";
  online.target = "_blank";
  online.rel = "noopener noreferrer";
  online.textContent = "or try the demo online";
  row.append(online);

  wrap.append(row);
  return wrap;
}

/** Setup opens on the source already answered here, rather than on Xero every time. */
export function wireMigration(): void {
  const source = sourceForTheseBooks();
  if (source !== undefined) $<HTMLSelectElement>("setup-source").value = source;
}

// --- the furniture ----------------------------------------------------------

function card(step: number, title: string): [HTMLElement, HTMLElement] {
  const box = document.createElement("div");
  box.className = "migration-card";
  const heading = document.createElement("h3");
  const mark = document.createElement("span");
  mark.className = "migration-num";
  mark.textContent = String(step);
  heading.append(mark, document.createTextNode(title));
  const inner = document.createElement("div");
  box.append(heading, inner);
  return [box, inner];
}

function choices<T extends string>(
  options: readonly (readonly [T, string, string])[],
  pick: (value: T) => void,
  chosen?: T,
): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "migration-choices";
  wrap.setAttribute("role", "group");
  for (const [value, label, hint] of options) {
    const choice = document.createElement("button");
    choice.type = "button";
    choice.className = "migration-choice";
    if (chosen !== undefined) choice.setAttribute("aria-pressed", String(chosen === value));
    const strong = document.createElement("strong");
    strong.textContent = label;
    const small = document.createElement("span");
    small.textContent = hint;
    choice.append(strong, small);
    choice.addEventListener("click", () => pick(value));
    wrap.append(choice);
  }
  return wrap;
}

function advice(...paragraphs: readonly string[]): HTMLElement {
  const box = document.createElement("div");
  box.className = "migration-advice";
  for (const text of paragraphs) {
    const p = document.createElement("p");
    p.textContent = text;
    box.append(p);
  }
  return box;
}

function button(label: string, onClick: () => void, primary = false): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  if (primary) b.className = "primary";
  b.addEventListener("click", onClick);
  return b;
}

function actions(...buttons: readonly HTMLButtonElement[]): HTMLElement {
  const row = document.createElement("div");
  row.className = "migration-actions";
  row.append(...buttons);
  return row;
}

function answer(patch: Onboarding): void {
  rememberOnboarding(patch);
  renderMigration();
}

/**
 * Tell Setup where these books are coming from.
 *
 * Both the remembered answer, for the next time this set of books is opened,
 * and the selector on the page now -- which is a different set of books from
 * the one that was open when the question was asked, every time somebody is
 * sent off to start a second set.
 */
function tellSetup(source: Source): void {
  rememberSource(source);
  const select = document.getElementById("setup-source");
  if (select instanceof HTMLSelectElement) select.value = source;
}

function startAgain(): HTMLElement {
  const row = document.createElement("div");
  row.className = "migration-restart";
  row.append(
    button("Start these questions again", () => {
      forgetOnboarding();
      renderMigration();
    }),
  );
  return row;
}

// --- answered questions, in a line -----------------------------------------

function said(held: Onboarding, step: Step): string {
  switch (step) {
    case "source":
      return held.source === "xero"
        ? "Moving from Xero"
        : held.source === "sheet"
          ? "Moving from a spreadsheet"
          : held.opening === true
            ? "Starting from last year's closing balances"
            : "Starting with empty books";
    case "date":
      return `These books start ${held.startDate ?? ""}`;
    case "one":
      return held.onlyOne === true ? "One entity, and nothing else" : "More than one entity";
    case "shared":
      return held.shared === true
        ? "An account or card is used by more than one of them"
        : "Nothing is shared between them";
    case "entities":
      return (held.entities ?? [])
        .filter((e) => e.name.trim() !== "")
        .map((e) => e.name)
        .join(", ");
    case "plan": {
      const mine = started(held);
      return oneAtATime(held) && held.onlyOne === false
        ? mine.length === 1
          ? `${mine[0]?.name ?? ""} has a set of books`
          : `${mine.length} sets of books started`
        : "One set of books";
    }
    case "bank": {
      const many = state.ledger.transactions.length;
      const how = held.bank === "feed" ? "bank feed" : held.bank === "files" ? "bank files" : "";
      return many === 0
        ? how === ""
          ? "No bank transactions yet"
          : `No bank transactions yet, from the ${how}`
        : `${many} bank transaction${many === 1 ? "" : "s"}` + (how === "" ? "" : `, from the ${how}`);
    }
    case "files": {
      const files = xeroMigrationFiles();
      const have = files.filter((f) => f.have).length;
      return `${have} of ${files.length} files loaded`;
    }
    case "checklist": {
      const rest = remainingSteps();
      const done = rest.filter((s) => s.done).length;
      return `${done} of ${rest.length} of the rest set up`;
    }
    case "done":
      return "";
  }
}

function summary(step: Step, held: Onboarding): HTMLElement {
  const row = document.createElement("div");
  row.className = "migration-card done migration-summary";
  const mark = document.createElement("span");
  mark.className = "migration-num";
  mark.textContent = "✓";
  const text = document.createElement("span");
  text.className = "migration-summary-text";
  text.textContent = said(held, step);
  row.append(mark, text, button("Change", () => answer({ at: step })));
  return row;
}

// --- 1. where the books are starting from -----------------------------------

function sourceQuestion(number: number): HTMLElement {
  const [box, inner] = card(number, "Where are these books starting from?");
  inner.append(
    note(
      "This decides what Setup asks you for. It is about this set of books, so if you end " +
        "up with more than one set, each can be answered differently.",
    ),
  );

  // Two of these are the same source -- nothing to bring across -- and differ
  // only in whether there are opening balances, which is the difference
  // between a balance sheet that is a position and one that is a movement.
  const pick = (source: Source, opening: boolean): void => {
    tellSetup(source);
    answer({ source, opening, at: opening ? "date" : "one" });
  };

  inner.append(
    choices<"empty" | "balances" | "xero" | "sheet">(
      [
        [
          "empty",
          "Empty books",
          "The books will start from the date of your bank transactions. You can add " +
            "historical data and opening balances later",
        ],
        [
          "balances",
          "From last year's closing balances",
          "A trial balance at your last year end, then on from there",
        ],
        [
          "xero",
          "Import from Xero",
          "Chart, coding, opening balances, invoices and assets come across from Xero's " +
            "exports. Historical transactions can be coded as they were in Xero",
        ],
        ["sheet", "From a spreadsheet", "The coding already in the sheet becomes the rules"],
      ],
      (value) => {
        if (value === "empty") pick("new", false);
        else if (value === "balances") pick("new", true);
        else if (value === "xero") pick("xero", true);
        else pick("sheet", true);
      },
    ),
  );
  return box;
}

// --- 2. the day they start --------------------------------------------------

function dateQuestion(number: number, held: Onboarding): HTMLElement {
  const [box, inner] = card(number, "What date do these books start?");
  inner.append(
    held.source === "xero"
      ? advice(
          "The day NZOSA takes over from Xero. The first day of a financial year (1 April " +
            "for most) is the cleanest: the whole year's reports, depreciation and IR10 then " +
            "come from one system, and the opening balances are year-end figures your " +
            "accountant has already signed off.",
          "Part way through a year works too. Choose the first day of a GST period, so no " +
            "return is split between two systems.",
        )
      : advice(
          "The day these books take over. What happened before it arrives as opening " +
            "balances; what happens after it arrives as transactions.",
        ),
  );

  const row = document.createElement("div");
  row.className = "migration-entity";
  const label = document.createElement("label");
  label.append("Start date ");
  const date = document.createElement("input");
  date.type = "date";
  date.value = held.startDate ?? booksStartDate();
  label.append(date);
  row.append(label);
  inner.append(row);

  inner.append(
    note("Opening balances open dated this day, so nothing asks you for it twice."),
    actions(
      button(
        "Save the date",
        () => {
          if (date.value === "") return;
          answer({ startDate: date.value, at: "one" });
        },
        true,
      ),
    ),
  );
  return box;
}

// --- 3. one entity, or more than one ----------------------------------------

function oneQuestion(number: number): HTMLElement {
  const [box, inner] = card(number, "Is this one business, and nothing else?");
  inner.append(
    note(
      "An entity is anything that requires its own financial record: a business, a rental " +
        "property, a trust, or your personal finances.",
    ),
  );
  inner.append(
    choices<"yes" | "no">(
      [
        [
          "yes",
          "Yes, just the one",
          "One company, or one person's affairs. Every account in these books belongs to it",
        ],
        [
          "no",
          "No, there is more than one",
          "A company and a rental, say, or your own affairs alongside a business",
        ],
      ],
      (value) =>
        value === "yes"
          ? answer({ onlyOne: true, at: "entities" })
          : answer({ onlyOne: false, at: "shared" }),
    ),
  );
  return box;
}

// --- 4. whether anything is shared ------------------------------------------

function sharedQuestion(number: number): HTMLElement {
  const [box, inner] = card(number, "Is any account or card used by more than one of them?");
  inner.append(
    advice(
      "A set of books has one ledger, and it balances to $0.",
      "Best practice is one set of books for each entity -- a business, your personal " +
        "affairs, a residential rental, a commercial rental. Each one's accounts, reports " +
        "and returns then stand on their own: nothing from one can reach another's figures, " +
        "and each can go to its accountant, or to its other owners, without the rest.",
      "But if you have cards or accounts used by more than one entity, it is easier to have " +
        "more than one entity in one set of books. The shared account's transactions then " +
        "exist once, instead of being copied into two sets -- which is how a payment ends up " +
        "counted twice, or in neither.",
    ),
  );
  inner.append(
    choices<"no" | "yes">(
      [
        [
          "no",
          "No, each has its own",
          "The company's account pays only the company's costs, the rental's only the rental's",
        ],
        [
          "yes",
          "Yes, some are shared",
          "One account pays for more than one entity: rental costs from a personal account, say",
        ],
      ],
      (value) => answer({ shared: value === "yes", at: "entities" }),
    ),
  );
  return box;
}

// --- 5. who they are --------------------------------------------------------

function entityRow(
  entity: PlannedEntity | undefined,
  onChange: () => void,
  removable: boolean,
): HTMLElement {
  const row = document.createElement("div");
  row.className = "migration-entity";

  const name = document.createElement("input");
  name.type = "text";
  name.className = "migration-entity-name";
  name.placeholder = "Company, trust, rental address, or your own name";
  name.value = entity?.name ?? "";
  name.addEventListener("input", onChange);

  const kind = document.createElement("select");
  for (const [value, caption] of KINDS) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = caption;
    option.selected = (entity?.kind ?? "business") === value;
    kind.append(option);
  }
  kind.title = "Residential rental losses are ring-fenced; the others are not.";
  kind.addEventListener("change", onChange);

  const gstLabel = document.createElement("label");
  const gst = document.createElement("input");
  gst.type = "checkbox";
  gst.checked = entity?.gst ?? true;
  gst.addEventListener("change", onChange);
  gstLabel.append(gst, " GST registered");

  row.append(name, kind, gstLabel);
  if (removable) {
    const remove = button("Remove", () => {
      row.remove();
      onChange();
    });
    remove.className = "migration-entity-remove";
    row.append(remove);
  }
  return row;
}

function entitiesQuestion(number: number, held: Onboarding): HTMLElement {
  // Only where the accounts are genuinely shared is there anything to gain
  // from naming several at once. Where each is getting books of its own there
  // is nothing to arrange between them, so asking for a list up front is
  // asking somebody to plan out an afternoon before they have seen one set of
  // books work. One, then the next one whenever they come back.
  const one = oneAtATime(held);
  const mine = started(held);
  const [box, inner] = card(
    number,
    held.onlyOne === true
      ? "What is this entity called?"
      : one
        ? mine.length > 0
          ? "Which entity next?"
          : "Which entity would you like to start with?"
        : "Which entities do you have?",
  );

  // Nothing to explain where there is only one of them: the question is the
  // whole of it.
  if (held.onlyOne !== true) {
    inner.append(
      note(
        one
          ? "One at a time. This one gets a set of books of its own, and the next one gets " +
            "its own when you come back for it -- there is nothing to arrange between them."
          : "Name each one that shares those accounts. They all go in one set of books, and " +
            "each still gets its own profit and loss and its own GST return.",
      ),
    );
  }

  if (one && mine.length > 0) {
    const already = document.createElement("ul");
    already.className = "migration-list";
    for (const entity of mine) {
      const item = document.createElement("li");
      item.textContent = `${entity.name} — ${kindName(entity.kind)}, already has its own books`;
      already.append(item);
    }
    inner.append(already);
  }

  const rows = document.createElement("div");
  rows.className = "migration-entities";
  const waiting = pending(held);
  const known = one
    ? waiting === undefined
      ? []
      : [waiting]
    : (held.entities ?? []).filter((e) => e.name.trim() !== "");
  const collect = (): PlannedEntity[] => {
    const found: PlannedEntity[] = [];
    for (const row of Array.from(rows.children)) {
      const name = row.querySelector("input[type=text]");
      const kind = row.querySelector("select");
      const gst = row.querySelector("input[type=checkbox]");
      if (
        !(name instanceof HTMLInputElement) ||
        !(kind instanceof HTMLSelectElement) ||
        !(gst instanceof HTMLInputElement)
      ) {
        continue;
      }
      // A set of books already started for this one is not forgotten because
      // its name was retyped.
      const was = known.find((e) => e.name === name.value.trim());
      found.push({
        name: name.value.trim(),
        kind: kind.value as EntityKind,
        gst: gst.checked,
        ...(was?.book !== undefined ? { book: was.book } : {}),
        ...(was?.ready === true ? { ready: true } : {}),
      });
    }
    return found;
  };
  const changed = (): void => {
    rememberOnboarding({ entities: collect() });
  };

  const existing: (PlannedEntity | undefined)[] = known.length > 0 ? [...known] : [undefined];
  for (const entity of one ? existing.slice(0, 1) : existing) {
    rows.append(entityRow(entity, changed, !one));
  }
  inner.append(rows);

  if (!one) {
    inner.append(
      actions(
        button("Add another", () => {
          rows.append(entityRow(undefined, changed, true));
          changed();
        }),
      ),
    );
  }

  const trouble = document.createElement("p");
  trouble.className = "cloud-said";
  inner.append(
    actions(
      button(
        "Continue",
        () => {
          const entities = collect().filter((e) => e.name.trim() !== "");
          if (entities.length === 0) {
            trouble.textContent = "A name is needed before this can go any further.";
            return;
          }
          // Naming one does not forget the ones already living in books of
          // their own; this question is only ever about the next.
          answer({ entities: one ? [...mine, ...entities.slice(0, 1)] : entities, at: "plan" });
        },
        true,
      ),
    ),
    trouble,
  );
  return box;
}

// --- 6. what that means, and doing it ---------------------------------------

/**
 * Write the planned entities into the books that are open.
 *
 * Books that already hold entities somebody has named keep them: these
 * questions are for a set of books that is starting, and quietly replacing the
 * entities of a set that is already going would take every account assignment
 * with it.
 *
 * The placeholder entity is the exception, because it is not somebody's
 * answer. It does own things, though -- a new set of books gives it every
 * account in the starter chart and every bank account -- so what it owned goes
 * to the first entity named here. Dropping it without that would leave all
 * sixty-six accounts pointing at an entity that no longer exists, and every
 * per-entity report empty.
 */
async function applyEntities(planned: readonly PlannedEntity[]): Promise<void> {
  const live: EntityModel = state.ledger.entities ?? emptyEntityModel();
  const placeholderOnly =
    live.entities.length === 0 || live.entities.every((e) => e.name === DEFAULT_ENTITY_NAME);

  const made: Entity[] = [];
  for (const entity of planned) {
    // Two rentals given the same name would otherwise become one entity.
    let id = entityId(entity.name);
    for (let n = 2; made.some((m) => m.id === id); n += 1) id = `${entityId(entity.name)}-${n}`;
    made.push({ id, name: entity.name, kind: entity.kind, gstRegistered: entity.gst });
  }

  const kept = placeholderOnly
    ? []
    : live.entities.filter((e) => !made.some((m) => m.id === e.id));

  const successor = made[0]?.id;
  const replaced = new Set(placeholderOnly ? live.entities.map((e) => e.id) : []);
  const inherit = (id: string): string =>
    successor !== undefined && replaced.has(id) ? successor : id;

  const accounts: Record<string, string> = {};
  for (const [key, id] of Object.entries(live.accounts)) accounts[key] = inherit(id);
  const banks: Record<string, readonly string[]> = {};
  for (const [key, ids] of Object.entries(live.banks)) {
    banks[key] = [...new Set(ids.map(inherit))];
  }

  const next: EntityModel = { entities: [...kept, ...made], accounts, banks };

  await saveEntities(
    next,
    made.length === 1 && kept.length === 0
      ? `These books are for ${made[0]?.name ?? ""}`
      : `${made.length} entities named in the guided start`,
  );

  // Setup asks whether there is more than one entity. It has been answered.
  if (next.entities.length === 1) {
    state.ledger.singleEntityConfirmed = true;
    await save(state.ledger);
  }
}

/** Whether the books that are open are still nobody's. */
function unclaimed(): boolean {
  const live = state.ledger.entities ?? emptyEntityModel();
  return live.entities.length === 0 || live.entities.every((e) => e.name === DEFAULT_ENTITY_NAME);
}

function entityList(planned: readonly PlannedEntity[]): HTMLElement {
  const list = document.createElement("ul");
  list.className = "migration-list";
  for (const entity of planned) {
    const item = document.createElement("li");
    item.textContent =
      `${entity.name} — ${kindName(entity.kind)}, ` +
      (entity.gst ? "GST registered" : "not GST registered");
    list.append(item);
  }
  return list;
}

/**
 * Write the entities into the books that are open, and say when it is done.
 *
 * `record` is what the answer has to remember afterwards -- which set of books
 * this entity ended up in, where each is getting its own.
 */
function applyPanel(
  planned: readonly PlannedEntity[],
  held: Onboarding,
  record: Onboarding = {},
): HTMLElement {
  const wrap = document.createElement("div");
  const live = state.ledger.entities ?? emptyEntityModel();
  const alreadyThere =
    planned.length > 0 &&
    planned.every((p) => live.entities.some((e) => e.id === entityId(p.name)));

  wrap.append(entityList(planned));

  const trouble = document.createElement("p");
  trouble.className = "cloud-said";

  if (alreadyThere) {
    trouble.textContent = "Saved to these books ✓";
    wrap.append(trouble, actions(button("Continue", () => answer({ at: "bank" }), true)));
    return wrap;
  }

  const apply = button(
    planned.length === 1 ? "Save to these books" : "Save these to these books",
    () => {
      apply.disabled = true;
      trouble.textContent = "Saving…";
      void applyEntities(planned).then(
        () => {
          if (held.source !== undefined) tellSetup(held.source);
          rememberOnboarding(record);
          renderMigration();
        },
        () => {
          apply.disabled = false;
          trouble.textContent =
            "Could not save that. Try again, or name them on Entities & accounts.";
        },
      );
    },
    true,
  );
  wrap.append(actions(apply), trouble);
  return wrap;
}

function planQuestion(number: number, held: Onboarding): HTMLElement {
  const shared = held.onlyOne === false && held.shared === true;
  const planned = (held.entities ?? []).filter((e) => e.name.trim() !== "");
  const [box, inner] = card(number, shared ? "One set of books" : "A set of books of its own");

  if (shared) {
    inner.append(
      advice(
        "One set of books, holding all of them. Every account in the chart belongs to one " +
          "entity, so each gets its own profit and loss and its own GST return, and a shared " +
          "bank account is ticked for every entity it pays for.",
      ),
    );
    if (planned.length > 1) {
      inner.append(
        note(
          "The balance sheet is for the set of books as a whole, which is what balances to " +
            "$0. Nothing is posted between entities, so one entity's balance sheet on its " +
            "own would be short the cash another entity's account paid out.",
        ),
      );
    }
  }

  inner.append(theirOwnBooks(held, shared));
  return box;
}

/**
 * Putting the entities somewhere.
 *
 * Which is the books that are open, when nobody has claimed them, or a new set
 * when somebody has. That second case used to be missed for a single entity:
 * it wrote the name into whatever books happened to be open and said "saved",
 * so asking for a company's books while another company's were open quietly
 * added an entity to theirs and started nothing. One question -- are these
 * books already somebody's -- answers it for every shape of set-up, so there
 * is one answer rather than one per branch.
 *
 * Starting a new set switches to it and reloads, the same thing the Books page
 * does: half the app holding one ledger while half holds another is a class of
 * bug that produces plausible wrong figures. So the answers are kept outside
 * any one set of books and picked up afterwards.
 */
function theirOwnBooks(held: Onboarding, shared: boolean): HTMLElement {
  const wrap = document.createElement("div");
  const open = booksKey();
  const all = (held.entities ?? []).filter((e) => e.name.trim() !== "");
  const placed = all.filter((e) => e.book !== undefined);
  const waiting = pending(held);
  // Several at once only where they share a set of books. Otherwise one, and
  // the next one when they come back for it.
  const group = shared ? all.filter((e) => e.book === undefined) : waiting ? [waiting] : [];

  if (placed.length > 0 && !shared) {
    const list = document.createElement("div");
    list.className = "migration-queue";
    for (const entity of placed) {
      const row = document.createElement("div");
      row.className = "migration-queue-row";
      const name = document.createElement("span");
      name.className = "migration-queue-name";
      name.textContent = `${entity.name} \u2014 ${kindName(entity.kind)}`;
      const mark = document.createElement("span");
      if (entity.book === open) {
        mark.className = "books-open";
        mark.textContent = "open now";
      } else {
        mark.className = "migration-queue-done";
        mark.textContent = "\u2713 has its own books";
      }
      row.append(name, mark);
      list.append(row);
    }
    wrap.append(list);
  }

  // Whose books are open but are not written into them yet -- which is where
  // the reload after starting a new set lands.
  const hereNow = all.filter((e) => e.book === open);
  if (hereNow.length > 0 && unclaimed()) {
    const heading = document.createElement("h4");
    heading.textContent =
      hereNow.length === 1
        ? `These books are for ${hereNow[0]?.name ?? ""}`
        : "These books are for all of them";
    wrap.append(heading, applyPanel(hereNow, held));
    return wrap;
  }

  if (group.length === 0) {
    wrap.append(
      advice(
        shared ? "These books hold all of them." : "Each of these has a set of books of its own.",
      ),
      actions(
        ...(shared ? [] : [button("Start another entity", () => answer({ at: "entities" }))]),
        button("Continue", () => answer({ at: "bank" }), true),
      ),
    );
    return wrap;
  }

  const first = group[0];
  if (first === undefined) return wrap;

  if (unclaimed()) {
    wrap.append(
      advice(
        group.length === 1
          ? `These books are still nobody's, so ${first.name} can have them.`
          : "These books are still nobody's, so all of them can go in here.",
      ),
      applyPanel(group, held, {
        entities: [...placed, ...group.map((e) => ({ ...e, book: open }))],
      }),
    );
    return wrap;
  }

  const theirs = (state.ledger.entities ?? emptyEntityModel()).entities[0]?.name ?? "somebody else";

  if (backendKind() === "browser") {
    wrap.append(
      note(
        `The books open now are ${theirs}'s, and this copy runs in a browser, which holds ` +
          "one set. To keep a set for each entity, run NZOSA on your own computer, where " +
          "each set is a folder of its own, or sign in to keep them on the server.",
      ),
    );
    return wrap;
  }

  wrap.append(
    advice(
      `The books open now are ${theirs}'s, so ` +
        (group.length === 1 ? `${first.name} gets a new set.` : "these get a new set.") +
        " Starting it opens it, and these questions carry on inside it.",
    ),
    entityList(group),
    actions(button(`Start ${first.name}'s books`, () => void startBooksFor(group, all), true)),
  );
  return wrap;
}

// --- 7. the bank, and anything else being brought across --------------------

/**
 * Somewhere to drop files, here rather than only on Setup.
 *
 * The same reader Setup uses, which takes anything and works out what each
 * file is, so there is nothing to get in the wrong order. Setup's own drop
 * zone is a single element that moves around the page, and taking it would
 * leave Setup without one.
 */
function dropZone(): HTMLElement {
  const zone = document.createElement("div");
  zone.className = "dropzone dropzone-mini";

  const text = document.createElement("span");
  text.className = "dropzone-mini-text";
  text.textContent = "Drop files here, or";

  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".csv,.xlsx,.txt";
  input.multiple = true;
  input.hidden = true;

  const pick = document.createElement("button");
  pick.type = "button";
  pick.className = "dropzone-mini-btn";
  pick.textContent = "Choose files";
  pick.addEventListener("click", () => input.click());

  const take = (files: FileList | null | undefined): void => {
    if (!files || files.length === 0) return;
    text.textContent = "Reading…";
    void loadWhatever([...files]).finally(() => renderMigration());
  };
  input.addEventListener("change", () => {
    take(input.files);
    input.value = "";
  });
  for (const event of ["dragenter", "dragover"]) {
    zone.addEventListener(event, (e) => {
      e.preventDefault();
      zone.classList.add("dragging");
    });
  }
  for (const event of ["dragleave", "drop"]) {
    zone.addEventListener(event, (e) => {
      e.preventDefault();
      zone.classList.remove("dragging");
    });
  }
  zone.addEventListener("drop", (e) => take((e as DragEvent).dataTransfer?.files));

  zone.append(text, pick, input);
  // What the reader says about each file it was given. It writes into one
  // element, which lives in Setup's own drop zone, so a file dropped here
  // would otherwise be read in silence.
  const told = borrow("setup-loaded");
  if (told !== null) zone.append(told);
  return zone;
}

/** Reference material, out of the way until it is asked for. */
function folded(summary: string, content: HTMLElement): HTMLElement {
  const details = document.createElement("details");
  details.className = "setup-migration-details migration-folded";
  const head = document.createElement("summary");
  head.className = "setup-migration-summary";
  head.textContent = summary;
  details.append(head, content);
  return details;
}

function bankQuestion(number: number, held: Onboarding): HTMLElement {
  const [box, inner] = card(number, "Bring in your bank transactions");
  const many = state.ledger.transactions.length;

  inner.append(
    advice(
      "Everything else hangs off these. They come from the bank itself rather than from " +
        "whatever you are moving away from, so they are the bank's record and not somebody's " +
        "copy of it.",
    ),
  );

  inner.append(
    choices<"feed" | "files">(
      [
        [
          "feed",
          "Connect your NZ bank accounts directly",
          "A live connection: transactions arrive on their own, and nothing is typed or mistyped",
        ],
        [
          "files",
          "Import from a file",
          "CSV exports from your bank. Several at once is fine, and duplicates are caught",
        ],
      ],
      (value) => answer({ bank: value }),
      held.bank,
    ),
  );

  // The page that does it, shown here rather than linked to. It is the live
  // one, moved: a second copy would be a second thing to keep in step.
  if (held.bank === "feed") {
    const feed = borrow("import-feed");
    if (feed !== null) {
      inner.append(feed);
      // Not yet: this card is still being built and is not in the page, and
      // what draws the feed looks its own element up by id. Once the render
      // that asked for this card has finished putting it there.
      queueMicrotask(() => {
        if (document.getElementById("feed-body") !== null) void renderFeed();
      });
    }
  } else if (held.bank === "files") {
    const files = borrow("import-files");
    if (files !== null) inner.append(files);
  }

  if (many > 0) inner.append(note(`${many} transaction${many === 1 ? "" : "s"} loaded.`));

  inner.append(
    actions(
      button("Continue", () => answer({ at: nextAfter(held, "bank") }), many > 0),
      button("The whole Bank import page", () => showPage("import")),
    ),
  );
  return box;
}

function filesQuestion(number: number, held: Onboarding): HTMLElement {
  const xero = held.source === "xero";
  const [box, inner] = card(
    number,
    xero ? "Bring your Xero organisation across" : "Bring your spreadsheet across",
  );

  if (xero) {
    const files = xeroMigrationFiles();
    const have = files.filter((f) => f.have).length;
    inner.append(
      advice(
        "Drop the exports here as you get them. Each is recognised on its own, so the order " +
          "does not matter, and the list below ticks off what has arrived.",
      ),
      note(`${have} of ${files.length} loaded.`),
      dropZone(),
      table(
        ["Export", "Where in Xero", "What it gives NZOSA"],
        files.map((f) => [f.have ? `✓ ${f.what}` : f.what, f.where, f.why]),
      ),
      folded(
        "The full Xero guide: what to finish first, what to export, how to check the figures",
        xeroGuide(held),
      ),
    );
  } else {
    inner.append(
      advice(
        "Have ready: the spreadsheet, with a column for the account each line was coded to; " +
          "and last year's balance sheet from your accountant, for the opening balances. The " +
          "coding already in the sheet becomes the rules.",
      ),
      dropZone(),
    );
  }

  inner.append(actions(button("Continue", () => answer({ at: "done" }), true)));
  return box;
}

/**
 * What the questions above have already answered, in Setup's own words.
 *
 * Kept as names rather than positions because the list is Setup's and may grow
 * -- and a step that has been answered and is asked again reads as the guided
 * start not having listened.
 */
const ALREADY_ASKED = new Set([
  "Bank transactions",
  "Whose books are these?",
  "More than one entity?",
]);

/**
 * The rest of the set-up list, walked one step at a time.
 *
 * Setup lists the same steps on one page and ticks them off, which suits
 * somebody who knows what they have. Walking them is for somebody who does
 * not: one at a time, in the order they depend on each other, each saying what
 * it is and what it gives you, with somewhere to drop the file it wants.
 *
 * The steps are Setup's own, asked for without their interactive content --
 * building that moves Setup's drop zone out of Setup. The drop zone here is
 * this page's own.
 */
function remainingSteps(): SetupStep[] {
  return setupSteps({ withContent: false }).filter(
    (step) =>
      // "Migration from Xero", and its spreadsheet twin, is the step above
      // this walk rather than one inside it.
      !ALREADY_ASKED.has(step.what) && !step.what.startsWith("Migration from "),
  );
}

/**
 * What a step is for, where its one line in Setup's list does not say.
 *
 * Setup's list is read by somebody checking what is left; this walk is read by
 * somebody who has not met the thing yet. The step's own line stays, as the
 * status underneath.
 */
function guidance(what: string): HTMLElement | null {
  if (what !== "Chart of accounts") return null;

  const wrap = document.createElement("div");
  wrap.append(
    advice(
      "These are the accounts you reconcile transactions to. A standard chart of accounts " +
        "is preloaded, for example:",
    ),
  );

  const examples = document.createElement("ul");
  examples.className = "migration-list";
  for (const line of ["200 Sales", "433 Insurance", "408 Cleaning", "720 Computer Equipment"]) {
    const item = document.createElement("li");
    item.textContent = line;
    examples.append(item);
  }
  wrap.append(examples);

  wrap.append(
    advice(
      "If you would like to add more, or import a chart of accounts, you can do it here now " +
        "or at any time in the future.",
      "There is no need to enter bank accounts or credit cards on the chart of accounts. " +
        "They are picked up from your transactions.",
    ),
  );
  return wrap;
}

function checklistQuestion(number: number, held: Onboarding): HTMLElement {
  const rest = remainingSteps();
  const total = rest.length;
  const where = Math.min(Math.max(held.checklistAt ?? 0, 0), Math.max(total - 1, 0));
  const step = rest[where];

  if (step === undefined) {
    const [box, inner] = card(number, "The rest of the set-up");
    inner.append(
      advice("Nothing left to walk through."),
      actions(button("Continue", () => answer({ at: "done" }), true)),
    );
    return box;
  }

  const [box, inner] = card(number, step.what);

  const place = document.createElement("p");
  place.className = "migration-place";
  place.textContent =
    `Step ${where + 1} of ${total}` +
    (step.optional === true ? " · optional" : "") +
    (step.done ? " · done ✓" : "");
  inner.append(place);

  const said = guidance(step.what);
  if (said !== null) inner.append(said, note(step.detail));
  else inner.append(advice(step.detail));
  if (step.unlocks !== "") inner.append(note(`Gives you: ${step.unlocks}`));
  if (step.takesFiles === true && !step.done) inner.append(dropZone());

  // The rows this step is about, rather than a button to a page holding them
  // among sixty-six others. A step somebody has to go looking for is a step
  // that gets left.
  if (step.what === "Link bank accounts on chart of accounts") {
    const links = bankLinkTable();
    inner.append(
      links ??
        note(
          "No bank accounts in the chart to link. They are picked up from your " +
            "transactions, so there is nothing to do here.",
        ),
    );
  }

  // The step's own way in, whether that is a page or something it does here.
  const ways: HTMLButtonElement[] = [];
  for (const link of step.links ?? []) {
    const go = link.page;
    ways.push(
      button(link.label, () => {
        if (go !== undefined) showPage(go);
        else link.action?.();
      }),
    );
  }
  if (ways.length === 0 && step.page !== undefined) {
    const page = step.page;
    ways.push(button(step.done ? "Review" : "Go", () => showPage(page)));
  }

  const move = (to: number): void =>
    answer(to >= total ? { at: "done", checklistAt: total } : { checklistAt: Math.max(to, 0) });

  inner.append(
    actions(
      button(where + 1 === total ? "Finish" : "Next", () => move(where + 1), true),
      ...ways,
      ...(where > 0 ? [button("Back", () => move(where - 1))] : []),
    ),
  );
  return box;
}

function doneQuestion(number: number, held: Onboarding): HTMLElement {
  const [box, inner] = card(number, "That is the start of it");
  const several = (held.entities ?? []).length > 1 && held.shared === true;
  const many = state.ledger.transactions.length;

  const points: string[] = [
    many > 0
      ? `${many} bank transaction${many === 1 ? "" : "s"} in, and these books know whose ` +
        "they are. Setup lists what is left: the chart of accounts, opening balances, and " +
        "the rest, each saying what it would give you."
      : "These books know whose they are. Setup lists what is left, starting with the bank " +
        "transactions everything else hangs off.",
  ];
  if (several) {
    points.push(
      "Then give each account in the chart, and each bank account, to the entity it belongs " +
        "to, on Entities & accounts. Until that is done the reports cannot be split by entity.",
    );
  }
  if (held.opening === true) {
    points.push(
      "Opening balances matter most of all: without them a balance sheet shows the movement " +
        "since your first bank line rather than the position, which is wrong rather than short.",
    );
  }

  inner.append(
    advice(...points),
    actions(
      button("Continue to Setup →", () => showPage("setup", "top"), true),
      ...(several ? [button("Entities & accounts", () => showPage("entities"))] : []),
    ),
  );
  return box;
}

/**
 * Start a set of books for these entities, and go into it.
 *
 * A folder gets a folder; a server account gets a set of books on the server,
 * named after the first of them. Either way the page reloads into the new set,
 * because everything on screen belongs to the books that were open.
 */
async function startBooksFor(
  group: readonly PlannedEntity[],
  planned: readonly PlannedEntity[],
): Promise<void> {
  const first = group[0];
  if (first === undefined) return;
  let id: string;

  if (backendKind() === "cloud") {
    const made = await createBook(first.name);
    if (made === null) {
      alert("Could not start that set of books.");
      return;
    }
    openCloudBook({ id: made.id, name: made.name });
    id = made.id;
  } else {
    // A folder name, so only what a folder name may hold.
    const slug = first.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    if (slug === "") {
      alert("That name has nothing in it a folder can be called.");
      return;
    }
    // Never into a folder this list has already given to somebody else.
    const taken = planned.some((e) => !group.includes(e) && e.book === slug);
    id = taken ? `${slug}-books` : slug;
    if (!(await switchLedger(id, first.name))) {
      alert("Could not start that set of books.");
      return;
    }
  }

  rememberOnboarding({
    entities: planned.map((e) => (group.includes(e) ? { ...e, book: id } : e)),
    at: "plan",
  });
  location.reload();
}

// --- the router between them ------------------------------------------------

function question(number: number, step: Step, held: Onboarding): HTMLElement {
  switch (step) {
    case "source":
      return sourceQuestion(number);
    case "date":
      return dateQuestion(number, held);
    case "one":
      return oneQuestion(number);
    case "shared":
      return sharedQuestion(number);
    case "entities":
      return entitiesQuestion(number, held);
    case "plan":
      return planQuestion(number, held);
    case "bank":
      return bankQuestion(number, held);
    case "files":
      return filesQuestion(number, held);
    case "checklist":
      return checklistQuestion(number, held);
    case "done":
      return doneQuestion(number, held);
  }
}

// --- the Xero guide ---------------------------------------------------------

function table(head: readonly string[], rows: readonly (readonly string[])[]): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "migration-table-wrap";
  const t = document.createElement("table");
  t.className = "report-table migration-table";
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const text of head) {
    const th = document.createElement("th");
    th.textContent = text;
    headRow.append(th);
  }
  thead.append(headRow);
  const tbody = document.createElement("tbody");
  for (const row of rows) {
    const tr = document.createElement("tr");
    for (const text of row) {
      const td = document.createElement("td");
      td.textContent = text;
      tr.append(td);
    }
    tbody.append(tr);
  }
  t.append(thead, tbody);
  wrap.append(t);
  return wrap;
}

/**
 * Moving from Xero, start to finish.
 *
 * The files are Setup's own list, so the two cannot name different exports.
 * What this adds is what Setup has no room for: the conversion date every
 * report hangs on, what to finish in Xero first, and how to prove the figures
 * arrived intact before Xero stops being the record.
 */
function xeroGuide(held: Onboarding): HTMLElement {
  const guide = document.createElement("div");
  guide.className = "migration-guide";
  const add = (tag: "h3" | "h4" | "p", text: string): void => {
    const el = document.createElement(tag);
    el.textContent = text;
    guide.append(el);
  };
  const items = (tag: "ol" | "ul", lines: readonly string[]): void => {
    const list = document.createElement(tag);
    for (const line of lines) {
      const li = document.createElement("li");
      li.textContent = line;
      list.append(li);
    }
    guide.append(list);
  };

  add(
    "p",
    "Xero stays the record until the checks at the end of this agree. Keep it open until " +
      "they do.",
  );

  add("h4", "1. Pick a conversion date");
  if (held.startDate !== undefined) {
    add("p", `You chose ${held.startDate}. Run the Xero reports below for the day before it.`);
  }
  add(
    "p",
    "The day NZOSA takes over. The first day of a financial year (1 April for most) is the " +
      "cleanest: the whole year's reports, depreciation and IR10 then come from one system, " +
      "and the opening balances are year-end figures your accountant has already signed off.",
  );
  add(
    "p",
    "Part way through a year works too. Choose the first day of a GST period, so no return " +
      "is split between two systems, and bring the year so far across as coded history.",
  );

  add("h4", "2. Finish off in Xero first");
  items("ul", [
    "Reconcile every bank account in Xero up to the day before the conversion date.",
    "File the last GST return that ends before it.",
    "Converting at a year end: have your accountant's year-end journals posted, so the trial " +
      "balance is the one the accounts were signed from.",
    "Keep access to Xero until your first year in NZOSA is filed. The history stays there if " +
      "a question comes up.",
  ]);

  add("h4", "3. Export from Xero");
  add(
    "p",
    "Export each of these as CSV or Excel. The chart of accounts and the account transactions " +
      "are enough to start; each of the others fills in more of the books, and Setup ticks " +
      "each one off as it arrives. Run the trial balance as at the day before the conversion " +
      "date: the previous year end, when converting on 1 April.",
  );
  guide.append(
    table(
      ["Export", "Where in Xero", "What it gives NZOSA"],
      xeroMigrationFiles().map((f) => [f.have ? `✓ ${f.what}` : f.what, f.where, f.why]),
    ),
  );
  add(
    "p",
    "Bank transactions do not come from Xero. NZOSA reads them from the bank itself, through " +
      "a bank feed or the bank's own CSV exports, so they are the bank's record rather than " +
      "Xero's copy of it.",
  );

  add("h4", "4. Load the files");
  add(
    "p",
    "Drop them on Setup all at once, with your bank's exports. Each file is recognised and " +
      "sorted before it is read (bank statements first, then the chart and account " +
      "transactions, then journals, invoices and assets, and the trial balance last), so the " +
      "order you pick them in does not matter.",
  );
  add("p", "Loading them one at a time on their own pages works too. Two orders matter there:");
  items("ul", [
    "The chart of accounts before the trial balance. A trial balance read first recognises " +
      "none of its account codes, and the opening balances land under names nothing else uses.",
    "Bank transactions and the chart before linking bank accounts on Entities & accounts, " +
      "because the link joins the two.",
  ]);
  add(
    "p",
    "Afterwards, link each bank account in the chart to the account the bank import found, " +
      "on Entities & accounts. Setup lists it as a step of its own.",
  );

  add("h4", "5. Check the conversion");
  add(
    "p",
    "Before trusting the new books, prove they agree with the old ones. Run each Xero report " +
      "for the same date as the NZOSA one beside it.",
  );
  guide.append(
    table(
      ["Check", "In NZOSA", "Against", "Should show"],
      [
        [
          "Trial balance",
          "Reports → Journal report and trial balance",
          "Xero Trial Balance",
          "Every account agrees, to the cent",
        ],
        [
          "Balance sheet",
          "Reports → Balance sheet",
          "Xero Balance Sheet",
          "Every line agrees, retained earnings included",
        ],
        [
          "Bank accounts",
          "Bank import → Import bank balances",
          "Your bank statements",
          "Each balance agrees with the bank on the conversion date",
        ],
        [
          "Money owed",
          "Reports → Balance sheet",
          "Xero Aged Receivables and Aged Payables",
          "Accounts receivable and payable agree with the aged totals",
        ],
        [
          "Fixed assets",
          "Reports → Depreciation schedule",
          "Xero Fixed Asset Reconciliation",
          "Cost, depreciation and book value agree",
        ],
        [
          "GST",
          "GST reconciliation",
          "Each GST return as filed",
          "Every filed period agrees, or the difference is explained",
        ],
        [
          "Coding",
          "Coding reconciliation",
          "Xero Account Transactions",
          "Lines coded differently are listed for you to decide",
        ],
      ],
    ),
  );

  add("h4", "6. After the conversion date");
  items("ul", [
    "Code new transactions in NZOSA only. Entering them in both is how the two drift apart " +
      "without anybody noticing.",
    "Payments for invoices raised in Xero are matched to the invoices brought across.",
    "At year end, give your accountant the reports from NZOSA. The journal report and trial " +
      "balance are the ones they will ask for first.",
  ]);

  return guide;
}
