import { showPage } from "../app.js";
import { saveEntities } from "../books.js";
import { chooseLedger } from "../daily/books-page.js";
import { addEntityForm } from "../daily/entities.js";
import { $, state } from "../state.js";
import { currentLedger, ledgerName, ledgers, writesToFolder } from "../store.js";
import { note } from "../ui.js";
import { DEFAULT_ENTITY_NAME, emptyEntityModel, reportsNetOfGst } from "@nzosa/core";
import type { EntityKind } from "@nzosa/core";
import { setupNameField, xeroMigrationFiles } from "./setup-wizard.js";

/**
 * Migration: a guided start, on trial beside Setup.
 *
 * Setup lists everything a set of books can be given and ticks it off, which
 * suits somebody who already knows what they have. Somebody new does not yet
 * know the thing it all depends on: whether their money is kept apart for each
 * entity, which decides how many sets of books they want before a single file
 * is loaded. So this asks that first, then whose books these are, then where
 * they are coming from -- and hands over to Setup, chosen for that answer.
 *
 * Nothing here is new accounting. The name is the field Setup uses, entities
 * are added with the form from Entities & accounts, and the source is Setup's
 * own selector, so the two pages cannot disagree.
 */

type Banks = "separate" | "shared" | "one";
type Source = "xero" | "sheet" | "new";

// How the money is kept is a fact about the person rather than about one set
// of books, so it is remembered across all of them: somebody sent off to start
// a separate set should not be asked again inside it. Where the books are
// coming from is asked of each set.
const BANKS_KEY = "nzosa.migration.banks";
const SOURCE_KEY = "nzosa.migration.source.";

function remembered(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function remember(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // A browser that blocks storage simply asks again next time.
  }
}

function banksAnswer(): Banks | undefined {
  const value = remembered(BANKS_KEY);
  return value === "separate" || value === "shared" || value === "one" ? value : undefined;
}

function sourceKey(): string {
  return SOURCE_KEY + (ledgerName() || "browser");
}

function sourceAnswer(): Source | undefined {
  const value = remembered(sourceKey());
  return value === "xero" || value === "sheet" || value === "new" ? value : undefined;
}

export function renderMigration(): void {
  const body = $("migration-body");
  body.textContent = "";
  const banks = banksAnswer();
  body.append(bankQuestion(banks));
  if (banks === undefined) return;
  body.append(nameQuestion(banks));
  const source = sourceAnswer();
  body.append(sourceQuestion(source));
  if (source === "xero") body.append(xeroGuide());
}

/** Setup opens on the source already answered here, rather than on Xero every time. */
export function wireMigration(): void {
  const source = sourceAnswer();
  if (source !== undefined) $<HTMLSelectElement>("setup-source").value = source;
}

function card(step: number, title: string, done: boolean): [HTMLElement, HTMLElement] {
  const box = document.createElement("div");
  box.className = done ? "migration-card done" : "migration-card";
  const heading = document.createElement("h3");
  const mark = document.createElement("span");
  mark.className = "migration-num";
  mark.textContent = done ? "✓" : String(step);
  heading.append(mark, document.createTextNode(title));
  const inner = document.createElement("div");
  box.append(heading, inner);
  return [box, inner];
}

