import { showPage } from "../app.js";
import { saveEntities } from "../books.js";
import { createBook } from "../cloud.js";
import { $, state } from "../state.js";
import { backendKind, openCloudBook, save, switchLedger } from "../store.js";
import { note } from "../ui.js";
import { DEFAULT_ENTITY_NAME, emptyEntityModel, entityId } from "@nzosa/core";
import type { Entity, EntityKind, EntityModel } from "@nzosa/core";
import { xeroMigrationFiles } from "./setup-wizard.js";
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
  steps.push("entities", "plan");
  return steps;
}

function at(held: Onboarding): Step {
  const steps = stepsFor(held);
  const wanted = held.at;
  return wanted !== undefined && steps.includes(wanted) ? wanted : "source";
}

export function renderMigration(): void {
  const body = $("migration-body");
  body.textContent = "";
  const held = onboarding();
  const here = at(held);
  const steps = stepsFor(held);
  const reached = steps.indexOf(here);

  steps.forEach((step, index) => {
    if (index < reached) body.append(summary(step, held));
    else if (index === reached) body.append(question(index + 1, step, held));
  });

  if (held.source === "xero") body.append(xeroGuide(held));
  if (held.at !== undefined) body.append(startAgain());
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
): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "migration-choices";
  wrap.setAttribute("role", "group");
  for (const [value, label, hint] of options) {
    const choice = document.createElement("button");
    choice.type = "button";
    choice.className = "migration-choice";
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
    case "plan":
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
          "Nothing to bring in. The books start here and your bank import fills them",
        ],
        [
          "balances",
          "From last year's closing balances",
          "A trial balance at your last year end, then on from there",
        ],
        [
          "xero",
          "Import from Xero",
          "Chart, coding, opening balances, invoices and assets come across from Xero's exports",
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
      "An entity is anything whose income is worked out on its own: a company, a rental " +
        "property, a trust, your personal affairs.",
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

function entityRow(entity: PlannedEntity | undefined, onChange: () => void): HTMLElement {
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

  const remove = button("Remove", () => {
    row.remove();
    onChange();
  });
  remove.className = "migration-entity-remove";

  row.append(name, kind, gstLabel, remove);
  return row;
}

function entitiesQuestion(number: number, held: Onboarding): HTMLElement {
  const one = held.onlyOne === true;
  const [box, inner] = card(
    number,
    one ? "What is this entity called?" : "Which entities do you have?",
  );

  inner.append(
    note(
      one
        ? "The one fact no export contains: a chart arrives with sixty accounts and not one " +
            "of them says whose they are."
        : held.shared === true
          ? "Name each one that shares those accounts. They all go in one set of books, and " +
            "each still gets its own profit and loss and its own GST return."
          : "Name each one. Each gets a set of books of its own, started for you at the end.",
    ),
  );

  const rows = document.createElement("div");
  rows.className = "migration-entities";
  const known = (held.entities ?? []).filter((e) => e.name.trim() !== "");
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
    rows.append(entityRow(entity, changed));
  }
  inner.append(rows);

  if (!one) {
    inner.append(
      actions(
        button("Add another", () => {
          rows.append(entityRow(undefined, changed));
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
          answer({ entities, at: "plan" });
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

function applyPanel(planned: readonly PlannedEntity[], held: Onboarding): HTMLElement {
  const wrap = document.createElement("div");
  const live = state.ledger.entities ?? emptyEntityModel();
  const alreadyThere =
    planned.length > 0 &&
    planned.every((p) => live.entities.some((e) => e.id === entityId(p.name)));

  const list = document.createElement("ul");
  list.className = "migration-list";
  for (const entity of planned) {
    const item = document.createElement("li");
    item.textContent =
      `${entity.name} — ${kindName(entity.kind)}, ` +
      (entity.gst ? "GST registered" : "not GST registered");
    list.append(item);
  }
  wrap.append(list);

  const trouble = document.createElement("p");
  trouble.className = "cloud-said";

  if (alreadyThere) {
    trouble.textContent = "Saved to these books ✓";
    wrap.append(trouble, nextSteps(held));
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

/** Where to go once the questions are answered and the entities are in. */
function nextSteps(held: Onboarding): HTMLElement {
  const wrap = document.createElement("div");
  const several = (held.entities ?? []).length > 1 && held.shared === true;
  const points: string[] = [];

  if (held.source === "xero") {
    points.push(
      "Read the Xero guide below before exporting anything, then drop the files on Setup.",
    );
  } else if (held.source === "sheet") {
    points.push(
      "Have ready: the spreadsheet, with a column for the account each line was coded to; " +
        "your bank's exports for the same accounts and dates; and last year's balance sheet " +
        "from your accountant, for the opening balances.",
    );
  } else if (held.opening === true) {
    points.push(
      "Have ready: last year's balance sheet or trial balance from your accountant, and your " +
        "bank's exports from the start date on.",
    );
  } else {
    points.push(
      "Nothing to bring across: your bank transactions, and a starter chart of accounts to " +
        "adjust. New books are not always a new entity, though -- a company or rental that " +
        "has been going a while still has opening balances.",
    );
  }
  if (several) {
    points.push(
      "Then give each account in the chart, and each bank account, to the entity it belongs " +
        "to, on Entities & accounts. Until that is done the reports cannot be split by entity.",
    );
  }

  wrap.append(advice(...points));
  wrap.append(
    actions(
      button("Continue to Setup →", () => showPage("setup", "top"), true),
      ...(several ? [button("Entities & accounts", () => showPage("entities"))] : []),
    ),
  );
  return wrap;
}

function planQuestion(number: number, held: Onboarding): HTMLElement {
  const planned = (held.entities ?? []).filter((e) => e.name.trim() !== "");
  const separate = held.onlyOne === false && held.shared === false;
  const [box, inner] = card(number, separate ? "A set of books for each" : "One set of books");

  if (!separate) {
    inner.append(
      advice(
        planned.length === 1
          ? "One set of books, with one entity. Nothing to keep apart."
          : "One set of books, holding all of them. Every account in the chart belongs to " +
              "one entity, so each gets its own profit and loss and its own GST return, and " +
              "a shared bank account is ticked for every entity it pays for.",
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
    inner.append(applyPanel(planned, held));
    return box;
  }

  inner.append(
    advice(
      `${planned.length} separate sets of books, one for each. Nothing in one can reach ` +
        "another's figures, and each can go to its accountant on its own.",
      "They are started one at a time, from here. Starting one opens it, and these questions " +
        "carry on inside it.",
    ),
  );
  inner.append(queue(planned, held));
  return box;
}

/**
 * The sets of books still to start, and the one that is open.
 *
 * Starting a set switches to it and reloads, which is what the Books page does
 * too -- half the app holding one ledger while half holds another is a class
 * of bug that produces plausible wrong figures. So the list is kept outside
 * any one set of books, and picks up where it left off afterwards.
 */
function queue(planned: readonly PlannedEntity[], held: Onboarding): HTMLElement {
  const wrap = document.createElement("div");
  const open = booksKey();

  if (backendKind() === "browser") {
    wrap.append(
      note(
        "This copy runs in a browser, so it holds one set of books. To keep a set for each " +
          "entity, run NZOSA on your own computer, where each set is a folder of its own, or " +
          "sign in to keep them on the server.",
      ),
    );
    const first = planned[0];
    if (first !== undefined) {
      wrap.append(
        advice(`These books can hold ${first.name}. The rest need somewhere to live first.`),
        applyPanel([first], held),
      );
    }
    return wrap;
  }

  const list = document.createElement("div");
  list.className = "migration-queue";
  for (const entity of planned) {
    const row = document.createElement("div");
    row.className = "migration-queue-row";
    const name = document.createElement("span");
    name.className = "migration-queue-name";
    name.textContent = `${entity.name} — ${kindName(entity.kind)}`;
    row.append(name);

    if (entity.book !== undefined && entity.book === open) {
      const here = document.createElement("span");
      here.className = "books-open";
      here.textContent = "open now";
      row.append(here);
    } else if (entity.book !== undefined) {
      const done = document.createElement("span");
      done.className = "migration-queue-done";
      done.textContent = "✓ started";
      row.append(done);
    } else {
      row.append(
        button(`Start ${entity.name}'s books`, () => {
          void startBooksFor(entity, planned);
        }),
      );
    }
    list.append(row);
  }
  wrap.append(list);

  // The entity whose books are open now still has to be written into them.
  const here = planned.find((e) => e.book !== undefined && e.book === open);
  if (here !== undefined) {
    const mine = document.createElement("div");
    mine.className = "migration-here";
    const heading = document.createElement("h4");
    heading.textContent = `These books are for ${here.name}`;
    mine.append(heading, applyPanel([here], held));
    wrap.append(mine);
  } else if (planned.some((e) => e.book !== undefined)) {
    wrap.append(
      note(
        "Start the next one when you are ready. The ones already started stay as they are " +
          "until you open them.",
      ),
    );
  }
  return wrap;
}

/**
 * Start a set of books for one entity, and go into it.
 *
 * A folder gets a folder; a server account gets a set of books on the server.
 * Either way the page reloads into the new set, because everything on screen
 * belongs to the books that were open.
 */
async function startBooksFor(
  entity: PlannedEntity,
  planned: readonly PlannedEntity[],
): Promise<void> {
  let id: string;

  if (backendKind() === "cloud") {
    const made = await createBook(entity.name);
    if (made === null) {
      alert("Could not start that set of books.");
      return;
    }
    openCloudBook({ id: made.id, name: made.name });
    id = made.id;
  } else {
    // A folder name, so only what a folder name may hold.
    const slug = entity.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    if (slug === "") {
      alert("That name has nothing in it a folder can be called.");
      return;
    }
    // Never into a folder this list has already given to somebody else.
    const taken = planned.some((e) => e.name !== entity.name && e.book === slug);
    id = taken ? `${slug}-books` : slug;
    if (!(await switchLedger(id, entity.name))) {
      alert("Could not start that set of books.");
      return;
    }
  }

  rememberOnboarding({
    entities: planned.map((e) => (e.name === entity.name ? { ...e, book: id } : e)),
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

  add("h3", "Moving from Xero");
  add(
    "p",
    "How a Xero organisation comes across: the date it happens on, what to finish first, " +
      "what to export, the order to load it in, and how to check the figures arrived intact. " +
      "Xero stays the record until those checks agree.",
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

  guide.append(actions(button("Continue to Setup →", () => showPage("setup", "top"), true)));
  return guide;
}