function choices<T extends string>(
  options: readonly (readonly [T, string, string])[],
  chosen: T | undefined,
  pick: (value: T) => void,
): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "migration-choices";
  wrap.setAttribute("role", "group");
  for (const [value, label, hint] of options) {
    const choice = document.createElement("button");
    choice.type = "button";
    choice.className = "migration-choice";
    choice.setAttribute("aria-pressed", String(chosen === value));
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

// --- 1. how the money is kept ---------------------------------------------

function bankQuestion(banks: Banks | undefined): HTMLElement {
  const [box, inner] = card(
    1,
    "Do you have bank accounts that are separate for each entity?",
    banks !== undefined,
  );
  inner.append(
    note(
      "An entity is anything whose income is worked out on its own: a company, a rental " +
        "property, a trust, your personal affairs.",
    ),
  );
  inner.append(
    choices<Banks>(
      [
        [
          "separate",
          "Yes, each has its own",
          "The company's account pays only the company's costs, the rental's only the rental's",
        ],
        [
          "shared",
          "No, some are shared",
          "One account pays for more than one entity: rental costs from a personal account, say",
        ],
        ["one", "There is only one entity", "Just a company, or just one person's affairs"],
      ],
      banks,
      (value) => {
        remember(BANKS_KEY, value);
        renderMigration();
      },
    ),
  );

  if (banks === "separate") {
    inner.append(
      advice(
        "We recommend a separate set of books for each entity. Each one's accounts, reports " +
          "and returns then stand on their own: nothing from one can reach another's figures, " +
          "and each can go to its accountant, or its other owners, without the rest.",
        "Set them up one at a time. The questions below are about the books open now.",
      ),
    );
    const books = document.createElement("div");
    inner.append(books);
    void listBooks(books);
  } else if (banks === "shared") {
    inner.append(
      advice(
        "Keep them together in one set of books, with an entity for each. Every account in " +
          "the chart belongs to one entity, so each still gets its own profit and loss, and a " +
          "shared bank account is ticked for every entity it pays for.",
        "Separate books would each need their own copy of the shared account's transactions, " +
          "which is how a payment ends up counted in both sets, or in neither.",
      ),
    );
  } else if (banks === "one") {
    inner.append(advice("One set of books, with one entity. Nothing to keep apart."));
  }
  return box;
}

async function listBooks(where: HTMLElement): Promise<void> {
  if (!writesToFolder()) {
    where.append(
      note(
        "This copy runs in a browser, so it holds one set of books. To keep a set for each " +
          "entity, run NZOSA on your own computer, where each set is a folder of its own.",
      ),
    );
    return;
  }
  const [all, open] = await Promise.all([ledgers(), currentLedger()]);
  const list = document.createElement("ul");
  list.className = "migration-list";
  for (const book of all) {
    const item = document.createElement("li");
    item.textContent =
      `${book.name} — ${book.transactions} transaction${book.transactions === 1 ? "" : "s"}`;
    if (book.id === open) {
      const here = document.createElement("span");
      here.className = "books-open";
      here.textContent = "open now";
      item.append(" ", here);
    }
    list.append(item);
  }
  where.append(
    list,
    actions(
      button("New set of books…", () => void chooseLedger(" new")),
      button("Books page", () => showPage("books")),
    ),
  );
}

// --- 2. whose books -------------------------------------------------------

const KINDS: readonly (readonly [EntityKind, string])[] = [
  ["business", "Business"],
  ["residential", "Residential rental"],
  ["commercial", "Commercial rental"],
  ["personal", "Personal"],
];

function kindName(kind: EntityKind | undefined): string {
  return KINDS.find(([value]) => value === (kind ?? "business"))?.[1] ?? "Business";
}

function nameQuestion(banks: Banks): HTMLElement {
  const model = state.ledger.entities ?? emptyEntityModel();
  const first = model.entities[0];
  const named =
    first !== undefined && !model.entities.some((e) => e.name === DEFAULT_ENTITY_NAME);
  const [box, inner] = card(2, "For this set of books, what is the entity name?", named);
  inner.append(setupNameField());
  if (first !== undefined && first.name !== DEFAULT_ENTITY_NAME) {
    inner.append(entityDetails(first.id));
  }

  const others = model.entities.slice(1);
  if (banks === "shared" || others.length > 0) {
    const heading = document.createElement("h4");
    heading.textContent = "The other entities in these books";
    inner.append(heading);
    if (others.length === 0) {
      inner.append(
        note(
          "None yet. Add each one that shares these bank accounts: a rental property, your " +
            "personal affairs, a trust.",
        ),
      );
    } else {
      const list = document.createElement("ul");
      list.className = "migration-list";
      for (const entity of others) {
        const item = document.createElement("li");
        item.textContent =
          `${entity.name} — ${kindName(entity.kind)}, ` +
          (reportsNetOfGst(entity) ? "GST registered" : "not GST registered");
        list.append(item);
      }
      inner.append(list);
    }
    inner.append(addEntityForm());
    inner.append(
      note(
        "Then give each account in the chart, and each bank account, to the entity it " +
          "belongs to.",
      ),
      actions(button("Entities & accounts", () => showPage("entities"))),
    );
  }
  return box;
}

/**
 * What the entity is, and whether it is registered.
 *
 * Asked straight after the name because both change figures: a residential
 * rental's losses are ring-fenced, and registration decides whether its
 * reports are net of GST. The name field makes a GST-registered business,
 * which is wrong for most rentals and for anybody's personal books.
 */
function entityDetails(id: string): HTMLElement {
  const row = document.createElement("div");
  row.className = "migration-entity";
  const entity = (state.ledger.entities ?? emptyEntityModel()).entities.find((e) => e.id === id);
  if (entity === undefined) return row;

  const kindLabel = document.createElement("label");
  kindLabel.append("What it is ");
  const kind = document.createElement("select");
  for (const [value, caption] of KINDS) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = caption;
    option.selected = (entity.kind ?? "business") === value;
    kind.append(option);
  }
  kind.title = "Residential rental losses are ring-fenced; the others are not.";
  kind.addEventListener("change", () => {
    const live = state.ledger.entities ?? emptyEntityModel();
    void saveEntities({
      ...live,
      entities: live.entities.map((e) =>
        e.id === id ? { ...e, kind: kind.value as EntityKind } : e,
      ),
    });
  });
  kindLabel.append(kind);

  const gstLabel = document.createElement("label");
  const gst = document.createElement("input");
  gst.type = "checkbox";
  gst.checked = reportsNetOfGst(entity);
  gstLabel.append(gst, " GST registered");
  gst.addEventListener("change", () => {
    const live = state.ledger.entities ?? emptyEntityModel();
    void saveEntities(
      {
        ...live,
        entities: live.entities.map((e) =>
          e.id === id ? { ...e, gstRegistered: gst.checked } : e,
        ),
      },
      `${entity.name} ${gst.checked ? "is" : "is not"} GST registered`,
    );
  });

  row.append(kindLabel, gstLabel);
  return row;
}

// --- 3. where the books are coming from -------------------------------------

function sourceQuestion(source: Source | undefined): HTMLElement {
  const [box, inner] = card(
    3,
    "For this set of books, are you moving from Xero, a spreadsheet, or starting fresh?",
    source !== undefined,
  );
  inner.append(
    choices<Source>(
      [
        [
          "xero",
          "From Xero",
          "Chart, coding, opening balances, invoices and assets come across from Xero's exports",
        ],
        ["sheet", "From a spreadsheet", "The coding already in the sheet becomes the rules"],
        ["new", "Starting fresh", "A starter chart to adjust; rules come from your first codings"],
      ],
      source,
      (value) => {
        remember(sourceKey(), value);
        $<HTMLSelectElement>("setup-source").value = value;
        renderMigration();
      },
    ),
  );

  if (source === "xero") {
    inner.append(
      advice(
        "Read the guide below before exporting anything. The conversion date decides which " +
          "date every Xero report is run for.",
      ),
    );
  } else if (source === "sheet") {
    inner.append(
      advice(
        "Have ready: the spreadsheet, with a column for the account each line was coded to; " +
          "your bank's exports for the same accounts and dates; and last year's balance sheet " +
          "from your accountant, for the opening balances.",
      ),
    );
  } else if (source === "new") {
    inner.append(
      advice(
        "Nothing to bring across: your bank transactions, the name above, and a starter chart " +
          "of accounts to adjust.",
        "New books are not always a new entity. A company or rental that has been going a " +
          "while still has opening balances, so ask your accountant for last year's balance sheet.",
      ),
    );
  }
  if (source !== undefined) {
    inner.append(actions(button("Continue to Setup →", () => showPage("setup", "top"), true)));
  }
  return box;
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
function xeroGuide(): HTMLElement {
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

  add("h4", "4. Load in this order");
  items("ol", [
    "Bank transactions, on Bank import. Everything else hangs off these.",
    "Chart of accounts, on Setup, then link each bank account in the chart to the account " +
      "the bank import found, on Entities & accounts.",
    "Opening balances, from the trial balance, on Opening balances.",
    "Account transactions, on Coding reconciliation. Xero's coding is compared line by line " +
      "with NZOSA's, and becomes the rules.",
    "Invoices and payment allocations, on Invoices.",
    "Fixed assets, on Fixed assets.",
    "The journal report, on Reports, for the accountant's journals.",
    "Filed GST returns, on GST reconciliation.",
  ]);

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
        ["Trial balance", "Reports → Journal report and trial balance", "Xero Trial Balance", "Every account agrees, to the cent"],
        ["Balance sheet", "Reports → Balance sheet", "Xero Balance Sheet", "Every line agrees, retained earnings included"],
        ["Bank accounts", "Bank import → Import bank balances", "Your bank statements", "Each balance agrees with the bank on the conversion date"],
        ["Money owed", "Reports → Balance sheet", "Xero Aged Receivables and Aged Payables", "Accounts receivable and payable agree with the aged totals"],
        ["Fixed assets", "Reports → Depreciation schedule", "Xero Fixed Asset Reconciliation", "Cost, depreciation and book value agree"],
        ["GST", "GST reconciliation", "Each GST return as filed", "Every filed period agrees, or the difference is explained"],
        ["Coding", "Coding reconciliation", "Xero Account Transactions", "Lines coded differently are listed for you to decide"],
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
